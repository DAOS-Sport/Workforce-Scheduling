import { and, eq, sql } from "drizzle-orm";
import {
  manualScheduleCourses,
  summerScheduleAssignments,
  type InsertManualScheduleCourse,
  type InsertSummerScheduleAssignment,
  type ManualScheduleCourse,
  type SummerScheduleAssignment,
} from "@shared/schema";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";

/** The one draft version the summer page reads, saves and publishes. */
export const DRAFT_VERSION = "v40";

type DraftContent = Pick<InsertSummerScheduleAssignment, "rawEntries" | "assignments" | "shiftEntries">;

const draftOf = (weekNo: number) => and(eq(summerScheduleAssignments.version, DRAFT_VERSION), eq(summerScheduleAssignments.weekNo, weekNo));

export const summerScheduleRepository = {
  async getDraft(weekNo: number, tx: Executor = db): Promise<SummerScheduleAssignment | undefined> {
    const [row] = await tx.select().from(summerScheduleAssignments).where(draftOf(weekNo));
    return row;
  },

  /** Insert or overwrite the week's draft, whatever version is stored. */
  async upsertDraft(weekNo: number, content: DraftContent, updatedAt: Date, tx: Executor = db): Promise<void> {
    await tx
      .insert(summerScheduleAssignments)
      .values({ version: DRAFT_VERSION, weekNo, ...content, updatedAt })
      .onConflictDoUpdate({ target: [summerScheduleAssignments.version, summerScheduleAssignments.weekNo], set: { ...content, updatedAt } });
  },

  /** Insert the week's first draft; false when one exists already. */
  async insertDraftIfAbsent(weekNo: number, content: DraftContent, updatedAt: Date, tx: Executor = db): Promise<boolean> {
    const rows = await tx
      .insert(summerScheduleAssignments)
      .values({ version: DRAFT_VERSION, weekNo, ...content, updatedAt })
      .onConflictDoNothing()
      .returning({ id: summerScheduleAssignments.id });
    return rows.length > 0;
  },

  /**
   * Overwrite the draft only if it is still the version the sender read: `updated_at` equal to
   * `expected` to the millisecond (what the page gets back as an ISO string). False when it moved on.
   */
  async updateDraftIfUnchanged(weekNo: number, expected: Date, content: DraftContent, updatedAt: Date, tx: Executor = db): Promise<boolean> {
    const rows = await tx
      .update(summerScheduleAssignments)
      .set({ ...content, updatedAt })
      .where(and(draftOf(weekNo), sql`date_trunc('milliseconds', ${summerScheduleAssignments.updatedAt}) = ${expected.toISOString()}::timestamp`))
      .returning({ id: summerScheduleAssignments.id });
    return rows.length > 0;
  },

  async getActiveManualCourses(weekNo: number, tx: Executor = db): Promise<ManualScheduleCourse[]> {
    return tx
      .select()
      .from(manualScheduleCourses)
      .where(and(eq(manualScheduleCourses.weekNo, weekNo), eq(manualScheduleCourses.status, "active")));
  },

  async createManualCourses(rows: InsertManualScheduleCourse[], tx: Executor = db): Promise<ManualScheduleCourse[]> {
    return tx.insert(manualScheduleCourses).values(rows).returning();
  },

  async updateManualCourse(id: number, patch: Partial<InsertManualScheduleCourse>, tx: Executor = db): Promise<ManualScheduleCourse | undefined> {
    const [row] = await tx.update(manualScheduleCourses).set({ ...patch, updatedAt: new Date() }).where(eq(manualScheduleCourses.id, id)).returning();
    return row;
  },

  /** The active course in one slot: same day, course name and times (the cram import's key). */
  async findActiveCourseInSlot(slot: { date: string; courseName: string; startTime: string; endTime: string }, tx: Executor = db): Promise<ManualScheduleCourse | undefined> {
    const [row] = await tx
      .select()
      .from(manualScheduleCourses)
      .where(
        and(
          eq(manualScheduleCourses.status, "active"),
          eq(manualScheduleCourses.date, slot.date),
          eq(manualScheduleCourses.courseName, slot.courseName),
          eq(manualScheduleCourses.startTime, slot.startTime),
          eq(manualScheduleCourses.endTime, slot.endTime),
        ),
      )
      .orderBy(manualScheduleCourses.id)
      .limit(1);
    return row;
  },
};
