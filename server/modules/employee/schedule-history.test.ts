// @vitest-environment node
import { describe,it,expect,vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
const f=vi.hoisted(()=>({
 employees:[
 {id:1,name:"Active",employeeCode:"A",role:"教練",employmentType:"part_time",regionId:1,status:"active",phone:"PRIVATE"},
 {id:2,name:"History",employeeCode:"H",role:"教練",employmentType:"part_time",regionId:1,status:"inactive",phone:"PRIVATE"},
 {id:3,name:"Other history",employeeCode:"X",role:"教練",employmentType:"part_time",regionId:2,status:"inactive",phone:"PRIVATE"},
 {id:4,name:"No history",employeeCode:"N",role:"教練",employmentType:"part_time",regionId:1,status:"inactive",phone:"PRIVATE"}],
 shifts:[{id:10,employeeId:2,date:"2026-09-01",status:"active"},{id:11,employeeId:3,date:"2026-09-02",status:"active"}]
}));
vi.mock("../../storage",()=>({storage:{
 getAllEmployees:vi.fn(async()=>f.employees),
 getRegionByCode:vi.fn(async(c:string)=>c==="A"?{id:1}:undefined),
 getEmployeesByRegion:vi.fn(async()=>f.employees.filter(e=>e.regionId===1)),
 getEmployeesForNeiQin:vi.fn(async()=>f.employees),
 getShiftsByRegionAndDateRange:vi.fn(async()=>f.shifts.slice(0,1)),
 getDispatchedShiftsToRegion:vi.fn(async()=>f.shifts.slice(1))
}}));
import { mountEmployeeRoutes } from "./employee.routes";
import { gateAdminApi } from "../../shared/middleware/requireAdmin";
import { employeeService } from "./employee.service";
describe("historical monthly roster HTTP",()=>{
 async function request(path:string,admin=true) {
  const app=express();
  app.use((req,_res,next)=>{(req as any).session=admin?{adminId:1}:{};next();});
  app.use(gateAdminApi);mountEmployeeRoutes(undefined as any,app);
  const server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try {const res=await fetch("http://127.0.0.1:"+(server.address() as any).port+path);
   return {status:res.status,body:res.headers.get("content-type")?.includes("json")?await res.json():null};
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 }
 it("keeps resigned and dispatched historical IDs without writing fixture",async()=>{
  const before=JSON.stringify(f);
  const r=await request("/api/employees/schedule/A/2026-09-01/2026-09-30");
  expect(r.status).toBe(200);expect(r.body.map((e:any)=>e.id)).toEqual([1,2,3]);
  for(const e of r.body)expect(Object.keys(e).sort()).toEqual(["id","name","employeeCode","role","employmentType","regionId","status"].sort());
  expect(JSON.stringify(f)).toBe(before);
 });
 it("retains active-only ordinary APIs",async()=>{expect((await employeeService.findByRegionCodes("A")).map(e=>e.id)).toEqual([1]);expect((await employeeService.findAllActive()).map(e=>e.id)).toEqual([1]);});
 it("rejects invalid calendar and reversed ranges",async()=>{
  for(const dates of ["2026-02-30/2026-03-01","2026-09-30/2026-09-01","bad/2026-09-01"])
   expect((await request("/api/employees/schedule/A/"+dates)).status).toBe(400);
 });
 it("requires original admin session",async()=>{expect((await request("/api/employees/schedule/A/2026-09-01/2026-09-30",false)).status).toBe(401);});
 it("does not widen unknown region",async()=>{const r=await request("/api/employees/schedule/UNKNOWN/2026-09-01/2026-09-30");expect(r.status).toBe(200);expect(r.body).toEqual([]);});
});
