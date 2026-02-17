# Project Factory - Intelligent Project Intake System

## Overview

Project Factory is an AI-enabled project development system designed to transform unstructured project inputs into standardized specifications. The system allows users to capture project information through natural language (conversational input) and document uploads, then uses intelligent parameter extraction to generate a Unified Project Intake Form (UPIF).

The core workflow follows a scenario-based approach where:
1. Users create projects and scenarios within those projects
2. Each scenario maintains independent inputs, outputs, and constraints
3. Users provide project details through free-form text and document uploads
4. The system extracts and categorizes parameters (feedstock, output requirements, location, constraints)
5. Extracted feedstock parameters are enriched with design defaults from a built-in knowledge base (TS%, VS/TS, C:N, BMP, etc.) with provenance tracking
6. Parameters are consolidated into a standardized UPIF for user review and confirmation

## User Preferences

Preferred communication style: Simple, everyday language.
Number formatting: Always display numbers with comma separators for thousands (e.g., 10,000 not 10000).

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack Query (React Query) for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with custom plugins for Replit integration

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Pattern**: RESTful API endpoints under `/api/*`
- **File Uploads**: Multer for handling document uploads (50MB limit)
- **Development**: Vite dev server integration with HMR support
- **Production**: Static file serving from built assets

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` (shared between frontend and backend)
- **Migrations**: Drizzle Kit for schema management (`db:push` command)
- **Session Storage**: connect-pg-simple for PostgreSQL-backed sessions

### Core Data Models
- **Projects**: Top-level containers for related scenarios
- **Scenarios**: Individual project evaluations with their own inputs/outputs (status: draft, in_review, confirmed), with per-scenario `preferredModel` field (gpt5 or claude), `projectType` (A/B/C/D) and `projectTypeConfirmed` (boolean) for 2-step classification
- **Text Entries**: Conversational inputs categorized by type
- **Documents**: Uploaded files with metadata
- **Extracted Parameters**: AI-extracted parameters with confidence levels
- **UPIF Records**: Consolidated project intake forms with multi-feedstock support
  - `feedstocks` JSONB array stores multiple FeedstockEntry objects, each with independent type, volume, unit, parameters, and enriched specs
  - Legacy single-feedstock fields (feedstockType, feedstockVolume, feedstockUnit, feedstockSpecs) still populated from primary feedstock for backward compatibility
  - UI synthesizes a single-entry feedstocks array from legacy fields when feedstocks column is empty
  - `confirmedFields` JSONB stores per-line-item confirmation state (ConfirmedFields type)
    - Supports confirming individual feedstock specs, output specs, location, output requirements, constraints
    - Confirmed fields are locked in edit mode (shown as read-only with lock icon)
    - Re-generation (POST /extract) preserves confirmed values and only updates unconfirmed fields
    - ConfirmToggle component (lock/unlock icon) in read-only view toggles confirmation per item
    - Confirmation state is persisted immediately via PATCH /api/scenarios/:id/upif
- **Validation Guardrails**: Between AI extraction and UPIF save, a multi-step validation pipeline runs:
  - `validationWarnings` JSONB stores errors/warnings/info from validation steps
  - `unmappedSpecs` JSONB stores parameters that failed validation (wrong section/unit mismatches)
  - `performanceTargets` JSONB stores removal efficiencies separated from concentration limits
  - Pipeline order: deduplication → section assignment validation → Type A feedstock checks → TS/TSS guardrail → output specs sanitization (RNG gas-only units, removal efficiency separation)
  - Server-side logic in `server/validation.ts` (Node.js) and `databricks_app/api/validation.py` (Python)
  - UPIF Review UI renders 3 collapsible sections: Validation Notes, Unmapped/Needs Review, Performance Targets
  - Re-generation preserves confirmed fields while re-running validation on unconfirmed data
- **UPIF Chat Messages**: Reviewer chat for suggesting UPIF changes via GPT-5
  - `upif_chat_messages` table stores chat history (role, content, appliedUpdates jsonb)
  - POST /api/scenarios/:id/upif/chat sends message to GPT-5 with current UPIF state and locked fields list
  - AI returns structured JSON with field updates; server-side guardrails enforce confirmed field protection
  - Applied updates are persisted with field-level change tracking
  - UpifChat component renders chat history with change badges, inline below UPIF review

- **Clarifying Questions**: Before generating a UPIF, the AI asks 3 targeted clarifying questions based on missing/ambiguous information
  - `clarifyingQuestions` and `clarifyingAnswers` JSONB columns on scenarios table
  - POST /api/scenarios/:id/clarify generates AI-powered questions from inputs
  - POST /api/scenarios/:id/clarify-answers saves user answers
  - Answers are appended to extraction prompt for better UPIF quality
  - Users can skip the clarification step and generate directly
  - Re-generation reuses stored answers automatically

- **Prompt Templates**: AI prompts are stored in the database and editable via Settings page
  - `prompt_templates` table stores customized prompts by key (extraction, clarify, reviewer_chat, pdf_summary)
  - Default prompts defined in `shared/default-prompts.ts` with metadata (name, description, available variables)
  - GET /api/prompts lists all prompts (DB overrides merged with defaults)
  - PATCH /api/prompts/:key updates a prompt template
  - POST /api/prompts/:key/reset deletes customization, restoring the default
  - Reviewer chat and PDF summary prompts use template variables (e.g., {{UPIF_STATE}}, {{LOCKED_FIELDS}}, {{PROJECT_NAME}}) replaced at runtime
  - Settings page at /settings with expandable prompt cards, edit mode, save/reset functionality

- **2-Step Project Type Classification**: UPIF generation starts with AI classifying the project type before extraction
  - Project types: A (Wastewater Treatment), B (RNG Greenfield), C (RNG Bolt-On), D (Hybrid)
  - POST /api/scenarios/:id/classify calls AI with classification prompt, returns suggested type with confidence and reasoning
  - Classification result saved with projectTypeConfirmed=false; user must confirm via PATCH /api/scenarios/:id/project-type
  - UI shows 4 selectable type cards with AI suggestion badge and confidence indicator
  - After confirmation, extraction uses type-specific prompt (extraction_type_a through extraction_type_d)
  - Type-specific prompts use appropriate terminology (e.g., "influent/effluent" for Type A, "feedstock" for Type B)
  - Falls back to generic extraction prompt if project type not confirmed
  - Project type badge displayed on scenario header when confirmed

### Key Design Patterns
- **Shared Types**: Schema definitions in `shared/` directory used by both client and server
- **API Request Helper**: Centralized `apiRequest` function for consistent error handling
- **Component Composition**: Modular UI components for each workflow step (ConversationalInput, DocumentUpload, UpifReview)
- **Path Aliases**: `@/` for client source, `@shared/` for shared types

## External Dependencies

### Database
- PostgreSQL (required via `DATABASE_URL` environment variable)
- Drizzle ORM for type-safe database operations

### UI Framework
- Radix UI primitives (comprehensive set of accessible components)
- shadcn/ui styling patterns with Tailwind CSS
- Lucide React for icons

### AI/ML Integration
- **Multi-LLM Support**: Users can switch between GPT-5 (OpenAI), Claude Sonnet 4.5, and Claude Opus 4.6 (Anthropic) per scenario
  - Unified LLM service in `server/llm.ts` abstracts all providers behind a common interface
  - Smart client routing: Sonnet uses Replit AI Integration proxy (model ID: claude-sonnet-4-5), Opus requires direct ANTHROPIC_API_KEY (model ID: claude-opus-4-6)
  - `preferredModel` column on scenarios table stores the user's choice (default: gpt5), values: "gpt5", "claude", "claude-opus"
  - Model selector dropdown in UPIF tab (only shown when providers are available)
  - All LLM call points (extraction, reviewer chat, PDF summary) use the scenario's preferred model
  - GET `/api/llm-providers` returns available providers
  - Response parsing handles model-specific JSON field names (Opus uses "parameter" instead of "name", "units" instead of "unit")
  - PATCH `/api/scenarios/:id/preferred-model` updates model preference
  - Anthropic access via Replit AI Integrations (no separate API key needed, billed to credits)
- Falls back to available provider if preferred one is not configured, then to pattern matching
- Extracted parameters show "AI extracted" badge in the UI when AI is used
- **Feedstock Enrichment**: After AI extraction, feedstock types are matched against a built-in knowledge base (`shared/feedstock-library.ts`) containing design parameters for common AD feedstocks (Potato Waste, Dairy Manure, Food Waste, FOG, Crop Residue, Poultry Litter, Swine Manure, Municipal Wastewater Sludge)
- Each enriched parameter includes: value, unit, source (user_provided vs estimated_default), confidence level, provenance (literature citation/reasoning), and display grouping (identity, physical, biochemical, contaminants, extended)
- User-provided values override estimated defaults when available
- Pricing functionality has been removed and will be re-added in a future update
- **Output Criteria Enrichment**: After AI extraction, declared outputs (RNG, digestate, effluent) are matched against a built-in knowledge base (`shared/output-criteria-library.ts`) containing acceptance criteria for three output profiles:
  - RNG Pipeline Injection: 13 gas quality & delivery criteria (FERC/NAESB pipeline standards)
  - Solid Digestate Land Application: 18 physical/nutrients/metals criteria (EPA 40 CFR Part 503)
  - Liquid Effluent to WWTP: 13 discharge limits (municipal pretreatment ordinances)
- Each enriched output criterion includes: value, unit, source (typical_industry_standard/estimated_requirement/user_provided), confidence level, provenance, and display grouping
- Output specs are stored in UPIF `outputSpecs` jsonb column as `Record<profileName, Record<criterionKey, EnrichedOutputSpec>>`
- UPIF Review UI displays output acceptance criteria in grouped tables with source badges, confidence levels, and provenance tooltips
- Users can override any default criterion value via the Edit interface

### PDF Export
- PDFKit for server-side PDF generation
- GET `/api/scenarios/:id/upif/export-pdf` endpoint generates a professional PDF
- Includes AI-generated one-paragraph project summary at top (via GPT-5, with fallback)
- DRAFT watermark on every page for unconfirmed UPIFs (diagonal text + status badge)
- Full content: header, feedstock tables with grouped enriched specs, output acceptance criteria, location, constraints
- Page numbers and "Generated by Project Alpha" footer on every page
- Frontend "Export PDF" button in UPIF review with loading state

### Document Processing
- Multer for file upload handling
- XLSX for spreadsheet processing
- PDF text extraction via pdf-parse (dynamic import for ESM compatibility)
- DOCX text extraction via mammoth
- TXT files read directly
- Extracted text stored in `extractedText` column and included in AI parameter extraction

### Authentication & Security
- Passport.js with passport-local strategy
- Express sessions with PostgreSQL storage
- JSON Web Tokens (jsonwebtoken)

### Additional Services
- Stripe SDK (payment integration capability)
- Nodemailer (email functionality)

## Databricks App Migration (databricks_app/)

### Architecture
- **Deployment target**: Databricks Apps (adb-582457799522203.3.azuredatabricks.net)
- **Backend**: FastAPI (Python) replacing Express.js
- **Data**: Delta tables in Unity Catalog (`burnham_rng` catalog) replacing PostgreSQL
- **AI**: Databricks Model Serving endpoints (databricks-gpt-5-2, databricks-claude-opus-4-6, databricks-gemini-3-pro, databricks-claude-opus-4-5)
- **Auth**: OAuth service principal (brng-replit-AI) for SQL warehouse and Model Serving
- **PDF**: ReportLab replacing PDFKit
- **Frontend**: Same React frontend, built and served as static files

### Key Files
- `databricks_app/main.py` - FastAPI entry point with SPA static file serving
- `databricks_app/api/routes.py` - All 31 API routes ported from Express
- `databricks_app/services/storage.py` - Databricks SQL storage layer (Delta tables)
- `databricks_app/services/llm.py` - Databricks Model Serving AI service
- `databricks_app/knowledge_base/` - Feedstock library, output criteria, default prompts
- `databricks_app/sql/create_tables.sql` - Delta table schemas for burnham_rng catalog
- `databricks_app/app.yaml` - Databricks App manifest
- `databricks_app/DEPLOY.md` - Deployment guide

### Databricks Config
- Workspace: adb-582457799522203.3.azuredatabricks.net
- SQL Warehouse: /sql/1.0/warehouses/7740505e6e4de417
- Catalog: burnham_rng
- Schemas: project_intakes (7 tables), raw_documents (1 table)
- Service Principal: brng-replit-AI (credentials in Replit Secrets)