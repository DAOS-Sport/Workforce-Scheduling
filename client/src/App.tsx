import { useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { RegionProvider } from "@/lib/region-context";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/dashboard";
import SchedulePage from "@/pages/schedule";
import EmployeesPage from "@/pages/employees";
import VenuesPage from "@/pages/venues";
import AttendancePage from "@/pages/attendance";
import GuidelinesPage from "@/pages/guidelines";
import ClockRecordsPage from "@/pages/clock-records";
import AnomalyReportsPage from "@/pages/anomaly-reports";
import WeeklyAttendancePage from "@/pages/weekly-attendance";
import SalaryReportPage from "@/pages/salary-report";
import ReportsPage from "@/pages/reports";
import LeaveRequestsPage from "@/pages/leave-requests";
import { Redirect } from "wouter";
import PortalPage from "@/pages/portal";
import LiffClockInPage from "@/pages/liff-clock-in";
import AdminLoginPage from "@/pages/admin-login";
import { Loader2 } from "lucide-react";

function AdminRouter() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/schedule" component={SchedulePage} />
      <Route path="/employees" component={EmployeesPage} />
      <Route path="/venues" component={VenuesPage} />
      <Route path="/attendance" component={AttendancePage} />
      <Route path="/guidelines" component={GuidelinesPage} />
      <Route path="/clock-records" component={ClockRecordsPage} />
      <Route path="/anomaly-reports" component={AnomalyReportsPage} />
      <Route path="/weekly-attendance" component={WeeklyAttendancePage} />
      <Route path="/salary-report" component={SalaryReportPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/leave-requests" component={LeaveRequestsPage} />
      <Route path="/announcements">{() => <Redirect to="/guidelines" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminLayout({ adminName, onLogout }: { adminName: string; onLogout: () => void }) {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <RegionProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar adminName={adminName} onLogout={onLogout} />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center justify-between gap-2 p-2 border-b">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <ThemeToggle />
            </header>
            <main className="flex-1 overflow-hidden">
              <AdminRouter />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </RegionProvider>
  );
}

function AdminGuard() {
  const [authKey, setAuthKey] = useState(0);
  const { data, isLoading, error } = useQuery<{ id: number; name: string }>({
    queryKey: ["/api/admin/me", authKey],
    queryFn: async () => {
      const res = await fetch("/api/admin/me", { credentials: "include" });
      if (!res.ok) throw new Error("未登入");
      return res.json();
    },
    retry: false,
  });

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setAuthKey((k) => k + 1);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.id) {
    return <AdminLoginPage onLoginSuccess={() => setAuthKey((k) => k + 1)} />;
  }

  return <AdminLayout adminName={data.name} onLogout={handleLogout} />;
}

function AppRouter() {
  const [location] = useLocation();
  const isPortal = location.startsWith("/portal");
  const isLiff = location.startsWith("/liff");
  const isAdminCallback = location.startsWith("/admin/callback");

  if (isPortal) {
    return <PortalPage />;
  }

  if (isLiff) {
    return <LiffClockInPage />;
  }

  return <AdminGuard />;
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppRouter />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
