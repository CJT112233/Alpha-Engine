import { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Wrench, ChevronRight, FileCode, Hash, Code } from "lucide-react";

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

type CalculatorListItem = {
  key: string;
  file: string;
  label: string;
  type: string;
  description: string;
};

type CalculatorDetail = CalculatorListItem & {
  source: string;
  lineCount: number;
};

export default function DocsCalculators() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const typeParam = params.get("type");

  const [selectedType, setSelectedType] = useState<string | null>(typeParam?.toUpperCase() || null);

  useEffect(() => {
    const normalized = typeParam?.toUpperCase() || null;
    if (normalized !== selectedType) {
      setSelectedType(normalized);
    }
  }, [typeParam]);

  const { data: calculators } = useQuery<CalculatorListItem[]>({
    queryKey: ["/api/calculators"],
  });

  const { data: detail, isLoading: detailLoading } = useQuery<CalculatorDetail>({
    queryKey: ["/api/calculators", selectedType],
    enabled: !!selectedType,
  });

  if (selectedType && detail) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="calculator-detail-view">
        <Button variant="ghost" asChild data-testid="button-back-to-calculator-list">
          <Link href="/docs/calculators">
            <ArrowLeft className="h-4 w-4 mr-2" />
            All Calculators
          </Link>
        </Button>

        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={typeColors[detail.type]}>{`Type ${detail.type}`}</Badge>
            <Badge variant="outline">{typeNames[detail.type]}</Badge>
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-calculator-title">{detail.label}</h1>
          <p className="text-muted-foreground">{detail.description}</p>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <FileCode className="h-4 w-4" />
            {detail.file}
          </span>
          <span className="flex items-center gap-1">
            <Hash className="h-4 w-4" />
            {detail.lineCount.toLocaleString()} lines
          </span>
        </div>

        <Separator />

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Code className="h-4 w-4" />
              Source Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono whitespace-pre overflow-x-auto overflow-y-auto max-h-[70vh] p-4 bg-muted/50 rounded-md" data-testid="calculator-source-code">
              {detail.source}
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedType && detailLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/docs/calculators">
            <ArrowLeft className="h-4 w-4 mr-2" />
            All Calculators
          </Link>
        </Button>
        <div className="text-muted-foreground">Loading calculator source...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="calculator-list-view">
      <Button variant="ghost" asChild data-testid="button-back-to-docs">
        <Link href="/documentation">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Documentation
        </Link>
      </Button>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Deterministic Mass Balance Calculators</h1>
        <p className="text-muted-foreground">
          Engineering-grade calculators with hardcoded design criteria from WEF MOP 8 and Ten States Standards.
          One calculator per project type. Used automatically as fallback when AI generation fails.
          All calculations use US customary units.
        </p>
      </div>

      <Separator />

      <div className="grid gap-4 md:grid-cols-2">
        {(calculators || []).map((calc) => (
          <Card
            key={calc.key}
            className="cursor-pointer hover-elevate"
            onClick={() => setSelectedType(calc.key)}
            data-testid={`card-calculator-${calc.key}`}
          >
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={typeColors[calc.type]}>{`Type ${calc.type}`}</Badge>
                <CardTitle className="text-sm">{calc.label}</CardTitle>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{calc.description}</p>
              <div className="flex items-center gap-2 mt-2">
                <Wrench className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-mono text-muted-foreground">{calc.file}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
