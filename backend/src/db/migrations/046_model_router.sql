-- M4 — Model router telemetry (Agentic OS).

CREATE TABLE IF NOT EXISTS model_invocations (
  id               TEXT PRIMARY KEY,
  task_class       TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  vendor           TEXT NOT NULL,
  skill            TEXT,
  workflow_run     TEXT,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd   INTEGER NOT NULL DEFAULT 0,
  latency_ms       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL,
  error_code       TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_invocations_task ON model_invocations(task_class, created_at);
CREATE INDEX IF NOT EXISTS idx_model_invocations_skill ON model_invocations(skill, created_at);
