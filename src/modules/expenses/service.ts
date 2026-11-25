import "server-only";
import type { ClientSession } from "mongoose";
import { z } from "zod";
import { transaction } from "@/lib/db/connection";
import { AppError } from "@/lib/http/errors";
import {
  weddingForMember,
  id,
  type AccountActor,
} from "@/modules/weddings/service";
import { readPosition, writePosition } from "@/modules/weddings/pagination";
import { ExpenseModel, ensureExpenses } from "./model";
import { createSchema, patchSchema, querySchema, type Expense } from "./schema";
async function access(a: AccountActor, w: string, s?: ClientSession) {
  await ensureExpenses();
  await weddingForMember(a, w, s, false, !!s);
}
function dto(e: InstanceType<typeof ExpenseModel>): Expense {
  return {
    ...createSchema.parse({
      title: e.title,
      payerName: e.payerName,
      vendorName: e.vendorName,
      notes: e.notes,
      expenseDate: e.expenseDate,
      paidPaise: e.paidPaise,
      remainingPaise: e.remainingPaise,
      firstPaymentDate: e.firstPaymentDate,
      latestPaymentDate: e.latestPaymentDate,
      remainingDueDate: e.remainingDueDate,
    }),
    id: String(e._id),
    weddingId: String(e.weddingId),
    totalPaise: e.paidPaise + e.remainingPaise,
    version: e.version,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
async function record(
  w: string,
  e: string,
  s?: ClientSession,
  deleted = false,
) {
  const row = await ExpenseModel.findOne({
    _id: id(e),
    weddingId: id(w),
    ...(!deleted && { isDeleted: false }),
  }).session(s ?? null);
  if (!row)
    throw new AppError(404, "NOT_FOUND", "This expense is unavailable.");
  return row;
}
export async function getExpense(a: AccountActor, w: string, e: string) {
  await access(a, w);
  return dto(await record(w, e));
}
export async function listExpenses(
  a: AccountActor,
  w: string,
  input: z.input<typeof querySchema> = {},
) {
  await access(a, w);
  const { limit, cursor, ...filters } = querySchema.parse(input);
  const scope = JSON.stringify([
      "expenses",
      a.id,
      a.sessionVersion,
      w,
      limit,
      filters,
    ]),
    position = readPosition(cursor, scope);
  const date = position?.date.slice(0, 10);
  const rows = await ExpenseModel.find({
    weddingId: id(w),
    isDeleted: false,
    ...((filters.outstanding === "true" || filters.dueBefore) && {
      remainingPaise: { $gt: 0 },
    }),
    ...(filters.dueBefore && { remainingDueDate: { $lt: filters.dueBefore } }),
    ...(position && {
      $or: [
        { expenseDate: { $lt: date } },
        { expenseDate: date, _id: { $lt: id(position.id) } },
      ],
    }),
  })
    .sort({ expenseDate: -1, _id: -1 })
    .limit(limit + 1);
  const shown = rows.slice(0, limit),
    last = shown.at(-1);
  return {
    data: shown.map(dto),
    page: {
      limit,
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit && last
          ? writePosition(
              String(last._id),
              new Date(last.expenseDate + "T00:00:00Z"),
              scope,
            )
          : null,
    },
  };
}
export async function expenseSummary(a: AccountActor, w: string) {
  await access(a, w);
  const rows = await ExpenseModel.find({ weddingId: id(w), isDeleted: false })
    .select("paidPaise remainingPaise")
    .lean();
  let paid = BigInt(0),
    remaining = BigInt(0);
  for (const row of rows) {
    paid += BigInt(row.paidPaise);
    remaining += BigInt(row.remainingPaise);
  }
  if (paid + remaining > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AppError(
      422,
      "AMOUNT_TOO_LARGE",
      "The combined expense total exceeds supported precision.",
    );
  return {
    currency: "INR",
    paidPaise: Number(paid),
    remainingPaise: Number(remaining),
    totalPaise: Number(paid + remaining),
    expenseCount: rows.length,
  };
}
export async function createExpense(
  a: AccountActor,
  w: string,
  input: z.infer<typeof createSchema>,
) {
  return transaction(async (s) => {
    await access(a, w, s);
    const [e] = await ExpenseModel.create(
      [
        {
          ...createSchema.parse(input),
          weddingId: id(w),
          createdBy: id(a.id),
          updatedBy: id(a.id),
        },
      ],
      { session: s },
    );
    return dto(e);
  });
}
export async function editExpense(
  a: AccountActor,
  w: string,
  e: string,
  input: z.infer<typeof patchSchema>,
) {
  return transaction(async (s) => {
    await access(a, w, s);
    const row = await record(w, e, s);
    if (row.version !== input.expectedVersion)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "This expense changed. Review the latest details.",
      );
    const { expectedVersion, ...patch } = input;
    void expectedVersion;
    const current = dto(row);
    const base = createSchema.parse(currentValues(current));
    const merged = {
      ...base,
      ...Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v]),
      ),
    };
    const result = createSchema.safeParse(merged);
    if (!result.success)
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Check the expense details.",
        {
          fields: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      );
    for (const key of Object.keys(base))
      if (!(key in result.data)) row.set(key, undefined);
    row.set(result.data);
    row.updatedBy = id(a.id);
    row.increment();
    await row.save({ session: s });
    return dto(row);
  });
}
function currentValues(e: Expense) {
  const {
    id: _,
    weddingId,
    totalPaise,
    version,
    createdAt,
    updatedAt,
    ...values
  } = e;
  void _;
  void weddingId;
  void totalPaise;
  void version;
  void createdAt;
  void updatedAt;
  return values;
}
export async function deleteExpense(
  a: AccountActor,
  w: string,
  e: string,
  version: number,
) {
  await transaction(async (s) => {
    await access(a, w, s);
    const row = await record(w, e, s, true);
    if (row.isDeleted) return;
    if (row.version !== version)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "This expense changed. Review the latest details.",
      );
    row.isDeleted = true;
    row.deletedAt = new Date();
    row.deletedBy = id(a.id);
    row.updatedBy = id(a.id);
    row.increment();
    await row.save({ session: s });
  });
}
