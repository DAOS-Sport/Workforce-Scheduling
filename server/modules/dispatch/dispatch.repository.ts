import { storage } from "../../storage";

export const dispatchRepository = {
  getByRegion: storage.getDispatchShifts.bind(storage),
  getByDate: storage.getDispatchShiftsByDate.bind(storage),
  getByLinkedEmployee: storage.getDispatchShiftsByLinkedEmployee.bind(storage),
  getById: storage.getDispatchShift.bind(storage),
  create: storage.createDispatchShift.bind(storage),
  batchCreate: storage.batchCreateDispatchShifts.bind(storage),
  update: storage.updateDispatchShift.bind(storage),
  delete: storage.deleteDispatchShift.bind(storage),
  reconcileLinks: storage.reconcileDispatchLinks.bind(storage),
};
