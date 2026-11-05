/**
 * Guideline service — admin CRUD, image-stripping for list views, and
 * employee acknowledgment writes.
 *
 * The portal-side "which guidelines apply to me right now" computation
 * lives in portal.service because it needs my-shift / venue-scope context
 * that pure CRUD callers don't have.
 */
import {
  insertGuidelineSchema,
  insertGuidelineAckSchema,
  type Guideline,
  type GuidelineAck,
} from "@shared/schema";
import { ackIsCurrent } from "../../core/guideline/ack";
import { LOCK_NS, lockXact, withTx } from "../../infra/db/tx";
import { guidelineRepository } from "./guideline.repository";

export const guidelineService = {
  async list(category?: string) {
    const items = await guidelineRepository.getGuidelines(category);
    return items.map(({ imageUrl, imageUrls, ...rest }) => ({
      ...rest,
      imageCount: (imageUrls && imageUrls.length > 0) ? imageUrls.length : (imageUrl ? 1 : 0),
    }));
  },

  get: (id: number) => guidelineRepository.getGuideline(id),

  async create(payload: unknown): Promise<Guideline> {
    const parsed = insertGuidelineSchema.parse(payload);
    return guidelineRepository.createGuideline(parsed);
  },

  async update(id: number, payload: unknown): Promise<Guideline | null> {
    const partial = insertGuidelineSchema.partial().parse(payload);
    return (await guidelineRepository.updateGuideline(id, partial as any)) ?? null;
  },

  /** The acknowledgments and the guideline go together: if the guideline cannot be deleted, no acknowledgment is lost. */
  remove: (id: number) =>
    withTx(async (tx) => {
      await guidelineRepository.deleteGuidelineAcks(id, tx);
      return guidelineRepository.deleteGuideline(id, tx);
    }),

  acks: (id: number) => guidelineRepository.getGuidelineAcks(id),

  allAcksWithDetails: () => guidelineRepository.getAllGuidelineAcksWithDetails(),

  /**
   * Acknowledge on an employee's behalf. Under the employee's guideline lock, an acknowledgment that still counts (this
   * month, guideline unchanged since) is returned instead of recording a second one.
   */
  async createAck(payload: unknown): Promise<GuidelineAck> {
    const parsed = insertGuidelineAckSchema.parse(payload);
    return withTx(async (tx) => {
      await lockXact(tx, LOCK_NS.guidelineAck, parsed.employeeId);
      const guideline = await guidelineRepository.getGuideline(parsed.guidelineId, tx);
      const mine = await guidelineRepository.getGuidelineAcksByEmployee(parsed.employeeId, tx);
      const now = new Date();
      const current = mine.find((a) => a.guidelineId === parsed.guidelineId && ackIsCurrent(a.acknowledgedAt, guideline?.updatedAt ?? null, now));
      return current ?? guidelineRepository.createGuidelineAck(parsed, tx);
    });
  },

  createGuideline: guidelineRepository.createGuideline,
  createGuidelineAck: guidelineRepository.createGuidelineAck,
  getGuidelineAcksByEmployee: guidelineRepository.getGuidelineAcksByEmployee,
  getGuidelines: guidelineRepository.getGuidelines,
};
