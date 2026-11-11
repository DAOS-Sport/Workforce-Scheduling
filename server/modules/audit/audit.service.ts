import { auditRepository, type TimelineOptions } from "./audit.repository";

export {
  insertAudit,
  withAuditFailureSignal,
  prepareAudit,
  mutationLink,
  recordOperation,
  auditedAtomic,
} from "./audit.persistence.repository";

export const auditService = {
  timeline: (options: TimelineOptions) => auditRepository.timeline(options),
};
