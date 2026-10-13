// @vitest-environment jsdom
import React from "react";
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,waitFor,cleanup,fireEvent,act} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
const region=vi.hoisted(()=>({activeRegion:"A",selectedRegions:["A"],toggleSelectedRegion:()=>{}}));
vi.mock("@/lib/region-context",()=>({useRegion:()=>region}));
vi.mock("@/components/region-tabs",()=>({RegionTabs:()=>null}));
vi.mock("@/components/region-pills",()=>({RegionPills:()=>null}));
vi.mock("@/components/GoogleSheetsImportDialog",()=>({GoogleSheetsImportDialog:()=>null}));
import SchedulePage from "./schedule";
HTMLElement.prototype.scrollIntoView=vi.fn();
// Pin "today": the fixture shift is on the 1st and must count as past, since upcoming shifts of resigned staff are cancellable.
vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(2026,9,15,12));
afterEach(()=>{cleanup();localStorage.clear();});
const month=new Date();const yyyy=month.getFullYear(),mm=String(month.getMonth()+1).padStart(2,"0");
const date=yyyy+"-"+mm+"-01";
const employee={id:2,name:"歷史測試員",employeeCode:"H",role:"教練",employmentType:"part_time",regionId:1,status:"inactive"};
const shifts=[{id:10,employeeId:2,venueId:1,date,startTime:"09:00",endTime:"12:00",role:"教練",status:"active",isDispatch:false}];
function start(fixed=false,hidden=false,status="inactive"){
 localStorage.setItem("schedule_fixed_order_A",String(fixed));
 localStorage.setItem("schedule_visible_A",JSON.stringify(hidden?[]:[2]));
 localStorage.setItem("schedule_seen_A","[2]");
 const e={...employee,status};
 const q=new QueryClient({defaultOptions:{queries:{retry:false,initialData:()=>[],queryFn:async({queryKey})=>{
 const p=queryKey.join("/");
 if(p.startsWith("/api/employees/schedule/"))return [e];
 if(p.startsWith("/api/employees"))return status==="active"?[e]:[];
 if(p.startsWith("/api/shifts/"))return shifts;
 if(p==="/api/regions")return [{id:1,code:"A",name:"測試區"}];
 if(p.startsWith("/api/venues"))return [{id:1,shortName:"測試場",name:"測試場",regionId:1}];
 if(p.includes("precheck"))return {warnings:[]};
 return [];
 }}}});
 render(<QueryClientProvider client={q}><SchedulePage/></QueryClientProvider>);
 return q;
}
for(const fixed of [false,true])it("shows inactive only historical row "+fixed,async()=>{
 start(fixed);const row=await screen.findByTestId("row-employee-2");
 expect(row).toHaveTextContent("離職／歷史紀錄");
 expect(screen.getByTestId("shift-10")).toHaveTextContent("09:00–12:00");
 expect(screen.queryByTestId("button-add-shift-2-"+date)).toBeNull();
 expect(screen.queryByText("此區域尚無員工")).toBeNull();
 fireEvent.click(screen.getByTestId("shift-10"));
 expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps manual hidden history hidden on refetch",async()=>{
 const q=start(false,true);await waitFor(()=>expect(q.isFetching()).toBe(0));
 expect(screen.queryByTestId("row-employee-2")).toBeNull();
 await q.invalidateQueries();await waitFor(()=>expect(q.isFetching()).toBe(0));
 expect(screen.queryByTestId("row-employee-2")).toBeNull();
 expect(JSON.parse(localStorage.getItem("schedule_visible_A")!)).toEqual([]);
});
it("retains active shift add control",async()=>{start(false,false,"active");await screen.findByTestId("row-employee-2");expect(screen.getByTestId("button-add-shift-2-"+date)).toBeInTheDocument();});

it("keeps an open month when employee becomes inactive and clears bulk selection",async()=>{
 const q=start(false,false,"active");await screen.findByTestId("row-employee-2");
 fireEvent.click(screen.getByTestId("button-toggle-multi-select"));fireEvent.click(screen.getByTestId("shift-10"));
 expect(screen.getByTestId("button-batch-delete-confirm")).toBeInTheDocument();
 await act(async()=>{for(const query of q.getQueryCache().findAll())if(query.queryKey[1]==="schedule")q.setQueryData(query.queryKey,[employee]);});
 await waitFor(()=>expect(screen.queryByTestId("button-batch-delete-confirm")).toBeNull());
 expect(screen.getByTestId("row-employee-2")).toHaveTextContent("離職／歷史紀錄");
 fireEvent.click(screen.getByTestId("shift-10"));expect(screen.queryByTestId("button-batch-delete-confirm")).toBeNull();
});
it("removes historical-only row after its returned shift is cancelled",async()=>{
 const q=start();await screen.findByTestId("row-employee-2");
 await act(async()=>{for(const query of q.getQueryCache().findAll())if(query.queryKey[0]==="/api/shifts")q.setQueryData(query.queryKey,[]);});
 await waitFor(()=>expect(screen.queryByTestId("row-employee-2")).toBeNull());
});
