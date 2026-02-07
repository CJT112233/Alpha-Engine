# Project Alpha - Intelligent Project Intake System

## Overview

Project Alpha is an AI-enabled project development system designed to transform unstructured project inputs into standardized specifications. The system allows users to capture project information through natural language (conversational input) and document uploads, then uses intelligent parameter extraction to generate a Unified Project Intake Form (UPIF).

The core workflow follows a scenario-based approach where:
1. Users create projects and scenarios within those projects
2. Each scenario maintains independent inputs, outputs, and constraints
3. Users provide project details through free-form text and document uploads
4. The system extracts and categorizes parameters (feedstock, output requirements, location, constraints)
5. Extracted feedstock parameters are enriched with design defaults from a built-in knowledge base (TS%, VS/TS, C:N, BMP, etc.) with provenance tracking
6. Parameters are consolidated into a standardized UPIF for user review and confirmation

## User Preferences

Preferred communication style: Simple, everyday language.

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
- **Scenarios**: Individual project evaluations with their own inputs/outputs (status: draft, in_review, confirmed)
- **Text Entries**: Conversational inputs categorized by type
- **Documents**: Uploaded files with metadata
- **Extracted Parameters**: AI-extracted parameters with confidence levels
- **UPIF Records**: Consolidated project intake forms with multi-feedstock support
  - `feedstocks` JSONB array stores multiple FeedstockEntry objects, each with independent type, volume, unit, parameters, and enriched specs
  - Legacy single-feedstock fields (feedstockType, feedstockVolume, feedstockUnit, feedstockSpecs) still populated from primary feedstock for backward compatibility
  - UI synthesizes a single-entry feedstocks array from legacy fields when feedstocks column is empty

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
- OpenAI SDK for intelligent parameter extraction using GPT-5
- The system uses AI to extract project parameters from natural language input
- Falls back to pattern matching if OpenAI API key is not configured
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