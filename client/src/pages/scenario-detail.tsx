import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  MessageSquare,
  FileUp,
  FileText,
  Trash2,
  Bot,
  Droplets,
  RefreshCw,
  Factory,
  Gauge,
  DollarSign,
  CheckCircle2,
  Wrench,
  ExternalLink,
} from "lucide-react";
import type { Scenario, Project, TextEntry, Document, UpifRecord, MassBalanceRun, MassBalanceResults, CapexEstimate, CapexResults } from "@shared/schema";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ConversationalInput } from "@/components/conversational-input";
import { DocumentUpload } from "@/components/document-upload";
import { UpifReview } from "@/components/upif-review";
import { UpifChat } from "@/components/upif-chat";
import { ElapsedTimer } from "@/components/elapsed-timer";

function formatNum(val: number | undefined | null, decimals: number = 1): string {
  if (val === undefined || val === null) return "\u2014";
  return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrency(val: number | undefined | null): string {
  if (val === undefined || val === null) return "\u2014";
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

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

  const { data: massBalanceData, isLoading: mbLoading } = useQuery<MassBalanceRun[]>({
    queryKey: ["/api/scenarios", id, "mass-balance"],
  });

  const { data: capexData, isLoading: capexLoading } = useQuery<CapexEstimate[]>({
    queryKey: ["/api/scenarios", id, "capex"],
  });

  const { data: llmProviders } = useQuery<{ providers: Array<{ id: string; label: string }>; default: string }>({
    queryKey: ["/api/llm-providers"],
  });

  const modelMutation = useMutation({
    mutationFn: async (model: string) => {
      return apiRequest("PATCH", `/api/scenarios/${id}/preferred-model`, { model });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", id] });
    },
  });

  const generateMBMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scenarios/${id}/mass-balance/generate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", id, "mass-balance"] });
      toast({ title: "Mass Balance Generated", description: "Treatment train calculation complete." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const generateCapexMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scenarios/${id}/capex/generate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", id, "capex"] });
      toast({ title: "CapEx Estimate Generated", description: "Capital cost estimation complete." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
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
  const latestMB = massBalanceData && massBalanceData.length > 0 ? massBalanceData[0] : null;
  const mbResults = latestMB?.results as MassBalanceResults | null | undefined;
  const latestCapex = capexData && capexData.length > 0 ? capexData[0] : null;
  const capexResults = latestCapex?.results as CapexResults | null | undefined;
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

        <Tabs defaultValue="input" className="space-y-4">
          <TabsList className="grid w-full grid-cols-6" data-testid="tabs-scenario">
            <TabsTrigger value="input" className="flex items-center gap-1.5" data-testid="tab-input">
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Input</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-1.5" data-testid="tab-documents">
              <FileUp className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="upif" className="flex items-center gap-1.5" data-testid="tab-upif">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">UPIF</span>
            </TabsTrigger>
            <TabsTrigger value="mass-balance" className="flex items-center gap-1.5" data-testid="tab-mass-balance">
              <Droplets className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Mass Balance</span>
            </TabsTrigger>
            <TabsTrigger value="equipment" className="flex items-center gap-1.5" data-testid="tab-equipment">
              <Wrench className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Equipment</span>
            </TabsTrigger>
            <TabsTrigger value="capex" className="flex items-center gap-1.5" data-testid="tab-capex">
              <DollarSign className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">CapEx</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="input" className="space-y-4">
            <ConversationalInput
              scenarioId={id!}
              entries={textEntries || []}
              isLoading={entriesLoading}
              isLocked={isConfirmed}
            />
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            <DocumentUpload
              scenarioId={id!}
              documents={documents || []}
              isLoading={documentsLoading}
              isLocked={isConfirmed}
            />
          </TabsContent>

          <TabsContent value="upif" className="space-y-4">
            {llmProviders && llmProviders.providers.length > 1 && (
              <div className="flex items-center gap-3 justify-end flex-wrap" data-testid="model-selector-container">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Bot className="h-4 w-4" />
                  <span>AI Model</span>
                </div>
                <Select
                  value={(scenario as any).preferredModel || "gpt5"}
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

          <TabsContent value="mass-balance" className="space-y-4">
            {mbLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : !latestMB ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
                  <Factory className="h-12 w-12 text-muted-foreground" />
                  <div className="text-center">
                    <h3 className="font-medium">No Mass Balance Generated</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isConfirmed
                        ? "Generate a mass balance from the confirmed UPIF to see process stages and equipment sizing."
                        : "Confirm the UPIF first, then generate a mass balance."}
                    </p>
                  </div>
                  {isConfirmed && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        onClick={() => generateMBMutation.mutate()}
                        disabled={generateMBMutation.isPending}
                        data-testid="button-generate-mass-balance"
                      >
                        {generateMBMutation.isPending ? (
                          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating with AI...</>
                        ) : (
                          <><Gauge className="h-4 w-4 mr-2" /> Generate Mass Balance</>
                        )}
                      </Button>
                      <ElapsedTimer isRunning={generateMBMutation.isPending} />
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={latestMB.status === "finalized" ? "default" : "outline"} data-testid="badge-mb-status">
                      {latestMB.status === "finalized" ? (
                        <><CheckCircle2 className="h-3 w-3 mr-1" /> Finalized</>
                      ) : latestMB.status === "reviewed" ? (
                        "Reviewed"
                      ) : (
                        "Draft"
                      )}
                    </Badge>
                    <Badge variant="secondary" data-testid="badge-mb-version">v{latestMB.version}</Badge>
                  </div>
                  <Link href={`/scenarios/${id}/mass-balance`}>
                    <Button variant="outline" data-testid="button-open-mass-balance">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Full View
                    </Button>
                  </Link>
                </div>

                {mbResults && (
                  <>
                    {mbResults.summary && Object.keys(mbResults.summary).length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {Object.entries(mbResults.summary).slice(0, 4).map(([key, entry]) => (
                          <Card key={key} data-testid={`card-mb-${key}`}>
                            <CardContent className="p-4">
                              <div className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}</div>
                              <div className="text-lg font-semibold mt-1">{entry.value}</div>
                              {entry.unit && <div className="text-xs text-muted-foreground">{entry.unit}</div>}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}

                    {mbResults.stages && mbResults.stages.length > 0 && (
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-sm font-medium mb-3">Treatment Train ({mbResults.stages.length} stages)</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {mbResults.stages.map((stage: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2">
                                {idx > 0 && <span className="text-muted-foreground">&rarr;</span>}
                                <Badge variant="outline">{stage.name}</Badge>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {mbResults.adStages && mbResults.adStages.length > 0 && (
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-sm font-medium mb-3">AD / RNG Process ({mbResults.adStages.length} stages)</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {mbResults.adStages.map((stage: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-2">
                                {idx > 0 && <span className="text-muted-foreground">&rarr;</span>}
                                <Badge variant="outline">{stage.name}</Badge>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="equipment" className="space-y-4">
            {mbLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : !latestMB || !mbResults?.equipment || mbResults.equipment.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
                  <Wrench className="h-12 w-12 text-muted-foreground" />
                  <div className="text-center">
                    <h3 className="font-medium">No Equipment List Available</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {latestMB
                        ? "The mass balance did not produce an equipment list."
                        : "Generate a mass balance first to see the equipment list."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-sm text-muted-foreground">
                    {mbResults.equipment.length} equipment item{mbResults.equipment.length !== 1 ? "s" : ""} from mass balance v{latestMB.version}
                  </div>
                  <Link href={`/scenarios/${id}/mass-balance`}>
                    <Button variant="outline" data-testid="button-open-equipment-detail">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Full View
                    </Button>
                  </Link>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <Table data-testid="table-equipment-summary">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Equipment</TableHead>
                          <TableHead>Quantity</TableHead>
                          <TableHead>Key Specs</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mbResults.equipment.map((eq: any) => {
                          const specEntries = eq.specs ? Object.entries(eq.specs).slice(0, 3) : [];
                          return (
                            <TableRow key={eq.id} data-testid={`row-equipment-${eq.id}`}>
                              <TableCell className="font-medium">{eq.equipmentType}</TableCell>
                              <TableCell>{eq.quantity || 1}</TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {specEntries.map(([k, v]) => `${k}: ${v}`).join(", ") || "\u2014"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="capex" className="space-y-4">
            {capexLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : !latestCapex ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
                  <DollarSign className="h-12 w-12 text-muted-foreground" />
                  <div className="text-center">
                    <h3 className="font-medium">No CapEx Estimate Generated</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {latestMB?.status === "finalized"
                        ? "Generate a capital cost estimate from the finalized mass balance."
                        : latestMB
                        ? "Finalize the mass balance first, then generate a CapEx estimate."
                        : "Generate and finalize a mass balance first."}
                    </p>
                  </div>
                  {latestMB?.status === "finalized" && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        onClick={() => generateCapexMutation.mutate()}
                        disabled={generateCapexMutation.isPending}
                        data-testid="button-generate-capex"
                      >
                        {generateCapexMutation.isPending ? (
                          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating with AI...</>
                        ) : (
                          <><DollarSign className="h-4 w-4 mr-2" /> Generate CapEx Estimate</>
                        )}
                      </Button>
                      <ElapsedTimer isRunning={generateCapexMutation.isPending} />
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" data-testid="badge-capex-version">v{latestCapex.version}</Badge>
                    {capexResults?.lineItems && (
                      <span className="text-sm text-muted-foreground">
                        {capexResults.lineItems.length} line item{capexResults.lineItems.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <Link href={`/scenarios/${id}/capex`}>
                    <Button variant="outline" data-testid="button-open-capex">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Full View
                    </Button>
                  </Link>
                </div>

                {capexResults?.summary && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card data-testid="card-capex-equipment-cost">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">Total Equipment Cost</div>
                        <div className="text-lg font-semibold mt-1">{formatCurrency(capexResults.summary.totalEquipmentCost)}</div>
                      </CardContent>
                    </Card>
                    <Card data-testid="card-capex-installed-cost">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">Total Installed Cost</div>
                        <div className="text-lg font-semibold mt-1">{formatCurrency(capexResults.summary.totalInstalledCost)}</div>
                      </CardContent>
                    </Card>
                    <Card data-testid="card-capex-direct-cost">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">Total Direct Cost</div>
                        <div className="text-lg font-semibold mt-1">{formatCurrency(capexResults.summary.totalDirectCost)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">incl. contingency</div>
                      </CardContent>
                    </Card>
                    <Card data-testid="card-capex-project-cost">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">Total Project Cost</div>
                        <div className="text-lg font-semibold mt-1">{formatCurrency(capexResults.summary.totalProjectCost)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">incl. engineering</div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {capexResults?.lineItems && capexResults.lineItems.length > 0 && (
                  <Card>
                    <CardContent className="p-0">
                      <Table data-testid="table-capex-summary">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Equipment</TableHead>
                            <TableHead className="text-right">Base Cost</TableHead>
                            <TableHead className="text-right">Install Factor</TableHead>
                            <TableHead className="text-right">Total Cost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {capexResults.lineItems.map((item: any) => (
                            <TableRow key={item.id} data-testid={`row-capex-${item.id}`}>
                              <TableCell className="font-medium">{item.equipmentName}</TableCell>
                              <TableCell className="text-right">{formatCurrency(item.baseCost)}</TableCell>
                              <TableCell className="text-right">{formatNum(item.installationFactor, 2)}x</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(item.totalCost)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
