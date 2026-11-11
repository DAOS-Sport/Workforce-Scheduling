-- Deployment handoff only: do not run against development or production automatically.
CREATE TABLE IF NOT EXISTS operation_audit (
  id SERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  record_id TEXT NOT NULL,
  employee_id INTEGER,
  action TEXT NOT NULL,
  actor JSONB NOT NULL,
  before_data JSONB,
  after_data JSONB,
  mutation_id INTEGER,
  transaction_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_mutations (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  actor JSONB NOT NULL,
  shared_password_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  before_data JSONB,
  after_data JSONB,
  transaction_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION ws_f8f9_capture_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_data JSONB;
  new_data JSONB;
  actor_data JSONB;
  entity_key TEXT;
  shared_enabled BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'clock_records' AND TG_OP = 'INSERT'
    AND current_setting('app.audit_clock_insert', true) = 'ordinary' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('leave_requests', 'clock_amendments') AND TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'employee_leave_balances' THEN
    IF TG_OP = 'INSERT' AND COALESCE((new_data->>'total_hours')::numeric, 0) = 0 THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND old_data->'total_hours' = new_data->'total_hours' THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'system_configs' AND COALESCE(new_data->>'key', old_data->>'key', '') NOT LIKE 'admin.%' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  entity_key := CASE TG_TABLE_NAME
    WHEN 'system_configs' THEN COALESCE(new_data->>'key', old_data->>'key')
    WHEN 'admin_role_permissions' THEN COALESCE(new_data->>'role', old_data->>'role')
    ELSE COALESCE(new_data->>'id', old_data->>'id') END;
  actor_data := COALESCE(NULLIF(current_setting('app.audit_actor', true), '')::jsonb, '{"kind":"system"}'::jsonb);
  IF TG_TABLE_NAME = 'system_configs' AND entity_key = 'admin.shared-password-enabled' THEN
    shared_enabled := COALESCE(old_data->>'value' = 'true', TRUE);
  ELSE
    SELECT value = 'true' INTO shared_enabled FROM system_configs WHERE key = 'admin.shared-password-enabled';
    shared_enabled := COALESCE(shared_enabled, TRUE);
  END IF;
  INSERT INTO audit_mutations(table_name,record_id,operation,actor,shared_password_enabled,before_data,after_data,transaction_id,created_at)
    VALUES(TG_TABLE_NAME,entity_key,TG_OP,actor_data,shared_enabled,old_data,new_data,txid_current()::text,timezone('UTC',clock_timestamp()));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['shifts','dispatch_shifts','clock_records','clock_amendments','leave_requests','employee_leave_balances','system_configs','admin_role_permissions'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgname = 'ws_f8f9_audit_mutation' AND t.tgrelid = to_regclass('public.' || table_name)
    ) THEN
      EXECUTE format('CREATE TRIGGER ws_f8f9_audit_mutation AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ws_f8f9_capture_mutation()', table_name);
    END IF;
  END LOOP;
END;
$$;
