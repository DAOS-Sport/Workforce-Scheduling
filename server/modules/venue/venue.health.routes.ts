/**
 * Venue location-health admin routes — Task #98.
 *
 * GET    /api/admin/venue-health        — aggregated per-venue success/fail
 *                                          stats with centroid drift, label.
 * POST   /api/admin/venue-health/:id/relocate
 *                                       — set venue lat/lng to the centroid
 *                                          of the last 30d successful clocks
 *                                          (requires ≥10 samples).
 * PATCH  /api/admin/venues/:id/active   — toggle venue isActive flag.
 */
import { type Express, type Request, type Response } from "express";
import { type Server } from "http";
import { storage } from "../../storage";
import { invalidateVenueCache } from "../line/lineClock.service";
import { requireAdmin } from "../../shared/middleware/requireAdmin";

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function mountVenueHealthRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/admin/venue-health", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [venues, records] = await Promise.all([
        storage.getAllVenues(),
        storage.getClockRecordsByDateRange(fmt(start), fmt(today)),
      ]);

      const byVenue = new Map<number, typeof records>();
      for (const r of records) {
        if (r.venueId == null) continue;
        if (!byVenue.has(r.venueId)) byVenue.set(r.venueId, []);
        byVenue.get(r.venueId)!.push(r);
      }

      // Detect duplicate venues by proximity (<200m & same regionId).
      const dupGroups = new Map<number, number[]>();
      for (let i = 0; i < venues.length; i++) {
        for (let j = i + 1; j < venues.length; j++) {
          const a = venues[i];
          const b = venues[j];
          if (a.regionId !== b.regionId) continue;
          if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) continue;
          if (haversine(a.latitude, a.longitude, b.latitude, b.longitude) < 200) {
            if (!dupGroups.has(a.id)) dupGroups.set(a.id, []);
            if (!dupGroups.has(b.id)) dupGroups.set(b.id, []);
            dupGroups.get(a.id)!.push(b.id);
            dupGroups.get(b.id)!.push(a.id);
          }
        }
      }

      const rows = venues.map((v) => {
        const recs = byVenue.get(v.id) || [];
        const success = recs.filter((r) => r.status === "success");
        const fail = recs.filter((r) => r.status === "fail");
        const suspicious = recs.filter((r) => (r as any).suspiciousLocation === true).length;
        const bufferApplied = recs.filter((r) => (r as any).accuracyBufferApplied === true).length;
        let centroidLat: number | null = null;
        let centroidLng: number | null = null;
        let drift: number | null = null;
        // Dispersion = mean distance from each success point to the centroid
        // (≈ standard radius of the cluster). Helps admins decide whether
        // the venue radius is too tight or whether GPS drift is just noisy.
        let dispersion: number | null = null;
        let lastSuccessAt: string | null = null;
        const validSuccess = success.filter((r) => r.latitude != null && r.longitude != null);
        if (validSuccess.length > 0) {
          centroidLat = validSuccess.reduce((s, r) => s + (r.latitude as number), 0) / validSuccess.length;
          centroidLng = validSuccess.reduce((s, r) => s + (r.longitude as number), 0) / validSuccess.length;
          if (v.latitude != null && v.longitude != null) {
            drift = Math.round(haversine(v.latitude, v.longitude, centroidLat, centroidLng));
          }
          dispersion = Math.round(
            validSuccess.reduce((s, r) => s + haversine(r.latitude as number, r.longitude as number, centroidLat!, centroidLng!), 0)
              / validSuccess.length,
          );
          lastSuccessAt = validSuccess
            .map((r) => r.clockTime as unknown as string)
            .sort()
            .pop() ?? null;
        }
        let label: "ok" | "no_data" | "drift" | "duplicate" | "no_coord" | "inactive" = "ok";
        if (v.isActive === false) label = "inactive";
        else if (v.latitude == null || v.longitude == null) label = "no_coord";
        else if (dupGroups.has(v.id)) label = "duplicate";
        else if (success.length === 0) label = "no_data";
        else if (drift != null && drift > 200) label = "drift";

        return {
          id: v.id,
          name: v.name,
          shortName: v.shortName,
          regionId: v.regionId,
          latitude: v.latitude,
          longitude: v.longitude,
          radius: v.radius,
          isInternal: v.isInternal === true,
          isActive: v.isActive !== false,
          successCount: success.length,
          failCount: fail.length,
          suspiciousCount: suspicious,
          bufferAppliedCount: bufferApplied,
          centroidLat: centroidLat != null ? Number(centroidLat.toFixed(6)) : null,
          centroidLng: centroidLng != null ? Number(centroidLng.toFixed(6)) : null,
          drift,
          dispersion,
          lastSuccessAt,
          duplicateOf: dupGroups.get(v.id) || [],
          label,
        };
      });

      rows.sort((a, b) => {
        const order: Record<string, number> = { drift: 0, duplicate: 1, no_data: 2, no_coord: 3, inactive: 4, ok: 5 };
        return (order[a.label] - order[b.label]) || a.shortName.localeCompare(b.shortName);
      });

      res.json({ rangeStart: fmt(start), rangeEnd: fmt(today), rows });
    } catch (err: any) {
      console.error("[venue-health] list error", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/venue-health/:id/relocate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const venue = await storage.getVenue(id);
      if (!venue) return res.status(404).json({ message: "場館不存在" });

      const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const records = await storage.getClockRecordsByDateRange(fmt(start), fmt(today));
      const success = records.filter((r) => r.venueId === id && r.status === "success" && r.latitude != null && r.longitude != null);
      if (success.length < 10) {
        return res.status(400).json({ message: `成功打卡數不足（${success.length}/10），無法自動定位` });
      }
      const cLat = Number((success.reduce((s, r) => s + (r.latitude as number), 0) / success.length).toFixed(6));
      const cLng = Number((success.reduce((s, r) => s + (r.longitude as number), 0) / success.length).toFixed(6));
      const updated = await storage.updateVenue(id, { latitude: cLat, longitude: cLng });
      invalidateVenueCache();
      res.json({ ok: true, venue: updated, samples: success.length, latitude: cLat, longitude: cLng });
    } catch (err: any) {
      console.error("[venue-health] relocate error", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/venues/:id/active", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { isActive } = req.body || {};
      if (typeof isActive !== "boolean") return res.status(400).json({ message: "isActive 必須為 boolean" });
      const updated = await storage.updateVenue(id, { isActive } as any);
      if (!updated) return res.status(404).json({ message: "場館不存在" });
      invalidateVenueCache();
      res.json({ ok: true, venue: updated });
    } catch (err: any) {
      console.error("[venue-health] toggle active error", err);
      res.status(500).json({ message: err.message });
    }
  });
}
