import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq } from "drizzle-orm";
import {
  regions,
  type Region,
} from "@shared/schema";

export const regionRepository = {
  async getRegions(tx: Executor = db): Promise<Region[]> {
    return tx.select().from(regions);
  },

  async getRegionByCode(code: string, tx: Executor = db): Promise<Region | undefined> {
    const [region] = await tx.select().from(regions).where(eq(regions.code, code));
    return region;
  },

};
