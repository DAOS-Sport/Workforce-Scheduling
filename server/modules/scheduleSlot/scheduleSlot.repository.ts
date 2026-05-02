import { storage } from "../../storage";

export const scheduleSlotRepository = {
  getByRegionAndDateRange: storage.getScheduleSlotsByRegionAndDateRange.bind(storage),
  getByVenueAndDate: storage.getScheduleSlotsByVenueAndDate.bind(storage),
  create: storage.createScheduleSlot.bind(storage),
  update: storage.updateScheduleSlot.bind(storage),
  delete: storage.deleteScheduleSlot.bind(storage),
};
