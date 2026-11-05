import express from "express";
import { createServer } from "http";
import { eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { employees, guidelines, regions, systemConfigs, venues } from "@shared/schema";
import { db } from "../infra/db";
import { registerRoutes } from "../routes";
import { createEmployee, resetDatabase } from "../test/itest";
import { INITIAL_ADMIN_LINE_ID, runOneTimeDataMigrations } from "./dataMigrations";
import { seedDatabase } from "./seed";

const venueNamed = async (shortName: string) => (await db.select().from(venues).where(eq(venues.shortName, shortName)))[0];

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seedDatabase on a database that already has venues (every cold start)", () => {
  it("keeps the radius and coordinates an administrator changed", async () => {
    await seedDatabase();
    const before = await venueNamed("新北高中");
    await db.update(venues).set({ radius: 450, latitude: 25.2, longitude: 121.6 }).where(eq(venues.id, before.id));

    await seedDatabase();

    const after = await venueNamed("新北高中");
    expect([after.radius, after.latitude, after.longitude]).toEqual([450, 25.2, 121.6]);
  });

  it("adds a venue that went missing, with the seed's radius and coordinates, and touches no other", async () => {
    await seedDatabase();
    const kept = await venueNamed("三民高中");
    await db.update(venues).set({ radius: 321 }).where(eq(venues.id, kept.id));
    await db.delete(venues).where(eq(venues.shortName, "松山國小"));

    await seedDatabase();

    const restored = await venueNamed("松山國小");
    expect(restored.radius).toBe(200);
    expect(restored.latitude).toBeCloseTo(25.0508, 3);
    expect((await venueNamed("三民高中")).radius).toBe(321);
  });

  it("does not add a second copy of a venue that exists under its long name", async () => {
    await seedDatabase();
    await db.update(venues).set({ shortName: "改過的簡稱", name: "新北高中館" }).where(eq(venues.shortName, "新北高中"));

    await seedDatabase();

    expect(await db.select().from(venues).where(eq(venues.name, "新北高中"))).toEqual([]);
  });
});

// What a cold start does to data an administrator has changed: the seed plus route registration, as bootstrap runs them.
const SICK_LEAVE = "病假注意事項";

async function boot() {
  const app = express();
  const http = createServer(app);
  await seedDatabase();
  await registerRoutes(http, app);
}

const sickLeaveGuidelines = () => db.select().from(guidelines).where(eq(guidelines.title, SICK_LEAVE));

describe("a cold start does not undo what an administrator changed", () => {
  it("creates the sick-leave guideline in a new database, once", async () => {
    await boot();
    expect(await sickLeaveGuidelines()).toHaveLength(1);

    await boot();
    expect(await sickLeaveGuidelines()).toHaveLength(1);
  });

  it("does not bring back a guideline that was deleted", async () => {
    await boot();
    await db.delete(guidelines).where(eq(guidelines.title, SICK_LEAVE));

    await boot();
    await boot();

    expect(await sickLeaveGuidelines()).toHaveLength(0);
  });

  it("does not create the guideline in a database that existed before this release and no longer has it", async () => {
    await seedDatabase();
    await db.delete(guidelines);
    await db.delete(systemConfigs).where(like(systemConfigs.key, "migration:%"));

    await boot();

    expect(await sickLeaveGuidelines()).toHaveLength(0);
  });

  it("does not make the initial administrator an administrator again once that was revoked", async () => {
    await seedDatabase();
    const [region] = await db.select().from(regions).limit(1);
    const emp = await createEmployee({ regionId: region.id, lineId: INITIAL_ADMIN_LINE_ID, isAdmin: false });
    await db.delete(systemConfigs).where(like(systemConfigs.key, "migration:%"));

    await boot();
    await boot();

    expect((await db.select().from(employees).where(eq(employees.id, emp.id)))[0].isAdmin).toBe(false);
  });

  it("leaves an existing database's guidelines and employees as they were, and only notes that the migrations are behind it", async () => {
    await seedDatabase();
    const [region] = await db.select().from(regions).limit(1);
    const emp = await createEmployee({ regionId: region.id, lineId: INITIAL_ADMIN_LINE_ID, isAdmin: true });
    await db.delete(systemConfigs).where(like(systemConfigs.key, "migration:%"));
    const before = { guidelines: await db.select().from(guidelines), employees: await db.select().from(employees) };

    await boot();

    expect({ guidelines: await db.select().from(guidelines), employees: await db.select().from(employees) }).toEqual(before);
    expect(emp.id).toBe(before.employees[0].id);
    expect((await db.select().from(systemConfigs).where(like(systemConfigs.key, "migration:%"))).map((r) => r.value)).toEqual(["baselined", "baselined"]);
  });

  it("lets two instances starting together apply a migration once", async () => {
    await seedDatabase();
    await db.delete(guidelines);
    await db.delete(systemConfigs).where(like(systemConfigs.key, "migration:%"));

    await Promise.all([runOneTimeDataMigrations({ freshDatabase: true }), runOneTimeDataMigrations({ freshDatabase: true })]);

    expect(await sickLeaveGuidelines()).toHaveLength(1);
  });
});
