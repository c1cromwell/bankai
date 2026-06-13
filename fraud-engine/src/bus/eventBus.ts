/**
 * Event bus — the Kafka/Redpanda backbone analog (Stage 2).
 *
 * The interface (publish + per-consumer-group subscribe) is exactly what maps
 * onto a real broker: swap InProcessEventBus for a KafkaEventBus and nothing
 * upstream changes. In-process delivery is best-effort and ordered per process;
 * cross-process exactly-once is the production graduation (documented as such).
 */

import { logger } from "../observability/logger";

export type Handler<T> = (msg: T) => Promise<void>;

export interface EventBus<T> {
  publish(topic: string, msg: T): Promise<void>;
  /** Subscribe a named consumer group to a topic. */
  subscribe(topic: string, group: string, handler: Handler<T>): void;
}

export class InProcessEventBus<T> implements EventBus<T> {
  private handlers = new Map<string, Map<string, Handler<T>>>();

  async publish(topic: string, msg: T): Promise<void> {
    const groups = this.handlers.get(topic);
    if (!groups) return;
    // Deliver to each consumer group independently (like distinct Kafka groups).
    for (const [group, handler] of groups) {
      // Fire async; isolate failures per consumer so one bad consumer can't
      // wedge the others or the producer. Failures are logged, not thrown.
      void handler(msg).catch((e) => {
        logger.error({ topic, group, err: (e as Error).message }, "consumer handler failed");
      });
    }
  }

  subscribe(topic: string, group: string, handler: Handler<T>): void {
    let groups = this.handlers.get(topic);
    if (!groups) {
      groups = new Map();
      this.handlers.set(topic, groups);
    }
    groups.set(group, handler);
  }
}

/** Topics. Constants so producers/consumers can't typo a string. */
export const TOPICS = {
  riskEvents: "risk_events",
  decisions: "decisions",
} as const;
