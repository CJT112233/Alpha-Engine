import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, MessageSquare, FileUp, FileText, Check, Trash2, AlertCircle } from "lucide-react";
import type { Scenario, Project, TextEntry, Document, UpifRecord } from "@shared/schema";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ConversationalInput } from "@/components/conversational-input";
import { DocumentUpload } from "@/components/document-upload";
import { UpifReview } from "@/components/upif-review";

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
              <div className="flex items-center gap-3">
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
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Created {format(new Date(scenario.createdAt), "MMMM d, yyyy 'at' h:mm a")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
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

        {scenario.status === "confirmed" && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center gap-3 pt-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-primary">UPIF Confirmed</p>
                <p className="text-sm text-muted-foreground">
                  This scenario's Unified Project Intake Form has been confirmed and locked.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="input" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="input" className="flex items-center gap-2" data-testid="tab-input">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Input</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2" data-testid="tab-documents">
              <FileUp className="h-4 w-4" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="upif" className="flex items-center gap-2" data-testid="tab-upif">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">UPIF</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="input" className="space-y-4">
            <ConversationalInput
              scenarioId={id!}
              entries={textEntries || []}
              isLoading={entriesLoading}
              isLocked={scenario.status === "confirmed"}
            />
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            <DocumentUpload
              scenarioId={id!}
              documents={documents || []}
              isLoading={documentsLoading}
              isLocked={scenario.status === "confirmed"}
            />
          </TabsContent>

          <TabsContent value="upif" className="space-y-4">
            <UpifReview
              scenarioId={id!}
              upif={upif}
              isLoading={upifLoading}
              hasInputs={hasInputs}
              scenarioStatus={scenario.status}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
