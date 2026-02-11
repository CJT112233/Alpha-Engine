import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, RotateCcw, Save, ChevronDown, ChevronUp, Code, AlertTriangle } from "lucide-react";

interface PromptData {
  key: string;
  name: string;
  description: string;
  template: string;
  isSystemPrompt: boolean;
  availableVariables: string[];
  isCustomized: boolean;
  updatedAt: string | null;
}

function PromptCard({ prompt }: { prompt: PromptData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editValue, setEditValue] = useState(prompt.template);
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();

  const hasChanges = editValue !== prompt.template;

  const saveMutation = useMutation({
    mutationFn: async (template: string) => {
      const res = await apiRequest("PATCH", `/api/prompts/${prompt.key}`, { template });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      setIsEditing(false);
      toast({ title: "Prompt saved", description: `"${prompt.name}" has been updated.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save prompt.", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/prompts/${prompt.key}/reset`);
      return res.json();
    },
    onSuccess: (data: PromptData) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      setEditValue(data.template);
      setIsEditing(false);
      toast({ title: "Prompt reset", description: `"${prompt.name}" has been restored to its default.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reset prompt.", variant: "destructive" });
    },
  });

  const handleStartEdit = () => {
    setEditValue(prompt.template);
    setIsEditing(true);
    setIsExpanded(true);
  };

  const handleCancel = () => {
    setEditValue(prompt.template);
    setIsEditing(false);
  };

  return (
    <Card data-testid={`card-prompt-${prompt.key}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base" data-testid={`text-prompt-name-${prompt.key}`}>
              {prompt.name}
            </CardTitle>
            <Badge variant={prompt.isSystemPrompt ? "secondary" : "outline"}>
              {prompt.isSystemPrompt ? "System Prompt" : "User Prompt"}
            </Badge>
            {prompt.isCustomized && (
              <Badge variant="default" data-testid={`badge-customized-${prompt.key}`}>
                Customized
              </Badge>
            )}
          </div>
          <CardDescription className="mt-1.5">
            {prompt.description}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsExpanded(!isExpanded)}
          data-testid={`button-toggle-prompt-${prompt.key}`}
        >
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {prompt.availableVariables.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50">
              <Code className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="text-sm">
                <span className="font-medium">Template variables</span>
                <span className="text-muted-foreground"> (replaced at runtime): </span>
                {prompt.availableVariables.map((v, i) => (
                  <span key={v}>
                    <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">{v}</code>
                    {i < prompt.availableVariables.length - 1 && ", "}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isEditing ? (
            <>
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="min-h-[300px] font-mono text-sm"
                data-testid={`textarea-prompt-${prompt.key}`}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={() => saveMutation.mutate(editValue)}
                  disabled={!hasChanges || saveMutation.isPending}
                  data-testid={`button-save-prompt-${prompt.key}`}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={saveMutation.isPending}
                  data-testid={`button-cancel-prompt-${prompt.key}`}
                >
                  Cancel
                </Button>
                {prompt.isCustomized && (
                  <Button
                    variant="outline"
                    onClick={() => resetMutation.mutate()}
                    disabled={resetMutation.isPending}
                    data-testid={`button-reset-prompt-${prompt.key}`}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {resetMutation.isPending ? "Resetting..." : "Reset to Default"}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="relative">
                <pre className="p-4 rounded-md bg-muted/50 text-sm font-mono whitespace-pre-wrap break-words max-h-[400px] overflow-auto" data-testid={`text-prompt-template-${prompt.key}`}>
                  {prompt.template}
                </pre>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={handleStartEdit}
                  data-testid={`button-edit-prompt-${prompt.key}`}
                >
                  Edit Prompt
                </Button>
                {prompt.isCustomized && (
                  <Button
                    variant="outline"
                    onClick={() => resetMutation.mutate()}
                    disabled={resetMutation.isPending}
                    data-testid={`button-reset-prompt-${prompt.key}`}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {resetMutation.isPending ? "Resetting..." : "Reset to Default"}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { data: prompts, isLoading } = useQuery<PromptData[]>({
    queryKey: ["/api/prompts"],
  });

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-4xl mx-auto p-6 space-y-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-settings-title">
              Settings
            </h1>
          </div>
          <p className="text-muted-foreground">
            View and customize the AI prompts used throughout the system. Changes apply immediately to all new AI interactions.
          </p>
        </div>

        <div className="flex items-start gap-2 p-3 rounded-md border border-border">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Modifying prompts can significantly affect AI output quality. If results degrade, use "Reset to Default" to restore the original prompt.
          </p>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold" data-testid="text-prompts-heading">AI Prompts</h2>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-full mt-2" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {prompts?.map(prompt => (
                <PromptCard key={prompt.key} prompt={prompt} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
