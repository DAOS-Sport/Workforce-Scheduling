/**
 * Guideline service — admin CRUD, image-stripping for list views, and
 * employee acknowledgment writes.
 *
 * The portal-side "which guidelines apply to me right now" computation
 * lives in portal.service because it needs my-shift / venue-scope context
 * that pure CRUD callers don't have.
 */
import { storage } from "../../storage";
import {
  insertGuidelineSchema,
  insertGuidelineAckSchema,
  type Guideline,
  type GuidelineAck,
} from "@shared/schema";

export const guidelineService = {
  async list(category?: string) {
    const items = await storage.getGuidelines(category);
    return items.map(({ imageUrl, imageUrls, ...rest }) => ({
      ...rest,
      imageCount: (imageUrls && imageUrls.length > 0) ? imageUrls.length : (imageUrl ? 1 : 0),
    }));
  },

  get: (id: number) => storage.getGuideline(id),

  async create(payload: unknown): Promise<Guideline> {
    const parsed = insertGuidelineSchema.parse(payload);
    return storage.createGuideline(parsed);
  },

  async update(id: number, payload: unknown): Promise<Guideline | null> {
    const partial = insertGuidelineSchema.partial().parse(payload);
    return (await storage.updateGuideline(id, partial as any)) ?? null;
  },

  remove: (id: number) => storage.deleteGuideline(id),

  acks: (id: number) => storage.getGuidelineAcks(id),

  allAcksWithDetails: () => storage.getAllGuidelineAcksWithDetails(),

  async createAck(payload: unknown): Promise<GuidelineAck> {
    const parsed = insertGuidelineAckSchema.parse(payload);
    return storage.createGuidelineAck(parsed);
  },
};
