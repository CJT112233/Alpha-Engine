# Project Alpha - Intelligent Project Intake System

## Overview

Project Alpha is an AI-enabled project development system designed to transform unstructured project inputs into standardized specifications. The system allows users to capture project information through natural language (conversational input) and document uploads, then uses intelligent parameter extraction to generate a Unified Project Intake Form (UPIF).

The core workflow follows a scenario-based approach where:
1. Users create projects and scenarios within those projects
2. Each scenario maintains independent inputs, outputs, and constraints
3. Users provide project details through free-form text and document uploads
4. The system extracts and categorizes parameters (feedstock, output requirements, location, pricing, constraints)
5. Parameters are consolidated into a standardized UPIF for user review and confirmation

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
- **UPIF Records**: Consolidated project intake forms

### Key Design Patterns
- **Shared Types**: Schema definitions in `shared/` directory used by both client and server
- **API Request Helper**: Centralized `apiRequest` function for consistent error handling
- **Component Composition**: Modular UI components for each workflow step (ConversationalInput, DocumentUpload, ParameterExtraction, UpifReview)
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
- OpenAI SDK (listed in build allowlist for parameter extraction)
- Google Generative AI SDK (listed in build allowlist)

### Document Processing
- Multer for file upload handling
- XLSX for spreadsheet processing

### Authentication & Security
- Passport.js with passport-local strategy
- Express sessions with PostgreSQL storage
- JSON Web Tokens (jsonwebtoken)

### Additional Services
- Stripe SDK (payment integration capability)
- Nodemailer (email functionality)