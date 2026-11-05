#!/bin/bash
set -e
npm install
# No automatic schema push after a merge: the databases hold four tables that
# are not in shared/schema.ts (session, audit_logs, app_logs,
# user_error_events), and drizzle-kit push treats them as tables to drop.
# Review new tables first and create them on the dev database from SQL;
# Publish then carries them to production. See docs/rebuild-and-rollback.md.
