import { Calendar, Users, Building2, LayoutGrid, ClipboardCheck, BookOpen, MapPin, LogOut, ShieldCheck, ShieldAlert, CalendarCheck, Clock, FileSpreadsheet, CalendarOff } from "lucide-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";

const mainItems = [
  { title: "排班總覽", url: "/", icon: LayoutGrid },
  { title: "排班編輯", url: "/schedule", icon: Calendar },
  { title: "員工管理", url: "/employees", icon: Users },
  { title: "場館管理", url: "/venues", icon: Building2 },
];

const reportItems = [
  { title: "報表匯出", url: "/reports", icon: FileSpreadsheet },
];

interface PendingCounts {
  clockAmendments: number;
  overtimeRequests: number;
  leaveRequests: number;
  anomalyReports: number;
  total: number;
}

interface AppSidebarProps {
  adminName?: string;
  onLogout?: () => void;
}

export function AppSidebar({ adminName, onLogout }: AppSidebarProps) {
  const [location] = useLocation();

  const { data: pendingCounts } = useQuery<PendingCounts>({
    queryKey: ["/api/pending-counts"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const toolItems = [
    { title: "考勤稽核", url: "/attendance", icon: ClipboardCheck, badge: pendingCounts?.clockAmendments },
    { title: "GPS 打卡", url: "/clock-records", icon: MapPin },
    { title: "打卡異常", url: "/anomaly-reports", icon: ShieldAlert, badge: pendingCounts?.anomalyReports },
    { title: "週報打卡", url: "/weekly-attendance", icon: CalendarCheck },
    { title: "工時總表", url: "/salary-report", icon: Clock },
    { title: "請假管理", url: "/leave-requests", icon: CalendarOff, badge: pendingCounts?.leaveRequests },
    { title: "守則與公告", url: "/guidelines", icon: BookOpen },
  ];

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25">
            <Calendar className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight" data-testid="text-app-title">三蘆智慧管理</h2>
            <p className="text-[11px] text-muted-foreground font-medium">115年 PT 排班系統</p>
          </div>
        </div>
        {pendingCounts && pendingCounts.total > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded-lg p-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-amber-700">有 {pendingCounts.total} 筆待處理</p>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                {pendingCounts.leaveRequests > 0 && <span className="text-[10px] text-amber-500">請假 {pendingCounts.leaveRequests}</span>}
                {pendingCounts.clockAmendments > 0 && <span className="text-[10px] text-amber-500">補打卡 {pendingCounts.clockAmendments}</span>}
                {pendingCounts.overtimeRequests > 0 && <span className="text-[10px] text-amber-500">加班 {pendingCounts.overtimeRequests}</span>}
                {pendingCounts.anomalyReports > 0 && <span className="text-[10px] text-amber-500">異常 {pendingCounts.anomalyReports}</span>}
              </div>
            </div>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70">排班管理</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-nav-${item.url.replace("/", "") || "home"}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70">行政工具</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-nav-${item.url.replace("/", "")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.title}</span>
                      {item.badge != null && item.badge > 0 && (
                        <span className="ml-auto text-[10px] font-semibold bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70">報表</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {reportItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-nav-${item.url.replace("/", "")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 border-t border-sidebar-border space-y-2">
        {adminName && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="h-4 w-4 text-blue-500 shrink-0" />
              <span className="text-xs font-medium truncate" data-testid="text-admin-name">{adminName}</span>
            </div>
            {onLogout && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500"
                onClick={onLogout}
                title="登出"
                aria-label="登出"
                data-testid="button-admin-logout"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="sr-only">登出</span>
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <p className="text-[11px] text-muted-foreground font-medium">v2.0 — 115年勞基法合規</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
