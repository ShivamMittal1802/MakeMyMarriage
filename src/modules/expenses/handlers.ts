import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { api, readJson, success } from "@/lib/http/api";
import { AppError } from "@/lib/http/errors";
import { currentActor } from "@/lib/access/actor";
import { guestWriter } from "@/modules/guests/writer";
import { createSchema, patchSchema, querySchema } from "./schema";
import {
  listExpenses,
  expenseSummary,
  createExpense,
  getExpense,
  editExpense,
  deleteExpense,
} from "./service";
type Context = { params: Promise<{ weddingId: string; expenseId?: string }> };
export const list = (r: NextRequest, c: Context) =>
  api(async () => {
    const q = querySchema.safeParse(Object.fromEntries(r.nextUrl.searchParams));
    if (!q.success)
      throw new AppError(422, "VALIDATION_ERROR", "Check the expense filters.");
    return NextResponse.json(
      await listExpenses(
        await currentActor(),
        (await c.params).weddingId,
        q.data,
      ),
    );
  });
export const summary = (_r: NextRequest, c: Context) =>
  api(async () =>
    success(
      await expenseSummary(await currentActor(), (await c.params).weddingId),
    ),
  );
export const get = (_r: NextRequest, c: Context) =>
  api(async () => {
    const p = await c.params;
    return success(
      await getExpense(await currentActor(), p.weddingId, p.expenseId!),
    );
  });
export const create = (r: NextRequest, c: Context) =>
  api(async () =>
    success(
      await createExpense(
        await guestWriter(r),
        (await c.params).weddingId,
        await readJson(r, createSchema),
      ),
      201,
    ),
  );
export const patch = (r: NextRequest, c: Context) =>
  api(async () => {
    const p = await c.params;
    return success(
      await editExpense(
        await guestWriter(r),
        p.weddingId,
        p.expenseId!,
        await readJson(r, patchSchema),
      ),
    );
  });
export const remove = (r: NextRequest, c: Context) =>
  api(async () => {
    const a = await guestWriter(r),
      p = await c.params,
      v = z.coerce
        .number()
        .int()
        .nonnegative()
        .safeParse(r.nextUrl.searchParams.get("expectedVersion") ?? undefined);
    if (!v.success)
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Supply the expense version.",
      );
    await deleteExpense(a, p.weddingId, p.expenseId!, v.data);
    return new NextResponse(null, { status: 204 });
  });
