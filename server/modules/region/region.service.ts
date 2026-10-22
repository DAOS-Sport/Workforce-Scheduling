/**
 * Region service — business operations for region listing.
 *
 * Currently a thin layer over the region repository; lives here so route
 * handlers never reach into the repository directly. As region rules grow
 * (region-scoped permissions, lookup caches, etc.) they belong here.
 */
import { regionRepository } from "./region.repository";

export const regionService = {
  findAll: () => regionRepository.getRegions(),
  findByCode: (code: string) => regionRepository.getRegionByCode(code),
};
