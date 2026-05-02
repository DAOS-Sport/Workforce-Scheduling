import { storage } from "../../storage";

export const anomalyRepository = {
  create: storage.createAnomalyReport.bind(storage),
  getAll: storage.getAnomalyReports.bind(storage),
  getById: storage.getAnomalyReport.bind(storage),
  updateResolution: storage.updateAnomalyResolution.bind(storage),
  delete: storage.deleteAnomalyReport.bind(storage),
};
