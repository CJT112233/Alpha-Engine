import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FolderKanban, FileText, Beaker, ArrowRight, Clock } from "lucide-react";
import type { Project, Scenario } from "@shared/schema";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: projects, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: recentScenarios, isLoading: scenariosLoading } = useQuery<(Scenario & { projectName: string })[]>({
    queryKey: ["/api/scenarios/recent"],
  });

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-6xl mx-auto p-6 space-y-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-dashboard-title">
            Welcome to Project Alpha
          </h1>
          <p className="text-muted-foreground">
            Transform unstructured project inputs into standardized specifications with AI-powered extraction.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Link href="/projects">
            <Card className="hover-elevate cursor-pointer" data-testid="card-metric-projects">
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
                <FolderKanban className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {projectsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold" data-testid="text-project-count">
                    {projects?.length || 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>

          <Link href="/scenarios?filter=in_progress">
            <Card className="hover-elevate cursor-pointer" data-testid="card-metric-in-progress">
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">In-Progress Scenarios</CardTitle>
                <Beaker className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {scenariosLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold" data-testid="text-scenario-count">
                    {recentScenarios?.filter(s => s.status !== "confirmed").length || 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>

          <Link href="/scenarios?filter=confirmed">
            <Card className="hover-elevate cursor-pointer" data-testid="card-metric-confirmed">
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Confirmed UPIFs</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {scenariosLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold" data-testid="text-confirmed-count">
                    {recentScenarios?.filter(s => s.status === "confirmed").length || 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Your Projects</CardTitle>
                  <CardDescription>Manage your project evaluations</CardDescription>
                </div>
                <Link href="/projects/new">
                  <Button data-testid="button-create-project">
                    <Plus className="h-4 w-4 mr-2" />
                    New Project
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {projectsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : projects?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-1">No projects yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create your first project to get started
                  </p>
                  <Link href="/projects/new">
                    <Button variant="outline" data-testid="button-create-first-project">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Project
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects?.map((project) => (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div
                        className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer"
                        data-testid={`card-project-${project.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <FolderKanban className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{project.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Created {format(new Date(project.createdAt), "MMM d, yyyy")}
                            </p>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Scenarios</CardTitle>
              <CardDescription>Track your ongoing evaluations</CardDescription>
            </CardHeader>
            <CardContent>
              {scenariosLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : recentScenarios?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Beaker className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-1">No scenarios yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Create a project and add scenarios to evaluate
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentScenarios?.slice(0, 5).map((scenario) => (
                    <Link key={scenario.id} href={`/scenarios/${scenario.id}`}>
                      <div
                        className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer"
                        data-testid={`card-scenario-${scenario.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                            <Beaker className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{scenario.name}</p>
                            <p className="text-xs text-muted-foreground">{scenario.projectName}</p>
                          </div>
                        </div>
                        <Badge
                          variant={
                            scenario.status === "confirmed"
                              ? "default"
                              : scenario.status === "in_review"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-xs"
                        >
                          {scenario.status === "confirmed"
                            ? "Confirmed"
                            : scenario.status === "in_review"
                            ? "In Review"
                            : "Draft"}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
            <CardDescription>Transform unstructured inputs into standardized project specifications</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-4">
              <div className="text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-3">
                  <span className="text-lg font-bold">1</span>
                </div>
                <h4 className="font-medium mb-1">Input Capture</h4>
                <p className="text-sm text-muted-foreground">
                  Describe your project in natural language or upload documents
                </p>
              </div>
              <div className="text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-3">
                  <span className="text-lg font-bold">2</span>
                </div>
                <h4 className="font-medium mb-1">AI Extraction</h4>
                <p className="text-sm text-muted-foreground">
                  Our engine extracts and predicts all necessary parameters
                </p>
              </div>
              <div className="text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-3">
                  <span className="text-lg font-bold">3</span>
                </div>
                <h4 className="font-medium mb-1">Review & Edit</h4>
                <p className="text-sm text-muted-foreground">
                  Review extracted data and modify as needed
                </p>
              </div>
              <div className="text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-3">
                  <span className="text-lg font-bold">4</span>
                </div>
                <h4 className="font-medium mb-1">Confirm UPIF</h4>
                <p className="text-sm text-muted-foreground">
                  Finalize the Unified Project Intake Form
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
