"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getResponse, mutateJson, ApiClientError } from "@/lib/http/client";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { ListPage } from "@/modules/weddings/schemas";
import { parseRupees, rupees, type Expense } from "./schema";
import g from "@/modules/guests/guests.module.css";
import s from "./expenses.module.css";
const base = (w: string) => "/dashboard/" + w + "/expenses";
const api = (w: string) => "/api/v1/weddings/" + w + "/expenses";
function feedback(e: unknown) {
  return e instanceof ApiClientError
    ? e.fields.map((f) => f.message).join(" ") || e.message
    : e instanceof Error
      ? e.message
      : "Please refresh and try again.";
}
function Stats({
  paidPaise,
  remainingPaise,
  totalPaise,
}: {
  paidPaise: number;
  remainingPaise: number;
  totalPaise: number;
}) {
  return (
    <div className={s.stats}>
      {[
        ["Recorded total cost", totalPaise],
        ["Paid so far", paidPaise],
        ["Remaining balance", remainingPaise],
      ].map(([label, value]) => (
        <article key={label}>
          <small>{label}</small>
          <strong>{rupees(Number(value))}</strong>
        </article>
      ))}
    </div>
  );
}
function Status({ expense: e }: { expense: Expense }) {
  return (
    <span className={g.pill}>
      {e.remainingPaise > 0
        ? "Outstanding"
        : e.paidPaise > 0
          ? "Fully paid"
          : "No amount recorded"}
    </span>
  );
}
export function Overview({
  w,
  initial,
  summary,
  outstanding,
  dueBefore,
}: {
  w: string;
  initial: ListPage<Expense>;
  summary: {
    paidPaise: number;
    remainingPaise: number;
    totalPaise: number;
    expenseCount: number;
  };
  outstanding?: string;
  dueBefore?: string;
}) {
  const [list, setList] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function more() {
    if (!list.page.nextCursor) return;
    setBusy(true);
    try {
      const next = await getResponse<ListPage<Expense>>(
        api(w) +
          "?" +
          new URLSearchParams({
            cursor: list.page.nextCursor,
            ...(outstanding && { outstanding }),
            ...(dueBefore && { dueBefore }),
          }),
      );
      setList({ ...next, data: [...list.data, ...next.data] });
    } catch (e) {
      setError(feedback(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={g.heading}>
        <div>
          <h1>Wedding expenses</h1>
          <p>
            Track recorded costs, cumulative payments, and outstanding balances.
          </p>
        </div>
        <Link className={g.primary} href={base(w) + "?view=new"}>
          ＋ Add expense
        </Link>
      </div>
      <Stats {...summary} />
      <p>{summary.expenseCount} expense records across this wedding</p>
      <form className={g.toolbar} action={base(w)}>
        <select
          name="outstanding"
          defaultValue={outstanding ?? "false"}
          aria-label="Expense status"
        >
          <option value="false">All expenses</option>
          <option value="true">Outstanding</option>
        </select>
        <label>
          Due before{" "}
          <input type="date" name="dueBefore" defaultValue={dueBefore} />
        </label>
        <button className={g.soft}>Apply</button>
        <Link href={base(w)}>Clear filters</Link>
      </form>
      <section className={s.list}>
        <div className={s.columns}>
          <span>Expense title & vendor</span>
          <span>Expense date / Payer</span>
          <span>Paid so far</span>
          <span>Remaining / Due date</span>
          <span>Actions</span>
        </div>
        {list.data.map((e) => (
          <article key={e.id}>
            <div>
              <strong>{e.title}</strong>
              <p>{e.vendorName}</p>
              <Status expense={e} />
            </div>
            <div>
              {e.expenseDate}
              <p>{e.payerName}</p>
            </div>
            <div>{rupees(e.paidPaise)}</div>
            <div>
              <strong>{rupees(e.remainingPaise)}</strong>
              <p>
                {e.remainingPaise > 0
                  ? (e.remainingDueDate ?? "No due date")
                  : "—"}
              </p>
            </div>
            <Link href={base(w) + "?expense=" + e.id}>View details →</Link>
          </article>
        ))}
        {!list.data.length && (
          <p className={s.empty}>
            {summary.expenseCount
              ? "No expenses match these filters."
              : "No expenses yet. Add your first expense."}
          </p>
        )}
        {list.page.hasMore && (
          <button
            disabled={busy}
            onClick={() => void more()}
            className={g.soft}
          >
            Load more expenses
          </button>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      <p className={s.privacy}>
        Expenses are private to your wedding planning team.
      </p>
    </>
  );
}
export function ExpenseForm({
  w,
  expense,
  payment = false,
}: {
  w: string;
  expense?: Expense;
  payment?: boolean;
}) {
  const router = useRouter(),
    [paid, setPaid] = useState(String((expense?.paidPaise ?? 0) / 100)),
    [remaining, setRemaining] = useState(
      String((expense?.remainingPaise ?? 0) / 100),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [blocked, setBlocked] = useState(false);
  const paidValue = parseRupees(paid),
    remainingValue = parseRupees(remaining);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    const values: Record<string, unknown> = {
      paidPaise: paidValue,
      remainingPaise: remainingValue,
    };
    for (const key of [
      "title",
      "payerName",
      "vendorName",
      "expenseDate",
      "notes",
      "firstPaymentDate",
      "latestPaymentDate",
      "remainingDueDate",
    ]) {
      const value = String(data.get(key) ?? "").trim();
      values[key] = value || (expense ? null : undefined);
    }
    if (paidValue === 0) {
      values.firstPaymentDate = expense ? null : undefined;
      values.latestPaymentDate = expense ? null : undefined;
    }
    if (remainingValue === 0)
      values.remainingDueDate = expense ? null : undefined;
    try {
      if (
        !Number.isSafeInteger(paidValue) ||
        !Number.isSafeInteger(remainingValue)
      )
        throw new Error(
          "Enter nonnegative amounts with up to two decimal places.",
        );
      const saved = await mutateJson<Expense>(
        api(w) + (expense ? "/" + expense.id : ""),
        expense ? "PATCH" : "POST",
        { ...values, ...(expense && { expectedVersion: expense.version }) },
      );
      router.push(base(w) + "?expense=" + saved.id);
      router.refresh();
    } catch (err) {
      setError(feedback(err));
      setBlocked(
        err instanceof ApiClientError &&
          ["REQUEST_UNCONFIRMED", "VERSION_CONFLICT"].includes(err.code),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={s.form} onSubmit={save}>
      <h1>
        {payment
          ? "Update paid and remaining"
          : expense
            ? "Edit expense"
            : "Add expense"}
      </h1>
      <p>Record costs and cumulative payments for this expense.</p>
      <fieldset disabled={busy}>
        <label>
          Expense title
          <input
            name="title"
            required
            maxLength={150}
            defaultValue={expense?.title}
          />
        </label>
        <div className={s.pair}>
          <label>
            Vendor name (optional)
            <input
              name="vendorName"
              maxLength={150}
              defaultValue={expense?.vendorName}
            />
          </label>
          <label>
            Payer name
            <input
              name="payerName"
              required
              maxLength={150}
              defaultValue={expense?.payerName}
            />
            <small>The payer does not need an account.</small>
          </label>
        </div>
        <label>
          Expense date
          <input
            type="date"
            name="expenseDate"
            required
            defaultValue={expense?.expenseDate}
          />
        </label>
        <div className={s.pair}>
          <label>
            Amount paid so far (₹)
            <input
              inputMode="decimal"
              required
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
            />
          </label>
          <label>
            Remaining amount (₹)
            <input
              inputMode="decimal"
              required
              value={remaining}
              onChange={(e) => setRemaining(e.target.value)}
            />
          </label>
        </div>
        <div className={s.total}>
          Recorded total cost{" "}
          <strong>
            {Number.isSafeInteger(paidValue + remainingValue)
              ? rupees(paidValue + remainingValue)
              : "Check amounts"}
          </strong>
        </div>
        {paidValue > 0 ? (
          <div className={s.pair}>
            <label>
              First payment date
              <input
                type="date"
                name="firstPaymentDate"
                required
                defaultValue={expense?.firstPaymentDate}
              />
            </label>
            <label>
              Latest payment date
              <input
                type="date"
                name="latestPaymentDate"
                required
                defaultValue={expense?.latestPaymentDate}
              />
            </label>
          </div>
        ) : (
          <p>Payment dates are cleared when paid is zero.</p>
        )}
        {remainingValue > 0 && (
          <label>
            Remaining-payment due date (optional)
            <input
              type="date"
              name="remainingDueDate"
              defaultValue={expense?.remainingDueDate}
            />
          </label>
        )}
        <label>
          Notes (optional)
          <textarea
            name="notes"
            maxLength={5000}
            defaultValue={expense?.notes}
          />
        </label>
        {payment && (
          <p>
            Update the cumulative paid and remaining amounts for this
            obligation. Saving records balances and dates.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={g.actions}>
          <Link href={base(w) + (expense ? "?expense=" + expense.id : "")}>
            Cancel
          </Link>
          {blocked ? (
            <a href={base(w) + (expense ? "?expense=" + expense.id : "")}>
              Review latest details
            </a>
          ) : (
            <button className={g.primary}>
              {busy ? "Saving…" : expense ? "Save changes" : "Save expense"}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
export function Details({ w, expense: e }: { w: string; expense: Expense }) {
  const router = useRouter(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    try {
      await mutateJson(
        api(w) + "/" + e.id + "?expectedVersion=" + e.version,
        "DELETE",
      );
      router.push(base(w));
      router.refresh();
    } catch (err) {
      setError(feedback(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={g.heading}>
        <Link href={base(w)}>← Back to expenses</Link>
        <div className={g.actions}>
          <Link
            className={g.soft}
            href={base(w) + "?view=edit&expense=" + e.id}
          >
            Edit expense
          </Link>
          <Link
            className={g.primary}
            href={base(w) + "?view=payment&expense=" + e.id}
          >
            Update paid and remaining
          </Link>
          <button className={g.remove} onClick={() => setOpen(true)}>
            Remove expense
          </button>
        </div>
      </div>
      <section className={s.card}>
        <Status expense={e} />
        <h1>{e.title}</h1>
        <p>{e.vendorName}</p>
        <Stats {...e} />
      </section>
      <section className={s.card}>
        <h2>Expense particulars</h2>
        <dl className={s.pair}>
          {[
            ["Primary payer", e.payerName],
            ["Expense date", e.expenseDate],
            ["First payment", e.firstPaymentDate],
            ["Latest payment", e.latestPaymentDate],
            ["Remaining due date", e.remainingDueDate],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {e.notes && <div className={s.total}>{e.notes}</div>}
      </section>
      <ConfirmDialog
        open={open}
        title={"Remove " + e.title + "?"}
        keep="Keep expense"
        confirm="Remove expense"
        busy={busy}
        blocked={!!error}
        error={error}
        onClose={() => {
          setOpen(false);
          if (error) router.refresh();
        }}
        onConfirm={() => void remove()}
      >
        <p>This expense will be excluded from the list and summary totals.</p>
      </ConfirmDialog>
    </>
  );
}
