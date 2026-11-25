import { z } from "zod";
import { eventListSchema } from "@/modules/events/schema";
const date = z.iso.date();
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const fields = z.strictObject({
  title: z.string().trim().min(1).max(150),
  payerName: z.string().trim().min(1).max(150),
  vendorName: z.string().trim().max(150).optional(),
  notes: z.string().trim().max(5000).optional(),
  expenseDate: date,
  paidPaise: money.default(0),
  remainingPaise: money.default(0),
  firstPaymentDate: date.optional(),
  latestPaymentDate: date.optional(),
  remainingDueDate: date.optional(),
});
export const createSchema = fields.superRefine((v, c) => {
  const issue = (path: string, message: string) =>
    c.addIssue({ code: "custom", path: [path], message });
  if (!Number.isSafeInteger(v.paidPaise + v.remainingPaise))
    issue("remainingPaise", "The recorded total is too large.");
  if (v.paidPaise > 0) {
    if (!v.firstPaymentDate)
      issue("firstPaymentDate", "Enter the first payment date.");
    if (!v.latestPaymentDate)
      issue("latestPaymentDate", "Enter the latest payment date.");
    if (
      v.firstPaymentDate &&
      v.latestPaymentDate &&
      v.latestPaymentDate < v.firstPaymentDate
    )
      issue(
        "latestPaymentDate",
        "Latest payment must be on or after the first payment.",
      );
  } else if (v.firstPaymentDate || v.latestPaymentDate)
    issue("firstPaymentDate", "Clear payment dates when paid is zero.");
  if (v.remainingPaise === 0 && v.remainingDueDate)
    issue("remainingDueDate", "Clear the due date when no balance remains.");
});
export const patchSchema = fields
  .partial()
  .extend({
    paidPaise: money.optional(),
    remainingPaise: money.optional(),
    vendorName: fields.shape.vendorName.nullable(),
    notes: fields.shape.notes.nullable(),
    firstPaymentDate: date.nullable().optional(),
    latestPaymentDate: date.nullable().optional(),
    remainingDueDate: date.nullable().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine((v) => Object.keys(v).length > 1);
export const querySchema = eventListSchema.extend({
  outstanding: z.enum(["true", "false"]).optional(),
  dueBefore: date.optional(),
});
export type ExpenseValues = z.infer<typeof createSchema>;
export type Expense = ExpenseValues & {
  id: string;
  weddingId: string;
  totalPaise: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export function parseRupees(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return NaN;
  const [rupees, paise = ""] = value.trim().split(".");
  const amount = BigInt(rupees) * BigInt(100) + BigInt(paise.padEnd(2, "0"));
  return amount > BigInt(Number.MAX_SAFE_INTEGER) ? NaN : Number(amount);
}
export const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    paise / 100,
  );
