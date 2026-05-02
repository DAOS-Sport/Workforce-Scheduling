import { storage } from "../../storage";

export const regionRepository = {
  getAll: storage.getRegions.bind(storage),
  getByCode: storage.getRegionByCode.bind(storage),
  create: storage.createRegion.bind(storage),
};
