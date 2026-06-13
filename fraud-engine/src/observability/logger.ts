/**
 * Structured logging (pino). Redacts PII-ish fields so the fraud engine's logs
 * never leak raw identifiers — the engine reads derived facts, not PII.
 */

import pino from "pino";
import { config } from "../config";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.isProd ? "info" : "debug"),
  redact: {
    paths: ["req.headers.authorization", "*.ip", "*.deviceId", "*.email", "*.payload"],
    censor: "[redacted]",
  },
  transport: config.isProd ? undefined : { target: "pino-pretty", options: { colorize: true } },
});
