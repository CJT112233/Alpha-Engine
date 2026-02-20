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
  Wallet,
  Lock,
  Unlock,
  RefreshCw,
  CheckCircle2,
  Pencil,
  Check,
  X,
  AlertTriangle,
  Info,
  Download,
  FileSpreadsheet,
  FileText,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { ElapsedTimer } from "@/components/elapsed-timer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpexEstimate, OpexResults, OpexLineItem, OpexOverrides, OpexLocks, OpexSummary } from "@shared/schema";

function formatCurrency(val: number): string {
  const prefix = val < 0 ? "-$" : "$";
  return prefix + Math.abs(val).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseNumericValue(str: string): number {
  const cleaned = str.replace(/[$,%\s]/g, "").replace(/,/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
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
    if (!isEditing) setEditValue(displayValue);
  }, [displayValue, isEditing]);

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

function WarningsList({ warnings }: { warnings: OpexResults["warnings"] }) {
  const validWarnings = (warnings || []).filter(
    (w) => (w.field && w.field.trim()) || (w.message && w.message.trim())
  );
  if (validWarnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {validWarnings.map((w, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 p-2 rounded-md text-sm ${
            w.severity === "error"
              ? "bg-destructive/10 text-destructive"
              : w.severity === "warning"
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
          }`}
          data-testid={`warning-opex-${i}`}
        >
          {w.severity === "error" || w.severity === "warning" ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div>
            {w.field && w.field.trim() ? (
              <><span className="font-medium">{w.field}:</span> {w.message || ""}</>
            ) : (
              <span>{w.message || ""}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AssumptionsList({ assumptions }: { assumptions: OpexResults["assumptions"] }) {
  if (!assumptions || assumptions.length === 0) return null;

  return (
    <div className="space-y-1">
      {assumptions.map((a, i) => (
        <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`assumption-opex-${i}`}>
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span><span className="font-medium">{a.parameter}:</span> {a.value} <span className="text-xs">({a.source})</span></span>
        </div>
      ))}
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  "Labor": "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  "Energy": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "Chemical": "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  "Maintenance": "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  "Disposal": "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  "Revenue Offset": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  "Other": "bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300",
};

function getCategoryColor(category: string): string {
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (category.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return CATEGORY_COLORS["Other"];
}

export default function OpexPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const { toast } = useToast();

  const { data: estimates, isLoading } = useQuery<OpexEstimate[]>({
    queryKey: ["/api/scenarios", scenarioId, "opex"],
  });

  const latestEstimate = estimates?.[0];
  const results = latestEstimate?.results as OpexResults | undefined;
  const locks = (latestEstimate?.locks || {}) as Record<string, boolean>;
  const overrides = (latestEstimate?.overrides || {}) as OpexOverrides;
  const summary = results?.summary;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);
      try {
        const res = await fetch(`/api/scenarios/${scenarioId}/opex/generate`, {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        return res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "opex"] });
      toast({ title: "OpEx Estimate Generated", description: "Annual operating cost estimate complete." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/opex/${latestEstimate!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "opex"] });
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
      const newOverrides: OpexOverrides = {
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
    const newOverrides: OpexOverrides = {
      ...overrides,
      [fieldKey]: {
        value: newValue,
        unit: "",
        overriddenBy: "user",
        reason: "Manual edit",
        originalValue,
      },
    };

    if (!results) {
      patchMutation.mutate({ overrides: newOverrides });
      toast({ title: "Value Updated", description: "Override saved." });
      return;
    }

    const numVal = parseNumericValue(newValue);
    let updatedResults = { ...results, lineItems: [...results.lineItems], summary: { ...results.summary } };

    const lineItemMatch = fieldKey.match(/^lineItems\.(.+?)\.annualCost$/);
    if (lineItemMatch) {
      const [, itemId] = lineItemMatch;
      updatedResults.lineItems = updatedResults.lineItems.map((li) => {
        if ((li.id || "") !== itemId) return li;
        return { ...li, annualCost: numVal };
      });
      updatedResults.summary = recalculateSummary(updatedResults.lineItems);
    } else if (fieldKey.startsWith("summary.")) {
      const summaryField = fieldKey.replace("summary.", "");
      (updatedResults.summary as any)[summaryField] = numVal;
    }

    patchMutation.mutate({ overrides: newOverrides, results: updatedResults });
    toast({ title: "Value Updated", description: "Override saved. Totals recalculated." });
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
        <Link href={`/scenarios/${scenarioId}/capex`}>
          <Button variant="ghost" size="icon" data-testid="button-back-opex">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-opex-page-title">
            <Wallet className="h-5 w-5" />
            Annual Operating Cost Estimate
          </h1>
          {results && (
            <p className="text-sm text-muted-foreground">
              {results.methodology} &middot; {results.costYear} &middot; {results.currency}
            </p>
          )}
        </div>

        {latestEstimate && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={latestEstimate.status === "finalized" ? "default" : "outline"} data-testid="badge-opex-status">
              {latestEstimate.status === "finalized" ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Finalized</>
              ) : (
                "Draft"
              )}
            </Badge>
            <Badge variant="secondary" data-testid="badge-opex-version">v{latestEstimate.version}</Badge>
          </div>
        )}
      </div>

      {!latestEstimate ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Wallet className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-medium">No OpEx Estimate Generated</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Generate an annual operating cost estimate from the finalized mass balance and equipment list.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Mass balance must be finalized first. CapEx data will be used if available.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                data-testid="button-generate-opex"
              >
                {generateMutation.isPending ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating with AI...</>
                ) : (
                  <><Wallet className="h-4 w-4 mr-2" /> Generate OpEx Estimate</>
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
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-regenerate-opex"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              Regenerate
            </Button>
            {latestEstimate.status !== "finalized" && (
              <Button
                variant="outline"
                onClick={handleFinalize}
                disabled={patchMutation.isPending}
                data-testid="button-finalize-opex"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Finalize
              </Button>
            )}
            <ElapsedTimer isRunning={generateMutation.isPending} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-export-opex">
                  <Download className="h-4 w-4 mr-2" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  data-testid="button-export-opex-pdf"
                  onClick={() => window.open(`/api/scenarios/${scenarioId}/opex/export-pdf`, "_blank")}
                >
                  <FileText className="h-4 w-4 mr-2" /> Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="button-export-opex-excel"
                  onClick={() => window.open(`/api/scenarios/${scenarioId}/opex/export-excel`, "_blank")}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {Object.keys(overrides).length > 0 && (
              <Badge variant="secondary" data-testid="badge-opex-overrides-count">
                {Object.keys(overrides).length} override{Object.keys(overrides).length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {results && (
            <>
              <WarningsList warnings={results.warnings} />

              {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <Card data-testid="card-total-annual-opex">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground">Total Annual OpEx</div>
                      <div className="mt-1">
                        <EditableValue
                          fieldKey="summary.totalAnnualOpex"
                          displayValue={formatCurrency(summary.totalAnnualOpex)}
                          isLocked={!!locks["summary.totalAnnualOpex"]}
                          isOverridden={!!overrides["summary.totalAnnualOpex"]}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                          compact
                        />
                      </div>
                    </CardContent>
                  </Card>
                  {summary.revenueOffsets !== 0 && (
                    <Card data-testid="card-revenue-offsets">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          {summary.revenueOffsets < 0 ? <TrendingDown className="h-3 w-3 text-emerald-500" /> : <TrendingUp className="h-3 w-3" />}
                          Revenue Offsets
                        </div>
                        <div className="mt-1">
                          <EditableValue
                            fieldKey="summary.revenueOffsets"
                            displayValue={formatCurrency(summary.revenueOffsets)}
                            isLocked={!!locks["summary.revenueOffsets"]}
                            isOverridden={!!overrides["summary.revenueOffsets"]}
                            onSaveOverride={handleSaveOverride}
                            onToggleLock={handleToggleLock}
                            compact
                          />
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  <Card data-testid="card-net-annual-opex">
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground font-medium">Net Annual OpEx</div>
                      <div className="mt-1">
                        <EditableValue
                          fieldKey="summary.netAnnualOpex"
                          displayValue={formatCurrency(summary.netAnnualOpex)}
                          isLocked={!!locks["summary.netAnnualOpex"]}
                          isOverridden={!!overrides["summary.netAnnualOpex"]}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                          compact
                        />
                      </div>
                    </CardContent>
                  </Card>
                  {summary.opexPerUnit && (
                    <Card data-testid="card-opex-per-unit">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">OpEx per Unit</div>
                        <div className="mt-1">
                          <EditableValue
                            fieldKey="summary.opexPerUnit"
                            displayValue={formatCurrency(summary.opexPerUnit.value)}
                            unit={summary.opexPerUnit.unit}
                            isLocked={!!locks["summary.opexPerUnit"]}
                            isOverridden={!!overrides["summary.opexPerUnit"]}
                            onSaveOverride={handleSaveOverride}
                            onToggleLock={handleToggleLock}
                            compact
                          />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{summary.opexPerUnit.basis}</div>
                      </CardContent>
                    </Card>
                  )}
                  {summary.opexAsPercentOfCapex != null && (
                    <Card data-testid="card-opex-pct-capex">
                      <CardContent className="p-4">
                        <div className="text-xs text-muted-foreground">OpEx as % of CapEx</div>
                        <div className="mt-1 text-sm font-semibold">{summary.opexAsPercentOfCapex}%</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Annual / Total CapEx</div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {summary && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: "Labor", value: summary.totalLaborCost, key: "summary.totalLaborCost" },
                    { label: "Energy", value: summary.totalEnergyCost, key: "summary.totalEnergyCost" },
                    { label: "Chemicals", value: summary.totalChemicalCost, key: "summary.totalChemicalCost" },
                    { label: "Maintenance", value: summary.totalMaintenanceCost, key: "summary.totalMaintenanceCost" },
                    { label: "Disposal", value: summary.totalDisposalCost, key: "summary.totalDisposalCost" },
                    { label: "Other", value: summary.totalOtherCost, key: "summary.totalOtherCost" },
                  ].map((item) => (
                    <Card key={item.key} className="border-dashed">
                      <CardContent className="p-3 text-center">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</div>
                        <div className="text-xs font-medium mt-1">{formatCurrency(item.value)}</div>
                        {summary.totalAnnualOpex > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            {Math.round((item.value / summary.totalAnnualOpex) * 100)}%
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              <Tabs defaultValue="line-items" className="w-full">
                <TabsList data-testid="tabs-opex">
                  <TabsTrigger value="line-items" data-testid="tab-opex-line-items">
                    Line Items ({results.lineItems?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="assumptions" data-testid="tab-opex-assumptions">
                    Assumptions
                  </TabsTrigger>
                  <TabsTrigger value="warnings" data-testid="tab-opex-warnings">
                    Warnings ({(results.warnings || []).filter((w) => (w.field && w.field.trim()) || (w.message && w.message.trim())).length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="line-items" className="mt-4">
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table data-testid="table-opex-line-items">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-[100px]">Category</TableHead>
                              <TableHead className="min-w-[200px]">Description</TableHead>
                              <TableHead className="text-right min-w-[120px]">Annual Cost ($)</TableHead>
                              <TableHead className="text-right min-w-[100px]">Unit Cost</TableHead>
                              <TableHead className="min-w-[100px]">Unit Basis</TableHead>
                              <TableHead className="min-w-[120px]">Scaling Basis</TableHead>
                              <TableHead className="min-w-[100px]">Source</TableHead>
                              <TableHead className="text-center">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {results.lineItems?.map((item, idx) => {
                              const itemId = item.id || `item-${idx}`;
                              const annualCostKey = `lineItems.${itemId}.annualCost`;

                              return (
                                <TableRow key={item.id || idx} data-testid={`row-opex-line-item-${idx}`}>
                                  <TableCell>
                                    <Badge variant="secondary" className={`text-xs ${getCategoryColor(item.category)} no-default-hover-elevate no-default-active-elevate`}>
                                      {item.category}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-sm">{item.description}</TableCell>
                                  <TableCell className="text-right">
                                    <EditableValue
                                      fieldKey={annualCostKey}
                                      displayValue={formatCurrency(item.annualCost)}
                                      isLocked={!!locks[annualCostKey]}
                                      isOverridden={!!overrides[annualCostKey]}
                                      onSaveOverride={handleSaveOverride}
                                      onToggleLock={handleToggleLock}
                                      compact
                                    />
                                  </TableCell>
                                  <TableCell className="text-right text-sm text-muted-foreground">
                                    {item.unitCost != null ? formatCurrency(item.unitCost) : "-"}
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{item.unitBasis || "-"}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{item.scalingBasis || "-"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{item.source}</TableCell>
                                  <TableCell className="text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => handleToggleLock(`lineItems.${itemId}`)}
                                            data-testid={`button-lock-opex-row-${idx}`}
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
                      <CardTitle className="text-base">Operating Assumptions</CardTitle>
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

function recalculateSummary(lineItems: OpexLineItem[]): OpexSummary {
  const categorize = (cat: string): string => {
    const c = cat.toLowerCase();
    if (c.includes("labor") || c.includes("staff") || c.includes("personnel")) return "Labor";
    if (c.includes("energy") || c.includes("electric") || c.includes("utilit")) return "Energy";
    if (c.includes("chemical") || c.includes("consumab")) return "Chemical";
    if (c.includes("mainten") || c.includes("repair")) return "Maintenance";
    if (c.includes("dispos") || c.includes("haul") || c.includes("sludge") || c.includes("digestate")) return "Disposal";
    if (c.includes("revenue") || c.includes("offset") || c.includes("credit")) return "Revenue Offset";
    return "Other";
  };

  const totalLaborCost = lineItems.filter(li => categorize(li.category) === "Labor").reduce((s, li) => s + li.annualCost, 0);
  const totalEnergyCost = lineItems.filter(li => categorize(li.category) === "Energy").reduce((s, li) => s + li.annualCost, 0);
  const totalChemicalCost = lineItems.filter(li => categorize(li.category) === "Chemical").reduce((s, li) => s + li.annualCost, 0);
  const totalMaintenanceCost = lineItems.filter(li => categorize(li.category) === "Maintenance").reduce((s, li) => s + li.annualCost, 0);
  const totalDisposalCost = lineItems.filter(li => categorize(li.category) === "Disposal").reduce((s, li) => s + li.annualCost, 0);
  const totalOtherCost = lineItems.filter(li => categorize(li.category) === "Other").reduce((s, li) => s + li.annualCost, 0);
  const revenueOffsets = lineItems.filter(li => categorize(li.category) === "Revenue Offset").reduce((s, li) => s + li.annualCost, 0);

  const totalAnnualOpex = totalLaborCost + totalEnergyCost + totalChemicalCost + totalMaintenanceCost + totalDisposalCost + totalOtherCost;
  const netAnnualOpex = totalAnnualOpex + revenueOffsets;

  return {
    totalAnnualOpex,
    totalLaborCost,
    totalEnergyCost,
    totalChemicalCost,
    totalMaintenanceCost,
    totalDisposalCost,
    totalOtherCost,
    revenueOffsets,
    netAnnualOpex,
  };
}
