# Project Factory - Intelligent Project Intake System

## Overview
Project Factory is an AI-powered system that transforms unstructured project inputs (natural language, documents) into standardized project specifications. It generates a Unified Project Intake Form (UPIF) by extracting, categorizing, and enriching project parameters with design defaults. The system supports scenario-based workflows for independent project evaluations, aiming to streamline project initiation with comprehensive, validated project definitions. It provides AI-powered mass balance, CapEx, OpEx estimations, and deterministic 10-year pro-forma financial modeling.

## User Preferences
Preferred communication style: Simple, everyday language.
Number formatting: Always display numbers with comma separators for thousands (e.g., 10,000 not 10000).
Unit conventions (US-based):
- Energy: MMBTU (never GJ or MJ)
- Gas volumes: cubic feet (scf, scfm, scfh, scfd) — never m³ or Nm³
- Liquid volumes: gallons (gal, gpd, gpm, MGD) — never m³ or liters for process volumes
- Concentrations: mg/L (standard in US wastewater industry)
- "RNG" must always be fully capitalized — never "Rng" or "rng" in display text
- Solids mass: tons (US short tons) — never tonnes
- Mixing power: W/m³ is acceptable (industry standard worldwide)
- OLR: kg VS/m³·d is acceptable (industry standard worldwide)

## System Architecture

### Core Functionality
- **Intelligent Parameter Extraction**: AI extracts and categorizes project parameters from free-form text and documents.
- **Feedstock & Output Enrichment**: Enriches parameters with design defaults and acceptance criteria from internal knowledge bases.
- **Unified Project Intake Form (UPIF)**: A consolidated, standardized form for user review, supporting multi-feedstock projects.
- **Validation Guardrails**: A multi-step pipeline ensures data integrity, identifies warnings, and categorizes unmapped specifications.
- **Clarifying Questions**: AI generates questions for missing or ambiguous information to improve UPIF accuracy.
- **User-Selected Project Type**: Users select project types (Wastewater Treatment, RNG Greenfield, RNG Bolt-On, Hybrid) to drive type-specific processes.
- **Reviewer Chat**: AI-powered chat for suggesting UPIF changes, with structured updates.
- **Configurable Prompt Templates**: AI prompts are customizable via a Documentation page.
- **Editable Reference Libraries**: Feedstock, wastewater influent, and output criteria profiles are editable.
- **Editable Validation Config**: Validation thresholds and rules are configurable via a Documentation page.
- **Databricks Sync**: All configuration edits are automatically synced to Databricks.
- **Generation Stats**: Tracks timing and metadata for all AI-generated documents (UPIF, Mass Balance, CapEx).
- **AI-Powered Mass Balance**: Generates mass balances using LLMs for four project types, with deterministic calculators as fallback.
- **Hybrid CapEx Estimation**: For RNG types (B/C/D), uses a hybrid approach: deterministic pricing for Prodeval GUU/BOP/construction/Burnham internal costs (Burnham CapEx Model V5.1 at 400/800/1200 SCFM tiers with interpolation), plus AI estimation for upstream process equipment not covered by firm pricing (digesters, macerators, depackaging, EQ tanks, pumps, heat exchangers, centrifuges, DAF, storage). Equipment covered by deterministic pricing is identified via pattern matching in `isEquipmentCoveredByDeterministic()`. Upstream AI estimation uses `estimateUpstreamEquipmentCosts()` in `server/services/capexAI.ts`. Falls back to full AI for Type A or flows >1,200 SCFM. See `shared/capex-pricing-library.ts` and `server/services/capexDeterministic.ts`.
- **Editable OpEx Assumptions**: OpEx assumptions (maintenance rate, electricity rate, load factor, labor costs, chemical costs, disposal costs, insurance, etc.) are editable per project type. Users can modify assumptions inline and recalculate all line items and totals deterministically via `POST /api/opex/:id/recompute`. Unit costs are also editable inline in the line items table, with proportional annual cost recalculation. Annual cost totals and summary values are read-only (computed from unit rates). Small unit costs display with 2 decimals (e.g., $0.07/kWh). Default assumptions defined in `getDefaultOpexAssumptions()` in `server/services/opexAI.ts`. UI component: `AssumptionsEditor` in `client/src/pages/opex.tsx`.
- **AI-Powered OpEx Estimation**: Generates annual operating cost estimates from mass balance and CapEx data for all project types. Type A (Wastewater) prompts include EPA/WEF O&M benchmarks (energy kWh/MG, staffing FTE, chemical costs, disposal rates).
- **Industry Cost Benchmarks (Type A)**: CapEx and OpEx AI prompts for Type A (Wastewater) projects include EPA CWNS 2022 cost curves and City of Phoenix/Carollo 2024 unit costs as calibration references. Covers WWTP construction by system type/MGD, conveyance piping $/ft, lift station costs, and treatment $/gpd benchmarks.
- **Deterministic Financial Model**: 20-year pro-forma financial projections with editable assumptions (inflation, ITC, RIN pricing, debt financing, 45Z tax credits), calculating IRR, NPV@10%, MOIC, and payback period. Available once mass balance, CapEx, and OpEx estimates exist (finalization not required). CapEx/OpEx can be modified after financial model generation; regenerate to incorporate changes.
- **45Z Clean Fuel Tax Credits**: Integrated 45Z revenue stream in financial model. Calculates credits from CI score, target CI, emission factor, credit price ($1.06/gal default), and gallon-per-MMBtu conversion (8.614). CI score auto-estimated from feedstock type (e.g., dairy manure ~10, food waste ~20, landfill gas ~40). Credits default to enabled through 2029, with user controls to disable or extend end year. Formula: Net 45Z = (TargetCI - CI) / TargetCI × CreditPrice × Conversion × Monetization%. See `calculate45ZRevenuePerMMBtu()` in `server/services/financialModel.ts`.
- **PDF & Excel Export**: Provides professional PDF and Excel export options for Mass Balance, CapEx, and OpEx reports.

### Technical Implementation
- **Frontend**: React 18, TypeScript, Wouter, TanStack Query, shadcn/ui, Tailwind CSS, React Hook Form, Zod, Vite.
- **Backend**: Express.js, TypeScript, RESTful API, Multer.
- **Data Storage**: PostgreSQL, Drizzle ORM.
- **Shared Architecture**: Shared types/schemas, modular UI components.
- **Databricks Migration**: Transitioning to a Databricks environment with FastAPI (Python) backend, Delta tables, and Databricks Model Serving. Existing React frontend remains.

## External Dependencies

### Database
- PostgreSQL

### UI/UX Libraries
- Radix UI primitives
- shadcn/ui
- Lucide React (icons)

### AI/ML Integration
- OpenAI (GPT-5)
- Anthropic (Claude Sonnet 4.5, Claude Opus 4.6)
- Built-in knowledge bases: Feedstock Library, Wastewater Influent Library, Output Criteria Library.

### Document Processing
- Multer
- XLSX
- pdf-parse
- mammoth

### Authentication & Security
- Passport.js
- Express sessions
- jsonwebtoken

### Additional Services
- Stripe SDK
- Nodemailer

### Databricks Specific
- Databricks Model Serving
- ReportLab (for PDF generation)
- openpyxl (for Excel generation)