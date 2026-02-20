import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRight, BookOpen, Beaker, FileUp, Sparkles, FileText, MessageSquare,
  MapPin, Settings2, FileOutput, FlaskConical, Shield, AlertTriangle,
  CheckCircle2, ArrowDown, Scale, DollarSign, Wrench, Zap, Droplets,
  Flame, Factory, GitBranch, ArrowLeftRight, ListChecks, Database,
  Bot, Eye, Lock, Pencil, ChevronRight
} from "lucide-react";

function SectionHeading({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-4 mb-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function FlowStep({ step, title, description, icon: Icon, badges, isLast }: {
  step: number; title: string; description: string; icon: any; badges?: string[]; isLast?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
          {step}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-2" />}
      </div>
      <div className="pb-8">
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className="h-4 w-4 text-primary shrink-0" />
          <h4 className="font-medium">{title}</h4>
          {badges?.map(b => <Badge key={b} variant="outline">{b}</Badge>)}
        </div>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

function PromptLink({ name, promptKey, description }: { name: string; promptKey: string; description: string }) {
  return (
    <Link href={`/docs/prompts?key=${promptKey}`} className="block p-3 rounded-md border hover-elevate transition-colors" data-testid={`link-prompt-${promptKey}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium">{name}</span>
        </div>
        <Badge variant="outline" className="font-mono text-xs">{promptKey}</Badge>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </Link>
  );
}

function CalculatorLink({ name, type, description }: { name: string; type: string; description: string }) {
  return (
    <Link href={`/docs/calculators?type=${type}`} className="block p-3 rounded-md border hover-elevate transition-colors" data-testid={`link-calculator-${type}`}>
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium">{name}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </Link>
  );
}

function GuardrailItem({ code, name, description, severity }: { code: string; name: string; description: string; severity: "error" | "warning" | "info" }) {
  const severityColors = {
    error: "text-red-600 dark:text-red-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    info: "text-blue-600 dark:text-blue-400",
  };
  return (
    <div className="p-3 rounded-md border space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="font-mono text-xs">{code}</Badge>
        <span className="text-sm font-medium">{name}</span>
        <Badge variant="secondary" className={`text-xs ${severityColors[severity]}`}>{severity}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export default function Documentation() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-5xl mx-auto p-6 space-y-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/" className="hover:text-foreground transition-colors" data-testid="link-dashboard">
            Dashboard
          </Link>
          <span>/</span>
          <span className="text-foreground">Documentation</span>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Project Factory Documentation</h1>
            <p className="text-muted-foreground mt-1">
              Complete reference for the AI-powered project intake, mass balance, and cost estimation pipeline
            </p>
          </div>
        </div>

        <Card data-testid="card-table-of-contents">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1 md:grid-cols-2">
              {[
                { label: "Project Types (A, B, C, D)", anchor: "#project-types" },
                { label: "End-to-End Process Flow", anchor: "#process-flow" },
                { label: "Step 1: Project Type Selection", anchor: "#classification" },
                { label: "Step 2: Parameter Extraction", anchor: "#extraction" },
                { label: "Step 3: Feedstock & Output Enrichment", anchor: "#enrichment" },
                { label: "Step 4: Validation Pipeline", anchor: "#validation" },
                { label: "Step 5: UPIF Generation & Review", anchor: "#upif" },
                { label: "Step 6: Mass Balance & Equipment List", anchor: "#mass-balance" },
                { label: "Step 7: CapEx Estimation", anchor: "#capex" },
                { label: "AI Models & Prompt Templates", anchor: "#prompts" },
                { label: "Unit Conventions", anchor: "#units" },
              ].map(item => (
                <a
                  key={item.anchor}
                  href={item.anchor}
                  className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover-elevate transition-colors"
                  data-testid={`link-toc-${item.anchor.slice(1)}`}
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  {item.label}
                </a>
              ))}
              <Separator className="col-span-full my-1" />
              <Link
                href="/docs/feedstock-library"
                className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover-elevate transition-colors font-medium"
                data-testid="link-toc-feedstock-library"
              >
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                Reference Libraries (Feedstock, Wastewater, Output)
              </Link>
              <Link
                href="/docs/prompts"
                className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover-elevate transition-colors font-medium"
                data-testid="link-toc-prompts"
              >
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                AI Prompt Templates (Full Text)
              </Link>
              <Link
                href="/docs/validation-config"
                className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover-elevate transition-colors font-medium"
                data-testid="link-toc-validation-config"
              >
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                Validation Configuration
              </Link>
            </div>
          </CardContent>
        </Card>

        <div id="project-types" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={Factory} title="Project Types" subtitle="Four distinct project configurations supported by the system" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 rounded-md border space-y-2" data-testid="card-type-a">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-blue-600 dark:bg-blue-500">Type A</Badge>
                    <span className="font-medium text-sm">Wastewater Treatment</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    High-strength industrial wastewater from food processing (dairy, meat, potato, beverage, produce).
                    Treats influent via anaerobic digestion to meet effluent discharge standards.
                    RNG may be a byproduct when organic loading justifies it.
                  </p>
                  <div className="text-xs space-y-1">
                    <p className="font-medium">Key Inputs:</p>
                    <p className="text-muted-foreground">Influent flow (GPD/MGD), BOD, COD, TSS, FOG, TKN, pH</p>
                    <p className="font-medium mt-1">Outputs:</p>
                    <p className="text-muted-foreground">Treated effluent to WWTP, optional RNG, dewatered solids</p>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Badge variant="outline" className="text-xs font-mono">extraction_type_a</Badge>
                    <Badge variant="outline" className="text-xs font-mono">mass_balance_type_a</Badge>
                    <Badge variant="outline" className="text-xs font-mono">capex_type_a</Badge>
                  </div>
                </div>

                <div className="p-4 rounded-md border space-y-2" data-testid="card-type-b">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-green-600 dark:bg-green-500">Type B</Badge>
                    <span className="font-medium text-sm">RNG Greenfield</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Full anaerobic digestion pipeline from feedstock receiving through RNG production.
                    Handles solid and semi-solid organic feedstocks (food waste, manure, crop residuals).
                    Complete process train: receiving, pretreatment, digestion, gas conditioning, upgrading.
                  </p>
                  <div className="text-xs space-y-1">
                    <p className="font-medium">Key Inputs:</p>
                    <p className="text-muted-foreground">Feedstock tonnage (tons/day), TS%, VS/TS, BMP, C:N ratio</p>
                    <p className="font-medium mt-1">Outputs:</p>
                    <p className="text-muted-foreground">Pipeline-quality RNG, solid digestate, liquid centrate</p>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Badge variant="outline" className="text-xs font-mono">extraction_type_b</Badge>
                    <Badge variant="outline" className="text-xs font-mono">mass_balance_type_b</Badge>
                    <Badge variant="outline" className="text-xs font-mono">capex_type_b</Badge>
                  </div>
                </div>

                <div className="p-4 rounded-md border space-y-2" data-testid="card-type-c">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-orange-600 dark:bg-orange-500">Type C</Badge>
                    <span className="font-medium text-sm">RNG Bolt-On</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Biogas-only inputs. An existing facility already produces biogas; this project adds
                    gas conditioning and upgrading equipment to convert raw biogas to pipeline-quality RNG.
                    No digester sizing needed.
                  </p>
                  <div className="text-xs space-y-1">
                    <p className="font-medium">Key Inputs:</p>
                    <p className="text-muted-foreground">Biogas flow (scfm), CH4%, CO2%, H2S (ppmv), siloxanes</p>
                    <p className="font-medium mt-1">Outputs:</p>
                    <p className="text-muted-foreground">Pipeline-quality RNG, tail gas</p>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Badge variant="outline" className="text-xs font-mono">extraction_type_c</Badge>
                    <Badge variant="outline" className="text-xs font-mono">mass_balance_type_c</Badge>
                    <Badge variant="outline" className="text-xs font-mono">capex_type_c</Badge>
                  </div>
                </div>

                <div className="p-4 rounded-md border space-y-2" data-testid="card-type-d">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-purple-600 dark:bg-purple-500">Type D</Badge>
                    <span className="font-medium text-sm">Hybrid</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Combines wastewater treatment (Type A) with sludge digestion and RNG production.
                    Wastewater is treated, sludge is thickened and digested, biogas is upgraded to RNG.
                    Optional co-digestion with trucked organic feedstocks for additional gas production.
                  </p>
                  <div className="text-xs space-y-1">
                    <p className="font-medium">Key Inputs:</p>
                    <p className="text-muted-foreground">Influent flow + analytes AND trucked feedstock specs (TS/VS/BMP/C:N)</p>
                    <p className="font-medium mt-1">Outputs:</p>
                    <p className="text-muted-foreground">Treated effluent, RNG, dewatered biosolids</p>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Badge variant="outline" className="text-xs font-mono">extraction_type_d</Badge>
                    <Badge variant="outline" className="text-xs font-mono">mass_balance_type_d</Badge>
                    <Badge variant="outline" className="text-xs font-mono">capex_type_d</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div id="process-flow" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={GitBranch} title="End-to-End Process Flow" subtitle="The complete pipeline from raw input to cost estimate" />
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                <FlowStep step={1} icon={ListChecks} title="Project Type Selection" badges={["User-Selected"]}
                  description="The user selects the project type (A, B, C, or D) when creating a scenario. This selection drives which extraction prompt, validation guardrails, and mass balance model apply downstream." />
                <FlowStep step={2} icon={Sparkles} title="Parameter Extraction" badges={["AI", "Type-Specific"]}
                  description="Using the classified type, a type-specific AI prompt extracts every technical parameter from user text and uploaded documents. Returns structured JSON with feedstock specs, location, outputs, and constraints." />
                <FlowStep step={3} icon={Database} title="Feedstock & Output Enrichment" badges={["Knowledge Base"]}
                  description="Extracted feedstock types are matched against a built-in library of AD feedstock characteristics. Missing parameters (TS%, VS/TS, BMP, C:N, etc.) are filled with industry defaults. Output profiles are enriched with acceptance criteria." />
                <FlowStep step={4} icon={Shield} title="Validation Pipeline" badges={["10 Guardrails"]}
                  description="A multi-step validation pipeline runs 10 guardrails to ensure data integrity: biosolids rejection, output spec sanitization, type-specific feedstock validation, TS/TSS guardrail, swap detection, biogas vs. RNG separation, and design driver completeness." />
                <FlowStep step={5} icon={FileText} title="UPIF Generation & Review" badges={["Interactive"]}
                  description="All extracted, enriched, and validated data is consolidated into the Unified Project Intake Form (UPIF). Users review every parameter, confirm or override values, and lock fields. AI reviewer chat allows natural-language edits." />
                <FlowStep step={6} icon={Scale} title="Mass Balance & Equipment List" badges={["AI + Deterministic"]}
                  description="From confirmed UPIF data, the system generates a detailed mass balance with process stages, flow calculations, and a sized equipment list. AI generation is attempted first; deterministic calculators serve as fallback." />
                <FlowStep step={7} icon={DollarSign} title="CapEx Estimation" badges={["AI"]} isLast
                  description="Once the mass balance is finalized, AI generates capital cost estimates for each equipment item. Includes base cost, installation factors, contingency, engineering, and total project cost. Gated on finalized mass balance." />
              </div>
            </CardContent>
          </Card>
        </div>

        <div id="classification" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={ListChecks} title="Step 1: Project Type Classification" subtitle="AI determines which project type best fits the input" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Before any parameters are extracted, the AI reads the full project description and classifies it into one of four types.
                This classification drives which extraction prompt is used, which validation guardrails apply, and what mass balance model is generated.
              </p>
              <div className="p-4 rounded-md border space-y-3">
                <p className="text-sm font-medium">How Classification Works:</p>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>User provides project text input and/or uploads documents</li>
                  <li>All inputs are concatenated into a single context string</li>
                  <li>The <span className="font-mono text-xs bg-muted px-1 rounded">classification</span> prompt instructs the AI to analyze the inputs</li>
                  <li>AI returns a JSON response with <span className="font-mono text-xs bg-muted px-1 rounded">projectType</span> (A/B/C/D), <span className="font-mono text-xs bg-muted px-1 rounded">reasoning</span>, and <span className="font-mono text-xs bg-muted px-1 rounded">confidence</span></li>
                  <li>The classified type is stored on the scenario and used for all subsequent processing</li>
                </ol>
              </div>
              <div className="p-4 rounded-md bg-muted/50 space-y-2">
                <p className="text-sm font-medium">Classification Decision Logic:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li><span className="font-medium">Type A</span> if: mg/L analytes (BOD/COD/TSS) + flow rate (GPD/MGD) + industrial wastewater context</li>
                  <li><span className="font-medium">Type B</span> if: solid/semi-solid organic feedstocks + TS% + tons/day + RNG as primary product</li>
                  <li><span className="font-medium">Type C</span> if: existing biogas source + biogas composition (CH4/CO2/H2S) + gas flow (scfm) + upgrading to RNG</li>
                  <li><span className="font-medium">Type D</span> if: wastewater treatment + sludge digestion + RNG production + optional co-digestion</li>
                </ul>
              </div>
              <PromptLink name="Project Type Classification" promptKey="classification"
                description="System prompt that guides AI to classify projects into types A-D with reasoning and confidence." />
            </CardContent>
          </Card>
        </div>

        <div id="extraction" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={Sparkles} title="Step 2: Parameter Extraction" subtitle="Type-specific AI prompts extract every technical parameter" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Once the project type is classified, a type-specific extraction prompt is used to extract all relevant parameters.
                Each type focuses on different parameter categories and uses domain-specific terminology.
              </p>

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="base">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Base Extraction (Fallback)
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Generic extraction prompt used when type classification hasn't been performed or as a fallback.
                      Extracts parameters across all four categories: feedstock, location, output requirements, and constraints.
                    </p>
                    <PromptLink name="Parameter Extraction" promptKey="extraction"
                      description="General-purpose extraction prompt covering all parameter types." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="type-a">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Badge className="bg-blue-600 dark:bg-blue-500">A</Badge>
                      Wastewater Treatment Extraction
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Focuses on influent/effluent characterization. Extracts flow rates (GPD/MGD), 
                      concentrations (BOD, COD, TSS, FOG, TKN, pH in mg/L), discharge permits, 
                      and effluent limits. Blocks solids-basis parameters (TS%, VS/TS, BMP) which don't apply to liquid wastewater.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">Flow (GPD/MGD)</Badge>
                      <Badge variant="secondary">BOD (mg/L)</Badge>
                      <Badge variant="secondary">COD (mg/L)</Badge>
                      <Badge variant="secondary">TSS (mg/L)</Badge>
                      <Badge variant="secondary">FOG (mg/L)</Badge>
                      <Badge variant="secondary">TKN (mg/L)</Badge>
                      <Badge variant="secondary">pH</Badge>
                    </div>
                    <PromptLink name="Extraction - Type A (WWT)" promptKey="extraction_type_a"
                      description="Wastewater-focused extraction with influent/effluent specs and contaminant reduction targets." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="type-b">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Badge className="bg-green-600 dark:bg-green-500">B</Badge>
                      RNG Greenfield Extraction
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Extracts solid/semi-solid feedstock properties: tonnage (tons/day or tons/year), 
                      total solids (TS%), volatile solids ratio (VS/TS), biochemical methane potential (BMP), 
                      C:N ratio, delivery schedule, and preprocessing requirements.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">Tonnage (tons/day)</Badge>
                      <Badge variant="secondary">TS%</Badge>
                      <Badge variant="secondary">VS/TS</Badge>
                      <Badge variant="secondary">BMP (scf/lb VS)</Badge>
                      <Badge variant="secondary">C:N Ratio</Badge>
                      <Badge variant="secondary">Bulk Density</Badge>
                    </div>
                    <PromptLink name="Extraction - Type B (RNG Greenfield)" promptKey="extraction_type_b"
                      description="Solid feedstock extraction with tonnage, solids content, and methane potential." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="type-c">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Badge className="bg-orange-600 dark:bg-orange-500">C</Badge>
                      RNG Bolt-On Extraction
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Focuses on existing biogas characteristics: flow rate (scfm), composition (CH4%, CO2%),
                      contaminants (H2S in ppmv, siloxanes in ppbv), moisture content, and temperature.
                      No digester or feedstock parameters needed.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">Biogas Flow (scfm)</Badge>
                      <Badge variant="secondary">CH4 (%)</Badge>
                      <Badge variant="secondary">CO2 (%)</Badge>
                      <Badge variant="secondary">H2S (ppmv)</Badge>
                      <Badge variant="secondary">Siloxanes (ppbv)</Badge>
                    </div>
                    <PromptLink name="Extraction - Type C (RNG Bolt-On)" promptKey="extraction_type_c"
                      description="Biogas composition and flow extraction for gas-only upgrading projects." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="type-d">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Badge className="bg-purple-600 dark:bg-purple-500">D</Badge>
                      Hybrid Extraction
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Combines wastewater parameters (flow, analytes) with trucked feedstock specs (TS/VS/BMP/C:N).
                      Must identify both wastewater streams and solid co-digestion feedstocks.
                      Hard separation enforced: wastewater carries flow + mg/L analytes, trucked feedstocks carry solids-basis parameters.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">WW: Flow + Analytes</Badge>
                      <Badge variant="secondary">Trucked: TS/VS/BMP</Badge>
                      <Badge variant="secondary">Sludge Specs</Badge>
                      <Badge variant="secondary">Co-digestion</Badge>
                    </div>
                    <PromptLink name="Extraction - Type D (Hybrid)" promptKey="extraction_type_d"
                      description="Combined wastewater + trucked feedstock extraction with stream separation." />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>

        <div id="enrichment" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={Database} title="Step 3: Feedstock & Output Enrichment" subtitle="Built-in knowledge bases fill in missing parameters with industry defaults" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                After extraction, each feedstock type is matched against a built-in library of AD feedstock characteristics.
                Missing parameters are filled with estimated defaults, and each value is tagged with its provenance.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <Link href="/docs/feedstock-library" className="block" data-testid="link-feedstock-library">
                  <div className="p-4 rounded-md border space-y-2 hover-elevate transition-colors h-full">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        <Beaker className="h-4 w-4 text-primary" />
                        Feedstock Library
                      </h4>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Common AD feedstocks with default properties. Matched by feedstock type name (fuzzy matching).
                      Click to browse all profiles and see every parameter.
                    </p>
                    <div className="text-xs space-y-1">
                      <p className="font-medium">Parameters enriched:</p>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-xs">TS%</Badge>
                        <Badge variant="secondary" className="text-xs">VS/TS</Badge>
                        <Badge variant="secondary" className="text-xs">BMP</Badge>
                        <Badge variant="secondary" className="text-xs">C:N Ratio</Badge>
                        <Badge variant="secondary" className="text-xs">Bulk Density</Badge>
                        <Badge variant="secondary" className="text-xs">pH Range</Badge>
                        <Badge variant="secondary" className="text-xs">N, P, K</Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Example feedstocks: Potato Waste, Dairy Manure, Food Waste, Grease Trap Waste, Brewery Spent Grain
                    </div>
                  </div>
                </Link>

                <Link href="/docs/feedstock-library?tab=output" className="block" data-testid="link-output-criteria-library">
                  <div className="p-4 rounded-md border space-y-2 hover-elevate transition-colors h-full">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        <FileOutput className="h-4 w-4 text-primary" />
                        Output Criteria Library
                      </h4>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Acceptance criteria for common output profiles, including regulatory limits and industry standards.
                      Click to browse all profiles and see every parameter.
                    </p>
                    <div className="text-xs space-y-1">
                      <p className="font-medium">Output profiles:</p>
                      <ul className="text-muted-foreground space-y-0.5">
                        <li>RNG - Pipeline Injection (CH4 &ge; 96%, H2S &lt; 4 ppmv)</li>
                        <li>Liquid Effluent - Discharge to WWTP</li>
                        <li>Solid Digestate - Land Application (blocked by guardrail)</li>
                        <li>Electricity Generation</li>
                        <li>Compost Production</li>
                      </ul>
                    </div>
                  </div>
                </Link>
              </div>

              <div className="p-4 rounded-md bg-muted/50 space-y-2">
                <p className="text-sm font-medium">Provenance Tracking</p>
                <p className="text-xs text-muted-foreground">
                  Every enriched value is tagged with its source so users can distinguish user-provided data from estimated defaults:
                </p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">User-provided</Badge>
                  <Badge variant="outline" className="text-xs">Estimated default</Badge>
                  <Badge variant="outline" className="text-xs">Document-extracted</Badge>
                  <Badge variant="outline" className="text-xs">AI-inferred</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div id="validation" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={Shield} title="Step 4: Validation Pipeline" subtitle="10 guardrails ensure data integrity before UPIF generation" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Between AI extraction and UPIF save, a multi-step validation pipeline runs. It identifies errors, warnings,
                and informational notes. Invalid or misplaced parameters are moved to "unmapped" and excluded from the UPIF.
              </p>

              <div className="p-4 rounded-md border space-y-2 mb-4">
                <p className="text-sm font-medium">Pipeline Execution Order:</p>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {["V0: Biosolids", "V1: Output Specs", "V1b: Biogas/RNG", "V2: Type A Gate",
                    "V2b: Type D Streams", "V2c: Design Drivers", "V3: TS/TSS", "V4: Swap Detection",
                    "Dedup", "Section Assignment"].map((step, i, arr) => (
                    <span key={step} className="flex items-center gap-1">
                      <Badge variant="outline" className="text-xs whitespace-nowrap">{step}</Badge>
                      {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                    </span>
                  ))}
                </div>
              </div>

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="v0">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V0</Badge>
                      Universal Biosolids Rejection
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <GuardrailItem code="V0" name="Biosolids Rejection" severity="error"
                      description="'Solid Digestate - Land Application' output profile is rejected for ALL project types. All associated criteria are moved to unmapped. Burnham does not handle biosolids land application." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="v1">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V1</Badge>
                      Output Specs Sanitization
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    <GuardrailItem code="V1" name="RNG Solids Indicator Check" severity="warning"
                      description="For RNG profiles: detects solids indicators (mg/kg, dry weight) in gas-quality specs. Moves them to unmapped." />
                    <GuardrailItem code="V1" name="Effluent Performance Targets" severity="info"
                      description="For effluent profiles: separates removal efficiency data (e.g., '95% BOD removal') into dedicated performance targets, distinct from concentration limits." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="v1b">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V1b</Badge>
                      Biogas vs. RNG Separation
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <GuardrailItem code="V1b" name="Biogas/RNG Gate" severity="error"
                      description="Methane values < 90% in the RNG pipeline injection profile are flagged as raw biogas (not pipeline-quality RNG). Moved to unmapped. Pipeline RNG requires CH4 >= 96%." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="v2">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V2</Badge>
                      Type A Wastewater Gate
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    <GuardrailItem code="V2" name="Solids Parameter Block" severity="error"
                      description="If mg/L analytes (BOD/COD/TSS/FOG/TKN/TP) or flow units (MGD/GPD) are detected, ALL solids-basis parameters are hard-blocked: VS/TS, BMP, C:N, bulk density, moisture%, delivery form, preprocessing. Also blocks primary/WAS sludge terminology." />
                    <GuardrailItem code="V2" name="Fail-Fast Check" severity="error"
                      description="Type A requires at minimum: influent flow rate AND at least one mg/L analyte before UPIF can be generated. Missing either triggers an error that blocks generation." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="v2b">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V2b</Badge>
                      Type D Stream Separation
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <GuardrailItem code="V2b" name="Hard Stream Separation" severity="warning"
                      description="For Type D (Hybrid): wastewater streams must carry flow + mg/L analytes only. Trucked feedstocks must carry TS/VS/BMP/C:N only. Cross-contaminated parameters are stripped and moved to the correct stream or unmapped." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="v2c">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V2c</Badge>
                      Type A Design Driver Completeness
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    <GuardrailItem code="V2c" name="Core Design Drivers" severity="error"
                      description="Validates that all 7 core design drivers are present: Flow (avg + peak), BOD, COD, TSS, FOG, TKN, pH. Missing drivers are auto-populated with industry-specific defaults (e.g., dairy: BOD 2,000-6,000 mg/L; potato: COD 3,000-10,000 mg/L)." />
                    <div className="p-3 rounded-md bg-muted/50">
                      <p className="text-xs font-medium mb-1">Auto-Populate Logic:</p>
                      <p className="text-xs text-muted-foreground">
                        When a design driver is missing, the system detects the industry type from feedstock names
                        (dairy, meat, poultry, potato, beverage, produce) and inserts a typical range as an estimated default.
                        For example, a dairy project missing TKN gets "50-150 mg/L" (source: "Estimated default - dairy industry typical").
                        All 7 drivers present triggers an info-level confirmation.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="v3">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V3</Badge>
                      TS/TSS Guardrail
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <GuardrailItem code="V3" name="TS/TSS Confusion Prevention" severity="warning"
                      description="If TSS (Total Suspended Solids, mg/L) is explicitly detected but TS (Total Solids, %) is not mentioned by the user, any default TS values are removed. TSS is not equivalent to TS, and keeping both could lead to incorrect calculations." />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="v4">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">V4</Badge>
                      Swap Detection
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <GuardrailItem code="V4" name="Misassignment Detection" severity="warning"
                      description="Wastewater-labeled streams containing solids-basis parameters (TS%, moisture%, BMP) but no flow rate or mg/L analytes are flagged as potential misassignments. The solids parameters are moved to unmapped and a warning is issued." />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>

        <div id="upif" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={FileText} title="Step 5: UPIF Generation & Review" subtitle="Consolidated project intake form with interactive review" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The UPIF consolidates all extracted, enriched, and validated data into a structured form. Users review every
                parameter, override estimated defaults with actual data, and confirm individual line items.
              </p>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Eye className="h-4 w-4 text-primary" />
                    Review
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    View all parameters organized by section (Feedstock, Location, Output Requirements, Constraints).
                    Each value shows its provenance and confidence level.
                  </p>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-primary" />
                    Override
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Override any estimated default with actual project data.
                    Inline editing on every parameter. Values update immediately.
                  </p>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Lock className="h-4 w-4 text-primary" />
                    Confirm & Lock
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Confirm individual fields to lock them. Locked fields are preserved during re-generation.
                    Confirm the entire UPIF to proceed to mass balance.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-md border space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  Reviewer Chat
                </h4>
                <p className="text-xs text-muted-foreground">
                  AI-powered chat panel allows natural-language UPIF edits: "Change the FOG concentration to 350 mg/L"
                  or "Remove the second feedstock." The system applies structured updates while respecting confirmed (locked) fields.
                </p>
              </div>

              <div className="p-4 rounded-md border space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4 text-primary" />
                  Import from Sibling Scenario
                </h4>
                <p className="text-xs text-muted-foreground">
                  Import a confirmed UPIF from another scenario within the same project. Useful for creating variations
                  of an existing design. Only available for scenarios without a confirmed UPIF. Cannot import from scenarios
                  in other projects.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div id="mass-balance" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={Scale} title="Step 6: Mass Balance & Equipment List" subtitle="Process-stage calculations and sized equipment from confirmed UPIF data" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Once the UPIF is confirmed, the system can generate a detailed mass balance. The AI approach is attempted first
                using the scenario's preferred LLM model. If AI generation fails (parsing error, timeout, etc.), a deterministic
                calculator specific to the project type serves as automatic fallback.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    AI Generation (Primary)
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Type-specific AI prompts generate mass balance using confirmed UPIF data. Supports GPT-5, Claude Sonnet 4.5,
                    and Claude Opus 4.6. Model can be selected per scenario. Returns structured JSON with process stages,
                    equipment sizing, and summary metrics.
                  </p>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    Deterministic Fallback
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Engineering-grade calculators with hardcoded design criteria (WEF MOP 8, Ten States Standards).
                    One calculator per project type. Used automatically if AI generation fails. All calculations use
                    US customary units.
                  </p>
                </div>
              </div>

              <Separator />

              <p className="text-sm font-medium">Type-Specific Mass Balance Models</p>

              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="mb-a">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge className="bg-blue-600 dark:bg-blue-500">A</Badge>
                      Wastewater Treatment Train
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Complete wastewater treatment process with recycle streams. Stages include screening, 
                      equalization, anaerobic reactor, clarification, DAF, aerobic polishing, and sludge handling.
                    </p>
                    <div className="p-3 rounded-md bg-muted/50 text-xs">
                      <p className="font-medium mb-1">Process Stages:</p>
                      <p className="text-muted-foreground">
                        Influent Screening → Equalization → Anaerobic Reactor → Post-Clarification → DAF → Aerobic Polishing → Effluent Discharge + Sludge Dewatering
                      </p>
                    </div>
                    <div className="grid gap-2 grid-cols-2">
                      <PromptLink name="AI Prompt" promptKey="mass_balance_type_a"
                        description="AI-generated treatment train with removal efficiencies per WEF MOP 8." />
                      <CalculatorLink name="Deterministic Calculator" type="A"
                        description="server/services/massBalance.ts" />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="mb-b">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge className="bg-green-600 dark:bg-green-500">B</Badge>
                      RNG Greenfield Pipeline
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Full AD pipeline from feedstock receiving through RNG production.
                      8 process stages with equipment sizing based on WEF MOP 8 design criteria.
                    </p>
                    <div className="p-3 rounded-md bg-muted/50 text-xs">
                      <p className="font-medium mb-1">Process Stages:</p>
                      <p className="text-muted-foreground">
                        Feedstock Receiving → Maceration/Depackaging → Equalization/Preheat → Anaerobic Digestion → Dewatering (Centrifuge) → DAF/Liquids Management → Gas Conditioning → Gas Upgrading to RNG
                      </p>
                    </div>
                    <div className="grid gap-2 grid-cols-2">
                      <PromptLink name="AI Prompt" promptKey="mass_balance_type_b"
                        description="Full AD pipeline mass balance with 8 process stages and equipment list." />
                      <CalculatorLink name="Deterministic Calculator" type="B"
                        description="server/services/massBalanceTypeB.ts" />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="mb-c">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge className="bg-orange-600 dark:bg-orange-500">C</Badge>
                      RNG Bolt-On Gas Train
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Gas-only processing. Takes existing biogas flow and composition, applies conditioning
                      (H2S removal, moisture removal, siloxane removal) then upgrades to pipeline-quality RNG.
                      No digester sizing.
                    </p>
                    <div className="p-3 rounded-md bg-muted/50 text-xs">
                      <p className="font-medium mb-1">Process Stages:</p>
                      <p className="text-muted-foreground">
                        Raw Biogas Inlet → H2S Removal → Moisture Removal → Siloxane/VOC Removal → Gas Compression → Membrane/PSA Upgrading → RNG Metering
                      </p>
                    </div>
                    <div className="grid gap-2 grid-cols-2">
                      <PromptLink name="AI Prompt" promptKey="mass_balance_type_c"
                        description="Gas conditioning and upgrading mass balance for bolt-on projects." />
                      <CalculatorLink name="Deterministic Calculator" type="C"
                        description="server/services/massBalanceTypeC.ts" />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="mb-d">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge className="bg-purple-600 dark:bg-purple-500">D</Badge>
                      Hybrid WW + AD + RNG
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Combines wastewater treatment with sludge digestion and RNG production.
                      Wastewater is treated (screening, primary clarification), sludge is thickened and fed to
                      an anaerobic digester along with optional trucked co-digestion feedstocks, biogas is conditioned
                      and upgraded to RNG.
                    </p>
                    <div className="p-3 rounded-md bg-muted/50 text-xs">
                      <p className="font-medium mb-1">Process Stages:</p>
                      <p className="text-muted-foreground">
                        WW Screening → Primary Clarification → Sludge Thickening → Anaerobic Digestion (+ Co-digestion) → Dewatering → Biogas Conditioning → Gas Upgrading to RNG → Treated Effluent
                      </p>
                    </div>
                    <div className="grid gap-2 grid-cols-2">
                      <PromptLink name="AI Prompt" promptKey="mass_balance_type_d"
                        description="Hybrid treatment + digestion + RNG mass balance with stream separation." />
                      <CalculatorLink name="Deterministic Calculator" type="D"
                        description="server/services/massBalanceTypeD.ts" />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <Separator />

              <p className="text-sm font-medium">Output Features</p>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-primary" />
                    Editable Values
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Override any calculated value in the mass balance. Overridden values are tracked with an "override" badge
                    showing original vs. modified values.
                  </p>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Lock className="h-4 w-4 text-primary" />
                    Lockable Fields
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Lock individual values to preserve them during recomputation. Locked values are maintained even when
                    the mass balance is regenerated.
                  </p>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Finalize
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Finalize the mass balance to lock it and enable CapEx estimation. The "Generate CapEx" button
                    appears only after mass balance is finalized.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div id="capex" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={DollarSign} title="Step 7: CapEx Estimation" subtitle="AI-generated capital cost estimates from the finalized equipment list" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Once the mass balance is finalized, the system generates capital expenditure estimates for each piece of equipment.
                CapEx generation is gated on finalized mass balance status to ensure equipment sizing is confirmed before costing.
              </p>

              <div className="p-4 rounded-md border space-y-2">
                <p className="text-sm font-medium">For Each Equipment Item:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>1. Base cost per unit (equipment purchase price, FOB)</li>
                  <li>2. Installation factor (Lang factor or discipline-specific, typically 1.5-3.5x)</li>
                  <li>3. Installed cost = base cost x quantity x installation factor</li>
                  <li>4. Contingency allowance (typically 10-20%)</li>
                  <li>5. Total cost per line item</li>
                </ul>
              </div>

              <div className="p-4 rounded-md border space-y-2">
                <p className="text-sm font-medium">Project Cost Summary:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>Total Equipment Cost (sum of all base costs)</li>
                  <li>Total Installed Cost (sum of all installed costs)</li>
                  <li>Contingency (% of installed cost)</li>
                  <li>Engineering & Permitting (% of installed cost)</li>
                  <li>Total Project Cost</li>
                  <li>Cost-per-unit metrics ($/GPD, $/ton, $/scfm depending on project type)</li>
                </ul>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-primary" />
                    Inline Editing
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Edit any line item cost, installation factor, or contingency directly in the table.
                    Overrides are tracked with badges.
                  </p>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Lock className="h-4 w-4 text-primary" />
                    Lock & Recompute
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Lock specific cost values. When recomputing, locked values are preserved and totals
                    are recalculated around them.
                  </p>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    Versioning
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Each generation creates a new version. Previous versions are preserved for comparison
                    and audit trail.
                  </p>
                </div>
              </div>

              <p className="text-sm font-medium">CapEx Prompts by Project Type</p>
              <div className="grid gap-2 md:grid-cols-2">
                <PromptLink name="CapEx - Type A (WWT)" promptKey="capex_type_a"
                  description="Cost estimation for wastewater treatment equipment." />
                <PromptLink name="CapEx - Type B (RNG Greenfield)" promptKey="capex_type_b"
                  description="Cost estimation for full AD + RNG pipeline equipment." />
                <PromptLink name="CapEx - Type C (RNG Bolt-On)" promptKey="capex_type_c"
                  description="Cost estimation for gas conditioning and upgrading equipment." />
                <PromptLink name="CapEx - Type D (Hybrid)" promptKey="capex_type_d"
                  description="Cost estimation for combined WW treatment + AD + RNG equipment." />
              </div>
            </CardContent>
          </Card>
        </div>

        <div id="prompts" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={Bot} title="AI Models & Prompt Templates" subtitle="Configurable prompts and multi-LLM support" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                All AI prompts are available for review. Click any prompt link below to see the full text
                of the instructions given to the AI.
                The system supports three LLM providers, selectable per scenario.
              </p>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium">GPT-5</h4>
                  <p className="text-xs text-muted-foreground">OpenAI's latest model. Good for structured JSON output and consistent formatting.</p>
                  <Badge variant="outline" className="text-xs">Requires OPENAI_API_KEY</Badge>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium">Claude Sonnet 4.5</h4>
                  <p className="text-xs text-muted-foreground">Mid-tier Anthropic model. Balanced performance and cost. Works via both direct API and integration proxy.</p>
                  <Badge variant="outline" className="text-xs">Requires ANTHROPIC_API_KEY</Badge>
                </div>
                <div className="p-4 rounded-md border space-y-2">
                  <h4 className="text-sm font-medium">Claude Opus 4.6</h4>
                  <p className="text-xs text-muted-foreground">Top-tier Anthropic model. Best reasoning for complex engineering calculations. Direct API only.</p>
                  <Badge variant="outline" className="text-xs">Requires ANTHROPIC_API_KEY (direct)</Badge>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-medium">Complete Prompt Template Reference</p>
                <Link href="/docs/prompts" data-testid="link-view-all-prompts">
                  <Badge variant="outline" className="text-xs hover-elevate cursor-pointer">
                    View all prompts with full text <ChevronRight className="h-3 w-3 ml-1 inline" />
                  </Badge>
                </Link>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <PromptLink name="Project Type Classification" promptKey="classification"
                  description="Classifies projects into types A-D." />
                <PromptLink name="Parameter Extraction (Base)" promptKey="extraction"
                  description="General-purpose parameter extraction." />
                <PromptLink name="Extraction - Type A" promptKey="extraction_type_a"
                  description="Wastewater treatment parameter extraction." />
                <PromptLink name="Extraction - Type B" promptKey="extraction_type_b"
                  description="RNG Greenfield parameter extraction." />
                <PromptLink name="Extraction - Type C" promptKey="extraction_type_c"
                  description="RNG Bolt-On parameter extraction." />
                <PromptLink name="Extraction - Type D" promptKey="extraction_type_d"
                  description="Hybrid project parameter extraction." />
                <PromptLink name="Mass Balance - Type A" promptKey="mass_balance_type_a"
                  description="WWT treatment train mass balance." />
                <PromptLink name="Mass Balance - Type B" promptKey="mass_balance_type_b"
                  description="Full AD pipeline mass balance." />
                <PromptLink name="Mass Balance - Type C" promptKey="mass_balance_type_c"
                  description="Gas conditioning + upgrading mass balance." />
                <PromptLink name="Mass Balance - Type D" promptKey="mass_balance_type_d"
                  description="Hybrid WW + AD + RNG mass balance." />
                <PromptLink name="CapEx - Type A" promptKey="capex_type_a"
                  description="WWT equipment cost estimation." />
                <PromptLink name="CapEx - Type B" promptKey="capex_type_b"
                  description="RNG Greenfield cost estimation." />
                <PromptLink name="CapEx - Type C" promptKey="capex_type_c"
                  description="RNG Bolt-On cost estimation." />
                <PromptLink name="CapEx - Type D" promptKey="capex_type_d"
                  description="Hybrid project cost estimation." />
              </div>
            </CardContent>
          </Card>
        </div>

        <div id="units" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <SectionHeading icon={ArrowLeftRight} title="Unit Conventions" subtitle="US customary units used throughout the system" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                All outputs use US customary units. The system accepts metric inputs and converts them automatically.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-units">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium">Measurement</th>
                      <th className="text-left py-2 pr-4 font-medium">Required Units</th>
                      <th className="text-left py-2 font-medium text-muted-foreground">Never Use</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b">
                      <td className="py-2 pr-4">Energy</td>
                      <td className="py-2 pr-4">MMBTU</td>
                      <td className="py-2">GJ, MJ</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">Gas Volumes</td>
                      <td className="py-2 pr-4">scf, scfm, scfh, scfd</td>
                      <td className="py-2">m3, Nm3</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">Liquid Volumes</td>
                      <td className="py-2 pr-4">gal, gpd, gpm, MGD</td>
                      <td className="py-2">m3, liters</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">Concentrations</td>
                      <td className="py-2 pr-4">mg/L</td>
                      <td className="py-2 text-muted-foreground/50">-</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">Solids Mass</td>
                      <td className="py-2 pr-4">tons (US short tons)</td>
                      <td className="py-2">tonnes</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">Mixing Power</td>
                      <td className="py-2 pr-4">W/m3</td>
                      <td className="py-2 text-muted-foreground/50">- (industry standard)</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Organic Loading Rate</td>
                      <td className="py-2 pr-4">kg VS/m3 d</td>
                      <td className="py-2 text-muted-foreground/50">- (industry standard)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
                <span className="font-medium">Note:</span> "RNG" must always appear fully capitalized in all display text. Never "Rng" or "rng".
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="pb-8" />
      </div>
    </div>
  );
}
