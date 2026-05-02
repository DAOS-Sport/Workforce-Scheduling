import { storage } from "../../storage";

export const systemRepository = {
  // System config
  getConfig: storage.getSystemConfig.bind(storage),
  upsertConfig: storage.upsertSystemConfig.bind(storage),

  // Salary rates
  getSalaryRates: storage.getSalaryRates.bind(storage),
  upsertSalaryRate: storage.upsertSalaryRate.bind(storage),
};
