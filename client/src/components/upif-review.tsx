/**
 * Main UPIF review component — handles display, inline editing, per-field
 * confirmation/locking, AI-driven generation, and PDF export of the
 * Unified Project Intake Form.
 */

import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, CheckCircle2, AlertCircle, Edit2, Save, X, Beaker, MapPin, FileOutput, Settings2, Info, FlaskConical, Bug, Layers, Flame, Droplets, Leaf, Sparkles, Download, Lock, Unlock, Plus, Minus, Trash2, HelpCircle, MessageCircle, SkipForward } from "lucide-react";
import type { UpifRecord, FeedstockEntry, ConfirmedFields } from "@shared/schema";
import { feedstockGroupLabels, feedstockGroupOrder, type EnrichedFeedstockSpec } from "@shared/feedstock-library";
import { outputGroupLabels, outputGroupOrder, type EnrichedOutputSpec } from "@shared/output-criteria-library";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useCallback, useEffect } from "react";
import { AiThinking } from "@/components/ai-thinking";

// Number formatting helper — adds locale-aware thousand separators for display
function formatDisplayValue(val: string): string {
  if (!val) return val;
  return val.replace(/(?<![.\d])\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/g, (match) => {
    const num = Number(match.replace(/,/g, ""));
    if (isNaN(num)) return match;
    return num.toLocaleString();
  });
}

interface UpifReviewProps {
  scenarioId: string;
  upif: UpifRecord | undefined;
  isLoading: boolean;
  hasInputs: boolean;
  scenarioStatus: string;
  projectType?: string | null;
  projectTypeConfirmed?: boolean;
}

const upifFormSchema = z.object({
  outputRequirements: z.string().optional(),
  location: z.string().optional(),
  constraints: z.string().optional(),
});

type UpifFormValues = z.infer<typeof upifFormSchema>;

const groupIcons: Record<string, React.ReactNode> = {
  identity: <Layers className="h-3.5 w-3.5" />,
  physical: <Beaker className="h-3.5 w-3.5" />,
  biochemical: <FlaskConical className="h-3.5 w-3.5" />,
  contaminants: <Bug className="h-3.5 w-3.5" />,
  extended: <Settings2 className="h-3.5 w-3.5" />,
};

// Badge styling map for confidence level indicators (high/medium/low)
const confidenceBadgeClass: Record<string, string> = {
  high: "bg-green-500/10 text-green-700 dark:text-green-400",
  medium: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  low: "bg-red-500/10 text-red-700 dark:text-red-400",
};

// Lock/unlock toggle button for confirming individual UPIF fields
function ConfirmToggle({
  isConfirmed,
  onToggle,
  testId,
}: {
  isConfirmed: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={`toggle-elevate ${isConfirmed ? "toggle-elevated text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
          onClick={onToggle}
          data-testid={testId}
        >
          {isConfirmed ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p className="text-xs">{isConfirmed ? "Confirmed — locked from re-generation" : "Click to confirm and lock this value"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// Expandable/collapsible section wrapper used throughout the UPIF display
function CollapsibleSection({
  icon,
  title,
  children,
  defaultOpen = false,
  rightContent,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  rightContent?: React.ReactNode;
  testId: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="flex items-center justify-between w-full group cursor-pointer"
        onClick={() => setIsOpen(prev => !prev)}
        data-testid={testId}
      >
        <div className="flex items-center gap-2">
          {icon}
          <h4 className="font-medium text-sm">{title}</h4>
          {rightContent}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </div>
      </button>
      {isOpen && children}
    </div>
  );
}

/**
 * Table component for enriched feedstock design parameters.
 * Supports inline editing, deletion, confirmation toggles, and provenance tooltips.
 * Groups specs by category: identity, physical, biochemical, contaminants, extended.
 */
function FeedstockSpecsTable({
  specs,
  isEditing,
  onSpecUpdate,
  onNoteUpdate,
  onSpecDelete,
  deletedKeys,
  confirmedSpecs,
  onToggleConfirm,
  showConfirmToggles,
  newSpecs,
  onAddSpec,
  onDeleteNewSpec,
  onUpdateNewSpec,
  testIdPrefix = "",
}: {
  specs: Record<string, EnrichedFeedstockSpec>;
  isEditing: boolean;
  onSpecUpdate?: (key: string, value: string) => void;
  onNoteUpdate?: (key: string, note: string) => void;
  onSpecDelete?: (key: string) => void;
  deletedKeys?: Set<string>;
  confirmedSpecs?: Record<string, boolean>;
  onToggleConfirm?: (key: string) => void;
  showConfirmToggles?: boolean;
  newSpecs?: Array<{key: string; displayName: string; value: string; unit: string; provenance: string; group: string}>;
  onAddSpec?: () => void;
  onDeleteNewSpec?: (index: number) => void;
  onUpdateNewSpec?: (index: number, field: string, value: string) => void;
  testIdPrefix?: string;
}) {
  const grouped: Record<string, Array<[string, EnrichedFeedstockSpec]>> = {};

  for (const [key, spec] of Object.entries(specs)) {
    if (deletedKeys?.has(key)) continue;
    if (!grouped[spec.group]) {
      grouped[spec.group] = [];
    }
    grouped[spec.group].push([key, spec]);
  }

  for (const group of Object.keys(grouped)) {
    grouped[group].sort((a, b) => a[1].sortOrder - b[1].sortOrder);
  }

  return (
    <div className="space-y-5">
      {feedstockGroupOrder.map((groupKey) => {
        const items = grouped[groupKey];
        if (!items || items.length === 0) return null;

        return (
          <div key={groupKey}>
            <div className="flex items-center gap-2 mb-2">
              {groupIcons[groupKey]}
              <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {feedstockGroupLabels[groupKey]}
              </h5>
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {showConfirmToggles && <th className="p-2 w-[40px]"></th>}
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[28%]">Parameter</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[23%]">Value</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[15%]">Source</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Notes</th>
                    {isEditing && <th className="p-2 w-[40px]"></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map(([key, spec]) => {
                    const isLocked = confirmedSpecs?.[key] === true;
                    return (
                      <tr key={key} className={`border-b last:border-b-0 ${isLocked ? "bg-green-500/5" : ""}`}>
                        {showConfirmToggles && (
                          <td className="p-1 text-center">
                            <ConfirmToggle
                              isConfirmed={isLocked}
                              onToggle={() => onToggleConfirm?.(key)}
                              testId={`toggle-confirm-spec-${key}`}
                            />
                          </td>
                        )}
                        <td className="p-2">
                          <span className="font-medium text-sm">{spec.displayName}</span>
                        </td>
                        <td className="p-2">
                          {isEditing && !isLocked ? (
                            <Input
                              defaultValue={spec.value}
                              className="h-7 text-sm"
                              onChange={(e) => onSpecUpdate?.(key, e.target.value)}
                              data-testid={`input-spec-${key}`}
                            />
                          ) : (
                            <span className="text-sm" data-testid={`text-spec-${key}`}>
                              {formatDisplayValue(spec.value)}{spec.unit ? ` ${spec.unit}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant="secondary"
                            className={`text-xs ${spec.source === "user_provided"
                              ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                              : "bg-orange-500/10 text-orange-700 dark:text-orange-400"
                            }`}
                          >
                            {spec.source === "user_provided" ? "User" : "Estimated"}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={`text-xs ml-1 ${confidenceBadgeClass[spec.confidence]}`}
                          >
                            {spec.confidence}
                          </Badge>
                        </td>
                        <td className="p-2">
                          {isEditing && !isLocked ? (
                            <Input
                              defaultValue={spec.provenance}
                              className="h-7 text-xs"
                              onChange={(e) => onNoteUpdate?.(key, e.target.value)}
                              data-testid={`input-note-${key}`}
                            />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-muted-foreground cursor-help line-clamp-2">
                                  {spec.provenance}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-sm">
                                <p className="text-xs">{spec.provenance}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </td>
                        {isEditing && (
                          <td className="p-1 text-center">
                            {!isLocked && (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => onSpecDelete?.(key)}
                                data-testid={`button-delete-spec-${key}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {isEditing && (
        <div className="space-y-2 pt-2">
          {newSpecs && newSpecs.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[28%]">Parameter</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[18%]">Value</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[12%]">Unit</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Notes</th>
                    <th className="p-2 w-[40px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {newSpecs.map((spec, i) => (
                    <tr key={`new-${i}`} className="border-b last:border-b-0">
                      <td className="p-2">
                        <Input className="h-7 text-sm" placeholder="Parameter name" defaultValue={spec.displayName} onChange={(e) => onUpdateNewSpec?.(i, "displayName", e.target.value)} data-testid={`input-new-spec-name-${testIdPrefix}${i}`} />
                      </td>
                      <td className="p-2">
                        <Input className="h-7 text-sm" placeholder="Value" defaultValue={spec.value} onChange={(e) => onUpdateNewSpec?.(i, "value", e.target.value)} data-testid={`input-new-spec-value-${testIdPrefix}${i}`} />
                      </td>
                      <td className="p-2">
                        <Input className="h-7 text-sm" placeholder="Unit" defaultValue={spec.unit} onChange={(e) => onUpdateNewSpec?.(i, "unit", e.target.value)} data-testid={`input-new-spec-unit-${testIdPrefix}${i}`} />
                      </td>
                      <td className="p-2">
                        <Input className="h-7 text-xs" placeholder="Notes/provenance" defaultValue={spec.provenance} onChange={(e) => onUpdateNewSpec?.(i, "provenance", e.target.value)} data-testid={`input-new-spec-note-${testIdPrefix}${i}`} />
                      </td>
                      <td className="p-1 text-center">
                        <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => onDeleteNewSpec?.(i)} data-testid={`button-delete-new-spec-${testIdPrefix}${i}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => onAddSpec?.()} data-testid={`button-add-feedstock-spec-${testIdPrefix.replace(/-$/, '') || '0'}`}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Parameter
          </Button>
        </div>
      )}
    </div>
  );
}

const outputGroupIcons: Record<string, React.ReactNode> = {
  gas_quality: <Flame className="h-3.5 w-3.5" />,
  delivery: <Settings2 className="h-3.5 w-3.5" />,
  physical: <Beaker className="h-3.5 w-3.5" />,
  nutrients: <Leaf className="h-3.5 w-3.5" />,
  metals: <Bug className="h-3.5 w-3.5" />,
  pathogens: <AlertCircle className="h-3.5 w-3.5" />,
  regulatory: <FileText className="h-3.5 w-3.5" />,
  discharge: <Droplets className="h-3.5 w-3.5" />,
  prohibited: <AlertCircle className="h-3.5 w-3.5" />,
};

// Badge styling map for data source indicators (standard, estimated, assumed, user-provided)
const sourceLabels: Record<string, { label: string; className: string }> = {
  typical_industry_standard: { label: "Standard", className: "bg-green-500/10 text-green-700 dark:text-green-400" },
  estimated_requirement: { label: "Estimated", className: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  assumed_placeholder: { label: "Assumed", className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
  user_provided: { label: "User", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
};

/**
 * Table component for output acceptance criteria (RNG pipeline specs,
 * digestate limits, effluent discharge limits). Same editing/confirmation
 * pattern as FeedstockSpecsTable, keyed by output profile name.
 */
function OutputSpecsTable({
  profileName,
  specs,
  isEditing,
  onSpecUpdate,
  onNoteUpdate,
  onSpecDelete,
  deletedKeys,
  confirmedSpecs,
  onToggleConfirm,
  showConfirmToggles,
  newSpecs,
  onAddSpec,
  onDeleteNewSpec,
  onUpdateNewSpec,
}: {
  profileName: string;
  specs: Record<string, EnrichedOutputSpec>;
  isEditing: boolean;
  onSpecUpdate?: (profileName: string, key: string, value: string) => void;
  onNoteUpdate?: (profileName: string, key: string, note: string) => void;
  onSpecDelete?: (profileName: string, key: string) => void;
  deletedKeys?: Set<string>;
  confirmedSpecs?: Record<string, boolean>;
  onToggleConfirm?: (key: string) => void;
  showConfirmToggles?: boolean;
  newSpecs?: Array<{key: string; displayName: string; value: string; unit: string; provenance: string; group: string}>;
  onAddSpec?: () => void;
  onDeleteNewSpec?: (index: number) => void;
  onUpdateNewSpec?: (index: number, field: string, value: string) => void;
}) {
  const grouped: Record<string, Array<[string, EnrichedOutputSpec]>> = {};

  for (const [key, spec] of Object.entries(specs)) {
    if (deletedKeys?.has(key)) continue;
    if (!grouped[spec.group]) {
      grouped[spec.group] = [];
    }
    grouped[spec.group].push([key, spec]);
  }

  for (const group of Object.keys(grouped)) {
    grouped[group].sort((a, b) => a[1].sortOrder - b[1].sortOrder);
  }

  return (
    <div className="space-y-5">
      {outputGroupOrder.map((groupKey) => {
        const items = grouped[groupKey];
        if (!items || items.length === 0) return null;

        return (
          <div key={groupKey}>
            <div className="flex items-center gap-2 mb-2">
              {outputGroupIcons[groupKey]}
              <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {outputGroupLabels[groupKey] || groupKey}
              </h5>
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {showConfirmToggles && <th className="p-2 w-[40px]"></th>}
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[28%]">Criterion</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[23%]">Requirement</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[15%]">Source</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Notes</th>
                    {isEditing && <th className="p-2 w-[40px]"></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map(([key, spec]) => {
                    const isLocked = confirmedSpecs?.[key] === true;
                    return (
                      <tr key={key} className={`border-b last:border-b-0 ${isLocked ? "bg-green-500/5" : ""}`}>
                        {showConfirmToggles && (
                          <td className="p-1 text-center">
                            <ConfirmToggle
                              isConfirmed={isLocked}
                              onToggle={() => onToggleConfirm?.(key)}
                              testId={`toggle-confirm-output-${key}`}
                            />
                          </td>
                        )}
                        <td className="p-2">
                          <span className="font-medium text-sm">{spec.displayName}</span>
                        </td>
                        <td className="p-2">
                          {isEditing && !isLocked ? (
                            <Input
                              defaultValue={spec.value}
                              className="h-7 text-sm"
                              onChange={(e) => onSpecUpdate?.(profileName, key, e.target.value)}
                              data-testid={`input-output-spec-${key}`}
                            />
                          ) : (
                            <span className="text-sm" data-testid={`text-output-spec-${key}`}>
                              {formatDisplayValue(spec.value)}{spec.unit ? ` ${spec.unit}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant="secondary"
                            className={`text-xs ${sourceLabels[spec.source]?.className || ""}`}
                          >
                            {sourceLabels[spec.source]?.label || spec.source}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={`text-xs ml-1 ${confidenceBadgeClass[spec.confidence]}`}
                          >
                            {spec.confidence}
                          </Badge>
                        </td>
                        <td className="p-2">
                          {isEditing && !isLocked ? (
                            <Input
                              defaultValue={spec.provenance}
                              className="h-7 text-xs"
                              onChange={(e) => onNoteUpdate?.(profileName, key, e.target.value)}
                              data-testid={`input-output-note-${key}`}
                            />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-muted-foreground cursor-help line-clamp-2">
                                  {spec.provenance}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-sm">
                                <p className="text-xs">{spec.provenance}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </td>
                        {isEditing && (
                          <td className="p-1 text-center">
                            {!isLocked && (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => onSpecDelete?.(profileName, key)}
                                data-testid={`button-delete-output-spec-${key}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {isEditing && (
        <div className="space-y-2 pt-2">
          {newSpecs && newSpecs.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[28%]">Criterion</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[18%]">Requirement</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[12%]">Unit</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Notes</th>
                    <th className="p-2 w-[40px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {newSpecs.map((spec, i) => (
                    <tr key={`new-output-${i}`} className="border-b last:border-b-0">
                      <td className="p-2">
                        <Input className="h-7 text-sm" placeholder="Criterion name" defaultValue={spec.displayName} onChange={(e) => onUpdateNewSpec?.(i, "displayName", e.target.value)} data-testid={`input-new-output-name-${profileName}-${i}`} />
                      </td>
                      <td className="p-2">
                        <Input className="h-7 text-sm" placeholder="Value" defaultValue={spec.value} onChange={(e) => onUpdateNewSpec?.(i, "value", e.target.value)} data-testid={`input-new-output-value-${profileName}-${i}`} />
                      </td>
                      <td className="p-2">
                        <Input className="h-7 text-sm" placeholder="Unit" defaultValue={spec.unit} onChange={(e) => onUpdateNewSpec?.(i, "unit", e.target.value)} data-testid={`input-new-output-unit-${profileName}-${i}`} />
                      </td>
                      <td className="p-2">
                        <Input className="h-7 text-xs" placeholder="Notes/provenance" defaultValue={spec.provenance} onChange={(e) => onUpdateNewSpec?.(i, "provenance", e.target.value)} data-testid={`input-new-output-note-${profileName}-${i}`} />
                      </td>
                      <td className="p-1 text-center">
                        <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => onDeleteNewSpec?.(i)} data-testid={`button-delete-new-output-${profileName}-${i}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => onAddSpec?.()} data-testid={`button-add-output-spec-${profileName}`}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Criterion
          </Button>
        </div>
      )}
    </div>
  );
}

type ClarifyingQuestion = { question: string };
type ClarifyingAnswer = { question: string; answer: string };

/**
 * Primary UPIF review component. Manages:
 * - UPIF generation flow (clarifying questions -> extraction -> UPIF)
 * - Edit mode with tracked changes (feedstock edits, spec edits, deletions, new entries)
 * - Per-field confirmation/locking state
 * - Re-generation that preserves confirmed (locked) values
 * - PDF export
 * - Reviewer chat integration
 */
const PROJECT_TYPE_LABELS: Record<string, string> = {
  A: "Wastewater Treatment (WWT)",
  B: "RNG Production (Greenfield)",
  C: "RNG Production (Bolt-On)",
  D: "Hybrid (WWT + Trucked-In Waste)",
};

const PROJECT_TYPE_DESCRIPTIONS: Record<string, string> = {
  A: "Accepts wastewater and reduces contaminants (BOD, COD, TSS, N, P). May produce RNG as a byproduct.",
  B: "Takes solid food processing residuals and converts to RNG. Produces solid and liquid digestate.",
  C: "Upgrades existing flared or underutilized biogas to pipeline-quality RNG. No feedstock handling.",
  D: "Combines wastewater treatment with trucked-in supplemental waste for enhanced gas production.",
};

export function UpifReview({ scenarioId, upif, isLoading, hasInputs, scenarioStatus, projectType: propProjectType, projectTypeConfirmed: propProjectTypeConfirmed }: UpifReviewProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [clarifyingQuestions, setClarifyingQuestions] = useState<ClarifyingQuestion[] | null>(null);
  const [clarifyingAnswers, setClarifyingAnswers] = useState<string[]>([]);
  const [showClarifyPhase, setShowClarifyPhase] = useState(false);
  const [showClassifyPhase, setShowClassifyPhase] = useState(false);
  const [classificationResult, setClassificationResult] = useState<{
    projectType: string;
    projectTypeName: string;
    confidence: string;
    reasoning: string;
  } | null>(null);
  const [selectedType, setSelectedType] = useState<string>("");
  const [feedstockEdits, setFeedstockEdits] = useState<Record<number, Partial<FeedstockEntry>>>({});
  const [feedstockSpecEdits, setFeedstockSpecEdits] = useState<Record<number, Record<string, string>>>({});
  const [feedstockNoteEdits, setFeedstockNoteEdits] = useState<Record<number, Record<string, string>>>({});
  const [deletedFeedstockIndices, setDeletedFeedstockIndices] = useState<Set<number>>(new Set());
  const [deletedFeedstockSpecs, setDeletedFeedstockSpecs] = useState<Record<number, Set<string>>>({});
  const isConfirmed = scenarioStatus === "confirmed";

  const [localConfirmedFields, setLocalConfirmedFields] = useState<ConfirmedFields>(
    (upif?.confirmedFields as ConfirmedFields | null) || {}
  );

  useEffect(() => {
    setLocalConfirmedFields((upif?.confirmedFields as ConfirmedFields | null) || {});
  }, [upif?.confirmedFields]);

  const syncConfirmedFields = useCallback((newCf: ConfirmedFields) => {
    setLocalConfirmedFields(newCf);
    apiRequest("PATCH", `/api/scenarios/${scenarioId}/upif`, { confirmedFields: newCf })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif"] });
      })
      .catch(() => {
        toast({ title: "Error", description: "Failed to save confirmation state.", variant: "destructive" });
      });
  }, [scenarioId, toast]);

  const toggleFieldConfirm = useCallback((path: string) => {
    setLocalConfirmedFields(prev => {
      const next = { ...prev };
      if (path === "location") {
        next.location = !prev.location;
      } else if (path === "outputRequirements") {
        next.outputRequirements = !prev.outputRequirements;
      } else if (path.startsWith("constraints.")) {
        const idx = parseInt(path.split(".")[1]);
        next.constraints = { ...(prev.constraints || {}) };
        next.constraints[idx] = !next.constraints[idx];
      } else if (path.startsWith("feedstocks.")) {
        const parts = path.split(".");
        const fsIdx = parseInt(parts[1]);
        const field = parts[2];
        next.feedstocks = { ...(prev.feedstocks || {}) };
        next.feedstocks[fsIdx] = { ...(next.feedstocks[fsIdx] || {}) };
        if (field === "feedstockType" || field === "feedstockVolume" || field === "feedstockUnit") {
          (next.feedstocks[fsIdx] as Record<string, boolean | Record<string, boolean> | undefined>)[field] = !(prev.feedstocks?.[fsIdx] as Record<string, boolean | undefined> | undefined)?.[field];
        } else if (field === "feedstockSpecs") {
          const specKey = parts[3];
          next.feedstocks[fsIdx].feedstockSpecs = { ...(next.feedstocks[fsIdx].feedstockSpecs || {}) };
          next.feedstocks[fsIdx].feedstockSpecs![specKey] = !next.feedstocks[fsIdx].feedstockSpecs![specKey];
        }
      } else if (path.startsWith("outputSpecs.")) {
        const parts = path.split(".");
        const profile = parts[1];
        const specKey = parts[2];
        next.outputSpecs = { ...(prev.outputSpecs || {}) };
        next.outputSpecs[profile] = { ...(next.outputSpecs[profile] || {}) };
        next.outputSpecs[profile][specKey] = !next.outputSpecs[profile][specKey];
      }
      syncConfirmedFields(next);
      return next;
    });
  }, [syncConfirmedFields]);

  const form = useForm<UpifFormValues>({
    resolver: zodResolver(upifFormSchema),
    defaultValues: {
      outputRequirements: upif?.outputRequirements || "",
      location: upif?.location || "",
      constraints: upif?.constraints?.join("\n") || "",
    },
  });

  const rawFeedstocks = (upif?.feedstocks as FeedstockEntry[] | null | undefined) || [];
  const feedstocks: FeedstockEntry[] = rawFeedstocks.length > 0
    ? rawFeedstocks
    : upif?.feedstockType
      ? [{
          feedstockType: upif.feedstockType,
          feedstockVolume: upif.feedstockVolume || undefined,
          feedstockUnit: upif.feedstockUnit || undefined,
          feedstockParameters: upif.feedstockParameters as FeedstockEntry["feedstockParameters"],
          feedstockSpecs: upif.feedstockSpecs as FeedstockEntry["feedstockSpecs"],
        }]
      : [];
  const hasFeedstocks = feedstocks.length > 0;
  const outputSpecs = upif?.outputSpecs as Record<string, Record<string, EnrichedOutputSpec>> | null | undefined;
  const hasOutputSpecs = outputSpecs && Object.keys(outputSpecs).length > 0;
  const [outputSpecEdits, setOutputSpecEdits] = useState<Record<string, Record<string, string>>>({});
  const [outputNoteEdits, setOutputNoteEdits] = useState<Record<string, Record<string, string>>>({});
  const [deletedOutputSpecs, setDeletedOutputSpecs] = useState<Record<string, Set<string>>>({});
  const [newFeedstockSpecs, setNewFeedstockSpecs] = useState<Record<number, Array<{key: string; displayName: string; value: string; unit: string; provenance: string; group: string}>>>({});
  const [newOutputSpecs, setNewOutputSpecs] = useState<Record<string, Array<{key: string; displayName: string; value: string; unit: string; provenance: string; group: string}>>>({});
  const [newFeedstockEntries, setNewFeedstockEntries] = useState<Array<{feedstockType: string; feedstockVolume: string; feedstockUnit: string}>>([]);

  const confirmedCount = (() => {
    let count = 0;
    if (localConfirmedFields.location) count++;
    if (localConfirmedFields.outputRequirements) count++;
    if (localConfirmedFields.constraints) {
      count += Object.values(localConfirmedFields.constraints).filter(Boolean).length;
    }
    if (localConfirmedFields.feedstocks) {
      for (const fs of Object.values(localConfirmedFields.feedstocks)) {
        if (fs.feedstockType) count++;
        if (fs.feedstockVolume) count++;
        if (fs.feedstockUnit) count++;
        if (fs.feedstockSpecs) {
          count += Object.values(fs.feedstockSpecs).filter(Boolean).length;
        }
      }
    }
    if (localConfirmedFields.outputSpecs) {
      for (const profile of Object.values(localConfirmedFields.outputSpecs)) {
        count += Object.values(profile).filter(Boolean).length;
      }
    }
    return count;
  })();

  const updateUpifMutation = useMutation({
    mutationFn: async (data: UpifFormValues) => {
      let updatedFeedstocks = feedstocks
        .filter((_, i) => !deletedFeedstockIndices.has(i))
        .map((f, _originalIdx) => {
          const i = feedstocks.indexOf(f);
          const edits = feedstockEdits[i];
          const specEdits = feedstockSpecEdits[i];
          const noteEdits = feedstockNoteEdits[i];
          const deletedSpecKeys = deletedFeedstockSpecs[i];
          let entry = { ...f };
          if (edits) {
            if (edits.feedstockType !== undefined) entry.feedstockType = edits.feedstockType;
            if (edits.feedstockVolume !== undefined) entry.feedstockVolume = edits.feedstockVolume;
            if (edits.feedstockUnit !== undefined) entry.feedstockUnit = edits.feedstockUnit;
          }
          if (entry.feedstockSpecs) {
            const updated = { ...entry.feedstockSpecs };
            if (specEdits) {
              for (const [key, value] of Object.entries(specEdits)) {
                if (updated[key]) {
                  updated[key] = {
                    ...updated[key],
                    value,
                    source: "user_provided",
                    confidence: "high",
                    provenance: noteEdits?.[key] ?? "User-provided override",
                  };
                }
              }
            }
            if (noteEdits) {
              for (const [key, note] of Object.entries(noteEdits)) {
                if (updated[key] && !specEdits?.[key]) {
                  updated[key] = {
                    ...updated[key],
                    provenance: note,
                  };
                }
              }
            }
            if (deletedSpecKeys) {
              for (const key of deletedSpecKeys) {
                delete updated[key];
              }
            }
            entry.feedstockSpecs = updated;
          }
          if (newFeedstockSpecs[i] && newFeedstockSpecs[i].length > 0) {
            const specs = (entry.feedstockSpecs as Record<string, EnrichedFeedstockSpec>) || {};
            for (const ns of newFeedstockSpecs[i]) {
              if (ns.displayName && ns.value) {
                specs[ns.key] = {
                  value: ns.value,
                  unit: ns.unit,
                  source: "user_provided",
                  confidence: "high",
                  provenance: ns.provenance || "User-provided",
                  group: (ns.group as EnrichedFeedstockSpec["group"]) || "extended",
                  displayName: ns.displayName,
                  sortOrder: 999,
                };
              }
            }
            entry.feedstockSpecs = specs;
          }
          return entry;
        });

      for (const nf of newFeedstockEntries) {
        if (nf.feedstockType) {
          updatedFeedstocks.push({
            feedstockType: nf.feedstockType,
            feedstockVolume: nf.feedstockVolume || undefined,
            feedstockUnit: nf.feedstockUnit || undefined,
            feedstockParameters: {},
            feedstockSpecs: {},
          });
        }
      }

      const primary = updatedFeedstocks[0];

      let updatedOutputSpecs = outputSpecs;
      if (updatedOutputSpecs) {
        updatedOutputSpecs = { ...updatedOutputSpecs };
        for (const [profileName, profileSpecs] of Object.entries(updatedOutputSpecs)) {
          updatedOutputSpecs[profileName] = { ...profileSpecs };
          const edits = outputSpecEdits[profileName];
          const noteEdits = outputNoteEdits[profileName];
          const deletedKeys = deletedOutputSpecs[profileName];
          if (edits) {
            for (const [key, value] of Object.entries(edits)) {
              if (updatedOutputSpecs[profileName][key]) {
                updatedOutputSpecs[profileName][key] = {
                  ...updatedOutputSpecs[profileName][key],
                  value,
                  source: "user_provided",
                  confidence: "high",
                  provenance: noteEdits?.[key] ?? "User-provided override",
                };
              }
            }
          }
          if (noteEdits) {
            for (const [key, note] of Object.entries(noteEdits)) {
              if (updatedOutputSpecs[profileName][key] && !edits?.[key]) {
                updatedOutputSpecs[profileName][key] = {
                  ...updatedOutputSpecs[profileName][key],
                  provenance: note,
                };
              }
            }
          }
          if (deletedKeys) {
            for (const key of deletedKeys) {
              delete updatedOutputSpecs[profileName][key];
            }
          }
        }
      }

      if (updatedOutputSpecs) {
        for (const [profileName, newSpecsArr] of Object.entries(newOutputSpecs)) {
          if (!updatedOutputSpecs[profileName]) updatedOutputSpecs[profileName] = {};
          for (const ns of newSpecsArr) {
            if (ns.displayName && ns.value) {
              updatedOutputSpecs[profileName][ns.key] = {
                value: ns.value,
                unit: ns.unit,
                source: "user_provided",
                confidence: "high",
                provenance: ns.provenance || "User-provided",
                group: ns.group || "regulatory",
                displayName: ns.displayName,
                sortOrder: 999,
              };
            }
          }
        }
      }

      const patchData: Record<string, unknown> = {
        ...data,
        constraints: data.constraints?.split("\n").filter(Boolean),
        outputSpecs: updatedOutputSpecs,
      };

      if (updatedFeedstocks.length > 0) {
        patchData.feedstocks = updatedFeedstocks;
        patchData.feedstockType = primary?.feedstockType;
        patchData.feedstockVolume = primary?.feedstockVolume;
        patchData.feedstockUnit = primary?.feedstockUnit;
        patchData.feedstockSpecs = primary?.feedstockSpecs;
      }

      return apiRequest("PATCH", `/api/scenarios/${scenarioId}/upif`, patchData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif"] });
      setIsEditing(false);
      setFeedstockEdits({});
      setFeedstockSpecEdits({});
      setFeedstockNoteEdits({});
      setDeletedFeedstockIndices(new Set());
      setDeletedFeedstockSpecs({});
      setOutputSpecEdits({});
      setOutputNoteEdits({});
      setDeletedOutputSpecs({});
      setNewFeedstockSpecs({});
      setNewOutputSpecs({});
      setNewFeedstockEntries([]);
      toast({
        title: "UPIF updated",
        description: "Your changes have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update UPIF. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const response = await fetch(`/api/scenarios/${scenarioId}/upif/export-pdf`);
      if (!response.ok) throw new Error("Failed to export PDF");
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : `UPIF-${scenarioId}.pdf`;
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({ title: "Error", description: "Failed to export PDF.", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const confirmUpifMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/scenarios/${scenarioId}/confirm`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios/recent"] });
      toast({
        title: "UPIF Confirmed",
        description: "The Unified Project Intake Form has been finalized.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to confirm UPIF. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpifFormValues) => {
    updateUpifMutation.mutate(data);
  };

  const [clarifyFailed, setClarifyFailed] = useState(false);

  const classifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scenarios/${scenarioId}/classify`);
      return res.json();
    },
    onSuccess: (data: { projectType: string; projectTypeName: string; confidence: string; reasoning: string }) => {
      setClassificationResult(data);
      setSelectedType(data.projectType);
      setShowClassifyPhase(true);
    },
    onError: (error: any) => {
      console.error("Classification failed:", error);
      toast({
        title: "Classification failed",
        description: "Could not determine project type. You can select one manually or proceed without it.",
        variant: "destructive",
      });
      setShowClassifyPhase(true);
      setClassificationResult(null);
      setSelectedType("B");
    },
  });

  const confirmTypeMutation = useMutation({
    mutationFn: async (projectType: string) => {
      return apiRequest("PATCH", `/api/scenarios/${scenarioId}/project-type`, {
        projectType,
        confirmed: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId] });
      setShowClassifyPhase(false);
      clarifyMutation.mutate();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save project type.",
        variant: "destructive",
      });
    },
  });

  const clarifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scenarios/${scenarioId}/clarify`);
      return res.json();
    },
    onSuccess: (data: { questions: ClarifyingQuestion[] }) => {
      const questions = data.questions || [];
      setClarifyFailed(false);
      if (questions.length === 0) {
        extractParametersMutation.mutate();
        return;
      }
      setClarifyingQuestions(questions);
      setClarifyingAnswers(new Array(questions.length).fill(""));
      setShowClarifyPhase(true);
    },
    onError: (error: any) => {
      console.error("Clarify failed:", error);
      setClarifyFailed(true);
    },
  });

  const saveAnswersMutation = useMutation({
    mutationFn: async (answers: ClarifyingAnswer[]) => {
      return apiRequest("POST", `/api/scenarios/${scenarioId}/clarify-answers`, { answers });
    },
  });

  const extractParametersMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/scenarios/${scenarioId}/extract`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId] });
      setShowClarifyPhase(false);
      setClarifyingQuestions(null);
      toast({
        title: "UPIF generated",
        description: confirmedCount > 0
          ? `AI has re-analyzed your inputs. ${confirmedCount} confirmed item(s) were preserved.`
          : "AI has analyzed your inputs and generated the project intake form.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate UPIF. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleGenerateWithAnswers = async () => {
    try {
      if (clarifyingQuestions) {
        const answers: ClarifyingAnswer[] = clarifyingQuestions.map((q, i) => ({
          question: q.question,
          answer: clarifyingAnswers[i] || "",
        }));
        await saveAnswersMutation.mutateAsync(answers);
      }
    } catch {
      toast({
        title: "Warning",
        description: "Couldn't save answers, but will proceed with UPIF generation.",
      });
    }
    extractParametersMutation.mutate();
  };

  const handleSkipAndGenerate = () => {
    setShowClarifyPhase(false);
    setClarifyingQuestions(null);
    extractParametersMutation.mutate();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!upif) {
    const isGenerating = extractParametersMutation.isPending || saveAnswersMutation.isPending;

    if (showClassifyPhase) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Project Type Classification
            </CardTitle>
            <CardDescription>
              {classificationResult
                ? "The AI has analyzed your inputs and determined the project type. Please confirm or change the selection below."
                : "Select the project type that best matches your project."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {classificationResult && (
              <div className="rounded-md border p-4 space-y-2" data-testid="classification-result">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="default" data-testid="badge-ai-classification">
                    AI Suggestion
                  </Badge>
                  <Badge
                    variant="outline"
                    className={confidenceBadgeClass[classificationResult.confidence] || ""}
                  >
                    {classificationResult.confidence} confidence
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground" data-testid="text-classification-reasoning">
                  {classificationResult.reasoning}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["A", "B", "C", "D"] as const).map((type) => (
                <div
                  key={type}
                  className={`rounded-md border p-4 cursor-pointer transition-colors ${
                    selectedType === type
                      ? "border-primary bg-primary/5"
                      : "hover-elevate"
                  }`}
                  onClick={() => setSelectedType(type)}
                  data-testid={`card-type-${type}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold ${
                      selectedType === type
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {type}
                    </div>
                    <span className="font-medium text-sm">{PROJECT_TYPE_LABELS[type]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-9">
                    {PROJECT_TYPE_DESCRIPTIONS[type]}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={() => confirmTypeMutation.mutate(selectedType)}
              disabled={!selectedType || confirmTypeMutation.isPending}
              data-testid="button-confirm-type"
            >
              {confirmTypeMutation.isPending ? "Saving..." : `Confirm Type ${selectedType} & Continue`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowClassifyPhase(false);
                setClassificationResult(null);
              }}
              data-testid="button-cancel-classify"
            >
              Cancel
            </Button>
          </CardFooter>
        </Card>
      );
    }

    // Two-phase generation flow: first show AI-generated clarifying questions,
    // then extract parameters using the user's answers (or skip straight to extraction)
    if (showClarifyPhase && clarifyingQuestions && clarifyingQuestions.length > 0) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Clarifying Questions
            </CardTitle>
            <CardDescription>
              The AI has identified a few questions to help produce a more accurate UPIF. Answer what you can, or skip to generate now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isGenerating ? (
              <AiThinking isActive={true} label="Generating UPIF from your answers..." />
            ) : (
              <div className="space-y-5">
                {clarifyingQuestions.map((q, i) => (
                  <div key={i} className="space-y-2">
                    <Label className="flex items-start gap-2 text-sm font-medium">
                      <MessageCircle className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                      <span data-testid={`text-clarify-question-${i}`}>{q.question}</span>
                    </Label>
                    <Textarea
                      placeholder="Type your answer here (optional)"
                      value={clarifyingAnswers[i] || ""}
                      onChange={(e) => {
                        setClarifyingAnswers(prev => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        });
                      }}
                      className="resize-none text-sm"
                      rows={2}
                      data-testid={`input-clarify-answer-${i}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={handleSkipAndGenerate}
              disabled={isGenerating}
              data-testid="button-skip-clarify"
            >
              <SkipForward className="h-4 w-4 mr-2" />
              {isGenerating ? "Generating..." : "Skip & Generate"}
            </Button>
            <Button
              onClick={handleGenerateWithAnswers}
              disabled={isGenerating}
              data-testid="button-submit-answers"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {isGenerating ? "Generating UPIF..." : "Submit & Generate UPIF"}
            </Button>
          </CardFooter>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Unified Project Intake Form
          </CardTitle>
          <CardDescription>
            Standardized project specification document
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            {hasInputs ? (
              <>
                {classifyMutation.isPending || clarifyMutation.isPending || extractParametersMutation.isPending ? (
                  <AiThinking
                    isActive={true}
                    label={classifyMutation.isPending ? "Classifying project type..." : clarifyMutation.isPending ? "Analyzing your inputs..." : "Generating UPIF..."}
                  />
                ) : (
                  <>
                    <Sparkles className="h-12 w-12 text-primary mb-4" />
                    <h3 className="font-medium mb-1" data-testid="text-ready-to-generate">Ready to Generate</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                      Click below to have AI analyze your inputs. The AI will first classify your project type, then ask clarifying questions to produce a better result.
                    </p>
                  </>
                )}
                {!(classifyMutation.isPending || clarifyMutation.isPending || extractParametersMutation.isPending) && (
                  <div className="flex flex-col items-center gap-3">
                    {clarifyFailed && (
                      <p className="text-sm text-destructive" data-testid="text-clarify-error">
                        Clarifying questions could not be generated. You can retry or generate directly.
                      </p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button
                        onClick={() => classifyMutation.mutate()}
                        data-testid="button-generate-upif"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        {clarifyFailed ? "Retry with Questions" : "Generate UPIF"}
                      </Button>
                      {clarifyFailed && (
                        <Button
                          variant="outline"
                          onClick={() => extractParametersMutation.mutate()}
                          data-testid="button-generate-direct"
                        >
                          <SkipForward className="h-4 w-4 mr-2" />
                          Generate Without Questions
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">No inputs yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Add text descriptions or upload documents first, then return here to generate the UPIF.
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }


  // UPIF display section: read-only view with per-field confirm toggles,
  // or full edit mode when the user clicks "Edit"
  return (
    <Card>
      {extractParametersMutation.isPending && (
        <div className="border-b px-6 py-2 bg-primary/5">
          <AiThinking isActive={true} label="Re-generating UPIF..." compact />
        </div>
      )}
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <FileText className="h-5 w-5" />
              Unified Project Intake Form
              {propProjectType && propProjectTypeConfirmed && (
                <Badge variant="outline" className="ml-1" data-testid="badge-upif-project-type">
                  Type {propProjectType}: {PROJECT_TYPE_LABELS[propProjectType as keyof typeof PROJECT_TYPE_LABELS] || propProjectType}
                </Badge>
              )}
              {isConfirmed && (
                <Badge className="ml-1">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Confirmed
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {isConfirmed
                ? `Confirmed on ${upif.confirmedAt ? format(new Date(upif.confirmedAt), "MMMM d, yyyy 'at' h:mm a") : "N/A"}`
                : "Review and confirm individual line items, then re-generate to update only unconfirmed fields"}
            </CardDescription>
          </div>
          {!isConfirmed && !isEditing && (
            <div className="flex gap-2 flex-wrap">
              {confirmedCount > 0 && (
                <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-700 dark:text-green-400">
                  <Lock className="h-3 w-3 mr-1" />
                  {confirmedCount} confirmed
                </Badge>
              )}
              <Button
                variant="outline"
                onClick={() => extractParametersMutation.mutate()}
                disabled={extractParametersMutation.isPending}
                data-testid="button-regenerate-upif"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {extractParametersMutation.isPending ? "Regenerating..." : "Re-generate"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  form.reset({
                    outputRequirements: upif?.outputRequirements || "",
                    location: upif?.location || "",
                    constraints: upif?.constraints?.join("\n") || "",
                  });
                  setFeedstockEdits({});
                  setFeedstockSpecEdits({});
                  setFeedstockNoteEdits({});
                  setDeletedFeedstockIndices(new Set());
                  setDeletedFeedstockSpecs({});
                  setOutputSpecEdits({});
                  setOutputNoteEdits({});
                  setDeletedOutputSpecs({});
                  setNewFeedstockSpecs({});
                  setNewOutputSpecs({});
                  setNewFeedstockEntries([]);
                  setIsEditing(true);
                }}
                data-testid="button-edit-upif"
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {hasFeedstocks && (
                <div className="space-y-6">
                  <h4 className="flex items-center gap-2 font-medium">
                    <Beaker className="h-4 w-4" />
                    Feedstock Specifications
                    <Badge variant="secondary" className="text-xs">{feedstocks.length} feedstock{feedstocks.length > 1 ? "s" : ""}</Badge>
                  </h4>
                  {feedstocks.map((fs, idx) => {
                    if (deletedFeedstockIndices.has(idx)) return null;
                    const specs = fs.feedstockSpecs as Record<string, EnrichedFeedstockSpec> | undefined;
                    const hasSpecs = specs && Object.keys(specs).length > 0;
                    const fsConfirm = localConfirmedFields.feedstocks?.[idx];
                    const nonDeletedCount = feedstocks.filter((_, i) => !deletedFeedstockIndices.has(i)).length;
                    return (
                      <div key={idx} className="border rounded-md p-4 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="text-sm font-semibold">Feedstock {idx + 1}</h5>
                          {nonDeletedCount > 1 && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setDeletedFeedstockIndices(prev => new Set([...prev, idx]))}
                              data-testid={`button-delete-feedstock-${idx}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Type</Label>
                            {fsConfirm?.feedstockType ? (
                              <div className="flex items-center gap-2">
                                <Lock className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                                <span className="text-sm font-medium">{fs.feedstockType || "Not specified"}</span>
                                <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-700 dark:text-green-400">Confirmed</Badge>
                              </div>
                            ) : (
                              <Input
                                defaultValue={fs.feedstockType || ""}
                                placeholder="e.g., Dairy Manure"
                                onChange={(e) => setFeedstockEdits(prev => ({
                                  ...prev,
                                  [idx]: { ...(prev[idx] || {}), feedstockType: e.target.value },
                                }))}
                                data-testid={`input-feedstock-type-${idx}`}
                              />
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs text-muted-foreground">Volume</Label>
                              {fsConfirm?.feedstockVolume ? (
                                <div className="flex items-center gap-2">
                                  <Lock className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                                  <span className="text-sm font-medium">{fs.feedstockVolume ? formatDisplayValue(fs.feedstockVolume) : "Not specified"}</span>
                                </div>
                              ) : (
                                <Input
                                  defaultValue={fs.feedstockVolume || ""}
                                  placeholder="e.g., 100,000"
                                  onChange={(e) => setFeedstockEdits(prev => ({
                                    ...prev,
                                    [idx]: { ...(prev[idx] || {}), feedstockVolume: e.target.value },
                                  }))}
                                  data-testid={`input-feedstock-volume-${idx}`}
                                />
                              )}
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Unit</Label>
                              {fsConfirm?.feedstockUnit ? (
                                <div className="flex items-center gap-2">
                                  <Lock className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                                  <span className="text-sm font-medium">{fs.feedstockUnit || "Not specified"}</span>
                                </div>
                              ) : (
                                <Input
                                  defaultValue={fs.feedstockUnit || ""}
                                  placeholder="e.g., tons/year"
                                  onChange={(e) => setFeedstockEdits(prev => ({
                                    ...prev,
                                    [idx]: { ...(prev[idx] || {}), feedstockUnit: e.target.value },
                                  }))}
                                  data-testid={`input-feedstock-unit-${idx}`}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                        {hasSpecs && (
                          <div className="space-y-3 pt-2">
                            <div className="flex items-center gap-2">
                              <FlaskConical className="h-3.5 w-3.5" />
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Design Parameters</span>
                              <Badge variant="secondary" className="text-xs">Edit unlocked values to override</Badge>
                            </div>
                            <FeedstockSpecsTable
                              specs={specs!}
                              isEditing={true}
                              testIdPrefix={`${idx}-`}
                              onSpecUpdate={(key, value) => {
                                setFeedstockSpecEdits(prev => ({
                                  ...prev,
                                  [idx]: { ...(prev[idx] || {}), [key]: value },
                                }));
                              }}
                              onNoteUpdate={(key, note) => {
                                setFeedstockNoteEdits(prev => ({
                                  ...prev,
                                  [idx]: { ...(prev[idx] || {}), [key]: note },
                                }));
                              }}
                              onSpecDelete={(key) => {
                                setDeletedFeedstockSpecs(prev => ({
                                  ...prev,
                                  [idx]: new Set([...(prev[idx] || []), key]),
                                }));
                              }}
                              deletedKeys={deletedFeedstockSpecs[idx]}
                              confirmedSpecs={localConfirmedFields.feedstocks?.[idx]?.feedstockSpecs}
                              showConfirmToggles={false}
                              newSpecs={newFeedstockSpecs[idx]}
                              onAddSpec={() => {
                                setNewFeedstockSpecs(prev => ({
                                  ...prev,
                                  [idx]: [...(prev[idx] || []), {key: `custom_${Date.now()}`, displayName: "", value: "", unit: "", provenance: "User-provided", group: "extended"}],
                                }));
                              }}
                              onDeleteNewSpec={(i) => {
                                setNewFeedstockSpecs(prev => ({
                                  ...prev,
                                  [idx]: (prev[idx] || []).filter((_, j) => j !== i),
                                }));
                              }}
                              onUpdateNewSpec={(i, field, value) => {
                                setNewFeedstockSpecs(prev => ({
                                  ...prev,
                                  [idx]: (prev[idx] || []).map((s, j) => j === i ? {...s, [field]: value} : s),
                                }));
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {newFeedstockEntries.map((nf, nfIdx) => (
                    <div key={`new-feedstock-${nfIdx}`} className="border rounded-md p-4 space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-sm font-semibold">New Feedstock {nfIdx + 1}</h5>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setNewFeedstockEntries(prev => prev.filter((_, j) => j !== nfIdx))}
                          data-testid={`button-delete-new-feedstock-${nfIdx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Type</Label>
                          <Input
                            defaultValue={nf.feedstockType}
                            placeholder="e.g., Dairy Manure"
                            onChange={(e) => setNewFeedstockEntries(prev => prev.map((entry, j) => j === nfIdx ? {...entry, feedstockType: e.target.value} : entry))}
                            data-testid={`input-new-feedstock-type-${nfIdx}`}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Volume</Label>
                            <Input
                              defaultValue={nf.feedstockVolume}
                              placeholder="e.g., 100,000"
                              onChange={(e) => setNewFeedstockEntries(prev => prev.map((entry, j) => j === nfIdx ? {...entry, feedstockVolume: e.target.value} : entry))}
                              data-testid={`input-new-feedstock-volume-${nfIdx}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Unit</Label>
                            <Input
                              defaultValue={nf.feedstockUnit}
                              placeholder="e.g., tons/year"
                              onChange={(e) => setNewFeedstockEntries(prev => prev.map((entry, j) => j === nfIdx ? {...entry, feedstockUnit: e.target.value} : entry))}
                              data-testid={`input-new-feedstock-unit-${nfIdx}`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setNewFeedstockEntries(prev => [...prev, {feedstockType: "", feedstockVolume: "", feedstockUnit: ""}])}
                    data-testid="button-add-feedstock"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Feedstock
                  </Button>
                </div>
              )}

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium">
                  <MapPin className="h-4 w-4" />
                  Location
                </h4>
                {localConfirmedFields.location ? (
                  <div className="flex items-center gap-2 pl-2">
                    <Lock className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-medium">{upif.location || "Not specified"}</span>
                    <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-700 dark:text-green-400">Confirmed</Badge>
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Location</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Quincy, Washington" {...field} data-testid="input-location" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium">
                  <FileOutput className="h-4 w-4" />
                  Output Requirements
                </h4>
                {localConfirmedFields.outputRequirements ? (
                  <div className="flex items-center gap-2 pl-2">
                    <Lock className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    <span className="text-sm">{upif.outputRequirements || "Not specified"}</span>
                    <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-700 dark:text-green-400">Confirmed</Badge>
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="outputRequirements"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            placeholder="Describe project outputs..."
                            className="resize-none"
                            rows={3}
                            {...field}
                            data-testid="input-output-requirements"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {hasOutputSpecs && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <FileOutput className="h-4 w-4" />
                      <h4 className="font-medium">Output Acceptance Criteria</h4>
                      <Badge variant="secondary" className="text-xs">
                        Edit unlocked values below to override defaults
                      </Badge>
                    </div>
                    {Object.entries(outputSpecs!).map(([profileName, specs]) => (
                      <div key={profileName} className="space-y-3">
                        <h5 className="text-sm font-medium text-muted-foreground pl-2" data-testid={`text-output-profile-${profileName}`}>{profileName}</h5>
                        <OutputSpecsTable
                          profileName={profileName}
                          specs={specs}
                          isEditing={true}
                          onSpecUpdate={(profile, key, value) => {
                            setOutputSpecEdits(prev => ({
                              ...prev,
                              [profile]: { ...(prev[profile] || {}), [key]: value },
                            }));
                          }}
                          onNoteUpdate={(profile, key, note) => {
                            setOutputNoteEdits(prev => ({
                              ...prev,
                              [profile]: { ...(prev[profile] || {}), [key]: note },
                            }));
                          }}
                          onSpecDelete={(profile, key) => {
                            setDeletedOutputSpecs(prev => ({
                              ...prev,
                              [profile]: new Set([...(prev[profile] || []), key]),
                            }));
                          }}
                          deletedKeys={deletedOutputSpecs[profileName]}
                          confirmedSpecs={localConfirmedFields.outputSpecs?.[profileName]}
                          showConfirmToggles={false}
                          newSpecs={newOutputSpecs[profileName]}
                          onAddSpec={() => {
                            setNewOutputSpecs(prev => ({
                              ...prev,
                              [profileName]: [...(prev[profileName] || []), {key: `custom_${Date.now()}`, displayName: "", value: "", unit: "", provenance: "User-provided", group: "regulatory"}],
                            }));
                          }}
                          onDeleteNewSpec={(i) => {
                            setNewOutputSpecs(prev => ({
                              ...prev,
                              [profileName]: (prev[profileName] || []).filter((_, j) => j !== i),
                            }));
                          }}
                          onUpdateNewSpec={(i, field, value) => {
                            setNewOutputSpecs(prev => ({
                              ...prev,
                              [profileName]: (prev[profileName] || []).map((s, j) => j === i ? {...s, [field]: value} : s),
                            }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium">
                  <Settings2 className="h-4 w-4" />
                  Constraints & Assumptions
                </h4>
                {localConfirmedFields.constraints && Object.values(localConfirmedFields.constraints).some(Boolean) ? (
                  <div className="space-y-2">
                    {upif.constraints && upif.constraints.map((c, idx) => {
                      const isLockedConstraint = localConfirmedFields.constraints?.[idx];
                      if (isLockedConstraint) {
                        return (
                          <div key={idx} className="flex items-center gap-2 pl-2">
                            <Lock className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                            <span className="text-sm">{c}</span>
                          </div>
                        );
                      }
                      return null;
                    })}
                    <FormField
                      control={form.control}
                      name="constraints"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">Unconfirmed constraints (editable)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="One constraint per line..."
                              className="resize-none"
                              rows={4}
                              {...field}
                              data-testid="input-constraints"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="constraints"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            placeholder="One constraint per line..."
                            className="resize-none"
                            rows={4}
                            {...field}
                            data-testid="input-constraints"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={updateUpifMutation.isPending}
                  data-testid="button-save-upif"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateUpifMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setFeedstockEdits({});
                    setFeedstockSpecEdits({});
                    setFeedstockNoteEdits({});
                    setDeletedFeedstockIndices(new Set());
                    setDeletedFeedstockSpecs({});
                    setOutputSpecEdits({});
                    setOutputNoteEdits({});
                    setDeletedOutputSpecs({});
                    setNewFeedstockSpecs({});
                    setNewOutputSpecs({});
                    setNewFeedstockEntries([]);
                  }}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="space-y-6">
            <CollapsibleSection
              icon={<Beaker className="h-4 w-4 text-primary" />}
              title="Feedstock Specifications"
              testId="toggle-section-feedstock"
              rightContent={feedstocks.length > 1 ? (
                <Badge variant="secondary" className="text-xs">{feedstocks.length} feedstocks</Badge>
              ) : undefined}
            >
              {hasFeedstocks ? feedstocks.map((fs, idx) => {
                const specs = fs.feedstockSpecs as Record<string, EnrichedFeedstockSpec> | undefined;
                const hasSpecs = specs && Object.keys(specs).length > 0;
                const specStats = hasSpecs ? {
                  total: Object.keys(specs!).length,
                  userProvided: Object.values(specs!).filter(s => s.source === "user_provided").length,
                  estimated: Object.values(specs!).filter(s => s.source === "estimated_default").length,
                } : null;
                const fsConfirm = localConfirmedFields.feedstocks?.[idx];

                return (
                  <div key={idx} className="border rounded-md p-4 space-y-4" data-testid={`feedstock-card-${idx}`}>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        {!isConfirmed && (
                          <ConfirmToggle
                            isConfirmed={!!fsConfirm?.feedstockType}
                            onToggle={() => toggleFieldConfirm(`feedstocks.${idx}.feedstockType`)}
                            testId={`toggle-confirm-feedstock-type-${idx}`}
                          />
                        )}
                        <h5 className="text-sm font-semibold" data-testid={`text-feedstock-type-${idx}`}>
                          {feedstocks.length > 1 ? `Feedstock ${idx + 1}: ` : ""}{fs.feedstockType || "Not specified"}
                        </h5>
                      </div>
                      {specStats && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400">
                            {specStats.userProvided} user-provided
                          </Badge>
                          <Badge variant="secondary" className="text-xs bg-orange-500/10 text-orange-700 dark:text-orange-400">
                            {specStats.estimated} estimated
                          </Badge>
                        </div>
                      )}
                    </div>
                    <div className="pl-2 flex items-center gap-2">
                      {!isConfirmed && (
                        <ConfirmToggle
                          isConfirmed={!!fsConfirm?.feedstockVolume}
                          onToggle={() => toggleFieldConfirm(`feedstocks.${idx}.feedstockVolume`)}
                          testId={`toggle-confirm-feedstock-volume-${idx}`}
                        />
                      )}
                      <div>
                        <Label className="text-xs text-muted-foreground">Volume / Capacity</Label>
                        <p className="text-sm font-medium" data-testid={`text-feedstock-volume-${idx}`}>
                          {fs.feedstockVolume
                            ? `${formatDisplayValue(fs.feedstockVolume)} ${fs.feedstockUnit || ""}`
                            : "Not specified"}
                        </p>
                      </div>
                    </div>
                    {hasSpecs && (
                      <div className="space-y-3 pt-1">
                        <div className="flex items-center gap-2">
                          <FlaskConical className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Design Parameters</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">
                                Use the lock icons to confirm individual values. Confirmed values are preserved when you re-generate.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <FeedstockSpecsTable
                          specs={specs!}
                          isEditing={false}
                          confirmedSpecs={localConfirmedFields.feedstocks?.[idx]?.feedstockSpecs}
                          onToggleConfirm={!isConfirmed ? (key) => toggleFieldConfirm(`feedstocks.${idx}.feedstockSpecs.${key}`) : undefined}
                          showConfirmToggles={!isConfirmed}
                        />
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="pl-6">
                  <p className="text-sm text-muted-foreground">No feedstocks identified</p>
                </div>
              )}
            </CollapsibleSection>

            <Separator />

            <CollapsibleSection
              icon={<MapPin className="h-4 w-4 text-primary" />}
              title="Location"
              testId="toggle-section-location"
            >
              <div className="pl-2 flex items-center gap-2">
                {!isConfirmed && (
                  <ConfirmToggle
                    isConfirmed={!!localConfirmedFields.location}
                    onToggle={() => toggleFieldConfirm("location")}
                    testId="toggle-confirm-location"
                  />
                )}
                <p className="text-sm font-medium" data-testid="text-location">
                  {upif.location || "Not specified"}
                </p>
              </div>
            </CollapsibleSection>

            <Separator />

            <CollapsibleSection
              icon={<FileOutput className="h-4 w-4 text-primary" />}
              title="Output Requirements"
              testId="toggle-section-output-requirements"
            >
              <div className="pl-2 flex items-center gap-2">
                {!isConfirmed && (
                  <ConfirmToggle
                    isConfirmed={!!localConfirmedFields.outputRequirements}
                    onToggle={() => toggleFieldConfirm("outputRequirements")}
                    testId="toggle-confirm-output-requirements"
                  />
                )}
                <p className="text-sm" data-testid="text-output-requirements">
                  {upif.outputRequirements || "Not specified"}
                </p>
              </div>
            </CollapsibleSection>

            {hasOutputSpecs && (
              <>
                <Separator />
                <CollapsibleSection
                  icon={<FileOutput className="h-4 w-4 text-primary" />}
                  title="Output Acceptance Criteria"
                  testId="toggle-section-output-criteria"
                  rightContent={
                    <div className="flex items-center gap-2">
                      {(() => {
                        const allSpecs = Object.values(outputSpecs!).flatMap(s => Object.values(s));
                        const standard = allSpecs.filter(s => s.source === "typical_industry_standard").length;
                        const estimated = allSpecs.filter(s => s.source === "estimated_requirement").length;
                        const user = allSpecs.filter(s => s.source === "user_provided").length;
                        return (
                          <>
                            {user > 0 && (
                              <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400">
                                {user} user-provided
                              </Badge>
                            )}
                            {standard > 0 && (
                              <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-700 dark:text-green-400">
                                {standard} industry standards
                              </Badge>
                            )}
                            {estimated > 0 && (
                              <Badge variant="secondary" className="text-xs bg-orange-500/10 text-orange-700 dark:text-orange-400">
                                {estimated} estimated
                              </Badge>
                            )}
                          </>
                        );
                      })()}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-xs">
                            Use the lock icons to confirm individual criteria. Confirmed values are preserved when you re-generate.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  }
                >
                  {Object.entries(outputSpecs!).map(([profileName, specs]) => (
                    <div key={profileName} className="space-y-3">
                      <h5 className="text-sm font-semibold" data-testid={`text-output-profile-readonly-${profileName}`}>{profileName}</h5>
                      <OutputSpecsTable
                        profileName={profileName}
                        specs={specs}
                        isEditing={false}
                        confirmedSpecs={localConfirmedFields.outputSpecs?.[profileName]}
                        onToggleConfirm={!isConfirmed ? (key) => toggleFieldConfirm(`outputSpecs.${profileName}.${key}`) : undefined}
                        showConfirmToggles={!isConfirmed}
                      />
                    </div>
                  ))}
                </CollapsibleSection>
              </>
            )}

            <Separator />

            <CollapsibleSection
              icon={<Settings2 className="h-4 w-4 text-primary" />}
              title="Constraints & Assumptions"
              testId="toggle-section-constraints"
            >
              <div className="pl-2">
                {upif.constraints && upif.constraints.length > 0 ? (
                  <ul className="space-y-1">
                    {upif.constraints.map((constraint, idx) => (
                      <li key={idx} className="text-sm flex items-center gap-2">
                        {!isConfirmed && (
                          <ConfirmToggle
                            isConfirmed={!!localConfirmedFields.constraints?.[idx]}
                            onToggle={() => toggleFieldConfirm(`constraints.${idx}`)}
                            testId={`toggle-confirm-constraint-${idx}`}
                          />
                        )}
                        <span className="text-primary mt-0.5">-</span>
                        {constraint}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No constraints specified</p>
                )}
              </div>
            </CollapsibleSection>
          </div>
        )}
      </CardContent>
      {!isEditing && upif && (
        <CardFooter className="border-t pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 w-full">
            <div className="text-sm text-muted-foreground">
              {!isConfirmed
                ? confirmedCount > 0
                  ? `${confirmedCount} item(s) confirmed. Re-generating will preserve confirmed values and update the rest.`
                  : "Lock individual items to preserve them during re-generation. Confirming the entire UPIF will finalize the scenario."
                : "This UPIF has been confirmed and locked."}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={handleExportPdf}
                disabled={isExportingPdf}
                data-testid="button-export-pdf"
              >
                <Download className="h-4 w-4 mr-2" />
                {isExportingPdf ? "Exporting..." : "Export PDF"}
              </Button>
              {isExportingPdf && (
                <AiThinking isActive={true} label="Generating PDF..." compact />
              )}
              {!isConfirmed && (
                <Button
                  onClick={() => {
                    if (confirm("Are you sure you want to confirm this UPIF? This will lock the scenario.")) {
                      confirmUpifMutation.mutate();
                    }
                  }}
                  disabled={confirmUpifMutation.isPending}
                  data-testid="button-confirm-upif"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {confirmUpifMutation.isPending ? "Confirming..." : "Confirm UPIF"}
                </Button>
              )}
            </div>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
