import { DeliveryProgress } from "@/modules/email/delivery-ui";
import { notFound, redirect } from "next/navigation";
import { currentAccount } from "@/lib/access/account";
import { emailVerificationSatisfied } from "@/lib/access/email-verification";
import { AppError } from "@/lib/http/errors";
import { listGuests, getGuest } from "@/modules/guests/service";
import { guestEvents, guestsByEvent } from "@/modules/guests/views";
import {
  Directory,
  GuestForm,
  GuestDetails,
  EventRoster,
} from "@/modules/guests/workspace";
import { listEvents, getEvent } from "@/modules/events/service";
import { GuestLayout } from "@/modules/guests/layout";
import { getWedding } from "@/modules/weddings/service";
import { Invitation } from "@/modules/guests/model";
import { id } from "@/modules/weddings/service";
import { SetupUnavailable } from "@/modules/weddings/components/onboarding-controls";

export const metadata = { title: "Wedding guests" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ weddingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!emailVerificationSatisfied(account)) redirect("/onboarding");
  const { weddingId: w } = await params,
    actor = { id: String(account._id), sessionVersion: account.sessionVersion },
    p = await searchParams;
  const param = (k: string) => (typeof p[k] === "string" ? p[k] : undefined);
  const view = param("view"),
    gid = param("guest"),
    q = (param("q") ?? "").slice(0, 150);
  async function loadView() {
    if (view === "delivery") {
      const event = await getEvent(actor, w, param("event") ?? "");
      return (
        <DeliveryProgress
          w={w}
          event={event}
          operationId={param("operation")}
        />
      );
    }
    if (gid) {
      const person = await getGuest(actor, w, gid);
      return view === "edit" ? (
        <GuestForm
          key={person.id}
          w={w}
          person={person}
          location={(await getWedding(actor, w)).location}
        />
      ) : (
        <GuestDetails
          key={person.id}
          w={w}
          person={person}
          initial={await guestEvents(w, gid)}
          notice={param("notice")}
        />
      );
    } else if (view === "events") {
      const events = await listEvents(actor, w);
      const eid = param("event");
      const event = eid ? await getEvent(actor, w, eid) : events.data[0];
      const r = param("rsvp");
      const filter =
        r === "pending" || r === "attending" || r === "declined"
          ? r
          : undefined;
      const counts: Record<string, number> = {
        pending: 0,
        attending: 0,
        declined: 0,
      };
      if (event) {
        const totals = await Invitation.aggregate<{ _id: string; n: number }>([
          {
            $match: {
              weddingId: id(w),
              eventId: id(event.id),
              status: "active",
            },
          },
          { $group: { _id: "$rsvp", n: { $sum: 1 } } },
        ]);
        for (const total of totals) counts[total._id] = total.n;
      }
      return (
        <EventRoster
          q={q}
          counts={counts}
          key={event?.id + ":" + filter + ":" + q}
          w={w}
          events={events}
          event={event}
          filter={filter}
          initial={
            event
              ? await guestsByEvent(w, event.id, filter, undefined, q)
              : {
                  data: [],
                  page: { limit: 25, hasMore: false, nextCursor: null },
                }
          }
        />
      );
    } else {
      const list = await listGuests(actor, w, {
        q,
        limit: view === "new" ? 1 : 25,
      });
      return view === "new" ? (
        <GuestForm w={w} location={(await getWedding(actor, w)).location} />
      ) : (
        <Directory key={q} w={w} initial={list} q={q} />
      );
    }
  }
  let content;
  try {
    content = await loadView();
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.status === 401) redirect("/login");
    if (e.status === 403) redirect("/onboarding");
    if ([400, 404].includes(e.status)) notFound();
    content = (
      <SetupUnavailable message="Couldn’t load the wedding guests. Please try again." />
    );
  }
  return (
    <GuestLayout w={w} email={account.emailNormalized}>
      {content}
    </GuestLayout>
  );
}
