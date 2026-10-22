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

  remove: (id: number) => guidelineRepository.deleteGuideline(id),

  acks: (id: number) => guidelineRepository.getGuidelineAcks(id),

  allAcksWithDetails: () => guidelineRepository.getAllGuidelineAcksWithDetails(),

  async createAck(payload: unknown): Promise<GuidelineAck> {
    const parsed = insertGuidelineAckSchema.parse(payload);
    return guidelineRepository.createGuidelineAck(parsed);
  },

  createGuideline: guidelineRepository.createGuideline,
  createGuidelineAck: guidelineRepository.createGuidelineAck,
  getGuidelineAcksByEmployee: guidelineRepository.getGuidelineAcksByEmployee,
  getGuidelines: guidelineRepository.getGuidelines,
};
