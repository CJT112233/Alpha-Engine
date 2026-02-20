import { Link, useLocation } from "wouter";
import { FolderKanban, Plus, LayoutDashboard, Beaker, FileText, BarChart3 } from "lucide-react";
import burnhamLogo from "@assets/Burnham_with_logo_1771619885304.png";
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
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

export function AppSidebar() {
  const [location] = useLocation();
  
  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img src={burnhamLogo} alt="Burnham" className="h-9 w-auto" />
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">Project Factory</h1>
            <p className="text-xs text-muted-foreground">Intake System</p>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/"}>
                  <Link href="/" data-testid="link-dashboard">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/scenarios")}>
                  <Link href="/scenarios" data-testid="link-scenarios">
                    <Beaker className="h-4 w-4" />
                    <span>All Scenarios</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between">
            <span>Projects</span>
            <Link href="/projects/new">
              <Button variant="ghost" size="icon" className="h-6 w-6" data-testid="button-new-project">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <>
                  <SidebarMenuItem>
                    <div className="px-2 py-1.5">
                      <Skeleton className="h-4 w-full" />
                    </div>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <div className="px-2 py-1.5">
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  </SidebarMenuItem>
                </>
              ) : projects?.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No projects yet
                  </div>
                </SidebarMenuItem>
              ) : (
                projects?.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton asChild isActive={location.startsWith(`/projects/${project.id}`)}>
                      <Link href={`/projects/${project.id}`} data-testid={`link-project-${project.id}`}>
                        <FolderKanban className="h-4 w-4" />
                        <span className="truncate">{project.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location === "/stats"}>
              <Link href="/stats" data-testid="link-stats">
                <BarChart3 className="h-4 w-4" />
                <span>Generation Stats</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location === "/documentation"}>
              <Link href="/documentation" data-testid="link-docs">
                <FileText className="h-4 w-4" />
                <span>Documentation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
