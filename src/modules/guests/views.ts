"use server";
import { currentActor } from "@/lib/access/actor";
import { listEvents } from "@/modules/events/service";
import { listSelections, getGuest } from "./service";
import { Guest, Invitation } from "./model";
import { id } from "@/modules/weddings/service";
// Hydrate only the visible page, within the authorised wedding.
export async function guestEvents(w: string, g: string, cursor?: string) {
  const actor = await currentActor();
  await getGuest(actor, w, g);
  const page = await listEvents(actor, w, { cursor });
  const selections = await Invitation.find({
    weddingId: id(w),
    guestId: id(g),
    eventId: { $in: page.data.map((e) => id(e.id)) },
  })
    .select("eventId status version rsvp")
    .lean();
  return {
    ...page,
    data: page.data.map((e) => {
      const i = selections.find((i) => String(i.eventId) === e.id);
      return {
        ...e,
        selection: i
          ? {
              id: String(i._id),
              version: i.version,
              status: i.status,
              rsvp: i.rsvp,
            }
          : null,
      };
    }),
  };
}
export async function guestsByEvent(
  w: string,
  e: string,
  rsvp: "pending" | "attending" | "declined" | undefined,
  cursor?: string,
  q = "",
) {
  const page = await listSelections(
    await currentActor(),
    w,
    {
      eventId: e,
      ...(rsvp && { rsvp }),
      cursor,
    },
    q,
  );
  const people = await Guest.find({
    weddingId: id(w),
    _id: { $in: page.data.map((i) => id(i.guestId)) },
    isDeleted: false,
  })
    .select("name emailNormalized")
    .lean();
  return {
    ...page,
    data: page.data.flatMap((i) => {
      const person = people.find((p) => String(p._id) === i.guestId);
      return person
        ? [
            {
              ...i,
              name: person.name,
              email: person.emailNormalized ?? undefined,
            },
          ]
        : [];
    }),
  };
}
