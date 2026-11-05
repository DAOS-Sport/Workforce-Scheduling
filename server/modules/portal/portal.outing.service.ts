import { outingRepository } from "./portal.outing.repository";

export async function createOutingRecord(body: any) {
  const { employeeId, outType, destination, note, latitude, longitude, accuracy, imageUrl } = body;
  return outingRepository.create({
    employeeId: Number(employeeId),
    outType,
    destination: destination?.trim() || null,
    note: note?.trim() || null,
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy: accuracy != null ? Number(accuracy) : null,
    imageUrl: imageUrl || null,
    status: "submitted",
  });
}

export function listEmployeeOutingRecords(employeeId: number) {
  return outingRepository.listByEmployee(employeeId);
}

export function listAllOutingRecords() {
  return outingRepository.listAll();
}
