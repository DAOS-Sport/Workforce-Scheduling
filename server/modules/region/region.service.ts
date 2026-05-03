/**
 * Region service — business operations for region listing.
 *
 * Currently a thin façade over `storage`; lives here so route handlers
 * never reach into the storage layer directly. As region rules grow
 * (region-scoped permissions, lookup caches, etc.) they belong here.
 */
import { storage } from "../../storage";

export const regionService = {
  findAll: () => storage.getRegions(),
  findByCode: (code: string) => storage.getRegionByCode(code),
};
