import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ADMIN_PAGES, hasPermission } from "@shared/admin-permissions";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Matrix = { roles: string[]; matrix: Record<string, string[]> };
type Login = { employeeId: number; name: string; role: string; firstLoginAt: string; lastLoginAt: string };

export default function PermissionsPage() {
  const matrix = useQuery<Matrix>({ queryKey: ["/api/admin/permissions"] });
  const logins = useQuery<Login[]>({ queryKey: ["/api/admin/personal-logins"] });
  const flag = useQuery<{ enabled: boolean }>({ queryKey: ["/api/admin/shared-password"] });
  const me = useQuery<{ permissions: string[] }>({ queryKey: ["/api/admin/me"] });
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const canWrite = hasPermission(me.data?.permissions ?? [], "permissions", "write");

  function toggle(role: string, key: string, checked: boolean) {
    const next = new Set(draft[role] ?? matrix.data?.matrix[role] ?? []);
    if (checked) { next.add(key); if (key.endsWith(":write")) next.add(key.replace(/:write$/, ":read")); }
    else { next.delete(key); if (key.endsWith(":read")) next.delete(key.replace(/:read$/, ":write")); }
    setDraft({ ...draft, [role]: [...next] });
  }

  async function save() {
    setSaving(true); setMessage("");
    try {
      for (const [role, permissions] of Object.entries(draft)) await apiRequest("PUT", `/api/admin/permissions/${encodeURIComponent(role)}`, { permissions });
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/permissions"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
      setMessage("權限已儲存，下一次請求立即依新權限判定。");
    } catch (err: any) { setMessage(err.message); }
    finally { setSaving(false); }
  }

  async function toggleSharedPassword() {
    setSaving(true); setMessage("");
    try {
      await apiRequest("PUT", "/api/admin/shared-password", { enabled: !flag.data?.enabled });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/shared-password"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
      setMessage("共用密碼設定已儲存。");
    } catch (err: any) { setMessage(err.message); }
    finally { setSaving(false); }
  }

  if (matrix.isLoading) return <p>載入權限設定中…</p>;
  if (matrix.error || logins.error || flag.error) return <p role="alert">無法載入設定：{String(matrix.error || logins.error || flag.error)}</p>;
  return <div className="h-full overflow-auto p-6 space-y-6">
    <h1 className="text-2xl font-bold">角色權限管理</h1>
    <p>依員工目前職位決定後台權限。讀取可查看頁面；寫入可新增、修改、刪除該功能資料。個人 LINE 登入後才列入下方名單。</p>
    {message && <p role="status">{message}</p>}
    <Card className="p-4 space-y-3">
      <h2 className="font-semibold">共用密碼登入</h2>
      <p>{flag.data?.enabled ? "目前開啟" : "目前關閉"}。關閉後，既有共用密碼與開發快速登入 session 也立即失效；個人 LINE 登入不受影響。</p>
      <Button variant="outline" disabled={!canWrite || saving || !flag.data} onClick={toggleSharedPassword}>{flag.data?.enabled ? "停用共用密碼" : "開啟共用密碼"}</Button>
    </Card>
    <Card className="p-4 overflow-auto">
      <Table><TableHeader><TableRow><TableHead>頁面</TableHead>{matrix.data?.roles.map((role) => <TableHead key={role}>{role}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{ADMIN_PAGES.map((page) => <TableRow key={page.key}><TableCell>{page.label}</TableCell>{matrix.data?.roles.map((role) => <TableCell key={role}>
          {(["read", "write"] as const).map((action) => <label key={action} className="mr-3 whitespace-nowrap"><input type="checkbox" aria-label={`${role} ${page.label} ${action === "read" ? "讀取" : "寫入"}`} checked={(draft[role] ?? matrix.data?.matrix[role] ?? []).includes(`${page.key}:${action}`)} disabled={!canWrite || saving} onChange={(e) => toggle(role, `${page.key}:${action}`, e.target.checked)} /> {action === "read" ? "讀取" : "寫入"}</label>)}
        </TableCell>)}</TableRow>)}</TableBody></Table>
      <Button onClick={save} disabled={!canWrite || saving || Object.keys(draft).length === 0}>儲存權限</Button>
    </Card>
    <Card className="p-4"><h2 className="font-semibold">曾以個人 LINE 登入的人員</h2>
      <Table><TableHeader><TableRow><TableHead>姓名</TableHead><TableHead>登入時職位</TableHead><TableHead>首次登入</TableHead><TableHead>最近登入</TableHead></TableRow></TableHeader>
        <TableBody>{logins.data?.map((login) => <TableRow key={login.employeeId}><TableCell>{login.name}</TableCell><TableCell>{login.role}</TableCell><TableCell>{new Date(login.firstLoginAt).toLocaleString("zh-TW")}</TableCell><TableCell>{new Date(login.lastLoginAt).toLocaleString("zh-TW")}</TableCell></TableRow>)}</TableBody></Table>
      {logins.data?.length === 0 && <p>尚無個人 LINE 登入紀錄。</p>}
    </Card>
  </div>;
}
