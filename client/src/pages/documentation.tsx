import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, BookOpen, Beaker, FileUp, Sparkles, FileText, MessageSquare, MapPin, DollarSign, Settings2, FileOutput } from "lucide-react";

export default function Documentation() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/" className="hover:text-foreground transition-colors">
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
            <h1 className="text-2xl font-bold tracking-tight">Documentation</h1>
            <p className="text-muted-foreground mt-1">
              Learn how to use Project Alpha to streamline your project intake process
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
            <CardDescription>
              Project Alpha transforms unstructured project inputs into standardized specifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Project Alpha is designed to take unstructured text inputs and supporting documents, 
              identify and extract standardized attributes that define a project, and consolidate 
              those elements into a single, unified project intake form (UPIF).
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="p-4 rounded-md border">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  Conversational Input
                </h4>
                <p className="text-sm text-muted-foreground">
                  Describe your project in natural language without rigid forms
                </p>
              </div>
              <div className="p-4 rounded-md border">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-primary" />
                  Document Upload
                </h4>
                <p className="text-sm text-muted-foreground">
                  Upload engineering reports, permits, and specifications
                </p>
              </div>
              <div className="p-4 rounded-md border">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI Extraction
                </h4>
                <p className="text-sm text-muted-foreground">
                  Intelligent extraction and prediction of project parameters
                </p>
              </div>
              <div className="p-4 rounded-md border">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  UPIF Generation
                </h4>
                <p className="text-sm text-muted-foreground">
                  Standardized project intake form with all specifications
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Input Categories</CardTitle>
            <CardDescription>
              Information you can provide about your project
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="feedstock">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Beaker className="h-4 w-4" />
                    Feedstock Specifications
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Describe your feedstock input including type, volume, and technical parameters.
                  </p>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Common Parameters:</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">VS/TS Ratio</Badge>
                      <Badge variant="secondary">BOD</Badge>
                      <Badge variant="secondary">COD</Badge>
                      <Badge variant="secondary">TS%</Badge>
                      <Badge variant="secondary">C:N Ratio</Badge>
                      <Badge variant="secondary">N, P, K</Badge>
                      <Badge variant="secondary">TSS</Badge>
                      <Badge variant="secondary">TDS</Badge>
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-muted text-sm">
                    <p className="font-medium mb-1">Example:</p>
                    <p className="text-muted-foreground">
                      "100,000 tons per year of potato waste with approximately 15% TS, VS/TS ratio of 0.85, 
                      and C:N ratio of 25:1"
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="output">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2">
                    <FileOutput className="h-4 w-4" />
                    Output Requirements
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Specify what the project will produce or how processed materials will be handled.
                  </p>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Common Outputs:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>- RNG (Renewable Natural Gas) production</li>
                      <li>- Land application of digestate</li>
                      <li>- Discharge to municipal WWTP</li>
                      <li>- Electricity generation</li>
                      <li>- Compost production</li>
                    </ul>
                  </div>
                  <div className="p-3 rounded-md bg-muted text-sm">
                    <p className="font-medium mb-1">Example:</p>
                    <p className="text-muted-foreground">
                      "Produce RNG for pipeline injection, land apply dewatered solids, and discharge 
                      liquid effluent to Moses Lake WWTP meeting their acceptance criteria"
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="location">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Project Location
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    The project location informs cost estimates, code requirements, permitting needs, 
                    and available infrastructure.
                  </p>
                  <div className="p-3 rounded-md bg-muted text-sm">
                    <p className="font-medium mb-1">Example:</p>
                    <p className="text-muted-foreground">
                      "Project site in Quincy, Washington, near existing food processing facility"
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="pricing">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Pricing Information
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Provide estimates of value for project inputs and outputs to help evaluate 
                    project economics.
                  </p>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Pricing Categories:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>- Feedstock tipping fees or costs</li>
                      <li>- RNG sale price or RIN values</li>
                      <li>- Electricity sale rates</li>
                      <li>- Digestate/compost pricing</li>
                      <li>- LCFS credit values</li>
                    </ul>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="constraints">
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Constraints & Assumptions
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Specify any requirements or conditions that must be incorporated into the 
                    project design.
                  </p>
                  <div className="p-3 rounded-md bg-muted text-sm">
                    <p className="font-medium mb-1">Examples:</p>
                    <ul className="text-muted-foreground space-y-1">
                      <li>- "Must use PlanET digester technology"</li>
                      <li>- "Using Prodeval equipment purchased for $2.5M"</li>
                      <li>- "Must meet Dept of Ecology discharge limits"</li>
                      <li>- "Project budget capped at $15M"</li>
                    </ul>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
            <CardDescription>
              Step-by-step guide to using Project Alpha
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                  1
                </div>
                <div>
                  <h4 className="font-medium">Create a Project</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Start by creating a new project and giving it a descriptive name. Each project 
                    can contain multiple scenarios for evaluating different configurations.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                  2
                </div>
                <div>
                  <h4 className="font-medium">Add a Scenario</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Create a scenario within your project. Scenarios allow you to evaluate different 
                    project configurations independently.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                  3
                </div>
                <div>
                  <h4 className="font-medium">Provide Inputs</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Enter project information through conversational text input and/or document uploads. 
                    You can provide information in any order and across multiple entries.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                  4
                </div>
                <div>
                  <h4 className="font-medium">Extract Parameters</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Click "Extract Parameters" to have the AI analyze your inputs and identify 
                    project specifications. The system will also predict missing parameters based 
                    on industry knowledge.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                  5
                </div>
                <div>
                  <h4 className="font-medium">Review & Confirm</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Review the extracted parameters, make any necessary edits, and confirm each value. 
                    Once all parameters are confirmed, proceed to the UPIF for final review and 
                    confirmation.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
