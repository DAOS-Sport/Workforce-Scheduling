import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
  regions,
  type Region,
  type InsertRegion,
} from "@shared/schema";

export const regionRepository = {
  async getRegions(): Promise<Region[]> {
    return db.select().from(regions);
  },

  async getRegionByCode(code: string): Promise<Region | undefined> {
    const [region] = await db.select().from(regions).where(eq(regions.code, code));
    return region;
  },

  async createRegion(data: InsertRegion): Promise<Region> {
    const [region] = await db.insert(regions).values(data).returning();
    return region;
  },

};
