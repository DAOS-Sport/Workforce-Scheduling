// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { anomalyReports } from "@shared/schema";

const pg = vi.hoisted(() => ({
  queries: [] as string[],
  rows: [] as unknown[][],
}));

vi.mock("../../db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const fakePool = {
    query: async (q: { text: string }) => {
      pg.queries.push(q.text);
      return { rows: pg.rows, rowCount: pg.rows.length, fields: [] };
    },
  };
  return { db: drizzle(fakePool as never) };
});

import { anomalyRepository } from "./anomaly.repository";

function rowWith(overrides: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(anomalyReports))
    .filter((k) => k !== "imageUrls")
    .concat("imageCount")
    .map((k) => (k in overrides ? overrides[k] : null));
}

beforeEach(() => {
  pg.queries.length = 0;
  pg.rows = [];
});

describe("anomaly report list", () => {
  it("does not select the image_urls column, only a count of it", async () => {
    await anomalyRepository.getAnomalyReports();

    expect(pg.queries).toHaveLength(1);
    const sql = pg.queries[0];
    expect(sql).toMatch(/cardinality\(("anomaly_reports"\.)?"image_urls"\)/);
    expect(sql.replace(/cardinality\(("anomaly_reports"\.)?"image_urls"\)/g, "")).not.toContain("image_urls");
  });

  it("returns imageCount and no imageUrls on each report", async () => {
    pg.rows = [rowWith({ id: 5, context: "打卡異常", imageCount: 3 }), rowWith({ id: 4, imageCount: 0 })];

    const list = await anomalyRepository.getAnomalyReports();

    expect(list.map((r) => [r.id, r.imageCount])).toEqual([[5, 3], [4, 0]]);
    for (const r of list) expect("imageUrls" in r).toBe(false);
  });

  it("keeps newest-first ordering", async () => {
    await anomalyRepository.getAnomalyReports();
    expect(pg.queries[0]).toMatch(/order by "anomaly_reports"\."created_at" desc/i);
  });
});

describe("single anomaly report", () => {
  it("still selects the full image_urls column", async () => {
    await anomalyRepository.getAnomalyReport(5);

    expect(pg.queries[0]).toMatch(/"image_urls"/);
    expect(pg.queries[0]).not.toContain("cardinality");
  });
});
