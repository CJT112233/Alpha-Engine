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
import { FileText, CheckCircle2, AlertCircle, Edit2, Save, X, Beaker, MapPin, FileOutput, Settings2, Info, FlaskConical, Bug, Layers, Flame, Droplets, Leaf } from "lucide-react";
import type { UpifRecord } from "@shared/schema";
import { feedstockGroupLabels, feedstockGroupOrder, type EnrichedFeedstockSpec } from "@shared/feedstock-library";
import { outputGroupLabels, outputGroupOrder, type EnrichedOutputSpec } from "@shared/output-criteria-library";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface UpifReviewProps {
  scenarioId: string;
  upif: UpifRecord | undefined;
  isLoading: boolean;
  hasParameters: boolean;
  scenarioStatus: string;
}

const upifFormSchema = z.object({
  feedstockType: z.string().optional(),
  feedstockVolume: z.string().optional(),
  feedstockUnit: z.string().optional(),
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

const confidenceBadgeClass: Record<string, string> = {
  high: "bg-green-500/10 text-green-700 dark:text-green-400",
  medium: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  low: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function FeedstockSpecsTable({
  specs,
  isEditing,
  onSpecUpdate,
}: {
  specs: Record<string, EnrichedFeedstockSpec>;
  isEditing: boolean;
  onSpecUpdate?: (key: string, value: string) => void;
}) {
  const grouped: Record<string, Array<[string, EnrichedFeedstockSpec]>> = {};

  for (const [key, spec] of Object.entries(specs)) {
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
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Parameter</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[25%]">Value</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[15%]">Source</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Provenance</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(([key, spec]) => (
                    <tr key={key} className="border-b last:border-b-0">
                      <td className="p-2">
                        <span className="font-medium text-sm">{spec.displayName}</span>
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <Input
                            defaultValue={spec.value}
                            className="h-7 text-sm"
                            onChange={(e) => onSpecUpdate?.(key, e.target.value)}
                            data-testid={`input-spec-${key}`}
                          />
                        ) : (
                          <span className="text-sm" data-testid={`text-spec-${key}`}>
                            {spec.value}{spec.unit ? ` ${spec.unit}` : ""}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
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

const sourceLabels: Record<string, { label: string; className: string }> = {
  typical_industry_standard: { label: "Standard", className: "bg-green-500/10 text-green-700 dark:text-green-400" },
  estimated_requirement: { label: "Estimated", className: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  assumed_placeholder: { label: "Assumed", className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
  user_provided: { label: "User", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
};

function OutputSpecsTable({
  profileName,
  specs,
  isEditing,
  onSpecUpdate,
}: {
  profileName: string;
  specs: Record<string, EnrichedOutputSpec>;
  isEditing: boolean;
  onSpecUpdate?: (profileName: string, key: string, value: string) => void;
}) {
  const grouped: Record<string, Array<[string, EnrichedOutputSpec]>> = {};

  for (const [key, spec] of Object.entries(specs)) {
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
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Criterion</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[25%]">Requirement</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[15%]">Source</th>
                    <th className="text-left p-2 font-medium text-xs text-muted-foreground w-[30%]">Provenance</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(([key, spec]) => (
                    <tr key={key} className="border-b last:border-b-0">
                      <td className="p-2">
                        <span className="font-medium text-sm">{spec.displayName}</span>
                      </td>
                      <td className="p-2">
                        {isEditing ? (
                          <Input
                            defaultValue={spec.value}
                            className="h-7 text-sm"
                            onChange={(e) => onSpecUpdate?.(profileName, key, e.target.value)}
                            data-testid={`input-output-spec-${key}`}
                          />
                        ) : (
                          <span className="text-sm" data-testid={`text-output-spec-${key}`}>
                            {spec.value}{spec.unit ? ` ${spec.unit}` : ""}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UpifReview({ scenarioId, upif, isLoading, hasParameters, scenarioStatus }: UpifReviewProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [specEdits, setSpecEdits] = useState<Record<string, string>>({});
  const isConfirmed = scenarioStatus === "confirmed";

  const form = useForm<UpifFormValues>({
    resolver: zodResolver(upifFormSchema),
    defaultValues: {
      feedstockType: upif?.feedstockType || "",
      feedstockVolume: upif?.feedstockVolume || "",
      feedstockUnit: upif?.feedstockUnit || "",
      outputRequirements: upif?.outputRequirements || "",
      location: upif?.location || "",
      constraints: upif?.constraints?.join("\n") || "",
    },
  });

  const feedstockSpecs = upif?.feedstockSpecs as Record<string, EnrichedFeedstockSpec> | null | undefined;
  const hasSpecs = feedstockSpecs && Object.keys(feedstockSpecs).length > 0;
  const outputSpecs = upif?.outputSpecs as Record<string, Record<string, EnrichedOutputSpec>> | null | undefined;
  const hasOutputSpecs = outputSpecs && Object.keys(outputSpecs).length > 0;
  const [outputSpecEdits, setOutputSpecEdits] = useState<Record<string, Record<string, string>>>({}); 

  const updateUpifMutation = useMutation({
    mutationFn: async (data: UpifFormValues) => {
      let updatedSpecs = feedstockSpecs;
      if (Object.keys(specEdits).length > 0 && updatedSpecs) {
        updatedSpecs = { ...updatedSpecs };
        for (const [key, value] of Object.entries(specEdits)) {
          if (updatedSpecs[key]) {
            updatedSpecs[key] = {
              ...updatedSpecs[key],
              value,
              source: "user_provided",
              confidence: "high",
              provenance: "User-provided override",
            };
          }
        }
      }

      let updatedOutputSpecs = outputSpecs;
      if (Object.keys(outputSpecEdits).length > 0 && updatedOutputSpecs) {
        updatedOutputSpecs = { ...updatedOutputSpecs };
        for (const [profileName, edits] of Object.entries(outputSpecEdits)) {
          if (updatedOutputSpecs[profileName]) {
            updatedOutputSpecs[profileName] = { ...updatedOutputSpecs[profileName] };
            for (const [key, value] of Object.entries(edits)) {
              if (updatedOutputSpecs[profileName][key]) {
                updatedOutputSpecs[profileName][key] = {
                  ...updatedOutputSpecs[profileName][key],
                  value,
                  source: "user_provided",
                  confidence: "high",
                  provenance: "User-provided override",
                };
              }
            }
          }
        }
      }

      return apiRequest("PATCH", `/api/scenarios/${scenarioId}/upif`, {
        ...data,
        constraints: data.constraints?.split("\n").filter(Boolean),
        feedstockSpecs: updatedSpecs,
        outputSpecs: updatedOutputSpecs,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif"] });
      setIsEditing(false);
      setSpecEdits({});
      setOutputSpecEdits({});
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

  if (!hasParameters) {
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
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-1">Parameters not extracted yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Extract parameters from your inputs first. The UPIF will be generated automatically from the confirmed parameters.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!upif) {
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
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-1">UPIF not generated yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Confirm your extracted parameters to generate the UPIF.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const specStats = hasSpecs ? {
    total: Object.keys(feedstockSpecs!).length,
    userProvided: Object.values(feedstockSpecs!).filter(s => s.source === "user_provided").length,
    estimated: Object.values(feedstockSpecs!).filter(s => s.source === "estimated_default").length,
  } : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Unified Project Intake Form
              {isConfirmed && (
                <Badge className="ml-2">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Confirmed
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {isConfirmed
                ? `Confirmed on ${upif.confirmedAt ? format(new Date(upif.confirmedAt), "MMMM d, yyyy 'at' h:mm a") : "N/A"}`
                : "Review and confirm all project specifications"}
            </CardDescription>
          </div>
          {!isConfirmed && !isEditing && (
            <Button
              variant="outline"
              onClick={() => {
                form.reset({
                  feedstockType: upif?.feedstockType || "",
                  feedstockVolume: upif?.feedstockVolume || "",
                  feedstockUnit: upif?.feedstockUnit || "",
                  outputRequirements: upif?.outputRequirements || "",
                  location: upif?.location || "",
                  constraints: upif?.constraints?.join("\n") || "",
                });
                setSpecEdits({});
                setIsEditing(true);
              }}
              data-testid="button-edit-upif"
            >
              <Edit2 className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <h4 className="flex items-center gap-2 font-medium">
                    <Beaker className="h-4 w-4" />
                    Feedstock Specifications
                  </h4>
                  <FormField
                    control={form.control}
                    name="feedstockType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Feedstock Type</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Potato Waste" {...field} data-testid="input-feedstock-type" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="feedstockVolume"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Volume</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., 100,000" {...field} data-testid="input-feedstock-volume" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="feedstockUnit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unit</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., tons/year" {...field} data-testid="input-feedstock-unit" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="flex items-center gap-2 font-medium">
                    <MapPin className="h-4 w-4" />
                    Location
                  </h4>
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
                </div>
              </div>

              {hasSpecs && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4" />
                      <h4 className="font-medium">Feedstock Design Parameters</h4>
                      <Badge variant="secondary" className="text-xs">
                        Edit values below to override defaults
                      </Badge>
                    </div>
                    <FeedstockSpecsTable
                      specs={feedstockSpecs!}
                      isEditing={true}
                      onSpecUpdate={(key, value) => {
                        setSpecEdits(prev => ({ ...prev, [key]: value }));
                      }}
                    />
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium">
                  <FileOutput className="h-4 w-4" />
                  Output Requirements
                </h4>
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
              </div>

              {hasOutputSpecs && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <FileOutput className="h-4 w-4" />
                      <h4 className="font-medium">Output Acceptance Criteria</h4>
                      <Badge variant="secondary" className="text-xs">
                        Edit values below to override defaults
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
                    setSpecEdits({});
                    setOutputSpecEdits({});
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
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium text-sm">
                  <Beaker className="h-4 w-4 text-primary" />
                  Feedstock Specifications
                </h4>
                <div className="space-y-3 pl-6">
                  <div>
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <p className="text-sm font-medium" data-testid="text-feedstock-type">
                      {upif.feedstockType || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Volume / Capacity</Label>
                    <p className="text-sm font-medium" data-testid="text-feedstock-volume">
                      {upif.feedstockVolume
                        ? `${upif.feedstockVolume} ${upif.feedstockUnit || ""}`
                        : "Not specified"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium text-sm">
                  <MapPin className="h-4 w-4 text-primary" />
                  Location
                </h4>
                <div className="pl-6">
                  <p className="text-sm font-medium" data-testid="text-location">
                    {upif.location || "Not specified"}
                  </p>
                </div>
              </div>
            </div>

            {hasSpecs && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <h4 className="flex items-center gap-2 font-medium text-sm">
                      <FlaskConical className="h-4 w-4 text-primary" />
                      Feedstock Design Parameters
                    </h4>
                    {specStats && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400">
                          {specStats.userProvided} user-provided
                        </Badge>
                        <Badge variant="secondary" className="text-xs bg-orange-500/10 text-orange-700 dark:text-orange-400">
                          {specStats.estimated} estimated defaults
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-xs">
                              Estimated defaults are sourced from published literature for {upif.feedstockType}. 
                              Click "Edit" to override any value with your own data.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                  <FeedstockSpecsTable
                    specs={feedstockSpecs!}
                    isEditing={false}
                  />
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 font-medium text-sm">
                <FileOutput className="h-4 w-4 text-primary" />
                Output Requirements
              </h4>
              <div className="pl-6">
                <p className="text-sm" data-testid="text-output-requirements">
                  {upif.outputRequirements || "Not specified"}
                </p>
              </div>
            </div>

            {hasOutputSpecs && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <h4 className="flex items-center gap-2 font-medium text-sm">
                      <FileOutput className="h-4 w-4 text-primary" />
                      Output Acceptance Criteria
                    </h4>
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
                            Acceptance criteria are populated from industry standards (FERC/NAESB, EPA Part 503, municipal pretreatment). 
                            Click "Edit" to override any value with project-specific requirements.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  {Object.entries(outputSpecs!).map(([profileName, specs]) => (
                    <div key={profileName} className="space-y-3">
                      <h5 className="text-sm font-semibold" data-testid={`text-output-profile-readonly-${profileName}`}>{profileName}</h5>
                      <OutputSpecsTable
                        profileName={profileName}
                        specs={specs}
                        isEditing={false}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 font-medium text-sm">
                <Settings2 className="h-4 w-4 text-primary" />
                Constraints & Assumptions
              </h4>
              <div className="pl-6">
                {upif.constraints && upif.constraints.length > 0 ? (
                  <ul className="space-y-1">
                    {upif.constraints.map((constraint, idx) => (
                      <li key={idx} className="text-sm flex items-start gap-2">
                        <span className="text-primary mt-1">-</span>
                        {constraint}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No constraints specified</p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
      {!isConfirmed && !isEditing && (
        <CardFooter className="border-t pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 w-full">
            <div className="text-sm text-muted-foreground">
              Confirming this UPIF will lock all inputs and parameters for this scenario.
            </div>
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
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
