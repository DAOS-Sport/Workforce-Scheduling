import { storage } from "../../storage";

export const guidelineRepository = {
  getAll: storage.getGuidelines.bind(storage),
  getById: storage.getGuideline.bind(storage),
  create: storage.createGuideline.bind(storage),
  update: storage.updateGuideline.bind(storage),
  delete: storage.deleteGuideline.bind(storage),

  // Acknowledgments
  getAcks: storage.getGuidelineAcks.bind(storage),
  createAck: storage.createGuidelineAck.bind(storage),
  getAcksByEmployee: storage.getGuidelineAcksByEmployee.bind(storage),
};
