import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Beaker, Droplets, FlaskConical, Leaf, Factory,
  ChevronRight, Search, Info
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  FEEDSTOCK_LIBRARY,
  WASTEWATER_INFLUENT_LIBRARY,
  feedstockGroupLabels,
  feedstockGroupOrder,
  type FeedstockProfile,
  type WastewaterInfluentProfile,
  type FeedstockProperty,
} from "@shared/feedstock-library";
import {
  OUTPUT_CRITERIA_LIBRARY,
  outputGroupLabels,
  outputGroupOrder,
  type OutputProfile,
  type OutputCriterion,
} from "@shared/output-criteria-library";

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

function FeedstockDetail({ profile, type }: { profile: FeedstockProfile | WastewaterInfluentProfile | OutputProfile; type: "feedstock" | "wastewater" | "output" }) {
  const properties = type === "output"
    ? (profile as OutputProfile).criteria
    : (profile as FeedstockProfile | WastewaterInfluentProfile).properties;

  const groupLabelsMap = type === "output" ? outputGroupLabels : feedstockGroupLabels;
  const groupOrderList = type === "output" ? outputGroupOrder : feedstockGroupOrder;

  const grouped: Record<string, { key: string; prop: FeedstockProperty | OutputCriterion }[]> = {};
  for (const [key, prop] of Object.entries(properties)) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">{profile.category}</Badge>
        {type === "wastewater" && <Badge className="bg-blue-600 dark:bg-blue-500">Wastewater</Badge>}
        {type === "feedstock" && <Badge className="bg-green-600 dark:bg-green-500">AD Feedstock</Badge>}
        {type === "output" && <Badge className="bg-purple-600 dark:bg-purple-500">Output Criteria</Badge>}
      </div>

      {"aliases" in profile && profile.aliases.length > 0 && (
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
    </div>
  );
}

type LibraryTab = "feedstock" | "wastewater" | "output";

export default function DocsFeedstockLibrary() {
  const [activeTab, setActiveTab] = useState<LibraryTab>("feedstock");
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filterBySearch = (name: string, aliases: string[]) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return name.toLowerCase().includes(q) || aliases.some(a => a.toLowerCase().includes(q));
  };

  const filteredFeedstocks = FEEDSTOCK_LIBRARY.filter(p => filterBySearch(p.name, p.aliases));
  const filteredWastewater = WASTEWATER_INFLUENT_LIBRARY.filter(p => filterBySearch(p.name, p.aliases));
  const filteredOutputs = OUTPUT_CRITERIA_LIBRARY.filter(p => filterBySearch(p.name, p.aliases));

  const currentList = activeTab === "feedstock" ? filteredFeedstocks
    : activeTab === "wastewater" ? filteredWastewater
    : filteredOutputs;

  const getSelectedProfile = () => {
    if (!selectedProfile) return null;
    if (activeTab === "feedstock") return FEEDSTOCK_LIBRARY.find(p => p.name === selectedProfile);
    if (activeTab === "wastewater") return WASTEWATER_INFLUENT_LIBRARY.find(p => p.name === selectedProfile);
    return OUTPUT_CRITERIA_LIBRARY.find(p => p.name === selectedProfile);
  };

  const selected = getSelectedProfile();

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
              Browse the complete feedstock profiles, wastewater influent profiles, and output acceptance criteria used by the system
            </p>
          </div>
        </div>

        <div className="p-4 rounded-md border bg-muted/30 space-y-2">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              These libraries provide default values when the AI extracts parameters from your project description.
              If you provide a specific value, your value always takes priority. Default values are only used
              to fill in missing information, and each one includes a confidence level and a source reference
              explaining where the number comes from.
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={activeTab === "feedstock" ? "default" : "outline"}
            onClick={() => { setActiveTab("feedstock"); setSelectedProfile(null); }}
            data-testid="button-tab-feedstock"
          >
            <Leaf className="h-4 w-4 mr-2" />
            AD Feedstocks ({FEEDSTOCK_LIBRARY.length})
          </Button>
          <Button
            variant={activeTab === "wastewater" ? "default" : "outline"}
            onClick={() => { setActiveTab("wastewater"); setSelectedProfile(null); }}
            data-testid="button-tab-wastewater"
          >
            <Droplets className="h-4 w-4 mr-2" />
            Wastewater Influent ({WASTEWATER_INFLUENT_LIBRARY.length})
          </Button>
          <Button
            variant={activeTab === "output" ? "default" : "outline"}
            onClick={() => { setActiveTab("output"); setSelectedProfile(null); }}
            data-testid="button-tab-output"
          >
            <Factory className="h-4 w-4 mr-2" />
            Output Criteria ({OUTPUT_CRITERIA_LIBRARY.length})
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
          <Card data-testid={`card-detail-${selected.name}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setSelectedProfile(null)} data-testid="button-back-to-list">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <CardTitle className="text-lg">{selected.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <FeedstockDetail profile={selected} type={activeTab} />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {currentList.map((profile) => {
              const propCount = "properties" in profile
                ? Object.keys(profile.properties).length
                : Object.keys((profile as OutputProfile).criteria).length;

              return (
                <Card
                  key={profile.name}
                  className="cursor-pointer hover-elevate transition-colors"
                  onClick={() => setSelectedProfile(profile.name)}
                  data-testid={`card-profile-${profile.name}`}
                >
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{profile.name}</h3>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">{profile.category}</Badge>
                      <span className="text-xs text-muted-foreground">{propCount} parameters</span>
                    </div>
                    {"aliases" in profile && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {(profile as any).aliases.slice(0, 4).join(", ")}
                        {(profile as any).aliases.length > 4 ? `, +${(profile as any).aliases.length - 4} more` : ""}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {currentList.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No profiles match your search.</p>
              </div>
            )}
          </div>
        )}

        <div className="pb-8" />
      </div>
    </div>
  );
}
