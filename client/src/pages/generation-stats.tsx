import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import type { GenerationLog } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ArrowUpDown, Clock, FileText, Activity, BarChart3 } from "lucide-react";

type SortField = "createdAt" | "documentType" | "modelUsed" | "durationMs" | "projectName" | "scenarioName";
type SortDirection = "asc" | "desc";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toLocaleString()}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSec}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function modelLabel(model: string): string {
  const labels: Record<string, string> = {
    gpt5: "GPT-5",
    claude: "Claude Sonnet 4.5",
    "claude-opus": "Claude Opus 4.6",
    deterministic: "Deterministic Engine",
  };
  return labels[model] || model;
}

export default function GenerationStatsPage() {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filterType, setFilterType] = useState<string>("all");

  const { data: logs, isLoading } = useQuery<GenerationLog[]>({
    queryKey: ["/api/generation-stats"],
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const filteredLogs = (logs || []).filter(log => {
    if (filterType === "all") return true;
    return log.documentType === filterType;
  });

  const sortedLogs = [...filteredLogs].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortField) {
      case "createdAt":
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "durationMs":
        return dir * (a.durationMs - b.durationMs);
      case "documentType":
        return dir * a.documentType.localeCompare(b.documentType);
      case "modelUsed":
        return dir * a.modelUsed.localeCompare(b.modelUsed);
      case "projectName":
        return dir * (a.projectName || "").localeCompare(b.projectName || "");
      case "scenarioName":
        return dir * (a.scenarioName || "").localeCompare(b.scenarioName || "");
      default:
        return 0;
    }
  });

  const totalGenerations = logs?.length || 0;
  const successCount = logs?.filter(l => l.status === "success").length || 0;
  const avgDuration = successCount > 0
    ? Math.round(logs!.filter(l => l.status === "success").reduce((sum, l) => sum + l.durationMs, 0) / successCount)
    : 0;

  const documentTypes = Array.from(new Set((logs || []).map(l => l.documentType)));

  const docTypeOrder = ["Classification", "UPIF", "Mass Balance", "CapEx"];
  const modelOrder = ["gpt5", "claude", "claude-opus", "deterministic"];

  const aggregatedByOutput = (() => {
    if (!logs || logs.length === 0) return [];
    const successLogs = logs.filter(l => l.status === "success" && typeof l.durationMs === "number" && isFinite(l.durationMs) && l.durationMs > 0);
    const grouped: Record<string, Record<string, number[]>> = {};
    for (const log of successLogs) {
      const docType = log.documentType;
      const model = log.modelUsed;
      if (!grouped[docType]) grouped[docType] = {};
      if (!grouped[docType][model]) grouped[docType][model] = [];
      grouped[docType][model].push(log.durationMs as number);
    }
    const allDocTypes = Object.keys(grouped);
    allDocTypes.sort((a, b) => {
      const ai = docTypeOrder.indexOf(a);
      const bi = docTypeOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    const groups: { docType: string; rows: { model: string; count: number; avg: number; min: number; max: number }[] }[] = [];
    for (const docType of allDocTypes) {
      const models = Object.keys(grouped[docType]);
      models.sort((a, b) => {
        const ai = modelOrder.indexOf(a);
        const bi = modelOrder.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      const rows = models.map(model => {
        const durations = grouped[docType][model];
        return {
          model,
          count: durations.length,
          avg: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length),
          min: Math.min(...durations),
          max: Math.max(...durations),
        };
      });
      groups.push({ docType, rows });
    }
    return groups;
  })();

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      data-testid={`sort-${field}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
      {sortField === field && (
        <span className="text-foreground">{sortDirection === "asc" ? "\u2191" : "\u2193"}</span>
      )}
    </button>
  );

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Generation Stats</h1>
          <p className="text-sm text-muted-foreground">Track AI generation performance across all documents</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Generations</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-generations">
              {isLoading ? <Skeleton className="h-8 w-16" /> : totalGenerations.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-success-rate">
              {isLoading ? <Skeleton className="h-8 w-16" /> : totalGenerations > 0 ? `${Math.round((successCount / totalGenerations) * 100)}%` : "N/A"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Generation Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-avg-duration">
              {isLoading ? <Skeleton className="h-8 w-16" /> : successCount > 0 ? formatDuration(avgDuration) : "N/A"}
            </div>
          </CardContent>
        </Card>
      </div>

      {aggregatedByOutput.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
            <CardTitle className="text-base font-medium">Performance by Output</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-aggregated-stats">
                <TableHeader>
                  <TableRow>
                    <TableHead>Output</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-center">Generations</TableHead>
                    <TableHead className="text-right">Avg Time</TableHead>
                    <TableHead className="text-right">Min Time</TableHead>
                    <TableHead className="text-right">Max Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedByOutput.map((group) => (
                    group.rows.map((row, ri) => (
                      <TableRow key={`${group.docType}-${row.model}`} data-testid={`row-agg-${group.docType}-${row.model}`}>
                        {ri === 0 ? (
                          <TableCell
                            rowSpan={group.rows.length}
                            className="font-semibold align-top border-r whitespace-nowrap"
                          >
                            {group.docType}
                          </TableCell>
                        ) : null}
                        <TableCell className="whitespace-nowrap">{modelLabel(row.model)}</TableCell>
                        <TableCell className="text-center">{row.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{formatDuration(row.avg)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatDuration(row.min)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatDuration(row.max)}</TableCell>
                      </TableRow>
                    ))
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
          <CardTitle className="text-base font-medium">Generation Log</CardTitle>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-type">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {documentTypes.map(type => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : sortedLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-empty-state">
              No generation logs yet. Generate a UPIF or Mass Balance to see stats here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-generation-stats">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">
                      <SortButton field="createdAt" label="Date Generated" />
                    </th>
                    <th className="text-left py-3 px-2">
                      <SortButton field="documentType" label="Document" />
                    </th>
                    <th className="text-left py-3 px-2">
                      <SortButton field="modelUsed" label="Model Used" />
                    </th>
                    <th className="text-left py-3 px-2">
                      <SortButton field="projectName" label="Project" />
                    </th>
                    <th className="text-left py-3 px-2">
                      <SortButton field="scenarioName" label="Scenario" />
                    </th>
                    <th className="text-left py-3 px-2">
                      <SortButton field="durationMs" label="Time to Generate" />
                    </th>
                    <th className="text-left py-3 px-2">
                      <span className="text-xs font-medium text-muted-foreground">Status</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLogs.map(log => (
                    <tr key={log.id} className="border-b last:border-0" data-testid={`row-log-${log.id}`}>
                      <td className="py-3 px-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(log.createdAt as unknown as string)}
                      </td>
                      <td className="py-3 px-2">
                        <Badge variant="secondary" className="text-xs">
                          {log.documentType}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        {modelLabel(log.modelUsed)}
                      </td>
                      <td className="py-3 px-2">
                        {log.projectId ? (
                          <Link href={`/projects/${log.projectId}`}>
                            <span className="text-primary hover:underline cursor-pointer" data-testid={`link-project-${log.projectId}`}>
                              {log.projectName || "Unknown"}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        {log.scenarioId ? (
                          <Link href={`/scenarios/${log.scenarioId}`}>
                            <span className="text-primary hover:underline cursor-pointer" data-testid={`link-scenario-${log.scenarioId}`}>
                              {log.scenarioName || "Unknown"}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3 px-2 font-mono whitespace-nowrap">
                        {formatDuration(log.durationMs as number)}
                      </td>
                      <td className="py-3 px-2">
                        <Badge
                          variant={log.status === "success" ? "default" : "destructive"}
                          className="text-xs"
                          data-testid={`badge-status-${log.id}`}
                        >
                          {log.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
