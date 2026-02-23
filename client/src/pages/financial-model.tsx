import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  RefreshCw,
  CheckCircle2,
  Calculator,
  DollarSign,
  BarChart3,
  Clock,
  Percent,
  Target,
  Download,
  FileText,
  FileStack,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { ElapsedTimer } from "@/components/elapsed-timer";
import type {
  FinancialModel,
  FinancialModelResults,
  FinancialAssumptions,
  ProFormaYear,
  FinancialMetrics,
} from "@shared/schema";

function formatCurrencyK(val: number): string {
  const inK = val / 1000;
  if (inK < 0) {
    return `($${Math.abs(inK).toLocaleString(undefined, { maximumFractionDigits: 0 })})`;
  }
  return `$${inK.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatCurrencyKClass(val: number): string {
  return val < 0 ? "text-red-600 dark:text-red-400" : "";
}

function formatNumber(val: number): string {
  return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPct(val: number | null): string {
  if (val === null || val === undefined) return "N/A";
  return `${(val * 100).toFixed(1)}%`;
}

function formatMoic(val: number): string {
  return `${val.toFixed(1)}x`;
}

function formatPayback(val: number | null): string {
  if (val === null || val === undefined) return "N/A";
  return `${val.toFixed(1)} years`;
}

function AssumptionField({
  label,
  value,
  onChange,
  unit,
  readOnly,
  step,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  readOnly?: boolean;
  step?: string;
  testId: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">
        {label} {unit && <span className="text-[10px]">({unit})</span>}
      </Label>
      <Input
        type="number"
        step={step || "0.01"}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        readOnly={readOnly}
        className={readOnly ? "bg-muted" : ""}
        data-testid={testId}
      />
    </div>
  );
}

export function FinancialModelContent({ scenarioId }: { scenarioId: string }) {
  const { toast } = useToast();
  const [localAssumptions, setLocalAssumptions] = useState<FinancialAssumptions | null>(null);

  const { data: models, isLoading } = useQuery<FinancialModel[]>({
    queryKey: ["/api/scenarios", scenarioId, "financial-model"],
  });

  const { data: massBalanceRuns } = useQuery<any[]>({
    queryKey: ["/api/scenarios", scenarioId, "mass-balance"],
  });
  const { data: capexEstimates } = useQuery<any[]>({
    queryKey: ["/api/scenarios", scenarioId, "capex"],
  });
  const { data: opexEstimates } = useQuery<any[]>({
    queryKey: ["/api/scenarios", scenarioId, "opex"],
  });

  const mbExists = !!massBalanceRuns?.[0];
  const capexExists = !!capexEstimates?.[0];
  const opexExists = !!opexEstimates?.[0];
  const prerequisitesMet = mbExists && capexExists && opexExists;

  const latestModel = models?.[0];
  const results = latestModel?.results as FinancialModelResults | undefined;
  const serverAssumptions = results?.assumptions || (latestModel?.assumptions as FinancialAssumptions | undefined);
  const assumptions = localAssumptions || serverAssumptions;
  const metrics = results?.metrics;
  const proForma = results?.proForma || [];
  const isFinalized = latestModel?.status === "finalized";
  const isDraft = latestModel && latestModel.status !== "finalized";

  const generateMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);
      try {
        const res = await fetch(`/api/scenarios/${scenarioId}/financial-model/generate`, {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          let errorMsg = res.statusText;
          try {
            const parsed = JSON.parse(text);
            errorMsg = parsed.error || parsed.message || text;
          } catch {
            errorMsg = text || res.statusText;
          }
          throw new Error(errorMsg);
        }
        return res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: () => {
      setLocalAssumptions(null);
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "financial-model"] });
      toast({ title: "Financial Model Generated", description: "Pro-forma projections are ready for review." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateAssumptionsMutation = useMutation({
    mutationFn: async (updatedAssumptions: FinancialAssumptions) => {
      const res = await apiRequest("PATCH", `/api/financial-model/${latestModel!.id}/assumptions`, {
        assumptions: updatedAssumptions,
      });
      return res.json();
    },
    onSuccess: () => {
      setLocalAssumptions(null);
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "financial-model"] });
      toast({ title: "Recalculated", description: "Financial model updated with new assumptions." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/financial-model/${latestModel!.id}/status`, {
        status: "finalized",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "financial-model"] });
      toast({ title: "Confirmed", description: "Financial model has been finalized." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const defaultFortyFiveZ = {
    enabled: true,
    ciScore: 25,
    targetCI: 50,
    creditPricePerGal: 1.06,
    conversionGalPerMMBtu: 8.614,
    monetizationPct: 0.90,
    endYear: 2029,
  };

  const defaultVoluntaryPricing = {
    gasPricePerMMBtu: 3.50,
    gasPriceEscalator: 0.03,
    voluntaryPremiumPerMMBtu: 16,
    voluntaryPremiumEscalator: 0.02,
  };

  const updateAssumption = (path: string, value: number | string) => {
    if (!assumptions) return;
    const updated = JSON.parse(JSON.stringify(assumptions));
    if (path.startsWith("fortyFiveZ.") && !updated.fortyFiveZ) {
      updated.fortyFiveZ = { ...defaultFortyFiveZ };
    }
    if (path.startsWith("voluntaryPricing.") && !updated.voluntaryPricing) {
      updated.voluntaryPricing = { ...defaultVoluntaryPricing };
    }
    if (path === "revenueMarket") {
      updated.revenueMarket = value as string;
      if (!updated.voluntaryPricing) {
        updated.voluntaryPricing = { ...defaultVoluntaryPricing };
      }
      setLocalAssumptions(updated);
      return;
    }
    const keys = path.split(".");
    let obj: any = updated;
    for (let i = 0; i < keys.length - 1; i++) {
      if (keys[i].match(/^\d+$/)) {
        obj = obj[parseInt(keys[i])];
      } else {
        obj = obj[keys[i]];
      }
    }
    obj[keys[keys.length - 1]] = value;
    setLocalAssumptions(updated);
  };

  const updateFeedstockCost = (index: number, field: string, value: number) => {
    if (!assumptions) return;
    const updated = {
      ...assumptions,
      feedstockCosts: assumptions.feedstockCosts.map((fc, i) =>
        i === index ? { ...fc, [field]: value } : fc
      ),
    };
    setLocalAssumptions(updated);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!latestModel) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <BarChart3 className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-medium">No Financial Model Generated</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Generate a 20-year pro-forma financial model from the CapEx, OpEx, and mass balance data.
              </p>
              {!prerequisitesMet && (
                <div className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                  {!mbExists && <p>Mass balance must be generated first.</p>}
                  {!capexExists && <p>CapEx estimate must be generated first.</p>}
                  {!opexExists && <p>OpEx estimate must be generated first.</p>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || !prerequisitesMet}
                data-testid="button-generate-financial-model"
              >
                {generateMutation.isPending ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating...</>
                ) : (
                  <><BarChart3 className="h-4 w-4 mr-2" /> Generate Financial Model</>
                )}
              </Button>
              <ElapsedTimer isRunning={generateMutation.isPending} />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {isFinalized ? (
            <Badge variant="default" className="bg-green-600" data-testid="badge-financial-status">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Confirmed
            </Badge>
          ) : (
            <Badge variant="outline" data-testid="badge-financial-status">Draft</Badge>
          )}
          <Badge variant="secondary" data-testid="badge-financial-version">v{latestModel.version}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  if (localAssumptions) {
                    updateAssumptionsMutation.mutate(localAssumptions);
                  } else {
                    toast({ title: "No Changes", description: "Modify assumptions first, then recalculate." });
                  }
                }}
                disabled={updateAssumptionsMutation.isPending || !localAssumptions}
                data-testid="button-recalculate"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${updateAssumptionsMutation.isPending ? "animate-spin" : ""}`} />
                Recalculate
              </Button>
              <Button
                onClick={() => finalizeMutation.mutate()}
                disabled={finalizeMutation.isPending}
                data-testid="button-confirm-financial"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Confirm
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            data-testid="button-regenerate-financial"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-export-summary">
                <Download className="h-4 w-4 mr-2" />
                Project Summary
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="menu-export-executive"
                onClick={() => {
                  window.open(`/api/scenarios/${scenarioId}/project-summary?mode=executive`, "_blank");
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                Executive Summary (2 pages)
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-export-full"
                onClick={() => {
                  window.open(`/api/scenarios/${scenarioId}/project-summary?mode=full`, "_blank");
                }}
              >
                <FileStack className="h-4 w-4 mr-2" />
                Full Report with Appendices
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ElapsedTimer isRunning={generateMutation.isPending || updateAssumptionsMutation.isPending} />
        </div>
      </div>

      {metrics && <MetricsCards metrics={metrics} />}

      {assumptions && (
        <AssumptionsEditor
          assumptions={assumptions}
          readOnly={isFinalized}
          onUpdate={updateAssumption}
          onUpdateFeedstock={updateFeedstockCost}
        />
      )}

      {proForma.length > 0 && results && (
        <ProFormaTable proForma={proForma} results={results} />
      )}
    </div>
  );
}

function MetricsCards({ metrics }: { metrics: FinancialMetrics }) {
  const cards = [
    { label: "IRR", value: formatPct(metrics.irr), icon: TrendingUp, testId: "card-irr" },
    { label: "NPV @ 10%", value: formatCurrencyK(metrics.npv10) + "K", icon: DollarSign, testId: "card-npv" },
    { label: "MOIC", value: formatMoic(metrics.moic), icon: Target, testId: "card-moic" },
    { label: "Payback Period", value: formatPayback(metrics.paybackYears), icon: Clock, testId: "card-payback" },
    { label: "Total CapEx", value: formatCurrencyK(metrics.totalCapex) + "K", icon: Calculator, testId: "card-total-capex" },
    { label: "ITC Proceeds", value: formatCurrencyK(metrics.itcProceeds) + "K", icon: Percent, testId: "card-itc" },
    { label: "Total EBITDA", value: formatCurrencyK(metrics.totalEbitda) + "K", icon: BarChart3, testId: "card-total-ebitda" },
    { label: "Avg Annual EBITDA", value: formatCurrencyK(metrics.averageAnnualEbitda) + "K", icon: BarChart3, testId: "card-avg-ebitda" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.testId} data-testid={c.testId}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <c.icon className="h-3.5 w-3.5" />
              {c.label}
            </div>
            <div className="text-lg font-semibold mt-1" data-testid={`value-${c.testId}`}>
              {c.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AssumptionsEditor({
  assumptions,
  readOnly,
  onUpdate,
  onUpdateFeedstock,
}: {
  assumptions: FinancialAssumptions;
  readOnly: boolean;
  onUpdate: (path: string, value: number | string) => void;
  onUpdateFeedstock: (index: number, field: string, value: number) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Assumptions</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AssumptionField label="Inflation Rate" unit="%" value={assumptions.inflationRate} onChange={(v) => onUpdate("inflationRate", v)} readOnly={readOnly} testId="input-inflation-rate" />
            <AssumptionField label="Project Life" unit="years" value={assumptions.projectLifeYears} onChange={(v) => onUpdate("projectLifeYears", v)} readOnly={readOnly} step="1" testId="input-project-life" />
            <AssumptionField label="Construction Period" unit="months" value={assumptions.constructionMonths} onChange={(v) => onUpdate("constructionMonths", v)} readOnly={readOnly} step="1" testId="input-construction-months" />
            <AssumptionField label="Uptime" unit="%" value={assumptions.uptimePct} onChange={(v) => onUpdate("uptimePct", v)} readOnly={readOnly} testId="input-uptime" />
            <AssumptionField label="Biogas Growth Rate" unit="%/yr" value={assumptions.biogasGrowthRate} onChange={(v) => onUpdate("biogasGrowthRate", v)} readOnly={readOnly} testId="input-biogas-growth" />
            <AssumptionField label="Discount Rate" unit="%" value={assumptions.discountRate} onChange={(v) => onUpdate("discountRate", v)} readOnly={readOnly} testId="input-discount-rate" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">RNG Revenue Market</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Label className="text-xs min-w-[70px]">Market</Label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={(assumptions.revenueMarket || "d3") === "d3" ? "default" : "outline"}
                  className="text-xs h-7 px-3"
                  onClick={() => onUpdate("revenueMarket", "d3")}
                  disabled={readOnly}
                  data-testid="button-market-d3"
                >
                  D3 RINs
                </Button>
                <Button
                  size="sm"
                  variant={assumptions.revenueMarket === "voluntary" ? "default" : "outline"}
                  className="text-xs h-7 px-3"
                  onClick={() => onUpdate("revenueMarket", "voluntary")}
                  disabled={readOnly}
                  data-testid="button-market-voluntary"
                >
                  Voluntary
                </Button>
              </div>
            </div>

            {(assumptions.revenueMarket || "d3") === "d3" ? (
              <>
                <AssumptionField label="RIN Price" unit="$/RIN" value={assumptions.rinPricePerRIN} onChange={(v) => onUpdate("rinPricePerRIN", v)} readOnly={readOnly} testId="input-rin-price" />
                <AssumptionField label="RIN Price Escalator" unit="%/yr" value={assumptions.rinPriceEscalator} onChange={(v) => onUpdate("rinPriceEscalator", v)} readOnly={readOnly} testId="input-rin-escalator" />
                <AssumptionField label="RIN Brokerage" unit="%" value={assumptions.rinBrokeragePct} onChange={(v) => onUpdate("rinBrokeragePct", v)} readOnly={readOnly} testId="input-rin-brokerage" />
                <AssumptionField label="RINs per MMBtu" unit="" value={assumptions.rinPerMMBtu} onChange={(v) => onUpdate("rinPerMMBtu", v)} readOnly={readOnly} testId="input-rin-per-mmbtu" />
                <AssumptionField label="Natural Gas Price" unit="$/MMBtu" value={assumptions.natGasPricePerMMBtu} onChange={(v) => onUpdate("natGasPricePerMMBtu", v)} readOnly={readOnly} testId="input-natgas-price" />
                <AssumptionField label="Nat Gas Escalator" unit="%/yr" value={assumptions.natGasPriceEscalator} onChange={(v) => onUpdate("natGasPriceEscalator", v)} readOnly={readOnly} testId="input-natgas-escalator" />
              </>
            ) : (
              <>
                <AssumptionField label="Gas Price" unit="$/MMBtu" value={assumptions.voluntaryPricing?.gasPricePerMMBtu ?? 3.50} onChange={(v) => onUpdate("voluntaryPricing.gasPricePerMMBtu", v)} readOnly={readOnly} testId="input-vol-gas-price" />
                <AssumptionField label="Gas Price Escalator" unit="%/yr" value={assumptions.voluntaryPricing?.gasPriceEscalator ?? 0.03} onChange={(v) => onUpdate("voluntaryPricing.gasPriceEscalator", v)} readOnly={readOnly} testId="input-vol-gas-escalator" />
                <AssumptionField label="Voluntary Premium" unit="$/MMBtu" value={assumptions.voluntaryPricing?.voluntaryPremiumPerMMBtu ?? 16} onChange={(v) => onUpdate("voluntaryPricing.voluntaryPremiumPerMMBtu", v)} readOnly={readOnly} testId="input-vol-premium" />
                <AssumptionField label="Premium Escalator" unit="%/yr" value={assumptions.voluntaryPricing?.voluntaryPremiumEscalator ?? 0.02} onChange={(v) => onUpdate("voluntaryPricing.voluntaryPremiumEscalator", v)} readOnly={readOnly} testId="input-vol-premium-escalator" />
              </>
            )}
            <AssumptionField label="Wheel/Hub Cost" unit="$/MMBtu" value={assumptions.wheelHubCostPerMMBtu} onChange={(v) => onUpdate("wheelHubCostPerMMBtu", v)} readOnly={readOnly} testId="input-wheel-hub" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Investment Tax Credit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AssumptionField label="ITC Rate" unit="%" value={assumptions.itcRate} onChange={(v) => onUpdate("itcRate", v)} readOnly={readOnly} testId="input-itc-rate" />
            <AssumptionField label="ITC Monetization" unit="%" value={assumptions.itcMonetizationPct} onChange={(v) => onUpdate("itcMonetizationPct", v)} readOnly={readOnly} testId="input-itc-monetization" />
            <AssumptionField label="Maintenance CapEx" unit="%/yr" value={assumptions.maintenanceCapexPct} onChange={(v) => onUpdate("maintenanceCapexPct", v)} readOnly={readOnly} testId="input-maintenance-capex" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Utility Costs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AssumptionField label="Electricity Cost" unit="$/kWh" value={assumptions.electricityCostPerKWh} onChange={(v) => onUpdate("electricityCostPerKWh", v)} readOnly={readOnly} testId="input-electricity-cost" />
            <AssumptionField label="Electricity Escalator" unit="%/yr" value={assumptions.electricityEscalator} onChange={(v) => onUpdate("electricityEscalator", v)} readOnly={readOnly} testId="input-electricity-escalator" />
            <AssumptionField label="Gas Cost" unit="$/MMBtu" value={assumptions.gasCostPerMMBtu} onChange={(v) => onUpdate("gasCostPerMMBtu", v)} readOnly={readOnly} testId="input-gas-cost" />
            <AssumptionField label="Gas Cost Escalator" unit="%/yr" value={assumptions.gasCostEscalator} onChange={(v) => onUpdate("gasCostEscalator", v)} readOnly={readOnly} testId="input-gas-escalator" />
          </CardContent>
        </Card>

        {assumptions.feedstockCosts && assumptions.feedstockCosts.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Feedstock Costs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {assumptions.feedstockCosts.map((fc, idx) => (
                <div key={idx} className="space-y-2 pb-3 border-b last:border-b-0 last:pb-0">
                  <div className="text-xs font-medium">{fc.feedstockName}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <AssumptionField label="Cost" unit="$/ton" value={fc.costPerTon} onChange={(v) => onUpdateFeedstock(idx, "costPerTon", v)} readOnly={readOnly} testId={`input-feedstock-cost-${idx}`} />
                    <AssumptionField label="Annual Tons" unit="" value={fc.annualTons} onChange={(v) => onUpdateFeedstock(idx, "annualTons", v)} readOnly={readOnly} step="1" testId={`input-feedstock-tons-${idx}`} />
                    <AssumptionField label="Escalator" unit="%/yr" value={fc.escalator} onChange={(v) => onUpdateFeedstock(idx, "escalator", v)} readOnly={readOnly} testId={`input-feedstock-escalator-${idx}`} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">45Z Clean Fuel Tax Credit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="45z-enabled"
                checked={assumptions.fortyFiveZ?.enabled ?? true}
                onCheckedChange={(checked) => onUpdate("fortyFiveZ.enabled", checked ? 1 : 0)}
                disabled={readOnly}
                data-testid="checkbox-45z-enabled"
              />
              <Label htmlFor="45z-enabled" className="text-xs">45Z Credits Enabled</Label>
            </div>
            {assumptions.fortyFiveZ?.enabled && (
              <>
                <AssumptionField label="CI Score" unit="gCO₂e/MJ" value={assumptions.fortyFiveZ.ciScore} onChange={(v) => onUpdate("fortyFiveZ.ciScore", v)} readOnly={readOnly} step="1" testId="input-45z-ci-score" />
                <AssumptionField label="Target CI" unit="gCO₂e/MJ" value={assumptions.fortyFiveZ.targetCI} onChange={(v) => onUpdate("fortyFiveZ.targetCI", v)} readOnly={readOnly} step="1" testId="input-45z-target-ci" />
                <AssumptionField label="Credit Price" unit="$/gal" value={assumptions.fortyFiveZ.creditPricePerGal} onChange={(v) => onUpdate("fortyFiveZ.creditPricePerGal", v)} readOnly={readOnly} testId="input-45z-credit-price" />
                <AssumptionField label="Conversion Factor" unit="gal/MMBtu" value={assumptions.fortyFiveZ.conversionGalPerMMBtu} onChange={(v) => onUpdate("fortyFiveZ.conversionGalPerMMBtu", v)} readOnly={readOnly} testId="input-45z-conversion" />
                <AssumptionField label="Monetization" unit="%" value={assumptions.fortyFiveZ.monetizationPct} onChange={(v) => onUpdate("fortyFiveZ.monetizationPct", v)} readOnly={readOnly} testId="input-45z-monetization" />
                <AssumptionField label="Credits End Year" unit="" value={assumptions.fortyFiveZ.endYear} onChange={(v) => onUpdate("fortyFiveZ.endYear", v)} readOnly={readOnly} step="1" testId="input-45z-end-year" />
                {(() => {
                  const z = assumptions.fortyFiveZ;
                  const emFactor = Math.max(0, (z.targetCI - z.ciScore) / z.targetCI);
                  const creditPerGal = emFactor * z.creditPricePerGal;
                  const pricePerMMBtu = creditPerGal * z.conversionGalPerMMBtu;
                  const netPrice = pricePerMMBtu * z.monetizationPct;
                  return (
                    <div className="mt-2 p-2 bg-muted rounded text-xs space-y-1" data-testid="text-45z-summary">
                      <div className="flex justify-between"><span>Emission Factor:</span><span>{(emFactor * 100).toFixed(1)}%</span></div>
                      <div className="flex justify-between"><span>Credit per gal equiv:</span><span>${creditPerGal.toFixed(3)}/gal</span></div>
                      <div className="flex justify-between"><span>45Z Price:</span><span>${pricePerMMBtu.toFixed(2)}/MMBtu</span></div>
                      <div className="flex justify-between font-semibold"><span>Net 45Z Price:</span><span>${netPrice.toFixed(2)}/MMBtu</span></div>
                    </div>
                  );
                })()}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Debt Financing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="debt-enabled"
                checked={assumptions.debtFinancing?.enabled || false}
                onCheckedChange={(checked) => onUpdate("debtFinancing.enabled", checked ? 1 : 0)}
                disabled={readOnly}
                data-testid="checkbox-debt-enabled"
              />
              <Label htmlFor="debt-enabled" className="text-xs">Debt Financing Enabled</Label>
            </div>
            {assumptions.debtFinancing?.enabled && (
              <>
                <AssumptionField label="Loan Amount" unit="% of CapEx" value={assumptions.debtFinancing.loanAmountPct} onChange={(v) => onUpdate("debtFinancing.loanAmountPct", v)} readOnly={readOnly} testId="input-loan-amount" />
                <AssumptionField label="Interest Rate" unit="%" value={assumptions.debtFinancing.interestRate} onChange={(v) => onUpdate("debtFinancing.interestRate", v)} readOnly={readOnly} testId="input-interest-rate" />
                <AssumptionField label="Term" unit="years" value={assumptions.debtFinancing.termYears} onChange={(v) => onUpdate("debtFinancing.termYears", v)} readOnly={readOnly} step="1" testId="input-debt-term" />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionHeaderRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <TableRow className="bg-muted/50">
      <TableCell colSpan={colSpan} className="font-bold text-xs py-1.5">
        {label}
      </TableCell>
    </TableRow>
  );
}

function DataRow({
  label,
  values,
  format: fmt = "currencyK",
  isBold = false,
  year0Value,
}: {
  label: string;
  values: number[];
  format?: "currencyK" | "number" | "currencyKNeg";
  isBold?: boolean;
  year0Value?: number | null;
}) {
  const formatVal = (val: number) => {
    if (fmt === "number") return formatNumber(val);
    return formatCurrencyK(val);
  };

  const cellClass = (val: number) => {
    const bold = isBold ? "font-semibold" : "";
    const color = val < 0 ? "text-red-600 dark:text-red-400" : "";
    return `${bold} ${color} text-right text-xs whitespace-nowrap`.trim();
  };

  return (
    <TableRow>
      <TableCell className={`text-xs whitespace-nowrap sticky left-0 bg-background z-10 ${isBold ? "font-semibold" : ""}`}>
        {label}
      </TableCell>
      <TableCell className={cellClass(year0Value ?? 0)}>
        {year0Value !== null && year0Value !== undefined ? formatVal(year0Value) : ""}
      </TableCell>
      {values.map((val, i) => (
        <TableCell key={i} className={cellClass(val)}>
          {formatVal(val)}
        </TableCell>
      ))}
    </TableRow>
  );
}

function ProFormaTable({ proForma, results }: { proForma: ProFormaYear[]; results: FinancialModelResults }) {
  const totalCols = proForma.length + 2;
  const capexTotal = results.capexTotal || 0;
  const itcProceeds = results.metrics?.itcProceeds || 0;
  const year0CalendarYear = proForma.length > 0 ? proForma[0].calendarYear - 1 : new Date().getFullYear();
  const isVoluntaryMarket = results.assumptions?.revenueMarket === "voluntary";

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Pro-Forma Projection ($000)</h3>
      <div className="overflow-x-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background z-10 min-w-[160px]" />
              <TableHead className="text-right text-xs whitespace-nowrap min-w-[90px]">
                <div>Year 0</div>
                <div className="text-[10px] text-muted-foreground">{year0CalendarYear}</div>
              </TableHead>
              {proForma.map((yr) => (
                <TableHead key={yr.year} className="text-right text-xs whitespace-nowrap min-w-[90px]">
                  <div>Year {yr.year}</div>
                  <div className="text-[10px] text-muted-foreground">{yr.calendarYear}</div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <SectionHeaderRow label="Production" colSpan={totalCols} />
            <DataRow
              label="Biogas Flow (SCFM)"
              values={proForma.map((yr) => yr.biogasScfm)}
              format="number"
              year0Value={null}
            />
            <DataRow
              label="RNG Production (MMBtu)"
              values={proForma.map((yr) => yr.rngProductionMMBtu)}
              format="number"
              year0Value={null}
            />

            <SectionHeaderRow label={`Revenue ($000) — ${isVoluntaryMarket ? "Voluntary Market" : "D3 RIN Market"}`} colSpan={totalCols} />
            {isVoluntaryMarket ? (
              <DataRow label="Voluntary Revenue" values={proForma.map((yr) => yr.voluntaryRevenue || 0)} year0Value={0} />
            ) : (
              <>
                <DataRow label="RIN Revenue" values={proForma.map((yr) => yr.rinRevenue)} year0Value={0} />
                <DataRow label="(-) RIN Brokerage" values={proForma.map((yr) => -yr.rinBrokerage)} year0Value={0} />
                <DataRow label="(+) Natural Gas Revenue" values={proForma.map((yr) => yr.natGasRevenue)} year0Value={0} />
              </>
            )}
            <DataRow label="(+) 45Z Tax Credits" values={proForma.map((yr) => yr.fortyFiveZRevenue || 0)} year0Value={0} />
            <DataRow label="(+) Tipping Fees" values={proForma.map((yr) => yr.tippingFeeRevenue || 0)} year0Value={0} />
            <DataRow label="= Total Revenue" values={proForma.map((yr) => yr.totalRevenue)} isBold year0Value={0} />

            <SectionHeaderRow label="Operating Expenses ($000)" colSpan={totalCols} />
            <DataRow label="Utilities" values={proForma.map((yr) => yr.utilityCost)} year0Value={0} />
            <DataRow label="Feedstock" values={proForma.map((yr) => yr.feedstockCost)} year0Value={0} />
            <DataRow label="Labor" values={proForma.map((yr) => yr.laborCost)} year0Value={0} />
            <DataRow label="Maintenance" values={proForma.map((yr) => yr.maintenanceCost)} year0Value={0} />
            <DataRow label="Chemicals" values={proForma.map((yr) => yr.chemicalCost)} year0Value={0} />
            <DataRow label="Insurance" values={proForma.map((yr) => yr.insuranceCost)} year0Value={0} />
            <DataRow label="Digestate Management" values={proForma.map((yr) => yr.digestateManagementCost || 0)} year0Value={0} />
            <DataRow label="Admin & Overhead" values={proForma.map((yr) => yr.adminOverheadCost || 0)} year0Value={0} />
            <DataRow label="= Total OpEx" values={proForma.map((yr) => yr.totalOpex)} isBold year0Value={0} />

            <SectionHeaderRow label="Cash Flow ($000)" colSpan={totalCols} />
            <DataRow label="EBITDA" values={proForma.map((yr) => yr.ebitda)} isBold year0Value={0} />
            <DataRow label="(-) Maintenance CapEx" values={proForma.map((yr) => -yr.maintenanceCapex)} year0Value={0} />
            <DataRow label="(-) Debt Service" values={proForma.map((yr) => -yr.debtService)} year0Value={0} />
            <DataRow label="(-) CapEx" values={proForma.map(() => 0)} year0Value={-capexTotal} />
            <DataRow label="(+) ITC Proceeds" values={proForma.map(() => 0)} year0Value={itcProceeds} />
            <DataRow label="= Net Cash Flow" values={proForma.map((yr) => yr.netCashFlow)} isBold year0Value={-capexTotal + itcProceeds} />
            <DataRow label="Cumulative Cash Flow" values={proForma.map((yr) => yr.cumulativeCashFlow)} isBold year0Value={-capexTotal + itcProceeds} />
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function FinancialModelPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-6xl mx-auto p-6">
        <FinancialModelContent scenarioId={id} />
      </div>
    </div>
  );
}
