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

  it("still lets open prefixes through, in any letter case", async () => {
    await withApp(async (base) => {
      expect((await fetch(`${base}/api/portal/ping`)).status).toBe(200);
      expect((await fetch(`${base}/API/PORTAL/ping`)).status).toBe(200);
    });
  });
});
