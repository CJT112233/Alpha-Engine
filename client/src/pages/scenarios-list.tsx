import { Link, useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Beaker, ArrowLeft } from "lucide-react";
import type { Scenario } from "@shared/schema";
import { format } from "date-fns";

type StatusFilter = "all" | "in_progress" | "confirmed";

function getFilterFromSearch(search: string): StatusFilter {
  const params = new URLSearchParams(search);
  const f = params.get("filter");
  if (f === "in_progress") return "in_progress";
  if (f === "confirmed") return "confirmed";
  return "all";
}

export default function ScenariosList() {
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const filter = getFilterFromSearch(searchString);

  const { data: allScenarios, isLoading } = useQuery<(Scenario & { projectName: string })[]>({
    queryKey: ["/api/scenarios/recent"],
  });

  const filtered = allScenarios?.filter((s) => {
    if (filter === "all") return true;
    if (filter === "in_progress") return s.status === "draft" || s.status === "in_review";
    if (filter === "confirmed") return s.status === "confirmed";
    return true;
  });

  const filterButtons: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "all" },
    { label: "In Progress", value: "in_progress" },
    { label: "Confirmed", value: "confirmed" },
  ];

  function setFilter(value: StatusFilter) {
    if (value === "all") {
      navigate("/scenarios");
    } else {
      navigate(`/scenarios?filter=${value}`);
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-scenarios-title">
              All Scenarios
            </h1>
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Loading..." : `${filtered?.length || 0} scenario${(filtered?.length || 0) !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {filterButtons.map((btn) => (
            <Button
              key={btn.value}
              variant={filter === btn.value ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(btn.value)}
              data-testid={`button-filter-${btn.value}`}
            >
              {btn.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : filtered?.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Beaker className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium mb-1">No scenarios found</h3>
              <p className="text-sm text-muted-foreground">
                {filter !== "all"
                  ? "No scenarios match this filter. Try a different filter."
                  : "Create a project and add scenarios to evaluate."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered?.map((scenario) => (
              <Link key={scenario.id} href={`/scenarios/${scenario.id}`}>
                <div
                  className="flex items-center justify-between p-4 rounded-md border hover-elevate cursor-pointer"
                  data-testid={`card-scenario-${scenario.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <Beaker className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{scenario.name}</p>
                      <p className="text-xs text-muted-foreground">{scenario.projectName}</p>
                      <p className="text-xs text-muted-foreground">
                        Created {format(new Date(scenario.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      scenario.status === "confirmed"
                        ? "default"
                        : scenario.status === "in_review"
                        ? "secondary"
                        : "outline"
                    }
                    className="text-xs"
                  >
                    {scenario.status === "confirmed"
                      ? "Confirmed"
                      : scenario.status === "in_review"
                      ? "In Review"
                      : "Draft"}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
