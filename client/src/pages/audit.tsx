import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Actor = { kind: "personal" | "shared_password" | "employee" | "system"; employeeId?: number; name?: string };
type Item = { id: string; entity: string; recordId: string; employeeId: number | null; at: string; action: string; actor: Actor; before: unknown; after: unknown };
type Timeline = { items: Item[]; nextCursor: string | null };
const entities = [
  ["shifts", "班表"], ["dispatch_shifts", "派遣班表"], ["clock_records", "打卡"],
  ["clock_amendments", "補打卡申請"], ["leave_requests", "請假單"], ["employee_leave_balances", "特休餘額"],
] as const;
const taipei = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "medium", hour12: false });

function actorLabel(actor: Actor) {
  if (actor.kind === "shared_password") return "共用密碼";
  if (actor.kind === "system") return "排程／系統";
  const person = actor.employeeId && actor.name ? `${actor.name}（${actor.employeeId}）` : "身分未提供";
  return `${actor.kind === "personal" ? "個人帳號" : "員工入口"}：${person}`;
}

export default function AuditPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [entity, setEntity] = useState("");
  const [recordId, setRecordId] = useState("");
  const [filters, setFilters] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const cursor = cursors[cursors.length - 1];
  const url = `/api/audit/timeline?limit=100${filters}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const { data, isLoading, error, refetch } = useQuery<Timeline>({
    queryKey: [url],
    queryFn: async () => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("操作紀錄讀取失敗，請確認查詢條件與權限");
      return response.json();
    },
  });
  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>操作時間軸</CardTitle></CardHeader>
        <CardContent>
          <form className="flex flex-wrap gap-2" onSubmit={event => {
            event.preventDefault();
            const query = new URLSearchParams();
            if (employeeId) query.set("employeeId", employeeId);
            if (entity) query.set("entity", entity);
            if (recordId) query.set("recordId", recordId);
            setFilters(query.size ? `&${query}` : "");
            setCursors([""]);
          }}>
            <label>員工 ID<Input aria-label="員工 ID" type="number" min="1" step="1" value={employeeId} onChange={event => setEmployeeId(event.target.value)} /></label>
            <label>資料類別<select aria-label="資料類別" value={entity} onChange={event => setEntity(event.target.value)}>
              <option value="">全部</option>{entities.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select></label>
            <label>資料 ID<Input aria-label="資料 ID" value={recordId} onChange={event => setRecordId(event.target.value)} /></label>
            <Button type="submit">查詢</Button>
            <Button type="button" variant="outline" onClick={() => void refetch()}>重新整理</Button>
          </form>
          <p className="text-sm text-muted-foreground mt-2">時間使用 Asia/Taipei。每頁最多 100 筆；員工自行打卡與送出請假以原始資料顯示，修改另列操作紀錄。</p>
        </CardContent>
      </Card>
      {error && <p role="alert">{error.message}</p>}
      {isLoading ? <p>讀取中…</p> : data && <>
        <Table>
          <TableHeader><TableRow>{["時間（Asia/Taipei）", "操作者", "動作", "資料", "內容"].map(title => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{data.items.map(item => <TableRow key={item.id}>
            <TableCell>{taipei.format(new Date(item.at))}</TableCell>
            <TableCell>{actorLabel(item.actor)}</TableCell>
            <TableCell>{item.action}</TableCell>
            <TableCell>{entities.find(([key]) => key === item.entity)?.[1] ?? item.entity} #{item.recordId}</TableCell>
            <TableCell><details><summary>前後內容</summary><pre className="whitespace-pre-wrap">{JSON.stringify({ before: item.before, after: item.after }, null, 2)}</pre></details></TableCell>
          </TableRow>)}</TableBody>
        </Table>
        {data.items.length === 0 && <p>沒有符合條件的紀錄。</p>}
        <div className="flex gap-2">
          <Button variant="outline" disabled={cursors.length === 1 || isLoading} onClick={() => setCursors(previous => previous.slice(0, -1))}>上一頁</Button>
          <Button variant="outline" disabled={!data.nextCursor || isLoading} onClick={() => data.nextCursor && setCursors(previous => [...previous, data.nextCursor!])}>下一頁</Button>
        </div>
      </>}
    </div>
  );
}
