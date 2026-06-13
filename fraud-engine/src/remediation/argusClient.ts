/**
 * Argus client — the engine's outbound callback into Argus. This is the ONLY
 * coupling to Argus, and it is over HTTP with a shared service bearer; the engine
 * imports no Argus code. Injectable so tests assert calls without a network.
 *
 * Idempotency: every call carries the decisionId; Argus dedupes on it, so a
 * retried freeze is a no-op.
 */

import { config } from "../config";
import { logger } from "../observability/logger";
import { remediationTotal } from "../observability/metrics";

export interface ArgusClient {
  freeze(args: { userId: string; reason: string; decisionId: string }): Promise<void>;
  unfreeze(args: { userId: string; reason: string; decisionId: string }): Promise<void>;
  flagTransaction(args: { userId: string; transactionRef: string; reason: string; decisionId: string }): Promise<void>;
}

class HttpArgusClient implements ArgusClient {
  private async post(path: string, body: Record<string, unknown>, action: string): Promise<void> {
    try {
      const res = await fetch(`${config.ARGUS_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.ARGUS_SERVICE_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        remediationTotal.inc({ action, result: "error" });
        logger.error({ path, status: res.status }, "argus remediation call failed");
        return;
      }
      remediationTotal.inc({ action, result: "ok" });
    } catch (e) {
      remediationTotal.inc({ action, result: "error" });
      logger.error({ path, err: (e as Error).message }, "argus remediation call threw");
    }
  }

  async freeze(args: { userId: string; reason: string; decisionId: string }): Promise<void> {
    await this.post("/api/internal/remediation/freeze", args, "freeze");
  }
  async unfreeze(args: { userId: string; reason: string; decisionId: string }): Promise<void> {
    await this.post("/api/internal/remediation/unfreeze", args, "unfreeze");
  }
  async flagTransaction(args: { userId: string; transactionRef: string; reason: string; decisionId: string }): Promise<void> {
    await this.post("/api/internal/remediation/flag-transaction", args, "flag");
  }
}

let _client: ArgusClient = new HttpArgusClient();

export function getArgusClient(): ArgusClient {
  return _client;
}

/** Inject a client (tests) or restore the default HTTP client (pass nothing). */
export function setArgusClient(c: ArgusClient | null): void {
  _client = c ?? new HttpArgusClient();
}
