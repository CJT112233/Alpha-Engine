import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Droplets,
  Factory,
  Gauge,
  Lock,
  Unlock,
  RefreshCw,
  Download,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import type { MassBalanceRun, MassBalanceResults, TreatmentStage, EquipmentItem, StreamData } from "@shared/schema";

function formatNum(val: number | undefined, decimals: number = 1): string {
  if (val === undefined || val === null) return "—";
  return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function StreamTable({ stages }: { stages: TreatmentStage[] }) {
  const params = ["bod", "cod", "tss", "tkn", "tp", "fog"] as const;
  const paramLabels: Record<string, string> = {
    bod: "BOD (mg/L)",
    cod: "COD (mg/L)",
    tss: "TSS (mg/L)",
    tkn: "TKN (mg/L)",
    tp: "TP (mg/L)",
    fog: "FOG (mg/L)",
  };

  return (
    <div className="overflow-x-auto">
      <Table data-testid="table-mass-balance">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[120px]">Parameter</TableHead>
            {stages.map((stage, i) => (
              <TableHead key={i} className="min-w-[100px] text-center" colSpan={2}>
                {stage.name}
              </TableHead>
            ))}
          </TableRow>
          <TableRow>
            <TableHead />
            {stages.map((_, i) => (
              <>
                <TableHead key={`in-${i}`} className="text-center text-xs text-muted-foreground">In</TableHead>
                <TableHead key={`out-${i}`} className="text-center text-xs text-muted-foreground">Out</TableHead>
              </>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">Flow (MGD)</TableCell>
            {stages.map((stage, i) => (
              <>
                <TableCell key={`f-in-${i}`} className="text-center" data-testid={`cell-flow-in-${i}`}>
                  {formatNum(stage.influent.flow, 4)}
                </TableCell>
                <TableCell key={`f-out-${i}`} className="text-center" data-testid={`cell-flow-out-${i}`}>
                  {formatNum(stage.effluent.flow, 4)}
                </TableCell>
              </>
            ))}
          </TableRow>
          {params.map(p => (
            <TableRow key={p}>
              <TableCell className="font-medium">{paramLabels[p]}</TableCell>
              {stages.map((stage, i) => {
                const inVal = stage.influent[p as keyof StreamData] as number;
                const outVal = stage.effluent[p as keyof StreamData] as number;
                return (
                  <>
                    <TableCell key={`${p}-in-${i}`} className="text-center">
                      {formatNum(inVal)}
                    </TableCell>
                    <TableCell key={`${p}-out-${i}`} className="text-center">
                      {formatNum(outVal)}
                    </TableCell>
                  </>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EquipmentTable({ equipment, locks, onToggleLock }: {
  equipment: EquipmentItem[];
  locks: Record<string, boolean>;
  onToggleLock: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {equipment.map((eq) => {
        const isExpanded = expandedId === eq.id;
        const isLocked = locks[eq.id] || eq.isLocked;

        return (
          <Card key={eq.id} data-testid={`card-equipment-${eq.id}`}>
            <div
              className="flex items-center gap-3 p-3 cursor-pointer hover-elevate"
              onClick={() => setExpandedId(isExpanded ? null : eq.id)}
              data-testid={`button-expand-${eq.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{eq.equipmentType}</span>
                  <Badge variant="outline" className="text-xs">{eq.process}</Badge>
                  <Badge variant="secondary" className="text-xs">Qty: {eq.quantity}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{eq.description}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onToggleLock(eq.id); }}
                data-testid={`button-lock-${eq.id}`}
              >
                {isLocked ? <Lock className="h-4 w-4 text-amber-500" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
              </Button>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
            {isExpanded && (
              <CardContent className="pt-0 pb-3 px-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                  {Object.entries(eq.specs).map(([key, spec]) => (
                    <div key={key} className="rounded-md bg-muted/40 p-2">
                      <div className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").trim()}</div>
                      <div className="text-sm font-medium">{spec.value} {spec.unit}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  <span className="font-medium">Design basis:</span> {eq.designBasis}
                </div>
                {eq.notes && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium">Notes:</span> {eq.notes}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function WarningsList({ warnings }: { warnings: MassBalanceResults["warnings"] }) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 p-2 rounded-md text-sm ${
            w.severity === "error"
              ? "bg-destructive/10 text-destructive"
              : w.severity === "warning"
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
          }`}
          data-testid={`warning-${i}`}
        >
          {w.severity === "error" ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : w.severity === "warning" ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div>
            <span className="font-medium">{w.field}:</span> {w.message}
          </div>
        </div>
      ))}
    </div>
  );
}

function AssumptionsList({ assumptions }: { assumptions: MassBalanceResults["assumptions"] }) {
  if (!assumptions || assumptions.length === 0) return null;

  return (
    <div className="space-y-1">
      {assumptions.map((a, i) => (
        <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`assumption-${i}`}>
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span><span className="font-medium">{a.parameter}:</span> {a.value} <span className="text-xs">({a.source})</span></span>
        </div>
      ))}
    </div>
  );
}

export default function MassBalancePage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const { toast } = useToast();

  const { data: runs, isLoading } = useQuery<MassBalanceRun[]>({
    queryKey: ["/api/scenarios", scenarioId, "mass-balance"],
  });

  const latestRun = runs?.[0];
  const results = latestRun?.results as MassBalanceResults | undefined;
  const locks = (latestRun?.locks || {}) as Record<string, boolean>;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scenarios/${scenarioId}/mass-balance/generate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
      toast({ title: "Mass Balance Generated", description: "Treatment train calculation complete." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mass-balance/${latestRun!.id}/recompute`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
      toast({ title: "Recomputed", description: "Mass balance recalculated with latest UPIF data." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const lockMutation = useMutation({
    mutationFn: async (toggledLocks: Record<string, boolean>) => {
      const res = await apiRequest("PATCH", `/api/mass-balance/${latestRun!.id}/locks`, { locks: toggledLocks });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/mass-balance/${latestRun!.id}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
      toast({ title: "Status Updated" });
    },
  });

  const handleToggleLock = (equipmentId: string) => {
    const newLocks = { [equipmentId]: !locks[equipmentId] };
    lockMutation.mutate(newLocks);
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/scenarios/${scenarioId}`}>
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <Droplets className="h-5 w-5" />
            Mass Balance & Equipment
          </h1>
          <p className="text-sm text-muted-foreground">Deterministic treatment train calculation</p>
        </div>

        {latestRun && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={latestRun.status === "finalized" ? "default" : "outline"} data-testid="badge-status">
              {latestRun.status === "finalized" ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Finalized</>
              ) : latestRun.status === "reviewed" ? (
                "Reviewed"
              ) : (
                "Draft"
              )}
            </Badge>
            <Badge variant="secondary" data-testid="badge-version">v{latestRun.version}</Badge>
          </div>
        )}
      </div>

      {!latestRun ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Factory className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-medium">No Mass Balance Generated</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Generate a mass balance from the confirmed UPIF to see treatment stages and equipment sizing.
              </p>
            </div>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate"
            >
              {generateMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Calculating...</>
              ) : (
                <><Gauge className="h-4 w-4 mr-2" /> Generate Mass Balance</>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => recomputeMutation.mutate()}
              disabled={recomputeMutation.isPending}
              data-testid="button-recompute"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${recomputeMutation.isPending ? "animate-spin" : ""}`} />
              Recompute
            </Button>
            {latestRun.status !== "finalized" && (
              <Button
                variant="outline"
                onClick={() => statusMutation.mutate("finalized")}
                disabled={statusMutation.isPending}
                data-testid="button-finalize"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Finalize
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-new-version"
            >
              New Version
            </Button>
          </div>

          {results && (
            <>
              <WarningsList warnings={results.warnings} />

              <Tabs defaultValue="treatment-train" className="w-full">
                <TabsList data-testid="tabs-mass-balance">
                  <TabsTrigger value="treatment-train" data-testid="tab-treatment-train">Treatment Train</TabsTrigger>
                  <TabsTrigger value="equipment" data-testid="tab-equipment">Equipment List ({results.equipment.length})</TabsTrigger>
                  <TabsTrigger value="assumptions" data-testid="tab-assumptions">Assumptions</TabsTrigger>
                </TabsList>

                <TabsContent value="treatment-train" className="mt-4 space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle className="text-base">Stream Data by Treatment Stage</CardTitle>
                        <div className="flex items-center gap-2">
                          {results.convergenceAchieved ? (
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Converged ({results.convergenceIterations} iter)
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Not converged
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <StreamTable stages={results.stages} />
                    </CardContent>
                  </Card>

                  {results.recycleStreams.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Recycle Streams</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table data-testid="table-recycle-streams">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Stream</TableHead>
                              <TableHead>Source</TableHead>
                              <TableHead>Destination</TableHead>
                              <TableHead className="text-right">Flow (MGD)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {results.recycleStreams.map((rs, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium">{rs.name}</TableCell>
                                <TableCell>{rs.source}</TableCell>
                                <TableCell>{rs.destination}</TableCell>
                                <TableCell className="text-right">{formatNum(rs.flow, 4)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Removal Efficiencies by Stage</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table data-testid="table-removal-efficiencies">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Stage</TableHead>
                            <TableHead className="text-center">BOD</TableHead>
                            <TableHead className="text-center">COD</TableHead>
                            <TableHead className="text-center">TSS</TableHead>
                            <TableHead className="text-center">TKN</TableHead>
                            <TableHead className="text-center">TP</TableHead>
                            <TableHead className="text-center">FOG</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.stages
                            .filter(s => Object.keys(s.removalEfficiencies).length > 0)
                            .map((stage, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium">{stage.name}</TableCell>
                                {["bod", "cod", "tss", "tkn", "tp", "fog"].map(p => (
                                  <TableCell key={p} className="text-center">
                                    {stage.removalEfficiencies[p] !== undefined
                                      ? `${(stage.removalEfficiencies[p] * 100).toFixed(0)}%`
                                      : "—"}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="equipment" className="mt-4">
                  <EquipmentTable
                    equipment={results.equipment}
                    locks={locks}
                    onToggleLock={handleToggleLock}
                  />
                </TabsContent>

                <TabsContent value="assumptions" className="mt-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Design Assumptions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <AssumptionsList assumptions={results.assumptions} />
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}
    </div>
  );
}
