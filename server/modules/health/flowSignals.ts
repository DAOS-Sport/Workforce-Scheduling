/** Adapt persisted read-only workflow signals to this server's scheduler mode. */
import { IS_PRODUCTION } from "../../config/env";
import type { FlowSignals } from "../../core/health/flowRules";
import { readFlowSignals } from "./flowSignals.repository";

export async function collectFlowSignals(now: Date): Promise<FlowSignals> {
  return { ...await readFlowSignals(now), schedulerActive: IS_PRODUCTION };
}
