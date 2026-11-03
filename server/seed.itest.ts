import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { venues } from "@shared/schema";
import { db } from "./infra/db";
import { resetDatabase } from "./test/itest";
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
