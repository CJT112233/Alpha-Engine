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
  Droplets,
  Factory,
  Gauge,
  Lock,
  Unlock,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flame,
  Zap,
  Truck,
  Scissors,
  Beaker,
  Filter,
  Wind,
  Pencil,
  Check,
  X,
  DollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Users,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useState, useRef, useEffect, Fragment } from "react";
import { ElapsedTimer } from "@/components/elapsed-timer";
import type { MassBalanceRun, MassBalanceResults, CalculationStep, TreatmentStage, EquipmentItem, StreamData, ADProcessStage, MassBalanceOverrides, VendorList, VendorListItem } from "@shared/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function formatNum(val: number | undefined, decimals: number = 1): string {
  if (val === undefined || val === null) return "\u2014";
  return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function resolveValue(fieldKey: string, originalValue: string, overrides: MassBalanceOverrides): string {
  const override = overrides[fieldKey];
  if (override && override.value !== undefined) return String(override.value);
  return originalValue;
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
          className={compact ? "h-7 text-xs w-20" : "h-8 text-sm w-24"}
          data-testid={`input-edit-${fieldKey}`}
        />
        {unit && <span className={compact ? "text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>{unit}</span>}
        <Button size="icon" variant="ghost" onClick={handleSave} className="h-6 w-6" data-testid={`button-save-${fieldKey}`}>
          <Check className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" onClick={handleCancel} className="h-6 w-6" data-testid={`button-cancel-${fieldKey}`}>
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
            className="h-5 w-5 invisible group-hover:visible"
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
            className="h-5 w-5"
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

function EditableTableCell({
  fieldKey,
  displayValue,
  decimals,
  isLocked,
  isOverridden,
  onSaveOverride,
  onToggleLock,
  overrideValue,
}: {
  fieldKey: string;
  displayValue: number | undefined;
  decimals?: number;
  isLocked: boolean;
  isOverridden: boolean;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
  onToggleLock: (key: string, currentValue?: string) => void;
  overrideValue?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const formatted = overrideValue !== undefined ? overrideValue : formatNum(displayValue, decimals);
  const [editValue, setEditValue] = useState(formatted);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setEditValue(formatted);
  }, [formatted, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editValue.trim() && editValue !== formatted) {
      onSaveOverride(fieldKey, editValue.trim(), formatted);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(formatted);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleCancel();
  };

  if (isEditing) {
    return (
      <TableCell className="text-center p-1">
        <div className="flex items-center justify-center gap-0.5">
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-6 text-xs w-16 text-center"
            data-testid={`input-edit-${fieldKey}`}
          />
          <Button size="icon" variant="ghost" onClick={handleSave} className="h-5 w-5" data-testid={`button-save-${fieldKey}`}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" onClick={handleCancel} className="h-5 w-5" data-testid={`button-cancel-${fieldKey}`}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    );
  }

  return (
    <TableCell
      className={`text-center cursor-pointer group/cell relative ${isOverridden ? "text-blue-600 dark:text-blue-400 font-medium" : ""}`}
      data-testid={`cell-${fieldKey}`}
    >
      <div className="flex items-center justify-center gap-0.5">
        <span onClick={() => { setEditValue(formatted); setIsEditing(true); }}>{formatted}</span>
        <div className="flex items-center gap-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-4 w-4 invisible group-hover/cell:visible"
            onClick={() => { setEditValue(formatted); setIsEditing(true); }}
          >
            <Pencil className="h-2.5 w-2.5" />
          </Button>
          {isLocked ? (
            <Button size="icon" variant="ghost" className="h-4 w-4" onClick={() => onToggleLock(fieldKey, formatted)}>
              <Lock className="h-2.5 w-2.5 text-amber-500" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="h-4 w-4 invisible group-hover/cell:visible"
              onClick={() => onToggleLock(fieldKey, formatted)}
            >
              <Unlock className="h-2.5 w-2.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
    </TableCell>
  );
}

function StreamTable({ stages, overrides, locks, onSaveOverride, onToggleLock }: {
  stages: TreatmentStage[];
  overrides: MassBalanceOverrides;
  locks: Record<string, boolean>;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
  onToggleLock: (key: string, currentValue?: string) => void;
}) {
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
            {stages.map((stage, i) => {
              const inKey = `stages.${i}.influent.flow`;
              const outKey = `stages.${i}.effluent.flow`;
              return (
                <>
                  <EditableTableCell
                    key={`f-in-${i}`}
                    fieldKey={inKey}
                    displayValue={stage.influent.flow}
                    decimals={4}
                    isLocked={!!locks[inKey]}
                    isOverridden={!!overrides[inKey]}
                    onSaveOverride={onSaveOverride}
                    onToggleLock={onToggleLock}
                    overrideValue={overrides[inKey]?.value !== undefined ? String(overrides[inKey].value) : undefined}
                  />
                  <EditableTableCell
                    key={`f-out-${i}`}
                    fieldKey={outKey}
                    displayValue={stage.effluent.flow}
                    decimals={4}
                    isLocked={!!locks[outKey]}
                    isOverridden={!!overrides[outKey]}
                    onSaveOverride={onSaveOverride}
                    onToggleLock={onToggleLock}
                    overrideValue={overrides[outKey]?.value !== undefined ? String(overrides[outKey].value) : undefined}
                  />
                </>
              );
            })}
          </TableRow>
          {params.map(p => (
            <TableRow key={p}>
              <TableCell className="font-medium">{paramLabels[p]}</TableCell>
              {stages.map((stage, i) => {
                const inVal = stage.influent[p as keyof StreamData] as number;
                const outVal = stage.effluent[p as keyof StreamData] as number;
                const inKey = `stages.${i}.influent.${p}`;
                const outKey = `stages.${i}.effluent.${p}`;
                return (
                  <>
                    <EditableTableCell
                      key={`${p}-in-${i}`}
                      fieldKey={inKey}
                      displayValue={inVal}
                      isLocked={!!locks[inKey]}
                      isOverridden={!!overrides[inKey]}
                      onSaveOverride={onSaveOverride}
                      onToggleLock={onToggleLock}
                      overrideValue={overrides[inKey]?.value !== undefined ? String(overrides[inKey].value) : undefined}
                    />
                    <EditableTableCell
                      key={`${p}-out-${i}`}
                      fieldKey={outKey}
                      displayValue={outVal}
                      isLocked={!!locks[outKey]}
                      isOverridden={!!overrides[outKey]}
                      onSaveOverride={onSaveOverride}
                      onToggleLock={onToggleLock}
                      overrideValue={overrides[outKey]?.value !== undefined ? String(overrides[outKey].value) : undefined}
                    />
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

function ADStagesTable({ adStages, overrides, locks, onSaveOverride, onToggleLock }: {
  adStages: ADProcessStage[];
  overrides: MassBalanceOverrides;
  locks: Record<string, boolean>;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
  onToggleLock: (key: string, currentValue?: string) => void;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!adStages || adStages.length === 0) return null;

  return (
    <div className="space-y-3">
      {adStages.map((stage, idx) => {
        const isExpanded = expandedIndex === idx;
        const stageIcon = stage.type === "digester" ? <Flame className="h-4 w-4" /> :
                          stage.type === "gasUpgrading" ? <Zap className="h-4 w-4" /> :
                          stage.type === "receiving" ? <Truck className="h-4 w-4" /> :
                          stage.type === "maceration" ? <Scissors className="h-4 w-4" /> :
                          stage.type === "equalization" ? <Beaker className="h-4 w-4" /> :
                          stage.type === "solidsSeparation" ? <Filter className="h-4 w-4" /> :
                          stage.type === "daf" ? <Droplets className="h-4 w-4" /> :
                          stage.type === "gasConditioning" ? <Wind className="h-4 w-4" /> :
                          <Factory className="h-4 w-4" />;
        const notes = stage.notes || [];
        const inputStream = stage.inputStream || {};
        const outputStream = stage.outputStream || {};
        const designCriteria = stage.designCriteria || {};

        return (
          <Card key={idx} data-testid={`card-ad-stage-${idx}`}>
            <div
              className="flex items-center gap-3 p-3 cursor-pointer hover-elevate"
              onClick={() => setExpandedIndex(isExpanded ? null : idx)}
              data-testid={`button-expand-ad-stage-${idx}`}
            >
              {stageIcon}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{stage.name}</span>
                  <Badge variant="outline" className="text-xs">{stage.type}</Badge>
                </div>
                {notes.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{notes[0]}</p>
                )}
              </div>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
            {isExpanded && (
              <CardContent className="pt-0 pb-3 px-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  {Object.keys(inputStream).length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Input Stream</h4>
                      <div className="space-y-1">
                        {Object.entries(inputStream).map(([key, val]) => {
                          const fieldKey = `adStages.${idx}.inputStream.${key}`;
                          const rawStr = typeof val?.value === 'number' ? val.value.toLocaleString() : String(val?.value ?? "");
                          const valStr = resolveValue(fieldKey, rawStr, overrides);
                          return (
                            <div key={key} className="flex items-center justify-between text-sm rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">{formatLabel(key)}</span>
                              <EditableValue
                                fieldKey={fieldKey}
                                displayValue={valStr}
                                unit={val?.unit}
                                isLocked={!!locks[fieldKey]}
                                isOverridden={!!overrides[fieldKey]}
                                onSaveOverride={onSaveOverride}
                                onToggleLock={onToggleLock}
                                compact
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {Object.keys(outputStream).length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Output Stream</h4>
                      <div className="space-y-1">
                        {Object.entries(outputStream).map(([key, val]) => {
                          const fieldKey = `adStages.${idx}.outputStream.${key}`;
                          const rawStr = typeof val?.value === 'number' ? val.value.toLocaleString() : String(val?.value ?? "");
                          const valStr = resolveValue(fieldKey, rawStr, overrides);
                          return (
                            <div key={key} className="flex items-center justify-between text-sm rounded-md bg-muted/40 px-2 py-1">
                              <span className="text-muted-foreground">{formatLabel(key)}</span>
                              <EditableValue
                                fieldKey={fieldKey}
                                displayValue={valStr}
                                unit={val?.unit}
                                isLocked={!!locks[fieldKey]}
                                isOverridden={!!overrides[fieldKey]}
                                onSaveOverride={onSaveOverride}
                                onToggleLock={onToggleLock}
                                compact
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {Object.keys(designCriteria).length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Design Criteria</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {Object.entries(designCriteria).map(([key, val]) => {
                        const fieldKey = `adStages.${idx}.designCriteria.${key}`;
                        const rawStr = String(val?.value ?? "");
                        const valStr = resolveValue(fieldKey, rawStr, overrides);
                        return (
                          <div key={key} className="rounded-md bg-muted/40 p-2">
                            <div className="text-xs text-muted-foreground">{formatLabel(key)}</div>
                            <EditableValue
                              fieldKey={fieldKey}
                              displayValue={valStr}
                              unit={val?.unit}
                              isLocked={!!locks[fieldKey]}
                              isOverridden={!!overrides[fieldKey]}
                              onSaveOverride={onSaveOverride}
                              onToggleLock={onToggleLock}
                              compact
                            />
                            {val?.source && !overrides[fieldKey] && (
                              <div className="text-xs text-muted-foreground">{val.source}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {notes.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {notes.map((note, ni) => (
                      <div key={ni} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Info className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{note}</span>
                      </div>
                    ))}
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

const SOLIDS_LIQUIDS_TYPES = new Set(["receiving", "maceration", "equalization", "digester", "sludgeThickening", "biogasInlet"]);
const LIQUID_DIGESTATE_TYPES = new Set(["solidsSeparation", "daf", "dewatering"]);
const GAS_TYPES = new Set(["gasConditioning", "gasUpgrading"]);

function ADStageSubTable({ title, icon, testId, stageEntries, allAdStages, overrides, locks, onSaveOverride, onToggleLock }: {
  title: string;
  icon: React.ReactNode;
  testId: string;
  stageEntries: { stage: ADProcessStage; originalIndex: number }[];
  allAdStages: ADProcessStage[];
  overrides: MassBalanceOverrides;
  locks: Record<string, boolean>;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
  onToggleLock: (key: string, currentValue?: string) => void;
}) {
  const paramKeys = new Set<string>();
  stageEntries.forEach(({ stage }) => {
    Object.keys(stage.inputStream || {}).forEach(k => paramKeys.add(k));
    Object.keys(stage.outputStream || {}).forEach(k => paramKeys.add(k));
  });
  const sortedParams = Array.from(paramKeys).sort();

  if (sortedParams.length === 0) return null;

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table data-testid={`table-${testId}`}>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px] sticky left-0 bg-background z-10">Parameter</TableHead>
                {stageEntries.map(({ stage }, i) => (
                  <TableHead key={i} className="text-center min-w-[100px]" colSpan={2}>
                    {stage.name}
                  </TableHead>
                ))}
              </TableRow>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-10" />
                {stageEntries.map((_, i) => (
                  <Fragment key={`subhdr-${i}`}>
                    <TableHead className="text-center text-xs text-muted-foreground">In</TableHead>
                    <TableHead className="text-center text-xs text-muted-foreground">Out</TableHead>
                  </Fragment>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedParams.map(paramKey => (
                <TableRow key={paramKey}>
                  <TableCell className="font-medium sticky left-0 bg-background z-10">
                    {formatLabel(paramKey)}
                    {stageEntries.some(({ stage }) => (stage.inputStream?.[paramKey]?.unit || stage.outputStream?.[paramKey]?.unit)) && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({stageEntries.find(({ stage }) => stage.inputStream?.[paramKey]?.unit || stage.outputStream?.[paramKey]?.unit)?.stage.inputStream?.[paramKey]?.unit ||
                          stageEntries.find(({ stage }) => stage.outputStream?.[paramKey]?.unit)?.stage.outputStream?.[paramKey]?.unit || ""})
                      </span>
                    )}
                  </TableCell>
                  {stageEntries.map(({ stage, originalIndex }) => {
                    const inVal = stage.inputStream?.[paramKey];
                    const outVal = stage.outputStream?.[paramKey];
                    const inFieldKey = `adStages.${originalIndex}.inputStream.${paramKey}`;
                    const outFieldKey = `adStages.${originalIndex}.outputStream.${paramKey}`;
                    const inIsNumeric = inVal?.value !== undefined && typeof inVal.value === 'number';
                    const outIsNumeric = outVal?.value !== undefined && typeof outVal.value === 'number';
                    const inOverride = overrides[inFieldKey];
                    const outOverride = overrides[outFieldKey];
                    const inResolvedNum = inOverride ? parseFloat(String(inOverride.value)) : (inIsNumeric ? (inVal.value as number) : undefined);
                    const outResolvedNum = outOverride ? parseFloat(String(outOverride.value)) : (outIsNumeric ? (outVal.value as number) : undefined);
                    const inDisplay = inOverride ? String(inOverride.value) : (inVal?.value !== undefined ? (inIsNumeric ? (inVal.value as number).toLocaleString() : String(inVal.value)) : "\u2014");
                    const outDisplay = outOverride ? String(outOverride.value) : (outVal?.value !== undefined ? (outIsNumeric ? (outVal.value as number).toLocaleString() : String(outVal.value)) : "\u2014");
                    return (
                      <Fragment key={`${paramKey}-${originalIndex}`}>
                        {(inIsNumeric || inOverride) && inResolvedNum !== undefined && !isNaN(inResolvedNum) ? (
                          <EditableTableCell
                            fieldKey={inFieldKey}
                            displayValue={inResolvedNum}
                            decimals={1}
                            isLocked={!!locks[inFieldKey]}
                            isOverridden={!!overrides[inFieldKey]}
                            onSaveOverride={onSaveOverride}
                            onToggleLock={onToggleLock}
                            overrideValue={inOverride?.value !== undefined ? String(inOverride.value) : undefined}
                          />
                        ) : (
                          <TableCell className="text-center text-muted-foreground">{inDisplay}</TableCell>
                        )}
                        {(outIsNumeric || outOverride) && outResolvedNum !== undefined && !isNaN(outResolvedNum) ? (
                          <EditableTableCell
                            fieldKey={outFieldKey}
                            displayValue={outResolvedNum}
                            decimals={1}
                            isLocked={!!locks[outFieldKey]}
                            isOverridden={!!overrides[outFieldKey]}
                            onSaveOverride={onSaveOverride}
                            onToggleLock={onToggleLock}
                            overrideValue={outOverride?.value !== undefined ? String(outOverride.value) : undefined}
                          />
                        ) : (
                          <TableCell className="text-center text-muted-foreground">{outDisplay}</TableCell>
                        )}
                      </Fragment>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function MassBalanceOutputsTable({ results, overrides, locks, onSaveOverride, onToggleLock }: {
  results: MassBalanceResults;
  overrides: MassBalanceOverrides;
  locks: Record<string, boolean>;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
  onToggleLock: (key: string, currentValue?: string) => void;
}) {
  const stages = results.stages || [];
  const adStages = results.adStages || [];
  const hasWW = stages.length > 0;
  const hasAD = adStages.length > 0;

  if (!hasWW && !hasAD) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
          <Factory className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No mass balance output data available.</p>
        </CardContent>
      </Card>
    );
  }

  const wwParams = ["flow", "bod", "cod", "tss", "tkn", "tp", "fog"] as const;
  const wwParamLabels: Record<string, string> = {
    flow: "Flow (MGD)",
    bod: "BOD (mg/L)",
    cod: "COD (mg/L)",
    tss: "TSS (mg/L)",
    tkn: "TKN (mg/L)",
    tp: "TP (mg/L)",
    fog: "FOG (mg/L)",
  };

  const solidsLiquidsStages: { stage: ADProcessStage; originalIndex: number }[] = [];
  const liquidDigestateStages: { stage: ADProcessStage; originalIndex: number }[] = [];
  const gasStages: { stage: ADProcessStage; originalIndex: number }[] = [];
  const uncategorizedStages: { stage: ADProcessStage; originalIndex: number }[] = [];

  adStages.forEach((stage, i) => {
    const entry = { stage, originalIndex: i };
    if (SOLIDS_LIQUIDS_TYPES.has(stage.type)) {
      solidsLiquidsStages.push(entry);
    } else if (LIQUID_DIGESTATE_TYPES.has(stage.type)) {
      liquidDigestateStages.push(entry);
    } else if (GAS_TYPES.has(stage.type)) {
      gasStages.push(entry);
    } else {
      uncategorizedStages.push(entry);
    }
  });

  const hasSplitTables = solidsLiquidsStages.length > 0 || liquidDigestateStages.length > 0 || gasStages.length > 0;
  const showSingleTable = hasAD && !hasSplitTables;

  return (
    <div className="space-y-4">
      {hasWW && (
        <Card data-testid="card-outputs-ww">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Droplets className="h-4 w-4" /> Wastewater Treatment Mass Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-outputs-ww">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px] sticky left-0 bg-background z-10">Parameter</TableHead>
                    <TableHead className="text-center min-w-[90px]">Influent</TableHead>
                    {stages.map((stage, i) => (
                      <TableHead key={i} className="text-center min-w-[90px]">{stage.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wwParams.map(p => (
                    <TableRow key={p}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{wwParamLabels[p]}</TableCell>
                      {stages.length > 0 ? (
                        (() => {
                          const val = stages[0].influent[p as keyof StreamData] as number;
                          const fieldKey = `stages.0.influent.${p}`;
                          return (
                            <EditableTableCell
                              fieldKey={fieldKey}
                              displayValue={val}
                              decimals={p === "flow" ? 4 : 1}
                              isLocked={!!locks[fieldKey]}
                              isOverridden={!!overrides[fieldKey]}
                              onSaveOverride={onSaveOverride}
                              onToggleLock={onToggleLock}
                              overrideValue={overrides[fieldKey]?.value !== undefined ? String(overrides[fieldKey].value) : undefined}
                            />
                          );
                        })()
                      ) : (
                        <TableCell className="text-center text-muted-foreground">{"\u2014"}</TableCell>
                      )}
                      {stages.map((stage, i) => {
                        const val = stage.effluent[p as keyof StreamData] as number;
                        const fieldKey = `stages.${i}.effluent.${p}`;
                        return (
                          <EditableTableCell
                            key={i}
                            fieldKey={fieldKey}
                            displayValue={val}
                            decimals={p === "flow" ? 4 : 1}
                            isLocked={!!locks[fieldKey]}
                            isOverridden={!!overrides[fieldKey]}
                            onSaveOverride={onSaveOverride}
                            onToggleLock={onToggleLock}
                            overrideValue={overrides[fieldKey]?.value !== undefined ? String(overrides[fieldKey].value) : undefined}
                          />
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {hasSplitTables && (
        <>
          {solidsLiquidsStages.length > 0 && (
            <ADStageSubTable
              title="Solids & Liquids (Feed through Digester)"
              icon={<Beaker className="h-4 w-4" />}
              testId="card-outputs-solids-liquids"
              stageEntries={solidsLiquidsStages}
              allAdStages={adStages}
              overrides={overrides}
              locks={locks}
              onSaveOverride={onSaveOverride}
              onToggleLock={onToggleLock}
            />
          )}
          {liquidDigestateStages.length > 0 && (
            <ADStageSubTable
              title="Liquid Digestate"
              icon={<Droplets className="h-4 w-4" />}
              testId="card-outputs-liquid-digestate"
              stageEntries={liquidDigestateStages}
              allAdStages={adStages}
              overrides={overrides}
              locks={locks}
              onSaveOverride={onSaveOverride}
              onToggleLock={onToggleLock}
            />
          )}
          {gasStages.length > 0 && (
            <ADStageSubTable
              title="Gas Train"
              icon={<Wind className="h-4 w-4" />}
              testId="card-outputs-gas"
              stageEntries={gasStages}
              allAdStages={adStages}
              overrides={overrides}
              locks={locks}
              onSaveOverride={onSaveOverride}
              onToggleLock={onToggleLock}
            />
          )}
          {uncategorizedStages.length > 0 && (
            <ADStageSubTable
              title="Other Process Stages"
              icon={<Factory className="h-4 w-4" />}
              testId="card-outputs-other"
              stageEntries={uncategorizedStages}
              allAdStages={adStages}
              overrides={overrides}
              locks={locks}
              onSaveOverride={onSaveOverride}
              onToggleLock={onToggleLock}
            />
          )}
        </>
      )}

      {showSingleTable && (
        <ADStageSubTable
          title="Process Mass Balance"
          icon={<Flame className="h-4 w-4" />}
          testId="card-outputs-ad"
          stageEntries={adStages.map((stage, i) => ({ stage, originalIndex: i }))}
          allAdStages={adStages}
          overrides={overrides}
          locks={locks}
          onSaveOverride={onSaveOverride}
          onToggleLock={onToggleLock}
        />
      )}
    </div>
  );
}

function StatsCard({ summary, overrides, locks, onSaveOverride, onToggleLock }: {
  summary: Record<string, { value: string; unit: string }> | undefined;
  overrides: MassBalanceOverrides;
  locks: Record<string, boolean>;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
  onToggleLock: (key: string, currentValue?: string) => void;
}) {
  if (!summary || Object.keys(summary).length === 0) return null;
  const summaryLabels: Record<string, string> = {
    totalFeedRate: "Total Feed Rate",
    totalVSLoad: "Total VS Load",
    biogasProduction: "Biogas Production",
    biogasFlowSCFM: "Biogas Flow",
    rngProduction: "RNG Production",
    rngProductionAnnual: "RNG Production (Annual)",
    rngFlowSCFM: "RNG Flow",
    rngEnergy: "RNG Energy",
    rngEnergyGJ: "RNG Energy (GJ)",
    digesterVolume: "Digester Volume",
    electricalDemand: "Electrical Demand",
    solidDigestate: "Solid Digestate",
    liquidFiltrate: "Liquid Filtrate",
    biogasInletFlow: "Biogas Inlet Flow",
    biogasInletCH4: "Inlet CH\u2084",
    biogasInletH2S: "Inlet H\u2082S",
    rngProductionDaily: "RNG Production (daily)",
    rngCH4Purity: "RNG CH\u2084 Purity",
    methaneRecovery: "Methane Recovery",
    tailgasFlow: "Tail Gas Flow",
    wastewaterFlow: "Wastewater Flow",
    wwTreatmentStages: "WW Treatment Stages",
    wwSludgeVS: "WW Sludge VS",
    truckedFeedstockVS: "Trucked Feedstock VS",
    biosolidsCake: "Biosolids Cake",
  };

  return (
    <Card data-testid="card-stats">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Project Stats</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Object.entries(summary).map(([key, val]) => {
            const fieldKey = `summary.${key}`;
            const rawVal = val.value;
            const originalVal = (rawVal !== null && typeof rawVal === "object" && "value" in (rawVal as any)) ? String((rawVal as any).value) : String(rawVal ?? "");
            const displayVal = resolveValue(fieldKey, originalVal, overrides);
            const displayUnit = val.unit || ((rawVal !== null && typeof rawVal === "object" && "unit" in (rawVal as any)) ? (rawVal as any).unit : "");
            return (
              <div key={key} className="rounded-md bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">{summaryLabels[key] || formatLabel(key)}</div>
                <div className="mt-1">
                  <EditableValue
                    fieldKey={fieldKey}
                    displayValue={displayVal}
                    unit={displayUnit}
                    isLocked={!!locks[fieldKey]}
                    isOverridden={!!overrides[fieldKey]}
                    onSaveOverride={onSaveOverride}
                    onToggleLock={onToggleLock}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function formatLabel(camelCase: string): string {
  return camelCase
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, s => s.toUpperCase())
    .replace(/\bScfm\b/gi, "SCFM")
    .replace(/\bCh4\b/gi, "CH\u2084")
    .replace(/\bCo2\b/gi, "CO\u2082")
    .replace(/\bH2s\b/gi, "H\u2082S")
    .replace(/\bTs\b/gi, "TS")
    .replace(/\bVs\b/gi, "VS")
    .replace(/\bRng\b/gi, "RNG")
    .replace(/\bMgd\b/gi, "MGD")
    .replace(/\bMm Btu\b/gi, "MMBtu")
    .replace(/\bGj\b/gi, "GJ")
    .replace(/\bWw\b/gi, "WW")
    .trim();
}

function EquipmentTable({ equipment, locks, overrides, onToggleLock, onSaveOverride }: {
  equipment: EquipmentItem[];
  locks: Record<string, boolean>;
  overrides: MassBalanceOverrides;
  onToggleLock: (key: string, currentValue?: string) => void;
  onSaveOverride: (key: string, value: string, originalValue: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {equipment.map((eq) => {
        const isExpanded = expandedId === eq.id;
        const eqLockKey = `equipment.${eq.id}`;
        const isLocked = locks[eqLockKey] || locks[eq.id] || eq.isLocked;

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
                  {Object.entries(eq.specs).map(([key, spec]) => {
                    const fieldKey = `equipment.${eq.id}.specs.${key}`;
                    const rawVal = spec.value;
                    const originalVal = (rawVal !== null && typeof rawVal === "object" && "value" in rawVal) ? String((rawVal as any).value) : String(rawVal ?? "");
                    const displayVal = resolveValue(fieldKey, originalVal, overrides);
                    const displayUnit = spec.unit || ((rawVal !== null && typeof rawVal === "object" && "unit" in rawVal) ? (rawVal as any).unit : "");
                    return (
                      <div key={key} className="rounded-md bg-muted/40 p-2">
                        <div className="text-xs text-muted-foreground">{formatLabel(key)}</div>
                        <EditableValue
                          fieldKey={fieldKey}
                          displayValue={displayVal}
                          unit={displayUnit}
                          isLocked={!!locks[fieldKey]}
                          isOverridden={!!overrides[fieldKey]}
                          onSaveOverride={onSaveOverride}
                          onToggleLock={onToggleLock}
                          compact
                        />
                      </div>
                    );
                  })}
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

function VendorListSection({ vendorList, scenarioId, isGenerating, onGenerate }: {
  vendorList: VendorList | null | undefined;
  scenarioId: string;
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  if (!vendorList || !vendorList.items || vendorList.items.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Recommended Vendor List
            </CardTitle>
            <Button
              onClick={onGenerate}
              disabled={isGenerating}
              size="sm"
              data-testid="button-generate-vendor-list"
            >
              {isGenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Users className="h-4 w-4 mr-2" /> Generate Vendor List</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {isGenerating
              ? "AI is generating vendor recommendations for each equipment item..."
              : "Click \"Generate Vendor List\" to get manufacturer recommendations for each equipment item."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Recommended Vendor List
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs" data-testid="badge-vendor-model">
              {vendorList.modelUsed}
            </Badge>
            <Badge variant="outline" className="text-xs" data-testid="badge-vendor-count">
              {vendorList.items.length} items
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-vendor-export">
                  <Download className="h-4 w-4 mr-2" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  data-testid="button-export-vendor-pdf"
                  onClick={() => window.open(`/api/scenarios/${scenarioId}/vendor-list/export-pdf`, "_blank")}
                >
                  <FileText className="h-4 w-4 mr-2" /> Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="button-export-vendor-excel"
                  onClick={() => window.open(`/api/scenarios/${scenarioId}/vendor-list/export-excel`, "_blank")}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={onGenerate}
              disabled={isGenerating}
              variant="outline"
              size="sm"
              data-testid="button-regenerate-vendor-list"
            >
              {isGenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Regenerating...</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" /> Regenerate</>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {vendorList.items.map((item, idx) => (
          <div key={idx} className="border rounded-lg overflow-hidden" data-testid={`vendor-item-${idx}`}>
            <div className="bg-muted/40 px-3 py-2 flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{item.equipmentType}</span>
              <Badge variant="outline" className="text-xs">{item.process}</Badge>
              <Badge variant="secondary" className="text-xs">Qty: {item.quantity}</Badge>
            </div>
            {item.specsSummary && (
              <div className="px-3 py-1 text-xs text-muted-foreground border-b">
                {item.specsSummary}
              </div>
            )}
            <div className="divide-y">
              {item.recommendations.map((rec, rIdx) => (
                <div key={rIdx} className="px-3 py-3 space-y-2" data-testid={`vendor-rec-${idx}-${rIdx}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="outline" className="text-xs font-normal">{rIdx + 1}</Badge>
                    <span className="font-semibold text-sm">{rec.manufacturer}</span>
                    <span className="text-sm text-muted-foreground">{rec.modelNumber}</span>
                    {(rec.websiteUrl || rec.specSheetUrl) && (
                      <a
                        href={rec.websiteUrl || rec.specSheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 text-xs"
                        data-testid={`link-vendor-${idx}-${rIdx}`}
                      >
                        Visit <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {rec.notes && (
                    <p className="text-xs text-muted-foreground">{rec.notes}</p>
                  )}
                  {(rec.strengths || rec.weaknesses || rec.considerations) && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      {rec.strengths && (
                        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded p-2" data-testid={`vendor-strengths-${idx}-${rIdx}`}>
                          <span className="font-semibold text-green-700 dark:text-green-400 block mb-0.5">Strengths</span>
                          <span className="text-green-800 dark:text-green-300">{rec.strengths}</span>
                        </div>
                      )}
                      {rec.weaknesses && (
                        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded p-2" data-testid={`vendor-weaknesses-${idx}-${rIdx}`}>
                          <span className="font-semibold text-red-700 dark:text-red-400 block mb-0.5">Weaknesses</span>
                          <span className="text-red-800 dark:text-red-300">{rec.weaknesses}</span>
                        </div>
                      )}
                      {rec.considerations && (
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2" data-testid={`vendor-considerations-${idx}-${rIdx}`}>
                          <span className="font-semibold text-amber-700 dark:text-amber-400 block mb-0.5">Considerations</span>
                          <span className="text-amber-800 dark:text-amber-300">{rec.considerations}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function WarningsList({ warnings }: { warnings: MassBalanceResults["warnings"] }) {
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

function CalculationStepsList({ steps }: { steps: CalculationStep[] }) {
  if (!steps || steps.length === 0) return null;

  const categories = [...new Set(steps.map(s => s.category))];

  return (
    <div className="space-y-6" data-testid="calculation-steps">
      {categories.map((cat) => (
        <div key={cat}>
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2" data-testid={`calc-category-${cat}`}>
            <Beaker className="h-4 w-4" />
            {cat}
          </h4>
          <div className="space-y-3">
            {steps.filter(s => s.category === cat).map((step, i) => (
              <div key={i} className="border rounded-lg p-3 bg-muted/30" data-testid={`calc-step-${i}`}>
                <div className="flex items-start justify-between gap-4 mb-1">
                  <span className="text-sm font-medium">{step.label}</span>
                  <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                    {step.result.value} {step.result.unit}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mb-1.5 font-mono bg-background/60 rounded px-2 py-1">
                  {step.formula}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {step.inputs.map((inp, j) => (
                    <span key={j} className="text-xs text-muted-foreground">
                      <span className="font-medium">{inp.name}:</span> {inp.value} {inp.unit}
                    </span>
                  ))}
                </div>
                {step.notes && (
                  <div className="text-xs text-muted-foreground mt-1 italic">{step.notes}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function getProjectTypeLabel(pt: string | undefined): string {
  if (!pt) return "Wastewater Treatment";
  switch (pt) {
    case "A": return "Type A \u2014 Wastewater Treatment";
    case "B": return "Type B \u2014 RNG Greenfield";
    case "C": return "Type C \u2014 RNG Bolt-On";
    case "D": return "Type D \u2014 Hybrid";
    default: return pt;
  }
}

function getProjectTypeDescription(pt: string | undefined): string {
  if (!pt) return "Deterministic treatment train calculation";
  switch (pt) {
    case "B": return "Feedstock \u2192 Anaerobic Digestion \u2192 Biogas \u2192 Gas Conditioning \u2192 RNG";
    case "C": return "Existing Biogas \u2192 Gas Conditioning \u2192 RNG Upgrading \u2192 Pipeline";
    case "D": return "Wastewater Treatment + Sludge \u2192 AD \u2192 Biogas \u2192 RNG";
    default: return "Deterministic treatment train calculation";
  }
}

export function MassBalanceContent({ scenarioId }: { scenarioId: string }) {
  const { toast } = useToast();

  const { data: runs, isLoading } = useQuery<MassBalanceRun[]>({
    queryKey: ["/api/scenarios", scenarioId, "mass-balance"],
  });

  const latestRun = runs?.[0];
  const results = latestRun?.results as MassBalanceResults | undefined;
  const locks = (latestRun?.locks || {}) as Record<string, boolean>;
  const overrides = (latestRun?.overrides || {}) as MassBalanceOverrides;
  const projectType = results?.projectType;
  const hasWWStages = (results?.stages?.length ?? 0) > 0;
  const hasADStages = (results?.adStages?.length ?? 0) > 0;
  const hasSummary = results?.summary && Object.keys(results.summary).length > 0;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);
      try {
        const res = await fetch(`/api/scenarios/${scenarioId}/mass-balance/generate`, {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          let errorMsg = res.statusText;
          try { const p = JSON.parse(text); errorMsg = p.error || p.message || text; } catch { errorMsg = text || res.statusText; }
          throw new Error(errorMsg);
        }
        return res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
      toast({ title: "Mass Balance Generated", description: "Calculation complete." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const RECALCULABLE_EXACT_KEYS = new Set([
    "summary.hrt", "summary.vsDestruction",
  ]);

  const RECALCULABLE_DESIGN_CRITERIA_SUFFIXES = new Set([
    "hrt", "olr", "vsDestruction", "temperature", "digesterVolume", "mixingPower",
    "retentionTime", "solidsCaptureEfficiency", "cakeSolids", "polymerDosing",
    "tssRemoval", "fogRemoval", "hydraulicLoading", "storageDays",
    "targetParticleSize", "depackagingRejectRate", "headspacePct",
    "gasYield", "ch4Content", "co2Content", "h2sContent", "preheatTemp",
    "targetTS", "thickenedSolids", "captureRate", "organicLoadingRate",
  ]);

  const isRecalculableField = (fieldKey: string): boolean => {
    if (RECALCULABLE_EXACT_KEYS.has(fieldKey)) return true;
    if (fieldKey.includes("designCriteria.")) {
      const lastPart = fieldKey.split(".").pop() || "";
      return RECALCULABLE_DESIGN_CRITERIA_SUFFIXES.has(lastPart);
    }
    return false;
  };

  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);
      try {
        const res = await fetch(`/api/mass-balance/${latestRun!.id}/recompute`, {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          let errorMsg = res.statusText;
          try { const p = JSON.parse(text); errorMsg = p.error || p.message || text; } catch { errorMsg = text || res.statusText; }
          throw new Error(errorMsg);
        }
        return res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
      toast({ title: "Recomputed", description: "Mass balance recalculated. Locked values preserved." });
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

  const overrideMutation = useMutation({
    mutationFn: async (overrideData: { overrides: MassBalanceOverrides }) => {
      const res = await apiRequest("PATCH", `/api/mass-balance/${latestRun!.id}/overrides`, overrideData);
      return res.json();
    },
    onSuccess: (_data, variables, _ctx) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
      const fieldKey = Object.keys(variables.overrides)[0];
      if (!fieldKey || !isRecalculableField(fieldKey)) {
        toast({ title: "Value Updated", description: "Override saved. Lock the field to preserve it on recompute." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
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

  const vendorListMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scenarios/${scenarioId}/vendor-list/generate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "mass-balance"] });
      toast({ title: "Vendor List Generated", description: "Manufacturer recommendations are ready." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleToggleLock = (fieldKey: string, currentValue?: string) => {
    const isLocking = !locks[fieldKey];
    const newLocks = { [fieldKey]: isLocking };
    lockMutation.mutate(newLocks);

    if (isLocking && currentValue && !overrides[fieldKey]) {
      const overrideEntry: MassBalanceOverrides = {
        [fieldKey]: {
          value: currentValue,
          unit: "",
          overriddenBy: "user",
          reason: "Locked at current value",
          originalValue: currentValue,
        },
      };
      overrideMutation.mutate({ overrides: overrideEntry });
    }
  };

  const handleSaveOverride = (fieldKey: string, newValue: string, originalValue: string) => {
    const overrideEntry: MassBalanceOverrides = {
      [fieldKey]: {
        value: newValue,
        unit: "",
        overriddenBy: "user",
        reason: "Manual edit",
        originalValue,
      },
    };
    const shouldRecompute = isRecalculableField(fieldKey);
    overrideMutation.mutate(
      { overrides: overrideEntry },
      {
        onSuccess: () => {
          if (shouldRecompute) {
            toast({ title: "Design Input Changed", description: "Recalculating downstream values..." });
            recomputeMutation.mutate();
          }
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const hasOutputs = hasWWStages || hasADStages;

  const tabItems: { value: string; label: string }[] = [];
  tabItems.push({ value: "assumptions", label: "Assumptions" });
  if (hasSummary) tabItems.push({ value: "stats", label: "Stats" });
  if (hasADStages) tabItems.push({ value: "ad-process", label: "Process" });
  tabItems.push({ value: "equipment", label: `Equipment (${results?.equipment?.length || 0})` });
  if (hasOutputs) tabItems.push({ value: "outputs", label: "Outputs" });
  if (hasWWStages) tabItems.push({ value: "treatment-train", label: "Treatment Train" });

  const defaultTab = tabItems[0]?.value || "outputs";

  return (
    <div className="space-y-4">
      {latestRun && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {projectType && (
              <Badge variant="outline" data-testid="badge-project-type">
                {getProjectTypeLabel(projectType)}
              </Badge>
            )}
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
          <div className="flex items-center gap-2 flex-wrap">
            {latestRun.status !== "finalized" && (
              <Button
                onClick={() => statusMutation.mutate("finalized")}
                disabled={statusMutation.isPending}
                data-testid="button-finalize"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Finalize
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-export-mass-balance">
                  <Download className="h-4 w-4 mr-2" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="button-export-mb-pdf"
                  onClick={() => window.open(`/api/scenarios/${scenarioId}/mass-balance/export-pdf`, "_blank")}
                >
                  <FileText className="h-4 w-4 mr-2" /> Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="button-export-mb-excel"
                  onClick={() => window.open(`/api/scenarios/${scenarioId}/mass-balance/export-excel`, "_blank")}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Download Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {!latestRun ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Factory className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-medium">No Mass Balance Generated</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Generate a mass balance from the confirmed UPIF to see process stages and equipment sizing.
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
                  <><Gauge className="h-4 w-4 mr-2" /> Generate Mass Balance</>
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
            <Button
              variant="outline"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-new-version"
            >
              New Version
            </Button>
            <ElapsedTimer isRunning={generateMutation.isPending || recomputeMutation.isPending} />
          </div>

          {results && (
            <>
              <WarningsList warnings={results.warnings} />

              <Tabs defaultValue={defaultTab} className="w-full">
                <TabsList data-testid="tabs-mass-balance">
                  {tabItems.map(tab => (
                    <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {hasOutputs && results && (
                  <TabsContent value="outputs" className="mt-4">
                    <MassBalanceOutputsTable
                      results={results}
                      overrides={overrides}
                      locks={locks}
                      onSaveOverride={handleSaveOverride}
                      onToggleLock={handleToggleLock}
                    />
                  </TabsContent>
                )}

                {hasWWStages && (
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
                        <StreamTable
                          stages={results.stages}
                          overrides={overrides}
                          locks={locks}
                          onSaveOverride={handleSaveOverride}
                          onToggleLock={handleToggleLock}
                        />
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
                                        : "\u2014"}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}

                {hasADStages && results.adStages && (
                  <TabsContent value="ad-process" className="mt-4 space-y-4">
                    <ADStagesTable
                      adStages={results.adStages}
                      overrides={overrides}
                      locks={locks}
                      onSaveOverride={handleSaveOverride}
                      onToggleLock={handleToggleLock}
                    />
                  </TabsContent>
                )}

                <TabsContent value="equipment" className="mt-4 space-y-4">
                  {latestRun && latestRun.status === "finalized" && (
                    <VendorListSection
                      vendorList={latestRun.vendorList}
                      scenarioId={scenarioId}
                      isGenerating={vendorListMutation.isPending}
                      onGenerate={() => vendorListMutation.mutate()}
                    />
                  )}
                  <EquipmentTable
                    equipment={results.equipment}
                    locks={locks}
                    overrides={overrides}
                    onToggleLock={handleToggleLock}
                    onSaveOverride={handleSaveOverride}
                  />
                </TabsContent>

                {hasSummary && results.summary && (
                  <TabsContent value="stats" className="mt-4">
                    <StatsCard
                      summary={results.summary}
                      overrides={overrides}
                      locks={locks}
                      onSaveOverride={handleSaveOverride}
                      onToggleLock={handleToggleLock}
                    />
                  </TabsContent>
                )}

                <TabsContent value="assumptions" className="mt-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Design Assumptions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <AssumptionsList assumptions={results.assumptions} />
                    </CardContent>
                  </Card>
                  {results.calculationSteps && results.calculationSteps.length > 0 && (
                    <Card className="mt-4">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Calculation Steps</CardTitle>
                        <p className="text-xs text-muted-foreground">Step-by-step derivation of key results — follow along to verify any value</p>
                      </CardHeader>
                      <CardContent>
                        <CalculationStepsList steps={results.calculationSteps} />
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function MassBalancePage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/scenarios/${scenarioId}`}>
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <Droplets className="h-5 w-5" />
          Mass Balance & Equipment
        </h1>
      </div>
      <MassBalanceContent scenarioId={scenarioId!} />
    </div>
  );
}
