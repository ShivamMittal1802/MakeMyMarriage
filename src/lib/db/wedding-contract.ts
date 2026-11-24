import "server-only";
import {
  Wedding,
  Membership,
  MemberInvitation,
} from "@/modules/weddings/models";
import { GalleryAccess } from "@/modules/gallery/access-model";

export const weddingModels = [
  Wedding,
  Membership,
  MemberInvitation,
  GalleryAccess,
];
const integer = {
  bsonType: ["int", "long", "double"],
  minimum: 0,
  multipleOf: 1,
};
const id = { bsonType: "objectId" };
const date = { bsonType: "date" };
const string = { bsonType: "string" };
const role = { enum: ["bride", "groom", "manager"] };
const token = {
  bsonType: "object",
  required: [
    "hash",
    "ciphertext",
    "keyId",
    "nonce",
    "tag",
    "version",
    "issuedAt",
  ],
  properties: {
    hash: string,
    ciphertext: string,
    keyId: string,
    nonce: string,
    tag: string,
    version: integer,
    issuedAt: date,
  },
};
const definitions = {
  weddings: {
    required: [
      "ownerUserId",
      "slug",
      "couple",
      "weddingDate",
      "location",
      "timezone",
      "currency",
    ],
    properties: {
      ownerUserId: id,
      slug: {
        bsonType: "string",
        minLength: 3,
        maxLength: 80,
        pattern: "^[a-z0-9-]+$",
      },
      couple: {
        bsonType: "object",
        required: ["brideName", "groomName"],
        properties: { brideName: string, groomName: string },
      },
      weddingDate: {
        bsonType: "string",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
      },
      location: string,
      introduction: string,
      timezone: { enum: ["Asia/Kolkata"] },
      currency: { enum: ["INR"] },
    },
  },
  memberships: {
    required: ["weddingId", "userId", "role", "status", "joinedAt"],
    properties: {
      weddingId: id,
      userId: id,
      role,
      status: { enum: ["active", "revoked"] },
      joinedAt: date,
      invitedBy: id,
      revokedAt: date,
      revokedBy: id,
    },
  },
  memberInvitations: {
    required: [
      "weddingId",
      "invitedBy",
      "emailNormalized",
      "role",
      "status",
      "token",
      "expiresAt",
    ],
    properties: {
      weddingId: id,
      invitedBy: id,
      emailNormalized: string,
      role,
      status: { enum: ["pending", "accepted", "revoked", "expired"] },
      token,
      expiresAt: date,
      acceptedAt: date,
      acceptedBy: id,
      revokedAt: date,
      revokedBy: id,
    },
  },
  galleryAccess: {
    required: ["weddingId", "purpose", "token", "status"],
    properties: {
      weddingId: id,
      purpose: { enum: ["upload", "view"] },
      token,
      status: { enum: ["active", "revoked"] },
    },
  },
};
export const weddingValidators = Object.fromEntries(
  Object.entries(definitions).map(([name, definition]) => [
    name,
    {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "schemaVersion",
          "version",
          "createdAt",
          "updatedAt",
          ...definition.required,
        ],
        properties: {
          schemaVersion: integer,
          version: integer,
          createdAt: date,
          updatedAt: date,
          ...definition.properties,
        },
      },
    },
  ]),
);
