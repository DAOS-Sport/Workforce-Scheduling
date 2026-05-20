# Error Code Registry

| Code | HTTP | Module | Meaning | Common Cause | Debug Tips |
|------|------|--------|---------|--------------|------------|
| `INTERNAL_API_DISABLED` | 503 | internal | `INTERNAL_API_TOKEN` env var not set | Missing environment variable | Check server env vars |
| `MISSING_INTERNAL_TOKEN` | 401 | internal | Request missing auth token | Caller forgot Authorization/X-Internal-Token header | Check caller config |
| `INVALID_INTERNAL_TOKEN` | 403 | internal | Token provided but doesn't match | Token rotated or wrong env | Verify `INTERNAL_API_TOKEN` matches |
| `REGION_NOT_FOUND` | 404 | internal | `facilityKey` query param not matched | Wrong facility key | Valid keys: see regions table `code` column |
| `EXPORT_SCHEDULES_FAILED` | 500 | internal | `exportSchedules` threw | DB query error or bad date range | Check `from` ≤ `to`, both YYYY-MM-DD |
| `EXPORT_SNAPSHOT_FAILED` | 500 | internal | `exportSnapshot` threw | DB query error | Check date range validity |
| `TODAY_SCHEDULE_FAILED` | 500 | internal | `getTodaySchedules` threw | DB connection or region lookup failure | Check DB health endpoint |
| `UNAUTHORIZED` | 401 | observability | Health/metrics endpoint hit without valid auth | Missing admin session or INTERNAL_API_TOKEN | Login to admin or provide Bearer token |
| `MISSING_REQUEST_ID` | 400 | observability | POST /api/system/user-errors missing `request_id` | Frontend not passing `x-request-id` | Ensure request-ID middleware is mounted |
| `THROTTLED` | 429 | observability | Same user+action+error combo within 5s | Rapid duplicate error events | Client should not retry user-error reports immediately |
| `SHIFT_NOT_FOUND` | 404 | shift | Shift ID does not exist | Deleted or wrong ID | Verify shift ID exists in DB |
| `ADMIN_NOT_FOUND` | 401 | admin | Session adminId not in admins table | Session stale after account deletion | Re-login |
