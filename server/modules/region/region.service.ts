/**
 * Region service — business operations for region listing.
 *
 * Currently a thin layer over the region repository; lives here so route
 * handlers never reach into the repository directly. As region rules grow
 * (region-scoped permissions, lookup caches, etc.) they belong here.
 */
export const regionService = {
  findAll: async () => {
    const { regionRepository } = await import("./region.repository");
    return regionRepository.getRegions();
  },
  findByCode: async (code: string) => {
    const { regionRepository } = await import("./region.repository");
    return regionRepository.getRegionByCode(code);
  },
};
