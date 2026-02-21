import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RegionTabs } from "@/components/region-tabs";
import { useRegion } from "@/lib/region-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, UserPlus, Phone, Mail, Edit2, RefreshCw, Download } from "lucide-react";
import type { Employee } from "@shared/schema";
import { REGIONS_DATA } from "@shared/schema";

const ROLE_LABELS: Record<string, string> = {
  "救生": "救生員",
  "櫃台": "行政櫃台",
  "pt": "PT教練",
  "manager": "管理員",
  "admin": "系統管理",
};

const EMPLOYMENT_TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  full_time: { label: "正職", variant: "default" },
  part_time: { label: "兼職", variant: "outline" },
};

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "在職", variant: "default" },
  inactive: { label: "離職", variant: "destructive" },
  suspended: { label: "停職", variant: "secondary" },
};

export default function EmployeesPage() {
  const { activeRegion } = useRegion();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    name: "",
    employeeCode: "",
    phone: "",
    email: "",
    lineId: "",
    status: "active",
    role: "pt",
    employmentType: "full_time",
  });
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number; deactivated: number; errors: string[] } | null>(null);

  const regionId = REGIONS_DATA.findIndex((r) => r.code === activeRegion) + 1;

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees", activeRegion],
  });

  const filteredEmployees = employees.filter(
    (e) =>
      e.name.includes(search) ||
      e.employeeCode.includes(search) ||
      (e.phone && e.phone.includes(search))
  );

  const createEmployee = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/employees", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "員工已新增" });
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "新增失敗", description: err.message, variant: "destructive" });
    },
  });

  const updateEmployee = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/employees/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "員工已更新" });
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "更新失敗", description: err.message, variant: "destructive" });
    },
  });

  const ragicSync = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ragic-sync");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries();
      setSyncResult(data);
      toast({
        title: "Ragic 同步完成",
        description: `新增 ${data.created} 人、更新 ${data.updated} 人${data.deactivated > 0 ? `、停用 ${data.deactivated} 人` : ""}、略過 ${data.skipped} 人`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "同步失敗", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", employeeCode: "", phone: "", email: "", lineId: "", status: "active", role: "pt", employmentType: "full_time" });
    setEditingEmployee(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setForm({
      name: emp.name,
      employeeCode: emp.employeeCode,
      phone: emp.phone || "",
      email: emp.email || "",
      lineId: emp.lineId || "",
      status: emp.status,
      role: emp.role,
      employmentType: emp.employmentType || "full_time",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name || !form.employeeCode) return;
    const payload = { ...form, regionId };
    if (editingEmployee) {
      updateEmployee.mutate({ id: editingEmployee.id, ...payload });
    } else {
      createEmployee.mutate(payload);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-5 border-b border-border/50">
        <div>
          <h1 className="text-xl font-bold tracking-tight" data-testid="text-employees-title">員工管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理員工資料與在職狀態</p>
        </div>
        <RegionTabs />
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋姓名、編號、電話..."
              className="pl-8"
              data-testid="input-search-employee"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => ragicSync.mutate()}
              disabled={ragicSync.isPending}
              data-testid="button-ragic-sync"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${ragicSync.isPending ? "animate-spin" : ""}`} />
              {ragicSync.isPending ? "同步中..." : "Ragic 同步"}
            </Button>
            <Button onClick={openCreate} data-testid="button-add-employee">
              <UserPlus className="h-4 w-4 mr-1.5" />
              新增員工
            </Button>
          </div>
        </div>

        {syncResult && syncResult.errors.length > 0 && (
          <Card className="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">同步警告 ({syncResult.errors.length} 筆)</p>
            <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 max-h-32 overflow-auto">
              {syncResult.errors.map((err, i) => (
                <li key={i}>• {err}</li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>員工編號</TableHead>
                <TableHead>電話</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>聘雇</TableHead>
                <TableHead>職務</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="w-[60px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {search ? "找不到符合的員工" : "尚無員工資料"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((emp) => {
                  const statusInfo = STATUS_MAP[emp.status] || STATUS_MAP.active;
                  const empTypeInfo = EMPLOYMENT_TYPE_LABELS[emp.employmentType] || EMPLOYMENT_TYPE_LABELS.full_time;
                  return (
                    <TableRow key={emp.id} data-testid={`row-employee-${emp.id}`}>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {emp.employeeCode}
                      </TableCell>
                      <TableCell>
                        {emp.phone ? (
                          <a href={`tel:${emp.phone}`} className="flex items-center gap-1 text-sm text-primary hover:underline">
                            <Phone className="h-3 w-3" />
                            {emp.phone}
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {emp.email ? (
                          <a href={`mailto:${emp.email}`} className="flex items-center gap-1 text-sm text-primary hover:underline">
                            <Mail className="h-3 w-3" />
                            {emp.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={empTypeInfo.variant}>{empTypeInfo.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{ROLE_LABELS[emp.role] || emp.role}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(emp)}
                          data-testid={`button-edit-employee-${emp.id}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? "編輯員工" : "新增員工"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>姓名 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="員工姓名"
                  data-testid="input-employee-name"
                />
              </div>
              <div className="space-y-2">
                <Label>員工編號 *</Label>
                <Input
                  value={form.employeeCode}
                  onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                  placeholder="PT001"
                  data-testid="input-employee-code"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>電話</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0912345678"
                  data-testid="input-employee-phone"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="email@example.com"
                  data-testid="input-employee-email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>LINE ID</Label>
              <Input
                value={form.lineId}
                onChange={(e) => setForm({ ...form, lineId: e.target.value })}
                placeholder="LINE 用戶 ID（用於員工入口登入）"
                data-testid="input-employee-line-id"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>聘雇類別</Label>
                <Select value={form.employmentType} onValueChange={(v) => setForm({ ...form, employmentType: v })}>
                  <SelectTrigger data-testid="select-employee-employment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">正職</SelectItem>
                    <SelectItem value="part_time">兼職</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>職務</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="select-employee-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="救生">救生員</SelectItem>
                    <SelectItem value="櫃台">行政櫃台</SelectItem>
                    <SelectItem value="pt">PT教練</SelectItem>
                    <SelectItem value="manager">管理員</SelectItem>
                    <SelectItem value="admin">系統管理</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>狀態</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-employee-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">在職</SelectItem>
                  <SelectItem value="inactive">離職</SelectItem>
                  <SelectItem value="suspended">停職</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-employee">
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name || !form.employeeCode || createEmployee.isPending || updateEmployee.isPending}
              data-testid="button-save-employee"
            >
              {createEmployee.isPending || updateEmployee.isPending ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
