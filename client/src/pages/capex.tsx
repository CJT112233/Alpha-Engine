import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  DollarSign,
  Lock,
  Unlock,
  RefreshCw,
  CheckCircle2,
  Pencil,
  Check,
  X,
  AlertTriangle,
  Info,
  Calculator,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { ElapsedTimer } from "@/components/elapsed-timer";
import type { CapexEstimate, CapexResults, CapexLineItem, CapexOverrides, CapexLocks, CapexSummary } from "@shared/schema";

function formatCurrency(val: number): string {
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function EditableValue({
  fieldKey,
  displayValue,
  unit,
  isLocked,
  isOverridden,
  onSaveOverride,
  onToggleLock,
  compact = false,
}: {
  fieldKey: string;
  displayValue: string;
  unit?: string;
  isLocked: boolean;
  isOverridden: boolean;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
  onToggleLock: (key: string, currentValue?: string) => void;
  compact?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editValue.trim() && editValue !== displayValue) {
      onSaveOverride(fieldKey, editValue.trim(), displayValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(displayValue);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleCancel();
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={compact ? "text-xs max-w-20" : "text-sm max-w-24"}
          data-testid={`input-edit-${fieldKey}`}
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        <Button size="icon" variant="ghost" onClick={handleSave} data-testid={`button-save-${fieldKey}`}>
          <Check className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={handleCancel} data-testid={`button-cancel-${fieldKey}`}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <span
        className={`cursor-pointer ${isOverridden ? "text-blue-600 dark:text-blue-400 font-semibold" : compact ? "" : "font-semibold"} ${compact ? "text-sm" : "text-lg"}`}
        onClick={() => { setEditValue(displayValue); setIsEditing(true); }}
        data-testid={`value-${fieldKey}`}
      >
        {displayValue}
      </span>
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="invisible group-hover:visible"
            onClick={() => { setEditValue(displayValue); setIsEditing(true); }}
            data-testid={`button-edit-${fieldKey}`}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit value</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onToggleLock(fieldKey, displayValue)}
            data-testid={`button-lock-${fieldKey}`}
          >
            {isLocked ? <Lock className="h-3 w-3 text-amber-500" /> : <Unlock className="h-3 w-3 text-muted-foreground invisible group-hover:visible" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isLocked ? "Unlock (will be overwritten on recompute)" : "Lock (preserves value on recompute)"}</TooltipContent>
      </Tooltip>
      {isOverridden && (
        <Badge variant="secondary" className="text-[10px] px-1 py-0 no-default-hover-elevate no-default-active-elevate">edited</Badge>
      )}
    </div>
  );
}

function WarningsList({ warnings }: { warnings: CapexResults["warnings"] }) {
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

function AssumptionsList({ assumptions }: { assumptions: CapexResults["assumptions"] }) {
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

export default function CapexPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const { toast } = useToast();

  const { data: estimates, isLoading } = useQuery<CapexEstimate[]>({
    queryKey: ["/api/scenarios", scenarioId, "capex"],
  });

  const latestEstimate = estimates?.[0];
  const results = latestEstimate?.results as CapexResults | undefined;
  const locks = (latestEstimate?.locks || {}) as Record<string, boolean>;
  const overrides = (latestEstimate?.overrides || {}) as CapexOverrides;
  const summary = results?.summary;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scenarios/${scenarioId}/capex/generate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "capex"] });
      toast({ title: "CapEx Estimate Generated", description: "Cost estimate complete." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/capex/${latestEstimate!.id}/recompute`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "capex"] });
      toast({ title: "Recomputed", description: "CapEx estimate recalculated. Locked values preserved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/capex/${latestEstimate!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "capex"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleToggleLock = (fieldKey: string, currentValue?: string) => {
    const isLocking = !locks[fieldKey];
    const newLocks = { ...locks, [fieldKey]: isLocking };
    if (!isLocking) delete newLocks[fieldKey];

    patchMutation.mutate({ locks: newLocks });

    if (isLocking && currentValue && !overrides[fieldKey]) {
      const newOverrides: CapexOverrides = {
        ...overrides,
        [fieldKey]: {
          value: currentValue,
          unit: "",
          overriddenBy: "user",
          reason: "Locked at current value",
          originalValue: currentValue,
        },
      };
      patchMutation.mutate({ overrides: newOverrides });
    }
  };

  const handleSaveOverride = (fieldKey: string, newValue: string, originalValue: string) => {
    const newOverrides: CapexOverrides = {
      ...overrides,
      [fieldKey]: {
        value: newValue,
        unit: "",
        overriddenBy: "user",
        reason: "Manual edit",
        originalValue,
      },
    };
    patchMutation.mutate({ overrides: newOverrides });
    toast({ title: "Value Updated", description: "Override saved. Lock the field to preserve it on recompute." });
  };

  const handleFinalize = () => {
    patchMutation.mutate({ status: "finalized" });
    toast({ title: "Status Updated" });
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
        <Link href={`/scenarios/${scenarioId}/mass-balance`}>
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <DollarSign className="h-5 w-5" />
            Capital Cost Estimate
          </h1>
          {results && (
            <p className="text-sm text-muted-foreground">
              {results.methodology} &middot; {results.costYear} &middot; {results.currency}
            </p>
          )}
        </div>

        {latestEstimate && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={latestEstimate.status === "finalized" ? "default" : "outline"} data-testid="badge-status">
              {latestEstimate.status === "finalized" ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Finalized</>
              ) : latestEstimate.status === "reviewed" ? (
                "Reviewed"
              ) : (
                "Draft"
              )}
            </Badge>
            <Badge variant="secondary" data-testid="badge-version">v{latestEstimate.version}</Badge>
          </div>
        )}
      </div>

      {!latestEstimate ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Calculator className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-medium">No CapEx Estimate Generated</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Generate a capital cost estimate from the finalized mass balance equipment list.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Mass balance must be finalized first.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                data-testid="button-generate"
              >
                {generateMutation.isPending ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating with AI...</>
                ) : (
                  <><Calculator className="h-4 w-4 mr-2" /> Generate CapEx Estimate</>
                )}
              </Button>
              <ElapsedTimer isRunning={generateMutation.isPending} />
            </div>
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
            {latestEstimate.status !== "finalized" && (
              <Button
                variant="outline"
                onClick={handleFinalize}
                disabled={patchMutation.isPending}
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
            <ElapsedTimer isRunning={generateMutation.isPending || recomputeMutation.isPending} />
            {Object.keys(overrides).length > 0 && (
              <Badge variant="secondary" data-testid="badge-overrides-count">
                {Object.keys(overrides).length} override{Object.keys(overrides).length !== 1 ? "s" : ""}
              </Badge>
            )}
            {Object.values(locks).filter(Boolean).length > 0 && (
              <Badge variant="outline" data-testid="badge-locks-count">
                <Lock className="h-3 w-3 mr-1" />
                {Object.values(locks).filter(Boolean).length} locked
              </Badge>
            )}
          </div>

          {results && (
            <>
              <WarningsList warnings={results.warnings} />

              {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <Card data-testid="card-total-equipment-cost">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Total Equipment Cost</div>
                      <div className="mt-1">
                        <EditableValue
                          fieldKey="summary.totalEquipmentCost"
                          displayValue={formatCurrency(summary.totalEquipmentCost)}
                          isLocked={!!locks["summary.totalEquipmentCost"]}
                          isOverridden={!!overrides["summary.totalEquipmentCost"]}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                          compact
                        />
                      </div>
                    </CardContent>
                  </Card>
                  <Card data-testid="card-total-installed-cost">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Total Installed Cost</div>
                      <div className="mt-1">
                        <EditableValue
                          fieldKey="summary.totalInstalledCost"
                          displayValue={formatCurrency(summary.totalInstalledCost)}
                          isLocked={!!locks["summary.totalInstalledCost"]}
                          isOverridden={!!overrides["summary.totalInstalledCost"]}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                          compact
                        />
                      </div>
                    </CardContent>
                  </Card>
                  <Card data-testid="card-total-direct-cost">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Total Direct Cost</div>
                      <div className="mt-1">
                        <EditableValue
                          fieldKey="summary.totalDirectCost"
                          displayValue={formatCurrency(summary.totalDirectCost)}
                          isLocked={!!locks["summary.totalDirectCost"]}
                          isOverridden={!!overrides["summary.totalDirectCost"]}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                          compact
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">incl. contingency</div>
                    </CardContent>
                  </Card>
                  <Card data-testid="card-total-project-cost">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Total Project Cost</div>
                      <div className="mt-1">
                        <EditableValue
                          fieldKey="summary.totalProjectCost"
                          displayValue={formatCurrency(summary.totalProjectCost)}
                          isLocked={!!locks["summary.totalProjectCost"]}
                          isOverridden={!!overrides["summary.totalProjectCost"]}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                          compact
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">incl. engineering</div>
                    </CardContent>
                  </Card>
                  <Card data-testid="card-engineering-pct">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Engineering</div>
                      <div className="mt-1">
                        <EditableValue
                          fieldKey="summary.engineeringPct"
                          displayValue={`${summary.engineeringPct}%`}
                          isLocked={!!locks["summary.engineeringPct"]}
                          isOverridden={!!overrides["summary.engineeringPct"]}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                          compact
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{formatCurrency(summary.engineeringCost)}</div>
                    </CardContent>
                  </Card>
                  {summary.costPerUnit && (
                    <Card data-testid="card-cost-per-unit">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">Cost per Unit</div>
                        <div className="mt-1">
                          <EditableValue
                            fieldKey="summary.costPerUnit"
                            displayValue={formatCurrency(summary.costPerUnit.value)}
                            unit={summary.costPerUnit.unit}
                            isLocked={!!locks["summary.costPerUnit"]}
                            isOverridden={!!overrides["summary.costPerUnit"]}
                            onSaveOverride={handleSaveOverride}
                            onToggleLock={handleToggleLock}
                            compact
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{summary.costPerUnit.basis}</div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              <Tabs defaultValue="line-items" className="w-full">
                <TabsList data-testid="tabs-capex">
                  <TabsTrigger value="line-items" data-testid="tab-line-items">
                    Line Items ({results.lineItems?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="assumptions" data-testid="tab-assumptions">
                    Assumptions
                  </TabsTrigger>
                  <TabsTrigger value="warnings" data-testid="tab-warnings">
                    Warnings ({results.warnings?.length || 0})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="line-items" className="mt-4">
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table data-testid="table-capex-line-items">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-[120px]">Process Area</TableHead>
                              <TableHead className="min-w-[120px]">Equipment Type</TableHead>
                              <TableHead className="min-w-[150px]">Description</TableHead>
                              <TableHead className="text-center">Qty</TableHead>
                              <TableHead className="text-right min-w-[120px]">Base Cost/Unit ($)</TableHead>
                              <TableHead className="text-center">Install Factor</TableHead>
                              <TableHead className="text-right min-w-[120px]">Installed Cost ($)</TableHead>
                              <TableHead className="text-center">Contingency %</TableHead>
                              <TableHead className="text-right min-w-[120px]">Total Cost ($)</TableHead>
                              <TableHead className="text-center">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {results.lineItems?.map((item, idx) => {
                              const itemId = item.id || `item-${idx}`;
                              const baseCostKey = `lineItems.${itemId}.baseCostPerUnit`;
                              const installFactorKey = `lineItems.${itemId}.installationFactor`;
                              const installedCostKey = `lineItems.${itemId}.installedCost`;
                              const contingencyKey = `lineItems.${itemId}.contingencyPct`;
                              const totalCostKey = `lineItems.${itemId}.totalCost`;

                              return (
                                <TableRow key={item.id || idx} data-testid={`row-line-item-${idx}`}>
                                  <TableCell className="font-medium text-sm">{item.process}</TableCell>
                                  <TableCell className="text-sm">{item.equipmentType}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{item.description}</TableCell>
                                  <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                                  <TableCell className="text-right">
                                    <EditableValue
                                      fieldKey={baseCostKey}
                                      displayValue={formatCurrency(item.baseCostPerUnit)}
                                      isLocked={!!locks[baseCostKey]}
                                      isOverridden={!!overrides[baseCostKey]}
                                      onSaveOverride={handleSaveOverride}
                                      onToggleLock={handleToggleLock}
                                      compact
                                    />
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <EditableValue
                                      fieldKey={installFactorKey}
                                      displayValue={item.installationFactor.toFixed(2)}
                                      isLocked={!!locks[installFactorKey]}
                                      isOverridden={!!overrides[installFactorKey]}
                                      onSaveOverride={handleSaveOverride}
                                      onToggleLock={handleToggleLock}
                                      compact
                                    />
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <EditableValue
                                      fieldKey={installedCostKey}
                                      displayValue={formatCurrency(item.installedCost)}
                                      isLocked={!!locks[installedCostKey]}
                                      isOverridden={!!overrides[installedCostKey]}
                                      onSaveOverride={handleSaveOverride}
                                      onToggleLock={handleToggleLock}
                                      compact
                                    />
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <EditableValue
                                      fieldKey={contingencyKey}
                                      displayValue={`${item.contingencyPct}%`}
                                      isLocked={!!locks[contingencyKey]}
                                      isOverridden={!!overrides[contingencyKey]}
                                      onSaveOverride={handleSaveOverride}
                                      onToggleLock={handleToggleLock}
                                      compact
                                    />
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <EditableValue
                                      fieldKey={totalCostKey}
                                      displayValue={formatCurrency(item.totalCost)}
                                      isLocked={!!locks[totalCostKey]}
                                      isOverridden={!!overrides[totalCostKey]}
                                      onSaveOverride={handleSaveOverride}
                                      onToggleLock={handleToggleLock}
                                      compact
                                    />
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => {
                                              const rowKey = `lineItems.${itemId}`;
                                              handleToggleLock(rowKey);
                                            }}
                                            data-testid={`button-lock-row-${idx}`}
                                          >
                                            {locks[`lineItems.${itemId}`] ? (
                                              <Lock className="h-3.5 w-3.5 text-amber-500" />
                                            ) : (
                                              <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{locks[`lineItems.${itemId}`] ? "Unlock row" : "Lock row"}</TooltipContent>
                                      </Tooltip>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="assumptions" className="mt-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Cost Assumptions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <AssumptionsList assumptions={results.assumptions} />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="warnings" className="mt-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Warnings & Notes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <WarningsList warnings={results.warnings} />
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
