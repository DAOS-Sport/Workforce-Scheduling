import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleSlots, venueShiftTemplates } from "@shared/schema";
import { db } from "../../infra/db";
import { LOCK_NS } from "../../infra/db/tx";
import { concurrently, createRegion, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { withFailingWrites } from "../../test/failWrites";
import { runWhileLockHeld } from "../../test/lock";
import { venueService } from "../venue/venue.service";
import { scheduleSlotRepository } from "./scheduleSlot.repository";
import { scheduleSlotService } from "./scheduleSlot.service";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY = "2026-11-03";

async function venueWithTemplates(roles: string[] = ["救生", "櫃台"]) {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  if (roles.length > 0) {
    await db.insert(venueShiftTemplates).values(
      roles.map((role, i) => ({ venueId: venue.id, dayType: "weekday", shiftLabel: `班${i}`, startTime: "08:00", endTime: "12:00", role, requiredCount: 1 })),
    );
  }
  return venue;
}

const slotsOf = (venueId: number) => db.select().from(scheduleSlots).where(eq(scheduleSlots.venueId, venueId));
const templatesOf = (venueId: number) => db.select().from(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId)).orderBy(venueShiftTemplates.id);
const template = (over: Record<string, unknown> = {}) => ({ dayType: "weekday", shiftLabel: "早班", startTime: "06:00", endTime: "14:00", role: "救生", requiredCount: 1, ...over });

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("template to real slots", () => {
  it("two requests at once create the day's slots once", async () => {
    const venue = await venueWithTemplates();
    const read = venueService.getVenueShiftTemplates;
    vi.spyOn(venueService, "getVenueShiftTemplates").mockImplementation((async (...args: Parameters<typeof read>) => {
      const rows = await read(...args);
      await sleep(100);
      return rows;
    }) as never);
    await warmPool(4);

    await concurrently(2, () => scheduleSlotService.materialize({ venueId: venue.id, date: DAY }));

    expect(await slotsOf(venue.id)).toHaveLength(2);
  });

  it("a failure on the second slot leaves no slot, so the request can be run again", async () => {
    const venue = await venueWithTemplates(["救生", "會失敗"]);

    await withFailingWrites("schedule_slots", "insert", `NEW.role = '會失敗'`, async () => {
      await expect(scheduleSlotService.materialize({ venueId: venue.id, date: DAY })).rejects.toThrow();
    });
    expect(await slotsOf(venue.id)).toHaveLength(0);

    const retry: any = await scheduleSlotService.materialize({ venueId: venue.id, date: DAY });
    expect(retry.created).toBe(2);
  });

  it("waits while the venue's slot lock is held", async () => {
    const venue = await venueWithTemplates();
    const { finishedWhileHeld, outcome } = await runWhileLockHeld(LOCK_NS.venueSlots, venue.id, () => scheduleSlotService.materialize({ venueId: venue.id, date: DAY }));
    expect(finishedWhileHeld).toBe(false);
    expect(outcome.status).toBe("fulfilled");
  });
});

describe("copy a slot to several venues and days", () => {
  const payload = (venueIds: number[]) => ({ venueIds, startTime: "08:00", endTime: "12:00", role: "救生", requiredCount: 2, targetDates: ["2026-11-03", "2026-11-04"] });

  it("two identical requests at once leave one slot per venue and day", async () => {
    const a = await venueWithTemplates([]);
    const b = await venueWithTemplates([]);
    const read = scheduleSlotRepository.getScheduleSlotsByVenueAndDate;
    vi.spyOn(scheduleSlotRepository, "getScheduleSlotsByVenueAndDate").mockImplementation((async (...args: Parameters<typeof read>) => {
      const rows = await read(...args);
      await sleep(60);
      return rows;
    }) as never);
    await warmPool(4);

    await concurrently(2, () => scheduleSlotService.batchCopy(payload([a.id, b.id])));

    expect(await slotsOf(a.id)).toHaveLength(2);
    expect(await slotsOf(b.id)).toHaveLength(2);
  });

  it("two requests that list the same venues in opposite order both finish and leave one slot per venue and day", async () => {
    const a = await venueWithTemplates([]);
    const b = await venueWithTemplates([]);
    await warmPool(4);

    const results = await concurrently(2, (i) => scheduleSlotService.batchCopy(payload(i === 0 ? [a.id, b.id] : [b.id, a.id])));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await slotsOf(a.id)).toHaveLength(2);
    expect(await slotsOf(b.id)).toHaveLength(2);
  });

  it("a failure on a later venue leaves the earlier ones unwritten", async () => {
    const a = await venueWithTemplates([]);
    const b = await venueWithTemplates([]);

    await withFailingWrites("schedule_slots", "insert", `NEW.venue_id = ${b.id}`, async () => {
      await expect(scheduleSlotService.batchCopy(payload([a.id, b.id]))).rejects.toThrow();
    });

    expect(await slotsOf(a.id)).toHaveLength(0);
  });

  it("waits while any of the venues' slot locks is held", async () => {
    const a = await venueWithTemplates([]);
    const b = await venueWithTemplates([]);
    const { finishedWhileHeld } = await runWhileLockHeld(LOCK_NS.venueSlots, b.id, () => scheduleSlotService.batchCopy(payload([a.id, b.id])));
    expect(finishedWhileHeld).toBe(false);
  });
});

describe("replace a venue's templates", () => {
  it("replacing twice at once leaves one copy of the templates, not two", async () => {
    const venue = await venueWithTemplates(["舊"]);
    const del = venueService.deleteVenueShiftTemplatesByVenue;
    vi.spyOn(venueService, "deleteVenueShiftTemplatesByVenue").mockImplementation((async (...args: Parameters<typeof del>) => {
      const result = await del(...args);
      await sleep(100);
      return result;
    }) as never);
    await warmPool(4);

    await concurrently(2, () => scheduleSlotService.batchReplaceTemplates(venue.id, [template(), template({ shiftLabel: "晚班", startTime: "14:00", endTime: "22:00" })]));

    expect((await templatesOf(venue.id)).map((t) => t.shiftLabel)).toEqual(["早班", "晚班"]);
  });

  it("a failure while inserting keeps the venue's old templates", async () => {
    const venue = await venueWithTemplates(["舊"]);

    await withFailingWrites("venue_shift_templates", "insert", `NEW.shift_label = '會失敗'`, async () => {
      await expect(scheduleSlotService.batchReplaceTemplates(venue.id, [template(), template({ shiftLabel: "會失敗" })])).rejects.toThrow();
    });

    expect((await templatesOf(venue.id)).map((t) => t.role)).toEqual(["舊"]);
  });
});
