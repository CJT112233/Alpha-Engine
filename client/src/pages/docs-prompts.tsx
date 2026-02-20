import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Bot, ChevronRight, Search, FileText, Sparkles,
  Scale, DollarSign, MessageSquare, Info, ListChecks, Pencil,
  Save, RotateCcw, X, Code, Wrench
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PROMPT_KEYS, type PromptKey } from "@shared/default-prompts";

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

const categoryMap: Record<string, { label: string; color: string; icon: any }> = {
  classification: { label: "Classification", color: "bg-gray-600 dark:bg-gray-500", icon: ListChecks },
  extraction: { label: "Extraction", color: "bg-blue-600 dark:bg-blue-500", icon: Sparkles },
  clarify: { label: "Workflow", color: "bg-teal-600 dark:bg-teal-500", icon: MessageSquare },
  reviewer_chat: { label: "Workflow", color: "bg-teal-600 dark:bg-teal-500", icon: MessageSquare },
  pdf_summary: { label: "Workflow", color: "bg-teal-600 dark:bg-teal-500", icon: FileText },
  mass_balance: { label: "Mass Balance", color: "bg-green-600 dark:bg-green-500", icon: Scale },
  capex: { label: "CapEx", color: "bg-purple-600 dark:bg-purple-500", icon: DollarSign },
  opex: { label: "OpEx", color: "bg-orange-600 dark:bg-orange-500", icon: Wrench },
};

function getCategory(key: string) {
  if (key === "classification") return categoryMap.classification;
  if (key.startsWith("extraction")) return categoryMap.extraction;
  if (key === "clarify") return categoryMap.clarify;
  if (key === "reviewer_chat") return categoryMap.reviewer_chat;
  if (key === "pdf_summary") return categoryMap.pdf_summary;
  if (key.startsWith("mass_balance")) return categoryMap.mass_balance;
  if (key.startsWith("capex")) return categoryMap.capex;
  if (key.startsWith("opex")) return categoryMap.opex;
  return { label: "Other", color: "bg-muted", icon: Bot };
}

function getProjectType(key: string): string | null {
  if (key.endsWith("_type_a")) return "A";
  if (key.endsWith("_type_b")) return "B";
  if (key.endsWith("_type_c")) return "C";
  if (key.endsWith("_type_d")) return "D";
  return null;
}

const typeColors: Record<string, string> = {
  A: "bg-blue-600 dark:bg-blue-500",
  B: "bg-green-600 dark:bg-green-500",
  C: "bg-orange-600 dark:bg-orange-500",
  D: "bg-purple-600 dark:bg-purple-500",
};

const typeNames: Record<string, string> = {
  A: "Wastewater Treatment",
  B: "RNG Greenfield",
  C: "RNG Bolt-On",
  D: "Hybrid",
};

function PromptDetail({ prompt, onBack }: { prompt: PromptData; onBack: () => void }) {
  const category = getCategory(prompt.key);
  const projectType = getProjectType(prompt.key);
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(prompt.template);

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
  };

  const handleCancel = () => {
    setEditValue(prompt.template);
    setIsEditing(false);
  };

  return (
    <Card data-testid={`card-detail-${prompt.key}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-lg">{prompt.name}</CardTitle>
          <Badge variant="outline" className="font-mono text-xs ml-auto">{prompt.key}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={category.color}>{category.label}</Badge>
          {projectType && (
            <Badge className={typeColors[projectType]}>
              Type {projectType}: {typeNames[projectType]}
            </Badge>
          )}
          <Badge variant="outline">{prompt.isSystemPrompt ? "System Prompt" : "User Prompt"}</Badge>
          {prompt.isCustomized && (
            <Badge variant="default" data-testid={`badge-customized-${prompt.key}`}>Customized</Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{prompt.description}</p>

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

        <Separator />

        {isEditing ? (
          <div className="space-y-4">
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[400px] font-mono text-sm"
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
                <X className="h-4 w-4 mr-2" />
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
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <pre
                className="p-4 rounded-md bg-muted/30 border text-sm font-mono whitespace-pre-wrap break-words max-h-[500px] overflow-auto leading-relaxed"
                data-testid={`text-prompt-template-${prompt.key}`}
              >
                {prompt.template}
              </pre>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={handleStartEdit} data-testid={`button-edit-prompt-${prompt.key}`}>
                <Pencil className="h-4 w-4 mr-2" />
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type FilterCategory = "all" | "extraction" | "mass_balance" | "capex" | "opex" | "workflow";

export default function DocsPrompts() {
  const searchParams = useSearch();
  const keyParam = new URLSearchParams(searchParams).get("key") as PromptKey | null;

  const { data: prompts, isLoading } = useQuery<PromptData[]>({
    queryKey: ["/api/prompts"],
  });

  const initialKey = keyParam && PROMPT_KEYS.includes(keyParam) ? keyParam : null;
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");

  const allPrompts = prompts || [];

  const filteredPrompts = allPrompts.filter(p => {
    const matchesSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.key.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesCategory = true;
    if (filterCategory === "extraction") matchesCategory = p.key.startsWith("extraction") || p.key === "classification";
    else if (filterCategory === "mass_balance") matchesCategory = p.key.startsWith("mass_balance");
    else if (filterCategory === "capex") matchesCategory = p.key.startsWith("capex");
    else if (filterCategory === "opex") matchesCategory = p.key.startsWith("opex");
    else if (filterCategory === "workflow") matchesCategory = ["clarify", "reviewer_chat", "pdf_summary"].includes(p.key);

    return matchesSearch && matchesCategory;
  });

  const selected = selectedKey ? allPrompts.find(p => p.key === selectedKey) || null : null;

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors" data-testid="link-dashboard">Dashboard</Link>
          <span>/</span>
          <Link href="/documentation" className="hover:text-foreground transition-colors" data-testid="link-docs">Documentation</Link>
          <span>/</span>
          <span className="text-foreground">AI Prompt Templates</span>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">AI Prompt Templates</h1>
            <p className="text-muted-foreground mt-1">
              Browse and edit the AI instructions used by the system
            </p>
          </div>
        </div>

        <div className="p-4 rounded-md border bg-muted/30 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              These are the exact instructions given to the AI at each step of the process.
              Click any prompt to see the full text and edit it. Changes are saved to the database
              and take effect immediately. You can always reset a prompt to its default.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {([
                { key: "all" as FilterCategory, label: "All", count: allPrompts.length, icon: Bot },
                { key: "extraction" as FilterCategory, label: "Extraction", count: allPrompts.filter(p => p.key.startsWith("extraction") || p.key === "classification").length, icon: Sparkles },
                { key: "mass_balance" as FilterCategory, label: "Mass Balance", count: allPrompts.filter(p => p.key.startsWith("mass_balance")).length, icon: Scale },
                { key: "capex" as FilterCategory, label: "CapEx", count: allPrompts.filter(p => p.key.startsWith("capex")).length, icon: DollarSign },
                { key: "opex" as FilterCategory, label: "OpEx", count: allPrompts.filter(p => p.key.startsWith("opex")).length, icon: Wrench },
                { key: "workflow" as FilterCategory, label: "Workflow", count: allPrompts.filter(p => ["clarify", "reviewer_chat", "pdf_summary"].includes(p.key)).length, icon: MessageSquare },
              ]).map(tab => (
                <Button
                  key={tab.key}
                  variant={filterCategory === tab.key ? "default" : "outline"}
                  onClick={() => { setFilterCategory(tab.key); setSelectedKey(null); }}
                  data-testid={`button-filter-${tab.key}`}
                >
                  <tab.icon className="h-4 w-4 mr-2" />
                  {tab.label} ({tab.count})
                </Button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search prompts by name, key, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-prompts"
              />
            </div>

            {selected ? (
              <PromptDetail prompt={selected} onBack={() => setSelectedKey(null)} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filteredPrompts.map((prompt) => {
                  const category = getCategory(prompt.key);
                  const projectType = getProjectType(prompt.key);
                  const Icon = category.icon;

                  return (
                    <Card
                      key={prompt.key}
                      className="cursor-pointer hover-elevate transition-colors"
                      onClick={() => setSelectedKey(prompt.key)}
                      data-testid={`card-prompt-${prompt.key}`}
                    >
                      <CardContent className="pt-4 pb-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon className="h-4 w-4 text-primary shrink-0" />
                            <h3 className="text-sm font-semibold truncate">{prompt.name}</h3>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {prompt.isCustomized && (
                              <Badge variant="default" className="text-xs">Customized</Badge>
                            )}
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`${category.color} text-xs`}>{category.label}</Badge>
                          {projectType && (
                            <Badge className={`${typeColors[projectType]} text-xs`}>Type {projectType}</Badge>
                          )}
                          <Badge variant="outline" className="font-mono text-xs">{prompt.key}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{prompt.description}</p>
                      </CardContent>
                    </Card>
                  );
                })}
                {filteredPrompts.length === 0 && (
                  <div className="col-span-full text-center py-12 text-muted-foreground">
                    <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No prompts match your search.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="pb-8" />
      </div>
    </div>
  );
}
