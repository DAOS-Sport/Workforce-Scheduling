# Schedule Mapping Production Audit

Use this runbook when production data appears misaligned across shifts, schedule slots, venues, regions, employees, dispatch shifts, clock records, or related request tables.

## Safe Audit

Run these first against the target database:

```bash
npm run verify:schedule-mapping
npm run verify:schedule-mapping:details
npm run repair:schedule-roles
npm run audit:feedback-case
```

`verify:schedule-mapping` is the strict gate. It exits non-zero if any checked mapping count is not zero.

`verify:schedule-mapping:details` uses the same checks, but includes capped row samples for failing categories so production remediation does not require ad hoc SQL.

`repair:schedule-roles` is dry-run by default. Review its JSON before applying.

## Apply Repair

Only run after reviewing the dry-run output:

```bash
npm run repair:schedule-roles -- --apply
npm run verify:schedule-mapping
```

The repair script currently normalizes schedule roles and salary-rate roles, soft-cancels duplicate future active shifts by normalized employee/venue/date/time/role key, soft-cancels duplicate future active dispatch shifts by normalized linked-employee-or-name/venue/date/time/role key, merges duplicate real schedule slots by normalized venue/date/time/role key, merges duplicate venue requirements by venue/day/time, removes duplicate venue shift templates by normalized schedule key, removes duplicate normalized salary-rate rows after keeping the most recently updated row, fixes dispatch rows whose `region_id` disagrees with their venue region, clears safe nullable references that point at missing rows, deletes orphan or invalid-weekday venue requirements, deletes orphan clock records whose employee no longer exists, deletes guideline acknowledgments for deleted employees, and clears invalid `clock_amendments.reviewed_by` values while preserving reviewer names and timestamps.

Duplicate real schedule slots and venue requirements are merged into the lowest-id row and their `required_count` values are summed. This preserves total staffing demand when production has split rows like `救生 (1人)` plus `救生 (2人)` for the same venue/date/time. Duplicate venue shift templates keep the highest `required_count` instead, because templates are reusable definitions rather than actual daily demand rows.

Duplicate future active shifts and dispatch shifts keep the lowest-id row and soft-cancel the rest with `cancelled_by = repair-schedule-roles`. This avoids inflated staffing counts while preserving row history.

The verifier also checks dispatch-specific slot mismatches, duplicate active dispatch rows, linked dispatch rows whose `dispatch_name` no longer matches the linked employee, duplicate/orphan/invalid venue requirements, non-positive staffing requirements, and zero-length staffing time ranges. All-day absence rows such as `休假`, `特休`, `補休`, and `曠職` are excluded from the zero-length staffing check.

Attendance import mappings are reported as warnings rather than hard failures because historical payroll exports can include former employees that are no longer in the employee table. Review `warnings` and `warningDetails` in `verify:schedule-mapping:details` when diagnosing attendance-specific issues.

Dispatch region repair updates `dispatch_shifts.region_id` to `venues.region_id` when the dispatch row already has a valid venue. This matches how schedule filtering is anchored to the physical venue assignment.

Nullable-reference repair preserves business records where possible. Examples include clearing invalid dispatch venue/linked-employee references, clearing invalid guideline venue references, clearing invalid overtime/leave reviewer references, clearing invalid overtime clock-record links, and clearing invalid clock-record shift/venue links. If a clock record has a valid shift but the stored venue differs, the repair updates the clock record venue to the shift venue.

Dispatch assignment references use a signed ID convention in tables that only have a generic `shift_id`: positive values point to `shifts.id`, and negative values point to `dispatch_shifts.id`. This is used for missing-clock notifications and clock amendments. `clock_records.shift_id` remains regular-shift-only; approved dispatch amendments create clock records with `shift_id = null` while preserving the dispatch link on the amendment.

Employee deletion is guarded when dependent rows exist across shifts, dispatch, clocking, leave/overtime, availability, notifications, acknowledgments, announcements, outing, or anomaly records. Use `status = inactive` for former employees so historical mappings remain intact.

Employee and venue region changes are guarded when future active assignments would become cross-region. Move or cancel the affected future shifts/dispatch rows first, then update the employee or venue region.

## Feedback Case Proof

The employee feedback case is verified by:

```bash
npm run audit:feedback-case:strict
```

Default expectation:

- `2026-05-23`, `新北`, role `救生`: `徐立珏`, `李羿昕`, `王崧宇`
- `2026-05-24`, `新北`, role `救生`: `李羿昕`, `王崧宇`

Strict mode proves the case only when the target DB contains the production rows and the expected rescue workers are present, grouped under normalized `救生`, have no duplicate normalized rescue slots, and count into an expected rescue schedule slot. It exits `2` if the case rows are absent or mismatched.

Override target data when needed:

```bash
FEEDBACK_VENUE_KEYWORD="新北" \
FEEDBACK_EMPLOYEE_NAMES="徐立珏,李羿昕,王崧宇" \
FEEDBACK_EXPECTED_ROLE="救生" \
FEEDBACK_EXPECTED_BY_DATE='{"2026-05-23":["徐立珏","李羿昕","王崧宇"],"2026-05-24":["李羿昕","王崧宇"]}' \
npm run audit:feedback-case:strict
```

## Completion Criteria

Do not consider production fixed until all of these pass against production:

```bash
npm run verify:schedule-mapping
npm run repair:schedule-roles
npm run audit:feedback-case:strict
```

The dry-run repair output must show no pending changes after any apply.
