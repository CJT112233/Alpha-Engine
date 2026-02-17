# Project Factory - Intelligent Project Intake System

## Overview

Project Factory is an AI-enabled system designed to convert unstructured project inputs (natural language, documents) into standardized project specifications. It generates a Unified Project Intake Form (UPIF) by intelligently extracting and categorizing parameters, enriching them with design defaults, and consolidating them for user review. The system supports a scenario-based workflow, allowing for independent project evaluations with distinct inputs, outputs, and constraints. Its primary goal is to streamline project initiation by providing comprehensive, validated project definitions.

## User Preferences

Preferred communication style: Simple, everyday language.
Number formatting: Always display numbers with comma separators for thousands (e.g., 10,000 not 10000).

## System Architecture

### Core Functionality
- **Intelligent Parameter Extraction**: AI processes free-form text and document uploads to extract and categorize project parameters (feedstock, output requirements, location, constraints).
- **Feedstock & Output Enrichment**: Extracted parameters are enriched with design defaults and acceptance criteria from built-in knowledge bases, including provenance tracking.
- **Unified Project Intake Form (UPIF)**: Consolidated, standardized form for user review, supporting multi-feedstock projects and individual line-item confirmation. Confirmed fields are locked, preserving values during re-generation.
- **Validation Guardrails**: A multi-step validation pipeline ensures data integrity and consistency before UPIF generation, identifying and categorizing warnings, unmapped specs, and performance targets. This includes specific guardrails for biosolids, wastewater, and gas quality.
- **Clarifying Questions**: AI generates targeted questions based on missing or ambiguous information to improve UPIF accuracy.
- **2-Step Project Type Classification**: AI classifies projects into types (Wastewater Treatment, RNG Greenfield, RNG Bolt-On, Hybrid) before extraction, using type-specific prompts for improved relevance.
- **Reviewer Chat**: AI-powered chat allows users to suggest UPIF changes, with the system applying structured updates while respecting confirmed fields.
- **Configurable Prompt Templates**: AI prompts are stored in the database and can be customized via a settings interface.
- **Generation Stats**: Tracks timing and metadata for every AI-generated document (Classification, UPIF, Mass Balance, CapEx). Stats page at `/stats` shows date, document type, model used, project/scenario, generation time, and success/error status. Data stored in `generation_logs` table.
- **AI-Powered Mass Balance & Equipment List**: Mass balances are generated using one of the three LLMs (GPT-5, Claude Sonnet 4.6, Claude Opus 4.6) via type-specific prompts. The system uses the scenario's preferred model selection. Deterministic calculators serve as fallback if AI generation fails. Results stored in `mass_balance_runs` table with versioning, override tracking, and lock toggles. Frontend page at `/scenarios/:scenarioId/mass-balance`.
- **Multi-Type Mass Balance**: Supports all four project types with both AI and deterministic calculators:
  - **Type A**: Wastewater treatment train with recycle streams (deterministic: server/services/massBalance.ts, AI prompt: mass_balance_type_a)
  - **Type B**: RNG Greenfield — full AD pipeline: feedstock receiving → pretreatment → digestion → biogas conditioning → gas upgrading → RNG (deterministic: server/services/massBalanceTypeB.ts, AI prompt: mass_balance_type_b)
  - **Type C**: RNG Bolt-On — biogas-only inputs (CH₄%, CO₂%, H₂S, siloxanes, flow scfm) through gas conditioning to RNG specs, no digester sizing (deterministic: server/services/massBalanceTypeC.ts, AI prompt: mass_balance_type_c)
  - **Type D**: Hybrid — combines WW treatment (Type A) with sludge → AD → biogas → RNG, optional co-digestion with trucked feedstocks (deterministic: server/services/massBalanceTypeD.ts, AI prompt: mass_balance_type_d)
  - AI generation service in server/services/massBalanceAI.ts handles prompt building, LLM calls, and JSON validation
  - Route dispatcher in server/routes.ts attempts AI generation first, falls back to deterministic calculators on failure
  - Generation stats log records which model was used (or "deterministic (AI fallback)" if fallback occurred)
  - Frontend mass balance page renders project-type-specific views with AD process stages, summary cards, and equipment lists
- **AI-Powered CapEx Estimation**: Capital cost estimates generated from confirmed mass balance equipment lists using AI with type-specific prompts. Gated on finalized mass balance. Results stored in `capex_estimates` table with versioning, override tracking, and lock toggles. Frontend page at `/scenarios/:scenarioId/capex`.
  - Supports all four project types with type-specific prompts (capex_type_a through capex_type_d)
  - AI generation service in server/services/capexAI.ts handles prompt building, LLM calls, and JSON validation
  - Line items reference mass balance equipment IDs with base cost, installation factor, contingency, and total cost
  - Summary includes total equipment cost, installed cost, contingency, engineering, and total project cost with cost-per-unit metrics
  - Frontend renders editable/lockable line items with inline editing, override badges, and recompute with locked value preservation
  - Navigation: "Generate CapEx" button appears on mass balance page when mass balance is finalized

### Technical Implementation
- **Frontend**: React 18 with TypeScript, Wouter for routing, TanStack Query for state, shadcn/ui and Tailwind CSS for UI, React Hook Form with Zod for forms, Vite for building.
- **Backend**: Express.js with TypeScript, RESTful API, Multer for file uploads.
- **Data Storage**: PostgreSQL with Drizzle ORM for schema management, connect-pg-simple for session storage.
- **Shared Architecture**: Shared types and schemas between client and server, centralized API request helper, modular UI components, path aliases for source organization.
- **PDF Export**: Server-side generation of professional PDFs with project summaries, watermarks for unconfirmed UPIFs, and detailed content.

### Databricks Migration
The project is migrating to a Databricks environment with a FastAPI (Python) backend, Delta tables in Unity Catalog for data storage, and Databricks Model Serving for AI integration. The React frontend remains the same, served statically.

## External Dependencies

### Database
- PostgreSQL

### UI/UX Libraries
- Radix UI primitives
- shadcn/ui
- Lucide React (icons)

### AI/ML Integration
- **Multi-LLM Support**: OpenAI (GPT-5), Anthropic (Claude Sonnet 4.6, Claude Opus 4.6).
- **Feedstock Library**: Built-in knowledge base for common AD feedstocks (e.g., Potato Waste, Dairy Manure).
- **Output Criteria Library**: Built-in knowledge base for output acceptance criteria (e.g., RNG Pipeline Injection, Solid Digestate Land Application, Liquid Effluent to WWTP).

### Document Processing
- Multer (file uploads)
- XLSX (spreadsheet processing)
- pdf-parse (PDF text extraction)
- mammoth (DOCX text extraction)

### Authentication & Security
- Passport.js (authentication)
- Express sessions
- jsonwebtoken (JSON Web Tokens)

### Additional Services
- Stripe SDK (payment integration)
- Nodemailer (email functionality)

### Databricks Specific
- Databricks Model Serving (for AI)
- ReportLab (PDF generation in Databricks environment)

## Validation Pipeline

Between AI extraction and UPIF save, a multi-step validation pipeline runs:
- `validationWarnings` JSONB stores errors/warnings/info from validation steps
- `unmappedSpecs` JSONB stores parameters that failed validation (wrong section/unit mismatches)
- `performanceTargets` JSONB stores removal efficiencies separated from concentration limits
- Pipeline order: (V0) Universal biosolids rejection → (V1) Output specs sanitization → (V1b) Biogas/RNG separation → (V2) Type A wastewater gate → (V2b) Type D stream separation → (V2c) Type A design driver completeness → (V3) TS/TSS guardrail → (V4) Swap detection
- Universal biosolids guardrail: "Solid Digestate - Land Application" profile rejected for ALL project types
- Type A wastewater gate: if mg/L analytes (BOD/COD/TSS/FOG/TKN/TP) or flow units (MGD/gpm/GPD/m³/d) detected, hard-block ALL solids-basis parameters (VS/TS, BMP m³/kg VS, C:N, bulk density, moisture%, delivery form, preprocessing) regardless of source. Also blocks primary/WAS sludge terminology from feedstock names and spec values. Feedstock section must display influent analytes + flow only.
- Type A design driver completeness (V2c): validates that all six core design drivers are present in the Feedstock/Influent section — Flow (avg + peak), BOD, COD, TSS, FOG, pH. Generates error-severity warnings for each missing driver. When all present, emits info-level confirmation.
- Type A fail-fast: requires influent flow + at least one mg/L analyte before UPIF generation
- Type D hard separation: wastewater must carry flow + mg/L analytes, trucked feedstocks carry TS/VS/BMP/C:N
- Swap detection: wastewater-labeled streams with solids params but no flow/analytes flagged and re-routed to Unmapped
- Gas separation: biogas CH₄ <90% rejected from RNG gas-quality table; RNG spec requires ≥96% pipeline quality
- Server-side logic in `server/validation.ts` (Node.js) and `databricks_app/api/validation.py` (Python)