-- Development database migration for WS-WATCHDOG-ALL-20261111.
-- Review and execute separately; this work order does not execute it.
CREATE TABLE IF NOT EXISTS app_logs (
  id serial PRIMARY KEY,
  occurred_at timestamp NOT NULL DEFAULT now(),
  level text NOT NULL,
  pipeline text NOT NULL,
  request_id text,
  message text NOT NULL
);
CREATE INDEX IF NOT EXISTS app_logs_pipeline_time_idx ON app_logs (pipeline, occurred_at, id);
CREATE INDEX IF NOT EXISTS app_logs_time_idx ON app_logs (occurred_at, id);
