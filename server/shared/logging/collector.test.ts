import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLogSink, flushLogs, recordLog } from "./collector";
import { withPipeline } from "./context";
import { installLogStamp, log } from "../log";
import { runWithRequestId } from "../http/requestId";
import { logRequestPipeline } from "./requestLogging";

afterEach(() => vi.restoreAllMocks());

describe("log collection wiring", () => {
  it("keeps warning/error request and job attribution; ignores info, objects and its own diagnostics", async () => {
    const rows: any[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stop = configureLogSink(async (batch) => { rows.push(...batch); });
    const restore = installLogStamp();
    try {
      runWithRequestId("req-9", () => withPipeline("push.delivery", () => {
        console.warn("failed contact test@example.test", { body: "PRIVATE-BODY" });
        console.error(new Error("broken"));
        console.info("ignore-info");
        log("失敗 testing", "cron");
        log("Ragic 同步完成: 新增 0, 更新 0, 錯誤 0", "cron");
        console.error("[app-logs] batch write failed; records dropped");
      }));
      await flushLogs();
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.pipeline === "push.delivery" && r.requestId === "req-9")).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/PRIVATE-BODY|test@example.test|ignore-info|batch write/);
    } finally { restore(); stop(); }
  });

  it("a failed DB write cannot fail or delay a request and cannot recursively collect its diagnostic", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let release!: () => void;
    const write = vi.fn(() => new Promise<void>((_resolve, reject) => { release = () => reject(Error("DB unavailable")); }));
    const stop = configureLogSink(write);
    const restore = installLogStamp();
    const app = express();
    app.get("/probe", (_req, res) => { console.error("route warning"); res.json({ ok: true }); });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      recordLog("warn", "already queued", "database");
      const writing = flushLogs();
      const res = await fetch(`http://127.0.0.1:${(server.address() as any).port}/probe`);
      expect(await res.json()).toEqual({ ok: true });
      release();
      await writing;
      // One real request error was queued while the DB write was hung; its diagnostic is not queued.
      const second = flushLogs();
      release();
      await second;
      await flushLogs();
      expect(write).toHaveBeenCalledTimes(2);
    } finally { restore(); stop(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("uses route prefixes and captures refused logins without body/query data", async () => {
    const rows: any[] = [];
    const stop = configureLogSink(async (batch) => { rows.push(...batch); });
    const app = express();
    app.use((req,res,next) => { res.locals.requestId='req-login'; logRequestPipeline(req,res,next); });
    app.post('/api/admin/login', (_req,res) => res.status(401).json({message:'refused'}));
    app.get('/api/admin/me', (_req,res) => res.status(401).json({message:'not signed in'}));
    app.post('/api/admin/dev-login', (_req,res) => res.json({ok:true}));
    app.get('/api/employees', (_req,res) => { recordLog('warn','failure employeeId=42'); res.json({ok:true}); });
    const server=app.listen(0,'127.0.0.1');
    await new Promise<void>((resolve)=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${(server.address() as any).port}`;
    try {
      await fetch(base+'/api/admin/login?token=secret-query',{method:'POST',body:'PRIVATE-BODY'});
      await fetch(base+'/api/admin/me');
      await fetch(base+'/api/admin/dev-login',{method:'POST'});
      await fetch(base+'/api/employees');
      await flushLogs();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({pipeline:'admin.login',requestId:'req-login',level:'warn'});
      expect(rows[1]).toMatchObject({pipeline:'employee.manage',level:'warn'});
      expect(JSON.stringify(rows)).not.toMatch(/secret-query|PRIVATE-BODY/);
    } finally { stop(); server.closeAllConnections(); await new Promise<void>((resolve)=>server.close(()=>resolve())); }
  });
});
