import { hasPermission } from "@shared/admin-permissions";

type Rule = { pattern: RegExp; read: string[]; write?: string[] };
const rule = (pattern: RegExp, read: string[], write = read): Rule => ({ pattern, read, write });
const peopleReaders = ["dashboard", "schedule", "employees", "attendance", "guidelines", "availability", "salary-report", "leave-requests"];
const venueReaders = ["dashboard", "schedule", "venues", "guidelines", "reports", "clock-records", "salary-report"];
const scheduleReaders = ["dashboard", "schedule", "guidelines", "reports", "salary-report"];

// Shared reads name their actual consumers; writes always name the owning administrative action.
const RULES: Rule[] = [
  rule(/^\/api\/admin\/permissions(?:\/[^/]+)?$/, ["permissions"]),
  rule(/^\/api\/admin\/personal-logins$/, ["permissions"]),
  rule(/^\/api\/admin\/shared-password$/, ["permissions"]),
  rule(/^\/api\/audit\/timeline$/, ["audit"], []),
  rule(/^\/api\/admin\/(?:health(?:\/(?:logs|clock-never-success))?|errors)$/, ["it-monitor"], []),
  rule(/^\/api\/admin\/schedule-save-events$/, [], ["summer"]),
  rule(/^\/api\/regions$/, peopleReaders.concat(venueReaders), []),
  rule(/^\/api\/(?:employees(?:\/.*)?|employees-all)$/, peopleReaders, ["employees"]),
  rule(/^\/api\/(?:venues(?:\/[^/]+)?|venues-all)$/, venueReaders, ["venues"]),
  rule(/^\/api\/(?:shifts(?:\/.*)?|shifts-cancelled\/.*|dispatch-shifts(?:\/.*)?|dispatch-shifts-cancelled\/.*)$/, scheduleReaders, ["schedule"]),
  rule(/^\/api\/(?:schedule-slots(?:\/.*)?|venue-requirements\/.*)$/, scheduleReaders, ["schedule"]),
  rule(/^\/api\/venue-shift-templates(?:\/.*)?$/, ["schedule", "venues"], ["venues"]),
  rule(/^\/api\/availabilities$/, ["availability", "schedule"], []),
  rule(/^\/api\/attendance-(?:uploads|records)(?:\/.*)?$/, ["attendance", "salary-report"], []),
  rule(/^\/api\/attendance-upload(?:\/.*)?$/, ["attendance"], ["attendance"]),
  rule(/^\/api\/clock-records(?:\/[0-9]+)?$/, ["clock-records"], ["clock-records"]),
  rule(/^\/api\/reports\/(?:clock-records|anomalies)$/, ["reports"], []),
  rule(/^\/api\/(?:clock-amendments|overtime-requests)(?:\/[^/]+)?$/, ["clock-records", "reports"], ["clock-records"]),
  rule(/^\/api\/outing-records$/, ["clock-records"], []),
  rule(/^\/api\/anomaly-reports(?:\/.*)?$/, ["anomaly-reports"], ["anomaly-reports"]),
  rule(/^\/api\/(?:notification-recipients(?:\/[^/]+)?|test-email)$/, ["anomaly-reports"], ["anomaly-reports"]),
  rule(/^\/api\/(?:leave-requests|leave-balances)(?:\/.*)?$/, ["leave-requests"], ["leave-requests"]),
  rule(/^\/api\/guidelines\/all-acknowledgments$/, ["guideline-acks"], []),
  rule(/^\/api\/guidelines\/[0-9]+\/acknowledgments$/, ["guidelines", "guideline-acks"], []),
  rule(/^\/api\/(?:guidelines(?:\/[0-9]+)?|guideline-ack)$/, ["guidelines", "guideline-acks"], ["guidelines", "guideline-acks"]),
  rule(/^\/api\/announcements(?:\/[^/]+)?$/, ["guidelines"], ["guidelines"]),
  rule(/^\/api\/pending-counts$/, ["dashboard", "clock-records", "anomaly-reports", "leave-requests"], []),
  rule(/^\/api\/salary-report(?:\/excel)?$/, ["salary-report"], []),
  rule(/^\/api\/four-week-compliance$/, ["salary-report", "schedule"], []),
  rule(/^\/api\/weekly-attendance(?:\/[^/]+)?$/, ["weekly-attendance"], ["weekly-attendance"]),
  rule(/^\/api\/salary-rates$/, ["salary-report", "summer"], ["salary-report", "summer"]),
  rule(/^\/api\/system-config\/(?:availability_window|monthly_holidays)$/, ["availability"], ["availability"]),
  rule(/^\/api\/system-config\/date_annotations$/, ["schedule"], ["schedule"]),
  rule(/^\/api\/system-config\/four_week_reference_date$/, ["salary-report"], ["salary-report"]),
  rule(/^\/api\/system-config\/summer-payroll-config-v1$/, ["summer"], ["summer"]),
  rule(/^\/api\/(?:ragic-sync|ragic\/sync-employees)$/, ["employees"], ["employees"]),
  rule(/^\/api\/(?:ragic-venue-sync|ragic\/sync-venues)$/, ["venues"], ["venues"]),
  rule(/^\/api\/(?:send-shift-reminders|admin\/trigger-weekly-schedule|admin\/trigger-weekly-late-report)$/, ["dashboard"], ["dashboard"]),
  rule(/^\/api\/admin\/(?:summer-employees|schedule-assignments|manual-schedule-courses|summer-availability)(?:\/.*)?$/, ["summer"], ["summer"]),
  rule(/^\/api\/admin\/summer-schedule\/(?:duty-shifts|publish-shifts)$/, ["summer"], ["summer"]),
  rule(/^\/api\/schedule\/enrollment-counts$/, ["summer"], []),
];

export function allowsAdminRequest(permissions: readonly string[], path: string, method: string, body?: unknown): boolean {
  if (path === "/admin/summer-schedule-v40.html") return hasPermission(permissions, "summer", "read");
  const action = method === "GET" || method === "HEAD" || method === "OPTIONS" || (method === "POST" && path === "/api/shifts/four-week-precheck") ? "read" : "write";
  if (action === "write" && /^\/api\/employees(?:\/[^/]+)?$/.test(path) && body && typeof body === "object"
    && ["role", "isAdmin", "lineId", "status"].some((key) => Object.prototype.hasOwnProperty.call(body, key))
    && !hasPermission(permissions, "permissions", "write")) return false;
  const matched = RULES.find(({ pattern }) => pattern.test(path));
  return !!matched && (matched[action] ?? []).some((resource) => hasPermission(permissions, resource, action));
}
