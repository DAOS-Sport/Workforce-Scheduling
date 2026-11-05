import type { Express } from "express";
import type { Server } from "http";
import { z } from "zod";
import { fail } from "../../shared/http/response";
import { listErrors } from "./errors.service";

// A time must say its zone (Z or an offset); a bare date means midnight UTC.
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

const querySchema = z.object({
  requestId: z.string().min(1).max(64).optional(),
  since: z
    .string()
    .regex(ISO_TIME)
    .refine((value) => !Number.isNaN(Date.parse(value)))
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export function mountErrorsRoutes(_httpServer: Server, app: Express): void {
  // Behind the admin gate: /api/admin/* is not in OPEN_API_PREFIXES.
  app.get("/api/admin/errors", async (req, res) => {
    const query = querySchema.safeParse(req.query);
    if (!query.success) return fail(res, 400, "查詢條件格式錯誤：requestId、since（ISO 8601，含時區）、limit（1–500）");
    const { requestId, since, limit } = query.data;
    const items = await listErrors({ requestId, since: since ? new Date(since) : undefined, limit });
    res.json({ items });
  });
}
