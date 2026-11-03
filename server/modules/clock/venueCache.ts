import type { Venue } from "@shared/schema";

const TTL_MS = 5 * 60 * 1000;
let cache: { venues: Venue[]; cachedAt: number } | null = null;

/** Active venues only: the ones clock-in matches a GPS position against. */
export async function getCachedVenues(load: () => Promise<Venue[]>): Promise<Venue[]> {
  const now = Date.now();
  if (cache && now - cache.cachedAt < TTL_MS) return cache.venues;
  const venues = (await load()).filter((v) => v.isActive !== false);
  cache = { venues, cachedAt: now };
  return venues;
}

export function invalidateVenueCache(): void {
  cache = null;
}
