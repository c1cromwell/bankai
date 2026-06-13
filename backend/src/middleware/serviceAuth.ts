/**
 * Phase 20 — service-to-service auth for internal callbacks (the fraud engine's
 * remediation calls). This is NOT user RBAC: the caller is a trusted internal
 * service presenting the shared FRAUD_ENGINE_API_KEY as a Bearer token, compared
 * in constant time. Refuses every request when the key is unset (fail closed).
 */

import { timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { ErrorCode } from "../errors";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = config.FRAUD_ENGINE_API_KEY;
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !token || !safeEqual(token, expected)) {
    res.status(401).json({ error: { code: ErrorCode.UNAUTHENTICATED, message: "Invalid service token", retryable: false } });
    return;
  }
  next();
}
