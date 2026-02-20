import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  MessageSquare,
  FileText,
  Trash2,
  Bot,
  Droplets,
  DollarSign,
  Import,
} from "lucide-react";
import type { Scenario, Project, TextEntry, Document, UpifRecord } from "@shared/schema";
import { Receipt } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ConversationalInput } from "@/components/conversational-input";
import { DocumentUpload } from "@/components/document-upload";
import { UpifReview } from "@/components/upif-review";
import { UpifChat } from "@/components/upif-chat";
import { MassBalanceContent } from "@/pages/mass-balance";
import { CapexContent } from "@/pages/capex";
import { OpexContent } from "@/pages/opex";
import { FinancialModelContent } from "@/pages/financial-model";

export default function ScenarioDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: scenario, isLoading: scenarioLoading } = useQuery<Scenario & { project: Project }>({
    queryKey: ["/api/scenarios", id],
  });

  const { data: textEntries, isLoading: entriesLoading } = useQuery<TextEntry[]>({
    queryKey: ["/api/scenarios", id, "text-entries"],
  });

  const { data: documents, isLoading: documentsLoading } = useQuery<Document[]>({
    queryKey: ["/api/scenarios", id, "documents"],
  });

  const { data: upif, isLoading: upifLoading } = useQuery<UpifRecord>({
    queryKey: ["/api/scenarios", id, "upif"],
  });

  const { data: llmProviders } = useQuery<{ providers: Array<{ id: string; label: string }>; default: string }>({
    queryKey: ["/api/llm-providers"],
  });

  const { data: siblingUpifs } = useQuery<Array<{ scenarioId: string; scenarioName: string; isConfirmed: boolean; updatedAt: string }>>({
    queryKey: ["/api/scenarios", id, "sibling-upifs"],
  });

  const modelMutation = useMutation({
    mutationFn: async (model: string) => {
      return apiRequest("PATCH", `/api/scenarios/${id}/preferred-model`, { model });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", id] });
    },
  });

  const importUpifMutation = useMutation({
    mutationFn: async (sourceScenarioId: string) => {
      const res = await apiRequest("POST", `/api/scenarios/${id}/import-upif`, { sourceScenarioId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", id, "upif"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", id] });
      toast({ title: "UPIF Imported", description: "UPIF data has been copied from the selected scenario." });
    },
    onError: (err: Error) => {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteScenarioMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/scenarios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios/recent"] });
      toast({
        title: "Scenario deleted",
        description: "The scenario has been deleted successfully.",
      });
      if (scenario?.project) {
        setLocation(`/projects/${scenario.project.id}`);
      } else {
        setLocation("/");
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete scenario. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (scenarioLoading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="container max-w-5xl mx-auto p-6 space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!scenario) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Scenario not found</h2>
          <p className="text-muted-foreground mb-4">The scenario you're looking for doesn't exist.</p>
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

  const hasInputs = (textEntries?.length || 0) > 0 || (documents?.length || 0) > 0;
  const isConfirmed = scenario.status === "confirmed";

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/" className="hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span>/</span>
          <Link href={`/projects/${scenario.project.id}`} className="hover:text-foreground transition-colors">
            {scenario.project.name}
          </Link>
          <span>/</span>
          <span className="text-foreground">{scenario.name}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight" data-testid="text-scenario-name">
                  {scenario.name}
                </h1>
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
                {(scenario as any).projectType && (scenario as any).projectTypeConfirmed && (
                  <Badge variant="outline" data-testid="badge-project-type">
                    Type {(scenario as any).projectType}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Created {format(new Date(scenario.createdAt), "MMMM d, yyyy 'at' h:mm a")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {llmProviders && llmProviders.providers.length > 0 && (
              <div className="flex items-center gap-2" data-testid="global-model-selector">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={(scenario as any).preferredModel || llmProviders.default || "gpt5"}
                  onValueChange={(value) => modelMutation.mutate(value)}
                  disabled={modelMutation.isPending}
                >
                  <SelectTrigger className="w-[200px]" data-testid="select-llm-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {llmProviders.providers.map((p) => (
                      <SelectItem key={p.id} value={p.id} data-testid={`option-model-${p.id}`}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                if (confirm("Are you sure you want to delete this scenario? This action cannot be undone.")) {
                  deleteScenarioMutation.mutate();
                }
              }}
              disabled={deleteScenarioMutation.isPending}
              data-testid="button-delete-scenario"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="input" className="space-y-4">
          <TabsList className="grid w-full grid-cols-6" data-testid="tabs-scenario">
            <TabsTrigger value="input" className="flex items-center gap-1.5" data-testid="tab-input">
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Input</span>
            </TabsTrigger>
            <TabsTrigger value="upif" className="flex items-center gap-1.5" data-testid="tab-upif">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">UPIF</span>
            </TabsTrigger>
            <TabsTrigger value="mass-balance" className="flex items-center gap-1.5" data-testid="tab-mass-balance">
              <Droplets className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Mass Balance</span>
            </TabsTrigger>
            <TabsTrigger value="capex" className="flex items-center gap-1.5" data-testid="tab-capex">
              <DollarSign className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">CapEx</span>
            </TabsTrigger>
            <TabsTrigger value="opex" className="flex items-center gap-1.5" data-testid="tab-opex">
              <Receipt className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">OpEx</span>
            </TabsTrigger>
            <TabsTrigger value="financial-model" className="flex items-center gap-1.5" data-testid="tab-financial-model">
              <DollarSign className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Financial</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="input" className="space-y-6">
            <ConversationalInput
              scenarioId={id!}
              entries={textEntries || []}
              isLoading={entriesLoading}
              isLocked={isConfirmed}
            />
            <DocumentUpload
              scenarioId={id!}
              documents={documents || []}
              isLoading={documentsLoading}
              isLocked={isConfirmed}
            />
          </TabsContent>

          <TabsContent value="upif" className="space-y-4">
            <div className="flex items-center gap-3 justify-end flex-wrap" data-testid="upif-toolbar">
              {siblingUpifs && siblingUpifs.length > 0 && !isConfirmed && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Import className="h-4 w-4" />
                    <span>Import UPIF</span>
                  </div>
                  <Select
                    onValueChange={(value) => {
                      if (confirm("This will replace the current UPIF data with the selected scenario's UPIF. Continue?")) {
                        importUpifMutation.mutate(value);
                      }
                    }}
                    disabled={importUpifMutation.isPending}
                  >
                    <SelectTrigger className="w-[220px]" data-testid="select-import-upif">
                      <SelectValue placeholder="Select a scenario..." />
                    </SelectTrigger>
                    <SelectContent>
                      {siblingUpifs.map((s) => (
                        <SelectItem key={s.scenarioId} value={s.scenarioId} data-testid={`option-import-${s.scenarioId}`}>
                          {s.scenarioName}{s.isConfirmed ? " (Confirmed)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <UpifReview
              scenarioId={id!}
              upif={upif}
              isLoading={upifLoading}
              hasInputs={hasInputs}
              scenarioStatus={scenario.status}
              projectType={(scenario as any).projectType}
              projectTypeConfirmed={(scenario as any).projectTypeConfirmed}
            />
            <UpifChat
              scenarioId={id!}
              hasUpif={!!upif}
              isConfirmed={isConfirmed}
            />
          </TabsContent>

          <TabsContent value="mass-balance">
            <MassBalanceContent scenarioId={id!} />
          </TabsContent>

          <TabsContent value="capex">
            <CapexContent scenarioId={id!} />
          </TabsContent>

          <TabsContent value="opex">
            <OpexContent scenarioId={id!} />
          </TabsContent>

          <TabsContent value="financial-model">
            <FinancialModelContent scenarioId={id!} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
