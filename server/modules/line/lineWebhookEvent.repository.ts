import { eq } from "drizzle-orm";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { lineWebhookEvents } from "@shared/schema";

export const lineWebhookEventRepository = {
  /** Record that this event arrived. False means it arrived before and must not be handled again. */
  async claim(eventId: string, tx: Executor = db): Promise<boolean> {
    const claimed = await tx.insert(lineWebhookEvents).values({ eventId }).onConflictDoNothing().returning({ eventId: lineWebhookEvents.eventId });
    return claimed.length > 0;
  },

  async finish(eventId: string, outcome: { error?: string }, tx: Executor = db): Promise<void> {
    await tx
      .update(lineWebhookEvents)
      .set({ status: outcome.error === undefined ? "done" : "failed", processedAt: new Date(), error: outcome.error ?? null })
      .where(eq(lineWebhookEvents.eventId, eventId));
  },
};
