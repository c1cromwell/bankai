/**
 * Schema registry — the Avro/Protobuf Schema Registry analog (Stage 2).
 *
 * Versioned event schemas (zod) validated on ingest, so a malformed or
 * wrong-version event is rejected at the boundary rather than corrupting
 * downstream state. Bump SCHEMA_VERSION and add a new entry to evolve.
 */

import { z } from "zod";
import type { RiskEvent } from "../types";

export const SCHEMA_VERSION = "1.0";

/** Wire shape: amountMinor arrives as a string (JSON has no bigint). */
const riskEventV1 = z.object({
  eventType: z.string().min(1),
  mode: z.enum(["score", "async"]).default("score"),
  userId: z.string().min(1),
  counterpartyId: z.string().optional(),
  channel: z.string().optional(),
  amountMinor: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? undefined : BigInt(v))),
  currency: z.string().optional(),
  deviceId: z.string().optional(),
  ip: z.string().optional(),
  geo: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

const schemas: Record<string, z.ZodType<RiskEvent>> = {
  "1.0": riskEventV1 as unknown as z.ZodType<RiskEvent>,
};

export interface ParsedEvent {
  schemaVersion: string;
  event: RiskEvent;
}

/** Validate + normalize an inbound event against a schema version. Throws on invalid. */
export function parseEvent(body: unknown, schemaVersion = SCHEMA_VERSION): ParsedEvent {
  const schema = schemas[schemaVersion];
  if (!schema) {
    throw new Error(`Unknown schema version ${schemaVersion}`);
  }
  const event = schema.parse(body);
  return { schemaVersion, event };
}
