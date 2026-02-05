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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, CheckCircle2, AlertCircle, Edit2, Save, X, Beaker, MapPin, FileOutput, DollarSign, Settings2 } from "lucide-react";
import type { UpifRecord } from "@shared/schema";
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
  pricingInputs: z.string().optional(),
  pricingOutputs: z.string().optional(),
});

type UpifFormValues = z.infer<typeof upifFormSchema>;

export function UpifReview({ scenarioId, upif, isLoading, hasParameters, scenarioStatus }: UpifReviewProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const isConfirmed = scenarioStatus === "confirmed";

  const formatPricing = (pricing: Record<string, string> | null | undefined): string => {
    if (!pricing) return "";
    return Object.entries(pricing).map(([key, value]) => `${key}: ${value}`).join("\n");
  };

  const parsePricing = (text: string): Record<string, string> => {
    const result: Record<string, string> = {};
    text.split("\n").filter(Boolean).forEach(line => {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (key) result[key] = value;
      } else if (line.trim()) {
        result[line.trim()] = "";
      }
    });
    return result;
  };

  const form = useForm<UpifFormValues>({
    resolver: zodResolver(upifFormSchema),
    defaultValues: {
      feedstockType: upif?.feedstockType || "",
      feedstockVolume: upif?.feedstockVolume || "",
      feedstockUnit: upif?.feedstockUnit || "",
      outputRequirements: upif?.outputRequirements || "",
      location: upif?.location || "",
      constraints: upif?.constraints?.join("\n") || "",
      pricingInputs: formatPricing(upif?.pricingInputs),
      pricingOutputs: formatPricing(upif?.pricingOutputs),
    },
  });

  const updateUpifMutation = useMutation({
    mutationFn: async (data: UpifFormValues) => {
      return apiRequest("PATCH", `/api/scenarios/${scenarioId}/upif`, {
        ...data,
        constraints: data.constraints?.split("\n").filter(Boolean),
        pricingInputs: data.pricingInputs ? parsePricing(data.pricingInputs) : null,
        pricingOutputs: data.pricingOutputs ? parsePricing(data.pricingOutputs) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "upif"] });
      setIsEditing(false);
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
                  pricingInputs: formatPricing(upif?.pricingInputs),
                  pricingOutputs: formatPricing(upif?.pricingOutputs),
                });
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
                          <Input placeholder="e.g., Potato Waste" {...field} />
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
                            <Input placeholder="e.g., 100,000" {...field} />
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
                            <Input placeholder="e.g., tons/year" {...field} />
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
                          <Input placeholder="e.g., Quincy, Washington" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

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
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium">
                  <DollarSign className="h-4 w-4" />
                  Pricing & Economics
                </h4>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="pricingInputs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Input Costs</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Budget: $15,000,000&#10;Feedstock Cost: $20/ton&#10;..."
                            className="resize-none"
                            rows={4}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pricingOutputs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Revenue / Output Value</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="RNG Price: $8/MMBtu&#10;Carbon Credits: $50/ton&#10;..."
                            className="resize-none"
                            rows={4}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
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
                  onClick={() => setIsEditing(false)}
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
                  {upif.feedstockParameters && Object.keys(upif.feedstockParameters).length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Technical Parameters</Label>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {Object.entries(upif.feedstockParameters).map(([key, val]) => (
                          <Badge key={key} variant="secondary" className="text-xs">
                            {key}: {val.value} {val.unit}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
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

            <Separator />

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <h4 className="flex items-center gap-2 font-medium text-sm">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Pricing & Economics
                </h4>
                <div className="pl-6 space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Input Costs</Label>
                    {upif.pricingInputs && Object.keys(upif.pricingInputs).length > 0 ? (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {Object.entries(upif.pricingInputs).map(([key, val]) => (
                          <Badge key={key} variant="secondary" className="text-xs">
                            {key}: {val}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not specified</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Revenue / Output Value</Label>
                    {upif.pricingOutputs && Object.keys(upif.pricingOutputs).length > 0 ? (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {Object.entries(upif.pricingOutputs).map(([key, val]) => (
                          <Badge key={key} variant="secondary" className="text-xs">
                            {key}: {val}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not specified</p>
                    )}
                  </div>
                </div>
              </div>

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
