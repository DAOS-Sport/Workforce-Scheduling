import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guidelineAcknowledgments, guidelines } from "@shared/schema";
import { db, pool } from "../../infra/db";
import { LOCK_NS } from "../../infra/db/tx";
import { concurrently, createEmployee, createRegion, resetDatabase, warmPool } from "../../test/itest";
import { runWhileLockHeld } from "../../test/lock";
import { guidelineService } from "./guideline.service";

beforeEach(async () => {
  await resetDatabase();
  await warmPool(4);
});

afterEach(async () => {
  await pool.query("drop trigger if exists refuse_guideline_delete on guidelines");
  await pool.query("drop function if exists refuse_guideline_delete()");
});

const newGuideline = () => guidelineService.create({ category: "工作規則", title: "虛構守則", content: "內容", sortOrder: 1, isActive: true });
const acks = () => db.select().from(guidelineAcknowledgments);

describe("deleting a guideline", () => {
  it("keeps the acknowledgments when the guideline itself cannot be deleted", async () => {
    const region = await createRegion();
    const emp = await createEmployee({ regionId: region.id });
    const g = await newGuideline();
    await guidelineService.createAck({ guidelineId: g.id, employeeId: emp.id });
    await pool.query(`
      create function refuse_guideline_delete() returns trigger language plpgsql as $$
      begin raise exception 'injected failure'; end $$`);
    await pool.query("create trigger refuse_guideline_delete before delete on guidelines for each row execute function refuse_guideline_delete()");

    await expect(guidelineService.remove(g.id)).rejects.toThrow("injected failure");

    expect(await acks()).toHaveLength(1);
    expect(await db.select().from(guidelines)).toHaveLength(1);
  });

  it("removes the guideline with its acknowledgments, and reports a missing one", async () => {
    const region = await createRegion();
    const emp = await createEmployee({ regionId: region.id });
    const g = await newGuideline();
    await guidelineService.createAck({ guidelineId: g.id, employeeId: emp.id });

    expect(await guidelineService.remove(g.id)).toBe(true);
    expect(await guidelineService.remove(g.id)).toBe(false);
    expect(await acks()).toHaveLength(0);
  });
});

describe("acknowledging a guideline on an employee's behalf", () => {
  it("records one acknowledgment when the same request arrives twice at once", async () => {
    const region = await createRegion();
    const emp = await createEmployee({ regionId: region.id });
    const g = await newGuideline();

    const results = await concurrently(2, () => guidelineService.createAck({ guidelineId: g.id, employeeId: emp.id }));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await acks()).toHaveLength(1);
  });

  it("waits for the employee's guideline lock", async () => {
    const region = await createRegion();
    const emp = await createEmployee({ regionId: region.id });
    const g = await newGuideline();

    const { finishedWhileHeld } = await runWhileLockHeld(LOCK_NS.guidelineAck, emp.id, () => guidelineService.createAck({ guidelineId: g.id, employeeId: emp.id }));

    expect(finishedWhileHeld).toBe(false);
  });

  it("records a new acknowledgment after the guideline was edited, and after the month turned", async () => {
    const region = await createRegion();
    const emp = await createEmployee({ regionId: region.id });
    const g = await newGuideline();
    await guidelineService.createAck({ guidelineId: g.id, employeeId: emp.id });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await guidelineService.update(g.id, { content: "改版後的內容" });
    await guidelineService.createAck({ guidelineId: g.id, employeeId: emp.id });
    expect(await acks()).toHaveLength(2);

    await db.update(guidelineAcknowledgments).set({ acknowledgedAt: new Date("2020-01-15T02:00:00Z") }).where(eq(guidelineAcknowledgments.employeeId, emp.id));
    await guidelineService.createAck({ guidelineId: g.id, employeeId: emp.id });
    expect(await acks()).toHaveLength(3);
  });
});
