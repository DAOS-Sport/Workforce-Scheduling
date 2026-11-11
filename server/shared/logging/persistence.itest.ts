import { beforeEach, describe, expect, it } from "vitest";
import { appLogs } from "@shared/schema";
import { db } from "../../infra/db";
import { resetDatabase } from "../../test/itest";
import { startLogPersistence, purgeOldLogs } from "./persistence";
import { flushLogs, recordLog } from "./collector";
import { withPipeline } from "./context";
import { runWithRequestId } from "../http/requestId";
import { trackJob } from "../health/healthState";
import { purgeOldErrors } from "../../modules/errors/errors.service";

beforeEach(resetDatabase);
describe("persistent diagnostic records", () => {
  it("writes redacted rows, startup and job start/end with pipeline/requestId", async () => {
    const stop=startLogPersistence();
    try {
      runWithRequestId('request-42',()=>withPipeline('shift.manage',()=>recordLog('warn','employeeId=42 a@example.test')));
      await trackJob('ragic.sync','manual',async()=>({ok:true}));
      await flushLogs();
      const rows=await db.select().from(appLogs);
      expect(rows).toHaveLength(4);
      expect(rows[0]).toMatchObject({pipeline:'server.restarts',message:'server.started'});
      expect(rows[1]).toMatchObject({pipeline:'shift.manage',requestId:'request-42',message:'employeeId=42 [EMAIL]'});
      expect(rows.slice(2).map(r=>[r.pipeline,r.message])).toEqual([['ragic.employee-sync','job started (manual)'],['ragic.employee-sync','job finished (success)']]);
    } finally { stop(); }
  });

  it("purges only records older than 14 days through the existing errors.purge entry", async () => {
    const now=new Date('2026-11-11T04:00:00Z');
    const row=(days:number)=>({occurredAt:new Date(now.getTime()-days*86400000),pipeline:'test',level:'warn',message:String(days)});
    await db.insert(appLogs).values([row(15),row(14),row(0)]);
    expect(await purgeOldErrors(now)).toEqual({deleted:0});
    expect((await db.select().from(appLogs)).map(r=>r.message).sort()).toEqual(['0','14']);
    expect(await purgeOldLogs(now)).toBe(0);
  });
});
