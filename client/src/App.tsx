/**
 * Main application entry point — sets up routing, sidebar layout, and
 * the global provider hierarchy (data fetching, theming, tooltips, sidebar).
 */

import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import ProjectDetail from "@/pages/project-detail";
import NewProject from "@/pages/new-project";
import ScenarioDetail from "@/pages/scenario-detail";
import ProjectsList from "@/pages/projects-list";
import ScenariosList from "@/pages/scenarios-list";
import Documentation from "@/pages/documentation";
import SettingsPage from "@/pages/settings";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/projects" component={ProjectsList} />
      <Route path="/projects/new" component={NewProject} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/scenarios" component={ScenariosList} />
      <Route path="/scenarios/:id" component={ScenarioDetail} />
      <Route path="/documentation" component={Documentation} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Application shell: sidebar navigation, header (sidebar trigger + theme toggle), and main content area
function App() {
  // Custom sidebar width configuration (CSS custom properties consumed by SidebarProvider)
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    // QueryClientProvider — TanStack Query context for data fetching/caching
    <QueryClientProvider client={queryClient}>
      {/* ThemeProvider — dark/light mode toggle and persistence */}
      <ThemeProvider defaultTheme="light">
        {/* TooltipProvider — shared context for Radix tooltip positioning */}
        <TooltipProvider>
          {/* SidebarProvider — collapsible sidebar state management */}
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-4 px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-hidden flex flex-col">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
