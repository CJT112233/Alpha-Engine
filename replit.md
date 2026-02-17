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
- **Mass Balance & Equipment List**: Deterministic calculation engine for Type A (Wastewater Treatment) projects. Parses confirmed UPIF influent data, determines treatment train (preliminary → equalization → primary → secondary → tertiary → disinfection), applies removal efficiencies from WEF MOP 8 / Ten States Standards, iterates recycle streams to convergence, and sizes equipment (screens, clarifiers, aeration basins, MBR, filters, UV). Results stored in `mass_balance_runs` table with versioning, override tracking, and lock toggles. Frontend page at `/scenarios/:scenarioId/mass-balance`.

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
- **Multi-LLM Support**: OpenAI (GPT-5), Anthropic (Claude Sonnet 4.5, Claude Opus 4.6).
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
- Pipeline order: (V0) Universal biosolids rejection → (V1) Output specs sanitization → (V1b) Biogas/RNG separation → (V2) Type A wastewater gate → (V2b) Type D stream separation → (V3) TS/TSS guardrail → (V4) Swap detection
- Universal biosolids guardrail: "Solid Digestate - Land Application" profile rejected for ALL project types
- Type A wastewater gate: if mg/L analytes (BOD/COD/TSS/FOG/TKN/TP) or flow units (MGD/gpm/GPD/m³/d) detected, hard-block ALL solids-basis parameters (VS/TS, BMP m³/kg VS, C:N, bulk density, moisture%, delivery form, preprocessing) regardless of source. Also blocks primary/WAS sludge terminology from feedstock names and spec values. Feedstock section must display influent analytes + flow only.
- Type A fail-fast: requires influent flow + at least one mg/L analyte before UPIF generation
- Type D hard separation: wastewater must carry flow + mg/L analytes, trucked feedstocks carry TS/VS/BMP/C:N
- Swap detection: wastewater-labeled streams with solids params but no flow/analytes flagged and re-routed to Unmapped
- Gas separation: biogas CH₄ <90% rejected from RNG gas-quality table; RNG spec requires ≥96% pipeline quality
- Server-side logic in `server/validation.ts` (Node.js) and `databricks_app/api/validation.py` (Python)