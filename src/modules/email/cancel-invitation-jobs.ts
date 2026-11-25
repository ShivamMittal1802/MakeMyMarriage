import "server-only";
import { Types, type ClientSession } from "mongoose";
import { EmailJob, Usage } from "./models";

// Link revocation stops undispatched jobs without cancelling unrelated recipients
// in the same operation. An already-dispatched outcome retains its quota hold.
export async function cancelInvitationJobs(
  weddingId: Types.ObjectId,
  invitationIds: Types.ObjectId[],
  session: ClientSession,
  now: Date,
  subjectType: "memberInvitation" | "eventInvitation" = "memberInvitation",
  reason?: "guestDeleted" | "uninvited" | "contactChanged",
) {
  if (!invitationIds.length) return;
  const cancelReason =
    reason ??
    (subjectType === "eventInvitation" ? "eventDeleted" : "invitationRevoked");
  const jobs = await EmailJob.find({
    weddingId,
    subjectType,
    subjectId: { $in: invitationIds },
    state: {
      $in: [
        "pending",
        "deferredQuota",
        "retryableFailed",
        "processing",
        "needsReview",
      ],
    },
  }).session(session);
  for (const job of jobs) {
    if (job.dispatchStartedAt) {
      await EmailJob.updateOne(
        { _id: job._id, version: job.version },
        {
          $set: { cancelRequestedAt: now, cancelReason },
          $inc: { version: 1 },
        },
        { session },
      );
      continue;
    }
    const release = job.quota?.state === "reserved";
    if (release) {
      for (const quotaId of [job.quota!.dayId, job.quota!.monthId]) {
        const result = await Usage.updateOne(
          { _id: quotaId, reserved: { $gte: 1 } },
          {
            $inc: { reserved: -1, version: 1 },
          },
          { session },
        );
        if (result.modifiedCount !== 1)
          throw new Error("Email quota accounting conflict");
      }
    }
    await EmailJob.updateOne(
      { _id: job._id, version: job.version },
      {
        $set: {
          state: "cancelled",
          cancelRequestedAt: now,
          cancelReason,
          ...(release ? { "quota.state": "released" } : {}),
        },
        $unset: { lease: "" },
        $inc: { version: 1 },
      },
      { session },
    );
  }
}
