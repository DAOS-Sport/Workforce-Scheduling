import { Calendar, Users, Building2, LayoutGrid, ClipboardCheck, BookOpen, MapPin, LogOut, ShieldCheck, ShieldAlert, CalendarCheck, Clock } from "lucide-react";
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

const mainItems = [
  { title: "排班總覽", url: "/", icon: LayoutGrid },
  { title: "排班編輯", url: "/schedule", icon: Calendar },
  { title: "員工管理", url: "/employees", icon: Users },
  { title: "場館管理", url: "/venues", icon: Building2 },
];

const toolItems = [
  { title: "考勤稽核", url: "/attendance", icon: ClipboardCheck },
  { title: "GPS 打卡", url: "/clock-records", icon: MapPin },
  { title: "打卡異常", url: "/anomaly-reports", icon: ShieldAlert },
  { title: "週報打卡", url: "/weekly-attendance", icon: CalendarCheck },
  { title: "工時總表", url: "/salary-report", icon: Clock },
  { title: "守則管理", url: "/guidelines", icon: BookOpen },
];

interface AppSidebarProps {
  adminName?: string;
  onLogout?: () => void;
}

export function AppSidebar({ adminName, onLogout }: AppSidebarProps) {
  const [location] = useLocation();

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
