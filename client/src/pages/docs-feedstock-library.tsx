import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Beaker, Droplets, FlaskConical, Leaf, Factory,
  ChevronRight, Search, Info, Pencil, Save, X, RotateCcw
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  feedstockGroupLabels,
  feedstockGroupOrder,
  type FeedstockProperty,
} from "@shared/feedstock-library";
import {
  outputGroupLabels,
  outputGroupOrder,
  type OutputCriterion,
} from "@shared/output-criteria-library";

interface LibraryProfile {
  id: string;
  libraryType: string;
  name: string;
  aliases: string[];
  category: string;
  properties: Record<string, FeedstockProperty | OutputCriterion>;
  sortOrder: number;
  isCustomized: boolean;
  updatedAt: string;
}

const confidenceColors: Record<string, string> = {
  high: "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30",
  medium: "text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30",
  low: "text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30",
};

function PropertyRow({ prop, propKey }: { prop: FeedstockProperty | OutputCriterion; propKey: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 border-b last:border-b-0 items-start" data-testid={`row-property-${propKey}`}>
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{prop.displayName}</span>
          {prop.unit && <span className="text-xs text-muted-foreground">({prop.unit})</span>}
        </div>
        <p className="text-sm">{prop.value}{prop.unit ? ` ${prop.unit}` : ""}</p>
        <p className="text-xs text-muted-foreground italic">{prop.provenance}</p>
      </div>
      <Badge variant="outline" className={`text-xs shrink-0 ${confidenceColors[prop.confidence]}`}>
        {prop.confidence}
      </Badge>
      <Badge variant="secondary" className="text-xs shrink-0 capitalize">{prop.group}</Badge>
    </div>
  );
}

function ProfileDetail({ profile, type, onBack }: { profile: LibraryProfile; type: LibraryTab; onBack: () => void }) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editJson, setEditJson] = useState("");

  const groupLabelsMap = type === "output" ? outputGroupLabels : feedstockGroupLabels;
  const groupOrderList = type === "output" ? outputGroupOrder : feedstockGroupOrder;

  const grouped: Record<string, { key: string; prop: FeedstockProperty | OutputCriterion }[]> = {};
  for (const [key, prop] of Object.entries(profile.properties)) {
    const group = prop.group;
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ key, prop });
  }
  for (const group of Object.values(grouped)) {
    group.sort((a, b) => a.prop.sortOrder - b.prop.sortOrder);
  }
  const sortedGroups = Object.keys(grouped).sort((a, b) => {
    const ai = groupOrderList.indexOf(a);
    const bi = groupOrderList.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<LibraryProfile>) => {
      const res = await apiRequest("PATCH", `/api/library-profiles/${profile.libraryType}/${profile.id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library-profiles", profile.libraryType] });
      setIsEditing(false);
      toast({ title: "Profile saved", description: `"${profile.name}" has been updated.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save profile.", variant: "destructive" });
    },
  });

  const handleStartEdit = () => {
    setEditJson(JSON.stringify(profile.properties, null, 2));
    setIsEditing(true);
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editJson);
      saveMutation.mutate({ properties: parsed });
    } catch {
      toast({ title: "Invalid JSON", description: "Please check the JSON format and try again.", variant: "destructive" });
    }
  };

  const apiType = type === "feedstock" ? "feedstock" : type === "wastewater" ? "wastewater_influent" : "output_criteria";

  return (
    <Card data-testid={`card-detail-${profile.name}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-lg">{profile.name}</CardTitle>
          {profile.isCustomized && (
            <Badge variant="default" className="ml-auto">Customized</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">{profile.category}</Badge>
          {type === "wastewater" && <Badge className="bg-blue-600 dark:bg-blue-500">Wastewater</Badge>}
          {type === "feedstock" && <Badge className="bg-green-600 dark:bg-green-500">AD Feedstock</Badge>}
          {type === "output" && <Badge className="bg-purple-600 dark:bg-purple-500">Output Criteria</Badge>}
        </div>

        {profile.aliases.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Also known as:</p>
            <div className="flex flex-wrap gap-1">
              {profile.aliases.map((a: string) => (
                <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {isEditing ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Edit the properties JSON below. Each property needs: value, unit, confidence, provenance, group, displayName, sortOrder.
            </p>
            <Textarea
              value={editJson}
              onChange={(e) => setEditJson(e.target.value)}
              className="min-h-[400px] font-mono text-xs"
              data-testid={`textarea-properties-${profile.id}`}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                data-testid={`button-save-profile-${profile.id}`}
              >
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditing(false)}
                disabled={saveMutation.isPending}
                data-testid={`button-cancel-profile-${profile.id}`}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {sortedGroups.map((group) => (
              <div key={group} className="space-y-1">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {groupLabelsMap[group] || group}
                </h4>
                <div>
                  {grouped[group].map(({ key, prop }) => (
                    <PropertyRow key={key} propKey={key} prop={prop} />
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleStartEdit} data-testid={`button-edit-profile-${profile.id}`}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit Properties
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type LibraryTab = "feedstock" | "wastewater" | "output";

const apiTypeMap: Record<LibraryTab, string> = {
  feedstock: "feedstock",
  wastewater: "wastewater_influent",
  output: "output_criteria",
};

export default function DocsFeedstockLibrary() {
  const searchParams = useSearch();
  const initialTab = searchParams.includes("tab=output") ? "output" as LibraryTab
    : searchParams.includes("tab=wastewater") ? "wastewater" as LibraryTab
    : "feedstock" as LibraryTab;

  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: feedstockProfiles = [], isLoading: loadingFeedstock } = useQuery<LibraryProfile[]>({
    queryKey: ["/api/library-profiles", "feedstock"],
    queryFn: async () => {
      const res = await fetch("/api/library-profiles/feedstock");
      return res.json();
    },
  });

  const { data: wastewaterProfiles = [], isLoading: loadingWastewater } = useQuery<LibraryProfile[]>({
    queryKey: ["/api/library-profiles", "wastewater_influent"],
    queryFn: async () => {
      const res = await fetch("/api/library-profiles/wastewater_influent");
      return res.json();
    },
  });

  const { data: outputProfiles = [], isLoading: loadingOutput } = useQuery<LibraryProfile[]>({
    queryKey: ["/api/library-profiles", "output_criteria"],
    queryFn: async () => {
      const res = await fetch("/api/library-profiles/output_criteria");
      return res.json();
    },
  });

  const isLoading = loadingFeedstock || loadingWastewater || loadingOutput;

  const filterBySearch = (profile: LibraryProfile) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return profile.name.toLowerCase().includes(q) ||
      profile.aliases.some(a => a.toLowerCase().includes(q));
  };

  const currentProfiles = activeTab === "feedstock" ? feedstockProfiles
    : activeTab === "wastewater" ? wastewaterProfiles
    : outputProfiles;

  const filteredList = currentProfiles.filter(filterBySearch);
  const selected = selectedId ? currentProfiles.find(p => p.id === selectedId) || null : null;

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors" data-testid="link-dashboard">Dashboard</Link>
          <span>/</span>
          <Link href="/documentation" className="hover:text-foreground transition-colors" data-testid="link-docs">Documentation</Link>
          <span>/</span>
          <span className="text-foreground">Reference Libraries</span>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Beaker className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Reference Libraries</h1>
            <p className="text-muted-foreground mt-1">
              Browse and edit feedstock profiles, wastewater influent profiles, and output acceptance criteria
            </p>
          </div>
        </div>

        <div className="p-4 rounded-md border bg-muted/30 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              These libraries provide default values when the AI extracts parameters from your project description.
              Click any profile to see and edit its properties. Changes are saved to the database and take
              effect immediately. Each property includes a confidence level and source reference.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={activeTab === "feedstock" ? "default" : "outline"}
                onClick={() => { setActiveTab("feedstock"); setSelectedId(null); }}
                data-testid="button-tab-feedstock"
              >
                <Leaf className="h-4 w-4 mr-2" />
                AD Feedstocks ({feedstockProfiles.length})
              </Button>
              <Button
                variant={activeTab === "wastewater" ? "default" : "outline"}
                onClick={() => { setActiveTab("wastewater"); setSelectedId(null); }}
                data-testid="button-tab-wastewater"
              >
                <Droplets className="h-4 w-4 mr-2" />
                Wastewater Influent ({wastewaterProfiles.length})
              </Button>
              <Button
                variant={activeTab === "output" ? "default" : "outline"}
                onClick={() => { setActiveTab("output"); setSelectedId(null); }}
                data-testid="button-tab-output"
              >
                <Factory className="h-4 w-4 mr-2" />
                Output Criteria ({outputProfiles.length})
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search profiles by name or alias..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-profiles"
              />
            </div>

            {selected ? (
              <ProfileDetail
                profile={selected}
                type={activeTab}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredList.map((profile) => {
                  const propCount = Object.keys(profile.properties).length;

                  return (
                    <Card
                      key={profile.id}
                      className="cursor-pointer hover-elevate transition-colors"
                      onClick={() => setSelectedId(profile.id)}
                      data-testid={`card-profile-${profile.name}`}
                    >
                      <CardContent className="pt-4 pb-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold">{profile.name}</h3>
                          <div className="flex items-center gap-1 shrink-0">
                            {profile.isCustomized && (
                              <Badge variant="default" className="text-xs">Customized</Badge>
                            )}
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">{profile.category}</Badge>
                          <span className="text-xs text-muted-foreground">{propCount} parameters</span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {profile.aliases.slice(0, 4).join(", ")}
                          {profile.aliases.length > 4 ? `, +${profile.aliases.length - 4} more` : ""}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
                {filteredList.length === 0 && (
                  <div className="col-span-full text-center py-12 text-muted-foreground">
                    <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No profiles match your search.</p>
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
