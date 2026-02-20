import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Shield, ChevronRight, Search, Info,
  Pencil, Save, X, Settings2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ValidationConfigItem {
  id: string;
  configKey: string;
  configValue: any;
  description: string | null;
  category: string;
  updatedAt: string;
}

const categoryColors: Record<string, string> = {
  flow_estimation: "bg-blue-600 dark:bg-blue-500",
  unit_conversion: "bg-teal-600 dark:bg-teal-500",
  type_a_display: "bg-indigo-600 dark:bg-indigo-500",
  type_a_validation: "bg-orange-600 dark:bg-orange-500",
  gas_quality: "bg-green-600 dark:bg-green-500",
  guardrails: "bg-red-600 dark:bg-red-500",
  general: "bg-gray-600 dark:bg-gray-500",
};

const categoryLabels: Record<string, string> = {
  flow_estimation: "Flow Estimation",
  unit_conversion: "Unit Conversion",
  type_a_display: "Type A Display",
  type_a_validation: "Type A Validation",
  gas_quality: "Gas Quality",
  guardrails: "Guardrails",
  general: "General",
};

function ConfigDetail({ config, onBack }: { config: ValidationConfigItem; onBack: () => void }) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editJson, setEditJson] = useState("");

  const saveMutation = useMutation({
    mutationFn: async (configValue: any) => {
      const res = await apiRequest("PATCH", `/api/validation-config/${config.configKey}`, { configValue });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/validation-config"] });
      setIsEditing(false);
      toast({ title: "Config saved", description: `"${config.configKey}" has been updated.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save config.", variant: "destructive" });
    },
  });

  const handleStartEdit = () => {
    setEditJson(JSON.stringify(config.configValue, null, 2));
    setIsEditing(true);
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editJson);
      saveMutation.mutate(parsed);
    } catch {
      toast({ title: "Invalid JSON", description: "Please check the JSON format and try again.", variant: "destructive" });
    }
  };

  return (
    <Card data-testid={`card-detail-${config.configKey}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-lg">{config.configKey}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={categoryColors[config.category] || categoryColors.general}>
            {categoryLabels[config.category] || config.category}
          </Badge>
          <Badge variant="outline" className="font-mono text-xs">{config.configKey}</Badge>
        </div>

        {config.description && (
          <p className="text-sm text-muted-foreground">{config.description}</p>
        )}

        <Separator />

        {isEditing ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Edit the configuration value below (JSON format).
            </p>
            <Textarea
              value={editJson}
              onChange={(e) => setEditJson(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
              data-testid={`textarea-config-${config.configKey}`}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                data-testid={`button-save-config-${config.configKey}`}
              >
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditing(false)}
                disabled={saveMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <pre
                className="p-4 rounded-md bg-muted/30 border text-sm font-mono whitespace-pre-wrap break-words max-h-[400px] overflow-auto leading-relaxed"
                data-testid={`text-config-value-${config.configKey}`}
              >
                {JSON.stringify(config.configValue, null, 2)}
              </pre>
            </div>
            <Button onClick={handleStartEdit} data-testid={`button-edit-config-${config.configKey}`}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit Value
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function DocsValidationConfig() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const { data: configs = [], isLoading } = useQuery<ValidationConfigItem[]>({
    queryKey: ["/api/validation-config"],
  });

  const categories = Array.from(new Set(configs.map(c => c.category)));

  const filtered = configs.filter(c => {
    const matchesSearch = !searchQuery ||
      c.configKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === "all" || c.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const selected = selectedKey ? configs.find(c => c.configKey === selectedKey) || null : null;

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors" data-testid="link-dashboard">Dashboard</Link>
          <span>/</span>
          <Link href="/documentation" className="hover:text-foreground transition-colors" data-testid="link-docs">Documentation</Link>
          <span>/</span>
          <span className="text-foreground">Validation Config</span>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Validation Configuration</h1>
            <p className="text-muted-foreground mt-1">
              View and edit the thresholds, factors, and parameters used in the validation pipeline
            </p>
          </div>
        </div>

        <div className="p-4 rounded-md border bg-muted/30 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              These settings control how the validation pipeline processes data. Changes take effect
              immediately. Be careful when modifying thresholds as they affect data quality checks
              across all projects.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={filterCategory === "all" ? "default" : "outline"}
                onClick={() => { setFilterCategory("all"); setSelectedKey(null); }}
                data-testid="button-filter-all"
              >
                <Settings2 className="h-4 w-4 mr-2" />
                All ({configs.length})
              </Button>
              {categories.map(cat => (
                <Button
                  key={cat}
                  variant={filterCategory === cat ? "default" : "outline"}
                  onClick={() => { setFilterCategory(cat); setSelectedKey(null); }}
                  data-testid={`button-filter-${cat}`}
                >
                  {categoryLabels[cat] || cat} ({configs.filter(c => c.category === cat).length})
                </Button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search config by key or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-config"
              />
            </div>

            {selected ? (
              <ConfigDetail config={selected} onBack={() => setSelectedKey(null)} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((config) => (
                  <Card
                    key={config.configKey}
                    className="cursor-pointer hover-elevate transition-colors"
                    onClick={() => setSelectedKey(config.configKey)}
                    data-testid={`card-config-${config.configKey}`}
                  >
                    <CardContent className="pt-4 pb-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold font-mono">{config.configKey}</h3>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                      <Badge className={`${categoryColors[config.category] || categoryColors.general} text-xs`}>
                        {categoryLabels[config.category] || config.category}
                      </Badge>
                      {config.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{config.description}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {filtered.length === 0 && (
                  <div className="col-span-full text-center py-12 text-muted-foreground">
                    <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No config entries match your search.</p>
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
