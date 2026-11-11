-- DEV handoff only. Not executed against a development or production database.
CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role TEXT PRIMARY KEY,
  permissions JSONB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
