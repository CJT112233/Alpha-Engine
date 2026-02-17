import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Beaker, ArrowLeft, ArrowRight, Trash2, Droplets, Flame, Plug, Layers } from "lucide-react";
import type { Project, Scenario } from "@shared/schema";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const PROJECT_TYPES = [
  { value: "A", label: "Type A", name: "Wastewater Treatment", icon: Droplets, description: "Municipal or industrial wastewater treatment plant" },
  { value: "B", label: "Type B", name: "RNG Greenfield", icon: Flame, description: "New anaerobic digestion facility producing RNG" },
  { value: "C", label: "Type C", name: "RNG Bolt-On", icon: Plug, description: "Upgrade existing biogas to pipeline-quality RNG" },
  { value: "D", label: "Type D", name: "Hybrid", icon: Layers, description: "Combined wastewater treatment with RNG production" },
] as const;

const createScenarioSchema = z.object({
  name: z.string().min(1, "Scenario name is required"),
  projectType: z.enum(["A", "B", "C", "D"], { required_error: "Please select a project type" }),
});

type CreateScenarioForm = z.infer<typeof createScenarioSchema>;

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", id],
  });

  const { data: scenarios, isLoading: scenariosLoading } = useQuery<Scenario[]>({
    queryKey: ["/api/projects", id, "scenarios"],
  });

  const form = useForm<CreateScenarioForm>({
    resolver: zodResolver(createScenarioSchema),
    defaultValues: {
      name: "",
      projectType: undefined as unknown as "A" | "B" | "C" | "D",
    },
  });

  const createScenarioMutation = useMutation({
    mutationFn: async (data: CreateScenarioForm) => {
      return apiRequest("POST", `/api/projects/${id}/scenarios`, {
        name: data.name,
        projectType: data.projectType,
        projectTypeConfirmed: true,
      });
    },
    onSuccess: async (response) => {
      const scenario = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "scenarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios/recent"] });
      toast({
        title: "Scenario created",
        description: "Your new scenario has been created successfully.",
      });
      setIsDialogOpen(false);
      form.reset();
      setLocation(`/scenarios/${scenario.id}`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create scenario. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios/recent"] });
      toast({
        title: "Project deleted",
        description: "The project and all its scenarios have been deleted.",
      });
      setLocation("/");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete project. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateScenarioForm) => {
    createScenarioMutation.mutate(data);
  };

  if (projectLoading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="container max-w-4xl mx-auto p-6 space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Project not found</h2>
          <p className="text-muted-foreground mb-4">The project you're looking for doesn't exist.</p>
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/" className="hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span>/</span>
          <span className="text-foreground">{project.name}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-project-name">
              {project.name}
            </h1>
            {project.description && (
              <p className="text-muted-foreground mt-1">{project.description}</p>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              Created {format(new Date(project.createdAt), "MMMM d, yyyy")}
            </p>
          </div>
          <div className="flex gap-2">
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-scenario">
                  <Plus className="h-4 w-4 mr-2" />
                  New Scenario
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Scenario</DialogTitle>
                  <DialogDescription>
                    Create a new scenario to evaluate different project configurations.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Scenario Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., Base Case, High Capacity Option"
                              data-testid="input-scenario-name"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="projectType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Type</FormLabel>
                          <FormControl>
                            <div className="grid grid-cols-2 gap-2">
                              {PROJECT_TYPES.map((pt) => {
                                const Icon = pt.icon;
                                const isSelected = field.value === pt.value;
                                return (
                                  <button
                                    key={pt.value}
                                    type="button"
                                    onClick={() => field.onChange(pt.value)}
                                    className={`flex items-start gap-3 p-3 rounded-md border text-left transition-colors ${
                                      isSelected
                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                        : "hover-elevate"
                                    }`}
                                    data-testid={`button-type-${pt.value}`}
                                  >
                                    <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                                    <div>
                                      <p className="font-medium text-sm">{pt.label}: {pt.name}</p>
                                      <p className="text-xs text-muted-foreground">{pt.description}</p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createScenarioMutation.isPending}
                        data-testid="button-submit-scenario"
                      >
                        {createScenarioMutation.isPending ? "Creating..." : "Create Scenario"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                if (confirm("Are you sure you want to delete this project? This action cannot be undone.")) {
                  deleteProjectMutation.mutate();
                }
              }}
              disabled={deleteProjectMutation.isPending}
              data-testid="button-delete-project"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Scenarios</CardTitle>
            <CardDescription>
              Evaluate different configurations for this project
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scenariosLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : scenarios?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Beaker className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">No scenarios yet</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                  Create a scenario to start capturing project inputs and generating the Unified Project Intake Form.
                </p>
                <Button onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-scenario">
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Scenario
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {scenarios?.map((scenario) => (
                  <Link key={scenario.id} href={`/scenarios/${scenario.id}`}>
                    <div
                      className="flex items-center justify-between p-4 rounded-md border hover-elevate cursor-pointer"
                      data-testid={`card-scenario-${scenario.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
                          <Beaker className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">{scenario.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Created {format(new Date(scenario.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {scenario.projectType && (
                          <Badge variant="outline">
                            Type {scenario.projectType}
                          </Badge>
                        )}
                        <Badge
                          variant={
                            scenario.status === "confirmed"
                              ? "default"
                              : scenario.status === "in_review"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {scenario.status === "confirmed"
                            ? "Confirmed"
                            : scenario.status === "in_review"
                            ? "In Review"
                            : "Draft"}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
