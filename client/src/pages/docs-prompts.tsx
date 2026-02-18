import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Bot, ChevronRight, Search, FileText, Sparkles,
  Scale, DollarSign, MessageSquare, Info, ListChecks
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { DEFAULT_PROMPTS, type PromptKey, type PromptTemplateDefault } from "@shared/default-prompts";

const categoryMap: Record<string, { label: string; color: string; icon: any }> = {
  classification: { label: "Classification", color: "bg-gray-600 dark:bg-gray-500", icon: ListChecks },
  extraction: { label: "Extraction", color: "bg-blue-600 dark:bg-blue-500", icon: Sparkles },
  clarify: { label: "Workflow", color: "bg-teal-600 dark:bg-teal-500", icon: MessageSquare },
  reviewer_chat: { label: "Workflow", color: "bg-teal-600 dark:bg-teal-500", icon: MessageSquare },
  pdf_summary: { label: "Workflow", color: "bg-teal-600 dark:bg-teal-500", icon: FileText },
  mass_balance: { label: "Mass Balance", color: "bg-green-600 dark:bg-green-500", icon: Scale },
  capex: { label: "CapEx", color: "bg-purple-600 dark:bg-purple-500", icon: DollarSign },
};

function getCategory(key: string) {
  if (key === "classification") return categoryMap.classification;
  if (key.startsWith("extraction")) return categoryMap.extraction;
  if (key === "clarify") return categoryMap.clarify;
  if (key === "reviewer_chat") return categoryMap.reviewer_chat;
  if (key === "pdf_summary") return categoryMap.pdf_summary;
  if (key.startsWith("mass_balance")) return categoryMap.mass_balance;
  if (key.startsWith("capex")) return categoryMap.capex;
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

function parsePromptToSections(template: string): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = [];
  const lines = template.split("\n");
  let currentHeading = "Overview";
  let currentContent: string[] = [];

  for (const line of lines) {
    const isHeader = /^[═]{3,}/.test(line.trim()) || /^#{1,3}\s/.test(line.trim());
    const isSectionTitle = /^[A-Z][A-Z\s&\-—:()\/]{5,}/.test(line.trim()) && !line.includes("{") && line.trim().length < 80;

    if (isHeader) {
      continue;
    }

    if (isSectionTitle && currentContent.length > 0) {
      sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      currentHeading = line.trim()
        .replace(/[═─—:]+$/g, "")
        .replace(/^[═─—:]+/g, "")
        .trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }

  return sections.filter(s => s.content.length > 0);
}

function PromptDetail({ prompt }: { prompt: PromptTemplateDefault }) {
  const category = getCategory(prompt.key);
  const projectType = getProjectType(prompt.key);
  const sections = parsePromptToSections(prompt.template);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={category.color}>{category.label}</Badge>
        {projectType && (
          <Badge className={typeColors[projectType]}>
            Type {projectType}: {typeNames[projectType]}
          </Badge>
        )}
        <Badge variant="outline">{prompt.isSystemPrompt ? "System Prompt" : "User Prompt"}</Badge>
      </div>

      <p className="text-sm text-muted-foreground">{prompt.description}</p>

      {prompt.availableVariables.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Dynamic values injected at runtime:</p>
          <div className="flex flex-wrap gap-1">
            {prompt.availableVariables.map(v => (
              <Badge key={v} variant="outline" className="font-mono text-xs">{v}</Badge>
            ))}
          </div>
        </div>
      )}

      <Separator />

      <div className="space-y-6">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-2">
            {section.heading !== "Overview" && (
              <h4 className="text-sm font-semibold text-foreground">{section.heading}</h4>
            )}
            <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-md p-4 border overflow-x-auto">
              {section.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type FilterCategory = "all" | "extraction" | "mass_balance" | "capex" | "workflow";

export default function DocsPrompts() {
  const [selectedKey, setSelectedKey] = useState<PromptKey | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");

  const allPrompts = Object.values(DEFAULT_PROMPTS);

  const filteredPrompts = allPrompts.filter(p => {
    const matchesSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.key.toLowerCase().includes(searchQuery.toLowerCase());

    let matchesCategory = true;
    if (filterCategory === "extraction") matchesCategory = p.key.startsWith("extraction") || p.key === "classification";
    else if (filterCategory === "mass_balance") matchesCategory = p.key.startsWith("mass_balance");
    else if (filterCategory === "capex") matchesCategory = p.key.startsWith("capex");
    else if (filterCategory === "workflow") matchesCategory = ["clarify", "reviewer_chat", "pdf_summary"].includes(p.key);

    return matchesSearch && matchesCategory;
  });

  const selected = selectedKey ? DEFAULT_PROMPTS[selectedKey] : null;

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
              Browse every AI instruction used by the system, in plain English
            </p>
          </div>
        </div>

        <div className="p-4 rounded-md border bg-muted/30 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              These are the exact instructions given to the AI at each step of the process.
              They tell the AI what role to play, what information to look for, and how to format
              its response. You can customize any of these prompts on the{" "}
              <Link href="/settings" className="text-primary hover:underline">Settings</Link> page.
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {([
            { key: "all" as FilterCategory, label: "All", count: allPrompts.length, icon: Bot },
            { key: "extraction" as FilterCategory, label: "Extraction", count: allPrompts.filter(p => p.key.startsWith("extraction") || p.key === "classification").length, icon: Sparkles },
            { key: "mass_balance" as FilterCategory, label: "Mass Balance", count: allPrompts.filter(p => p.key.startsWith("mass_balance")).length, icon: Scale },
            { key: "capex" as FilterCategory, label: "CapEx", count: allPrompts.filter(p => p.key.startsWith("capex")).length, icon: DollarSign },
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
          <Card data-testid={`card-detail-${selected.key}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setSelectedKey(null)} data-testid="button-back-to-list">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <CardTitle className="text-lg">{selected.name}</CardTitle>
                <Badge variant="outline" className="font-mono text-xs ml-auto">{selected.key}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <PromptDetail prompt={selected} />
            </CardContent>
          </Card>
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
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
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

        <div className="pb-8" />
      </div>
    </div>
  );
}
