import "server-only";

// Shared by the explicit migration and runtime readiness checks.
function collectionValidators() {
  const numeric = {
    bsonType: ["int", "long", "double"],
    minimum: 0,
    multipleOf: 1,
  };
  const base = {
    schemaVersion: numeric,
    version: numeric,
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" },
  };
  const validators = {
    users: {
      required: [
        "name",
        "emailNormalized",
        "passwordHash",
        "status",
        "sessionVersion",
      ],
      properties: {
        name: { bsonType: "string" },
        emailNormalized: { bsonType: "string" },
        passwordHash: { bsonType: "string" },
        status: { enum: ["active", "disabled"] },
        sessionVersion: numeric,
      },
    },
    authTokens: {
      required: [
        "userId",
        "purpose",
        "emailNormalized",
        "tokenHash",
        "expiresAt",
        "issuedSessionVersion",
      ],
      properties: {
        userId: { bsonType: "objectId" },
        purpose: { enum: ["verifyEmail", "resetPassword"] },
        emailNormalized: { bsonType: "string" },
        tokenHash: { bsonType: "string" },
        expiresAt: { bsonType: "date" },
        issuedSessionVersion: numeric,
      },
    },
    rateLimits: {
      required: ["scopeKey", "windowStart", "expiresAt", "count"],
      properties: {
        scopeKey: { bsonType: "string" },
        windowStart: { bsonType: "date" },
        expiresAt: { bsonType: "date" },
        count: numeric,
      },
    },
    emailOperations: {
      required: [
        "scopeKey",
        "kind",
        "mode",
        "status",
        "requestKey",
        "expectedJobs",
      ],
      properties: {
        scopeKey: { bsonType: "string" },
        kind: {
          enum: [
            "guestInvitation",
            "guestReminder",
            "memberInvitation",
            "verifyEmail",
            "resetPassword",
          ],
        },
        mode: { enum: ["simulated", "test", "live"] },
        status: { enum: ["preparing", "open", "closed", "cancelled"] },
        requestKey: { bsonType: "string" },
        expectedJobs: numeric,
      },
    },
    emailJobs: {
      required: [
        "operationId",
        "subjectId",
        "subjectType",
        "subjectKey",
        "intendedRecipient",
        "actualRecipient",
        "state",
        "mode",
        "payloadCipher",
        "idempotencyKey",
      ],
      properties: {
        operationId: { bsonType: "objectId" },
        subjectId: { bsonType: "objectId" },
        subjectType: {
          enum: ["authToken", "memberInvitation", "eventInvitation"],
        },
        subjectKey: { bsonType: "string" },
        intendedRecipient: { bsonType: "string" },
        actualRecipient: { bsonType: "string" },
        state: {
          enum: [
            "pending",
            "processing",
            "accepted",
            "deferredQuota",
            "retryableFailed",
            "permanentlyFailed",
            "needsReview",
            "cancelled",
            "simulated",
          ],
        },
        mode: { enum: ["simulated", "test", "live"] },
        payloadCipher: { bsonType: "object" },
        idempotencyKey: { bsonType: "string" },
      },
    },
    emailAttempts: {
      required: [
        "jobId",
        "operationId",
        "attemptNo",
        "leaseId",
        "startedAt",
        "outcome",
      ],
      properties: {
        jobId: { bsonType: "objectId" },
        operationId: { bsonType: "objectId" },
        attemptNo: numeric,
        leaseId: { bsonType: "string" },
        startedAt: { bsonType: "date" },
        outcome: { enum: ["started", "accepted", "rejected", "unknown"] },
      },
    },
    usage: {
      required: [
        "kind",
        "windowStart",
        "windowEnd",
        "limit",
        "consumed",
        "reserved",
        "held",
      ],
      properties: {
        _id: { bsonType: "string" },
        kind: { enum: ["emailDay", "emailMonth"] },
        windowStart: { bsonType: "date" },
        windowEnd: { bsonType: "date" },
        limit: numeric,
        consumed: numeric,
        reserved: numeric,
        held: numeric,
        carryHeld: numeric,
      },
    },
  };
  return Object.fromEntries(
    Object.entries(validators).map(([collection, validator]) => [
      collection,
      {
        $jsonSchema: {
          bsonType: "object",
          required: [
            "schemaVersion",
            "version",
            "createdAt",
            "updatedAt",
            ...validator.required,
          ],
          properties: { ...base, ...validator.properties },
        },
      },
    ]),
  );
}
export const identityValidators = collectionValidators();

export const identityIndexes: Record<
  string,
  {
    name: string;
    key: Record<string, number>;
    unique?: boolean;
    expireAfterSeconds?: number;
  }[]
> = {
  users: [{ name: "uq_user_email", key: { emailNormalized: 1 }, unique: true }],
  authTokens: [
    { name: "uq_auth_token", key: { tokenHash: 1 }, unique: true },
    { name: "ix_auth_user_purpose", key: { userId: 1, purpose: 1 } },
    { name: "ttl_auth_expiry", key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  rateLimits: [
    {
      name: "uq_rate_window",
      key: { scopeKey: 1, windowStart: 1 },
      unique: true,
    },
    { name: "ttl_rate_expiry", key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  emailOperations: [
    {
      name: "uq_email_operation_request",
      key: { scopeKey: 1, requestKey: 1 },
      unique: true,
    },
  ],
  emailJobs: [
    {
      name: "uq_operation_subject",
      key: { operationId: 1, subjectKey: 1 },
      unique: true,
    },
    { name: "uq_send_idempotency", key: { idempotencyKey: 1 }, unique: true },
    {
      name: "ix_email_day_carry",
      key: { state: 1, "quota.dayId": 1, acceptedAt: 1 },
    },
    {
      name: "ix_email_month_carry",
      key: { state: 1, "quota.monthId": 1, acceptedAt: 1 },
    },
  ],
  emailAttempts: [
    { name: "uq_job_attempt", key: { jobId: 1, attemptNo: 1 }, unique: true },
  ],
  usage: [{ name: "_id_", key: { _id: 1 } }],
};
