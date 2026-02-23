import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
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
import PortalPage from "@/pages/portal";

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
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminLayout() {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <RegionProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
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

function AppRouter() {
  const [location] = useLocation();
  const isPortal = location.startsWith("/portal");

  if (isPortal) {
    return <PortalPage />;
  }

  return <AdminLayout />;
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
