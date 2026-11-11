import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSION_KEYS } from "@shared/admin-permissions";
import { OPEN_API_PATHS, OPEN_API_PREFIXES } from "../../config/openApiPrefixes";
import { allowsAdminRequest } from "./admin.policy";

function adminRoutes(): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  function scan(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!file.endsWith(".ts") || /\.(?:test|itest)\.ts$/.test(file)) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        // These routes are deliberately mounted before gateAdminApi in server/routes.ts.
        if (ts.isFunctionDeclaration(node) && node.name?.text === "mountAdminAuthRoutes") return;
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "app"
          && /^(get|post|put|patch|delete|head|options)$/.test(node.expression.name.text)) {
          const argument = node.arguments[0];
          const values = argument && ts.isArrayLiteralExpression(argument) ? argument.elements : argument ? [argument] : [];
          for (const value of values) {
            if (!ts.isStringLiteral(value)) continue;
            const route = value.text.toLowerCase();
            if (!route.startsWith("/api/") || OPEN_API_PREFIXES.some((prefix) => route.startsWith(prefix))
              || OPEN_API_PATHS.some((open) => route === open)) continue;
            // Config keys have a finite public-page contract; arbitrary keys are intentionally denied.
            const paths = route === "/api/system-config/:key"
              ? ["availability_window", "monthly_holidays", "date_annotations", "four_week_reference_date", "summer-payroll-config-v1"].map((key) => route.replace(":key", key))
              : [route.replace(/:[a-z0-9_]+/g, "1")];
            for (const path of paths) routes.push({ method: node.expression.name.text.toUpperCase(), path });
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(path.resolve(__dirname, "../.."));
  return routes;
}

describe("merged administrative route permissions", () => {
  const routes = adminRoutes();
  it("discovers administrative routes from server source", () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toEqual(expect.arrayContaining([
      { method: "GET", path: "/api/admin/health/logs" },
      { method: "GET", path: "/api/admin/health/clock-never-success" },
      { method: "POST", path: "/api/admin/schedule-save-events" },
    ]));
  });
  it.each(routes)("allows all permissions at $method $path", ({ method, path }) => {
    expect(allowsAdminRequest(ADMIN_PERMISSION_KEYS, path, method)).toBe(true);
  });

  it.each(["/api/admin/health/logs", "/api/admin/health/clock-never-success"])("assigns %s to IT monitor reads", (route) => {
    expect(allowsAdminRequest(["it-monitor:read"], route, "GET")).toBe(true);
    expect(allowsAdminRequest(["schedule:read", "schedule:write"], route, "GET")).toBe(false);
    expect(allowsAdminRequest(ADMIN_PERMISSION_KEYS, route, "POST")).toBe(false);
  });
  it("assigns summer schedule failure reports to summer writes", () => {
    expect(allowsAdminRequest(["summer:read", "summer:write"], "/api/admin/schedule-save-events", "POST")).toBe(true);
    expect(allowsAdminRequest(["summer:read"], "/api/admin/schedule-save-events", "POST")).toBe(false);
    expect(allowsAdminRequest(["it-monitor:read"], "/api/admin/schedule-save-events", "POST")).toBe(false);
  });
});
