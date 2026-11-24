import "server-only";
import type { ClientSession } from "mongoose";
import { emailConfig } from "@/lib/config/server";
import { EmailJob, Usage } from "./models";

/** Called only within the job-claim transaction. Current-window counter writes
 * serialize competing claims. Older reservations are already visible before a
 * dispatch can start; a late old-window claim fails the dispatch-time fence.
 * Count pre-dispatch processing too, so a concurrent dispatch-start write cannot
 * disappear from a rollover snapshot. Accepted results remain counted using
 * their settlement time; unknown results stay held until operator resolution. */
export async function reserveEmailQuota(session: ClientSession, now: Date) {
  const config = emailConfig(now);
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const windows = [
    {
      _id: `email:${config.namespace}:day:${dayStart.toISOString().slice(0, 10)}`,
      kind: "emailDay",
      field: "quota.dayId",
      prefix: `^email:${config.namespace}:day:`,
      windowStart: dayStart,
      windowEnd: new Date(dayStart.getTime() + 86_400_000),
      limit: config.dailyLimit,
    },
    {
      _id: `email:${config.namespace}:month:${config.monthStart.toISOString()}`,
      kind: "emailMonth",
      field: "quota.monthId",
      prefix: `^email:${config.namespace}:month:`,
      windowStart: config.monthStart,
      windowEnd: config.monthEnd,
      limit: config.monthlyLimit,
    },
  ];
  let blocked = false;
  for (const window of windows) {
    const counter = await Usage.findOneAndUpdate(
      { _id: window._id },
      {
        $setOnInsert: {
          _id: window._id,
          kind: window.kind,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          limit: window.limit,
          consumed: 0,
          reserved: 0,
          held: 0,
          carryHeld: 0,
          schemaVersion: 1,
          version: 0,
        },
      },
      { session, upsert: true, returnDocument: "after" },
    ).orFail();
    const carryCount = await EmailJob.countDocuments({
      [window.field]: { $regex: window.prefix, $ne: window._id },
      $or: [
        { state: "processing", "quota.state": "reserved" },
        { state: "needsReview", "quota.state": "held" },
        {
          state: "accepted",
          "quota.state": "consumed",
          acceptedAt: { $gte: window.windowStart, $lt: window.windowEnd },
        },
      ],
    }).session(session);
    const directHeld = counter.held - (counter.carryHeld ?? 0);
    if (directHeld < 0) throw new Error("Invalid carry-over accounting");
    // A reduced allowance or legacy unresolved backlog can exceed the new cap.
    // Hold all remaining capacity and fail closed rather than exceed the limit.
    const carryHeld = Math.min(
      carryCount,
      Math.max(
        0,
        counter.limit - counter.consumed - counter.reserved - directHeld,
      ),
    );
    const held = directHeld + carryHeld;
    if (
      counter.limit !== window.limit ||
      carryCount > carryHeld ||
      counter.consumed + counter.reserved + held >= counter.limit
    )
      blocked = true;
    const changed = await Usage.updateOne(
      { _id: window._id, version: counter.version },
      { $set: { held, carryHeld }, $inc: { version: 1 } },
      { session },
    );
    if (changed.modifiedCount !== 1) throw new Error("Quota claim conflict");
  }
  if (blocked) return null;
  for (const window of windows) {
    const changed = await Usage.updateOne(
      {
        _id: window._id,
        $expr: {
          $lt: [{ $add: ["$consumed", "$reserved", "$held"] }, "$limit"],
        },
      },
      { $inc: { reserved: 1, version: 1 } },
      { session },
    );
    if (changed.modifiedCount !== 1)
      throw new Error("Quota reservation conflict");
  }
  return { dayId: windows[0]._id, monthId: windows[1]._id, state: "reserved" };
}
