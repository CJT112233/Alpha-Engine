import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sparkles, Beaker, MapPin, Settings2, FileOutput, AlertCircle, CheckCircle2, Edit2 } from "lucide-react";
import type { ExtractedParameter } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface ParameterExtractionProps {
  scenarioId: string;
  parameters: ExtractedParameter[];
  isLoading: boolean;
  hasInputs: boolean;
  onExtract: () => void;
  isExtracting: boolean;
  isLocked: boolean;
}

const categoryIcons: Record<string, React.ReactNode> = {
  feedstock: <Beaker className="h-4 w-4" />,
  output_requirements: <FileOutput className="h-4 w-4" />,
  location: <MapPin className="h-4 w-4" />,
  constraints: <Settings2 className="h-4 w-4" />,
};

const categoryLabels: Record<string, string> = {
  feedstock: "Feedstock Specifications",
  output_requirements: "Output Requirements",
  location: "Project Location",
  constraints: "Constraints & Assumptions",
};

const confidenceColors: Record<string, string> = {
  high: "bg-green-500/10 text-green-700 dark:text-green-400",
  medium: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  low: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function ParameterExtraction({
  scenarioId,
  parameters,
  isLoading,
  hasInputs,
  onExtract,
  isExtracting,
  isLocked,
}: ParameterExtractionProps) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const updateParameterMutation = useMutation({
    mutationFn: async ({ id, value, isConfirmed }: { id: string; value?: string; isConfirmed?: boolean }) => {
      return apiRequest("PATCH", `/api/parameters/${id}`, { value, isConfirmed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "parameters"] });
      setEditingId(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update parameter. Please try again.",
        variant: "destructive",
      });
    },
  });

  const confirmAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/scenarios/${scenarioId}/confirm-parameters`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios", scenarioId, "parameters"] });
      toast({
        title: "Parameters confirmed",
        description: "All parameters have been confirmed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to confirm parameters. Please try again.",
        variant: "destructive",
      });
    },
  });

  const groupedParameters = parameters.reduce((acc, param) => {
    if (!acc[param.category]) {
      acc[param.category] = [];
    }
    acc[param.category].push(param);
    return acc;
  }, {} as Record<string, ExtractedParameter[]>);

  const allConfirmed = parameters.length > 0 && parameters.every((p) => p.isConfirmed);
  const confirmedCount = parameters.filter((p) => p.isConfirmed).length;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasInputs) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Parameter Extraction
          </CardTitle>
          <CardDescription>
            AI-powered extraction and prediction of project parameters
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-1">No inputs to extract from</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add text descriptions or upload documents first, then return here to extract parameters.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (parameters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Parameter Extraction
          </CardTitle>
          <CardDescription>
            AI-powered extraction and prediction of project parameters
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles className="h-12 w-12 text-primary mb-4" />
            <h3 className="font-medium mb-1">Ready to Extract</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">
              Click the button below to have AI analyze your inputs and extract project parameters.
            </p>
            <Button
              onClick={onExtract}
              disabled={isExtracting}
              data-testid="button-extract"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {isExtracting ? "Extracting..." : "Extract Parameters"}
            </Button>
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
              <Sparkles className="h-5 w-5" />
              Extracted Parameters
            </CardTitle>
            <CardDescription>
              Review and confirm extracted values. {confirmedCount} of {parameters.length} confirmed.
            </CardDescription>
          </div>
          {!isLocked && !allConfirmed && (
            <Button
              variant="outline"
              onClick={() => confirmAllMutation.mutate()}
              disabled={confirmAllMutation.isPending}
              data-testid="button-confirm-all"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Confirm All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-6">
            {Object.entries(categoryLabels).map(([category, label]) => {
              const params = groupedParameters[category];
              if (!params?.length) return null;

              return (
                <div key={category}>
                  <h4 className="flex items-center gap-2 font-medium mb-3">
                    {categoryIcons[category]}
                    {label}
                  </h4>
                  <div className="space-y-2">
                    {params.map((param) => (
                      <div
                        key={param.id}
                        className={`flex items-center gap-3 p-3 rounded-md border ${
                          param.isConfirmed ? "bg-primary/5 border-primary/20" : "bg-card"
                        }`}
                        data-testid={`parameter-${param.id}`}
                      >
                        {!isLocked && (
                          <Checkbox
                            checked={param.isConfirmed || false}
                            onCheckedChange={(checked) => {
                              updateParameterMutation.mutate({
                                id: param.id,
                                isConfirmed: checked as boolean,
                              });
                            }}
                            data-testid={`checkbox-${param.id}`}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{param.name}</span>
                            <Badge
                              variant="secondary"
                              className={`text-xs ${confidenceColors[param.confidence || "medium"]}`}
                            >
                              {param.confidence || "medium"} confidence
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {param.source === "ai_extraction"
                                ? "AI extracted"
                                : param.source === "user_input"
                                ? "From input"
                                : param.source === "document"
                                ? "From document"
                                : "Predicted"}
                            </Badge>
                          </div>
                          {editingId === param.id ? (
                            <div className="flex items-center gap-2 mt-1">
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="h-8 text-sm"
                                data-testid={`input-edit-${param.id}`}
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  updateParameterMutation.mutate({
                                    id: param.id,
                                    value: editValue,
                                  });
                                }}
                                disabled={updateParameterMutation.isPending}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {param.value}
                              {param.unit && ` ${param.unit}`}
                            </p>
                          )}
                        </div>
                        {!isLocked && editingId !== param.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingId(param.id);
                              setEditValue(param.value || "");
                            }}
                            data-testid={`button-edit-${param.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
