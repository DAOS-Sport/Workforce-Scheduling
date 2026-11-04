import express from "express";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";
import { gateAdminApi } from "./requireAdmin";

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  app.use(gateAdminApi);
  app.get("/api/employees/:region", (_req, res) => res.json({ leaked: true }));
  app.get("/api/portal/ping", (_req, res) => res.json({ open: true }));
  app.post("/api/anomaly-report", (_req, res) => res.status(201).json({ open: true }));
  app.get("/api/anomaly-reports", (_req, res) => res.json({ leaked: true }));
  app.get("/api/anomaly-reports/:id", (_req, res) => res.json({ leaked: true }));
  app.patch("/api/anomaly-reports/:id/resolution", (_req, res) => res.json({ leaked: true }));
  app.post("/api/anomaly-reports/batch/delete", (_req, res) => res.json({ leaked: true }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("gateAdminApi", () => {
  it("blocks admin APIs without a session, whatever the letter case of the path", async () => {
    await withApp(async (base) => {
      for (const path of ["/api/employees/A", "/API/employees/A", "/Api/Employees/A", "/aPi/employees/A"]) {
        const res = await fetch(base + path);
        expect([path, res.status]).toEqual([path, 401]);
      }
    });
  });

  it("keeps the anomaly report admin APIs behind the login while the staff report form stays open", async () => {
    await withApp(async (base) => {
      const cases: Array<[string, string, number]> = [
        ["GET", "/api/anomaly-reports", 401],
        ["GET", "/api/anomaly-reports/74", 401],
        ["GET", "/API/Anomaly-Reports/74", 401],
        ["PATCH", "/api/anomaly-reports/1/resolution", 401],
        ["POST", "/api/anomaly-reports/batch/delete", 401],
        ["POST", "/api/anomaly-report", 201],
        ["POST", "/API/ANOMALY-REPORT", 201],
      ];
      for (const [method, path, want] of cases) {
        const res = await fetch(base + path, { method });
        expect([method, path, res.status]).toEqual([method, path, want]);
      }
    });
  });

  it("still lets open prefixes through, in any letter case", async () => {
    await withApp(async (base) => {
      expect((await fetch(`${base}/api/portal/ping`)).status).toBe(200);
      expect((await fetch(`${base}/API/PORTAL/ping`)).status).toBe(200);
    });
  });
});
