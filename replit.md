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
- **AI-Powered CapEx Estimation**: Generates capital cost estimates from confirmed mass balance equipment lists for all project types.
- **AI-Powered OpEx Estimation**: Generates annual operating cost estimates from mass balance and CapEx data for all project types.
- **Deterministic Financial Model**: 10-year pro-forma financial projections with editable assumptions (inflation, ITC, RIN pricing, debt financing), calculating IRR, NPV@10%, MOIC, and payback period. Available after CapEx+OpEx are confirmed.
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