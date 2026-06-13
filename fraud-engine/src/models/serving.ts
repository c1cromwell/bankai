/**
 * Model serving — the Triton/vLLM/SageMaker serving-layer analog (Stage 4).
 *
 * Holds the runnable Model instances keyed by version and scores against them,
 * timing each call. A ServingBackend abstraction means a real remote endpoint
 * (HTTP/gRPC to a GPU-served Transformer) registers behind the same call: the
 * router/decisionEngine never know whether a model runs in-process or remote.
 */

import type { Model } from "./modelTypes";
import type { EnrichedEvent } from "../features/enrichment";
import type { ModelOutput } from "../types";
import { modelLatency } from "../observability/metrics";

export interface ServingBackend {
  readonly version: string;
  score(ev: EnrichedEvent): Promise<ModelOutput>;
}

/** Wraps an in-process Model as a ServingBackend. */
function localBackend(model: Model): ServingBackend {
  return {
    version: model.version,
    async score(ev: EnrichedEvent) {
      return model.score(ev);
    },
  };
}

export class ModelServer {
  private backends = new Map<string, ServingBackend>();

  /** Register an in-process model. */
  registerModel(model: Model): void {
    this.backends.set(model.version, localBackend(model));
  }

  /** Register a remote/custom serving backend (e.g. a Triton endpoint). */
  registerBackend(backend: ServingBackend): void {
    this.backends.set(backend.version, backend);
  }

  has(version: string): boolean {
    return this.backends.has(version);
  }

  async score(version: string, ev: EnrichedEvent): Promise<ModelOutput> {
    const backend = this.backends.get(version);
    if (!backend) throw new Error(`No serving backend for model ${version}`);
    const end = modelLatency.startTimer({ model: version });
    try {
      return await backend.score(ev);
    } finally {
      end();
    }
  }
}
