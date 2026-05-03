/**
 * Clock module umbrella router — Task #71 重構 B split into 2 sub-files:
 *   - clock.records.routes.ts    — read/list records, reports, reason patch
 *   - clock.amendment.routes.ts  — clock-amendment CRUD + admin approval
 *
 * (Weekly attendance lives in the `system` module, not here.)
 */
import { type Express } from "express";
import { type Server } from "http";
import { mountClockRecordsRoutes } from "./clock.records.routes";
import { mountClockAmendmentRoutes } from "./clock.amendment.routes";

export function mountClockRoutes(httpServer: Server, app: Express): void {
  mountClockRecordsRoutes(httpServer, app);
  mountClockAmendmentRoutes(httpServer, app);
}
