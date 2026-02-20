# Alpha-Engine (Project Factory) — System Flow & LLM Engine Analysis

---

## End-to-End System Flow

```
+===================================================================================+
|                       ALPHA-ENGINE (PROJECT FACTORY)                               |
|                 AI-Powered RNG / Wastewater Project Intake System                  |
+===================================================================================+


STEP 1: PROJECT & SCENARIO SETUP                                      [No LLM]
+-----------------------------------------------------------------------------+
| User creates a Project, then creates Scenarios within it.                   |
| Each Scenario selects a preferred LLM: GPT-5 | Claude Sonnet | Opus        |
|                                                                             |
| Project Type (A/B/C/D) can be set via PATCH endpoint, but NO frontend UI   |
| exists for this yet. If set + confirmed, it unlocks type-specific prompts.  |
|                                                                             |
|   Type A: Wastewater Treatment (WWT)                                        |
|   Type B: RNG Greenfield                                                    |
|   Type C: RNG Bolt-On                                                       |
|   Type D: Hybrid Systems                                                    |
+-----------------------------------------------------------------------------+
         |
         v
STEP 2: INPUT CAPTURE                                                 [No LLM]
+-----------------------------------------------------------------------------+
| Two input channels:                                                         |
|   1. Conversational Text — free-form natural language descriptions          |
|   2. Document Upload — PDF, DOCX, XLSX with text extraction                 |
|      (pdf-parse, mammoth, xlsx libraries)                                   |
| Inputs categorized: feedstock | output_requirements | location | etc        |
+-----------------------------------------------------------------------------+
| Files: server/routes.ts (lines 1089-1176)                                   |
|        client/src/components/conversational-input.tsx                        |
|        client/src/components/document-upload.tsx                             |
+-----------------------------------------------------------------------------+
         |
         v
STEP 3: CLARIFYING QUESTIONS                                          [LLM]
+-----------------------------------------------------------------------------+
| LLM Engine: Scenario's preferred model (GPT-5 / Claude Sonnet / Opus)      |
| Prompt Key: "clarify"                                                       |
|                                                                             |
| All collected text + doc extracts sent to LLM.                              |
| LLM generates 3 targeted questions for missing/ambiguous data.              |
| User answers stored, fed into Step 4.                                       |
+-----------------------------------------------------------------------------+
| Files: server/routes.ts (lines 1202-1313)                                   |
|        server/llm.ts                                                        |
|        shared/default-prompts.ts                                            |
+-----------------------------------------------------------------------------+
         |
         v
STEP 4: PARAMETER EXTRACTION (the heavy-lifting step)                 [LLM + Rules]
+-----------------------------------------------------------------------------+
|                                                                             |
|  4a. GATHER INPUTS                                          [No LLM]       |
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Collect: all text entries + document extracts + clarifying answers  │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v                                                                   |
|  4b. SELECT PROMPT                                          [No LLM]       |
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Check: scenario.projectType AND scenario.projectTypeConfirmed      │    |
|  │                                                                     │    |
|  │   BOTH true?                                                        │    |
|  │     YES → use type-specific prompt:                                 │    |
|  │            A → "extraction_type_a"                                  │    |
|  │            B → "extraction_type_b"                                  │    |
|  │            C → "extraction_type_c"                                  │    |
|  │            D → "extraction_type_d"                                  │    |
|  │     NO  → use generic "extraction" prompt                           │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v                                                                   |
|  4c. LLM EXTRACTION                                         [LLM]         |
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Send everything to preferred model (GPT-5 / Claude Sonnet / Opus)  │    |
|  │ LLM persona: "Senior wastewater engineer"                          │    |
|  │ Returns: structured JSON with parameters + confidence levels        │    |
|  │                                                                     │    |
|  │ If LLM fails → fall back to 4d                                     │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v (only if LLM fails)                                               |
|  4d. REGEX FALLBACK                                         [No LLM]       |
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Pattern matching: BOD, COD, TS, VS/TS, C:N, flow rates, locations  │    |
|  │ Returns parameters with confidence scores                           │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v                                                                   |
|  4e. FILTER & DEDUPLICATE                                   [No LLM]       |
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Remove params missing name/category                                 │    |
|  │ Deduplicate by name + category                                      │    |
|  │ Validate section assignments (move mismatches to "unmapped")        │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v                                                                   |
|  4f. FEEDSTOCK ENRICHMENT                                   [Knowledge Base]|
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Match feedstock types to library profiles (25+ profiles)            │    |
|  │ Fill in design defaults where user didn't provide values            │    |
|  │ Track source: "user_provided" | "ai_inferred" | "estimated_default"│    |
|  │                                                                     │    |
|  │ Type C special: enrichBiogasSpecsFromDb (CH4, CO2, H2S, etc.)     │    |
|  │ All others: enrichFeedstockSpecsFromDb                              │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v                                                                   |
|  4g. OUTPUT SPEC ENRICHMENT                                 [Knowledge Base]|
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Match output requirements to criteria library                       │    |
|  │ Profiles: RNG Pipeline, Liquid Effluent, Digestate, etc.           │    |
|  │                                                                     │    |
|  │ Type A guarantee: auto-adds effluent profile with defaults          │    |
|  │   (BOD, COD, TSS, FOG, pH from industry standards)                 │    |
|  │ Keyword fallback: scans text for "rng", "pipeline", "effluent"     │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v                                                                   |
|  4h. VALIDATION CHAIN (8 sequential validators)             [Rule-Based]   |
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ V0: rejectBiosolidsOutputProfile    — universal guardrail           │    |
|  │ V1: validateAndSanitizeOutputSpecs  — gas/liquid/solids sections    │    |
|  │ V1b: validateBiogasVsRng           — reject raw biogas from RNG    │    |
|  │ V2: validateFeedstocksForTypeA     — wastewater gate, block sludge │    |
|  │ V2b: validateFeedstocksForTypeD    — stream separation checks      │    |
|  │ V2c: validateTypeADesignDrivers    — auto-populate missing drivers │    |
|  │ V3: applyTsTssGuardrail            — TS/TSS consistency check      │    |
|  │ V4: applySwapDetection             — data mismatch detection       │    |
|  │                                                                     │    |
|  │ All warnings accumulated into validationWarnings array              │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|         |                                                                   |
|         v                                                                   |
|  4i. CREATE / UPDATE UPIF                                   [No LLM]       |
|  ┌─────────────────────────────────────────────────────────────────────┐    |
|  │ Store: feedstocks, outputSpecs, performanceTargets, constraints,    │    |
|  │        location, validationWarnings, unmappedSpecs                  │    |
|  │ Merge with existing UPIF (respect locked/confirmed fields)          │    |
|  │ Scenario status: "draft" → "in_review"                              │    |
|  └─────────────────────────────────────────────────────────────────────┘    |
|                                                                             |
+-----------------------------------------------------------------------------+
| Files: server/routes.ts (lines 1315-1912)                                   |
|        server/enrichment-db.ts                                              |
|        server/validation.ts (46KB)                                          |
|        shared/feedstock-library.ts (140KB knowledge base)                   |
|        shared/output-criteria-library.ts (24KB knowledge base)              |
+-----------------------------------------------------------------------------+
         |
         v
STEP 5: USER REVIEW & CONFIRMATION                                    [LLM Chat]
+-----------------------------------------------------------------------------+
| User reviews UPIF with color-coded confidence levels.                       |
| Can lock/unlock individual fields. Can inline-edit any value.               |
|                                                                             |
| AI Reviewer Chat:                                                           |
|   LLM Engine: Claude Sonnet 4.5 (hardcoded for streaming)                  |
|   Prompt Key: "reviewer_chat"                                               |
|   Conversational interface for suggesting UPIF modifications                |
|   Respects locked fields — won't suggest changes to confirmed values        |
|                                                                             |
| User confirms UPIF → Scenario status: CONFIRMED                            |
+-----------------------------------------------------------------------------+
| Files: client/src/pages/scenario-detail.tsx                                 |
|        client/src/components/upif-review.tsx                                |
|        server/routes.ts (lines 2082-2439)                                   |
+-----------------------------------------------------------------------------+
         |
         v
STEP 6: MASS BALANCE GENERATION                                       [LLM + Fallback]
+-----------------------------------------------------------------------------+
| PRIMARY: AI Mass Balance                                                    |
|   LLM Engine: Scenario's preferred model                                    |
|   Prompt Keys: "mass_balance_type_a/b/c/d" (type-specific)                 |
|   Input: Confirmed UPIF data                                               |
|   Output: Treatment stages, equipment list, recycle streams,                |
|           convergence metrics, assumptions, warnings                        |
|                                                                             |
| FALLBACK: Deterministic Calculators (No LLM)                               |
|   Type A: server/services/massBalance.ts (industrial pretreatment model)    |
|   Type B: server/services/massBalanceTypeB.ts (standalone AD)               |
|   Type C: server/services/massBalanceTypeC.ts (bolt-on AD)                  |
|   Type D: server/services/massBalanceTypeD.ts (hybrid multi-stream)         |
|                                                                             |
| User can edit values, recompute with overrides                              |
+-----------------------------------------------------------------------------+
| Files: server/services/massBalanceAI.ts                                     |
|        server/services/massBalance.ts, massBalanceTypeB/C/D.ts              |
|        client/src/pages/mass-balance.tsx                                    |
+-----------------------------------------------------------------------------+
         |
         v
STEP 7: CAPEX ESTIMATION                                              [LLM]
+-----------------------------------------------------------------------------+
| LLM Engine: Scenario's preferred model                                      |
| Prompt Keys: "capex_type_a/b/c/d" (type-specific)                          |
| Input: Equipment list from Mass Balance + UPIF context                      |
| Output: Line-item costs, installation factors, contingency,                 |
|         civil/mechanical/electrical breakdown, total project cost            |
+-----------------------------------------------------------------------------+
| Files: server/services/capexAI.ts                                           |
|        client/src/pages/capex.tsx                                           |
+-----------------------------------------------------------------------------+
         |
         v
STEP 8: OPEX ESTIMATION                                               [LLM]
+-----------------------------------------------------------------------------+
| LLM Engine: Scenario's preferred model                                      |
| Prompt Keys: "opex_type_a/b/c/d" (type-specific)                           |
| Input: Mass Balance + CapEx data + equipment list                           |
| Output: Annual operating costs by category (labor, chemicals,               |
|         utilities, maintenance, disposal), total annual OpEx                |
+-----------------------------------------------------------------------------+
| Files: server/services/opexAI.ts                                            |
|        client/src/pages/opex.tsx                                            |
+-----------------------------------------------------------------------------+
         |
         v
STEP 9: VENDOR LIST GENERATION                                        [LLM]
+-----------------------------------------------------------------------------+
| LLM Engine: Scenario's preferred model                                      |
| Prompt Key: "vendor_list"                                                   |
| Input: Equipment specs from mass balance                                    |
| Output: Vendor recommendations per equipment type                           |
|                                                                             |
| UI Location: Mass Balance page > Equipment tab (visible after finalized)    |
+-----------------------------------------------------------------------------+
| Files: server/services/vendorListAI.ts                                      |
|        client/src/pages/mass-balance.tsx (VendorListSection component)       |
+-----------------------------------------------------------------------------+
         |
         v
STEP 10: EXPORT                                                        [LLM for summary only]
+-----------------------------------------------------------------------------+
| Formats: PDF (PDFKit) and Excel (XLSX)                                      |
| Available for: UPIF, Mass Balance, CapEx, OpEx, Vendor List                 |
|                                                                             |
| PDF summary generation uses LLM (scenario's preferred model)                |
| Everything else is deterministic formatting.                                |
+-----------------------------------------------------------------------------+
| Files: server/services/exportService.ts                                     |
+-----------------------------------------------------------------------------+
```

---

## LLM Engine Assignment Summary

| Step | LLM Used? | Engine Selection |
|------|-----------|------------------|
| 1. Project/Scenario Setup | No | N/A |
| 2. Input Capture | No | N/A |
| 3. Clarifying Questions | **Yes** | Scenario preference (GPT-5 / Claude Sonnet / Opus) |
| 4a-b. Gather inputs, select prompt | No | N/A |
| 4c. LLM Extraction | **Yes** | Scenario preference |
| 4d. Regex fallback | No (fallback only) | N/A |
| 4e. Filter & dedup | No | N/A |
| 4f. Feedstock enrichment | No | Knowledge base (feedstock-library.ts) |
| 4g. Output spec enrichment | No | Knowledge base (output-criteria-library.ts) |
| 4h. Validation chain | No | Rule engine (validation.ts) |
| 4i. Create/update UPIF | No | N/A |
| 5. User Review Chat | **Yes** | Claude Sonnet 4.5 (hardcoded) |
| 6. Mass Balance | **Yes** + fallback | Scenario preference; deterministic fallback per type |
| 7. CapEx Estimation | **Yes** | Scenario preference |
| 8. OpEx Estimation | **Yes** | Scenario preference |
| 9. Vendor List | **Yes** | Scenario preference |
| 10. Export | Partial | Scenario preference (PDF summary only) |

---

## LLM Provider Details

| Provider | Model ID | API | JSON Mode |
|----------|----------|-----|-----------|
| GPT-5 | gpt-5 | OpenAI SDK | Native json_object |
| Claude Sonnet | claude-sonnet-4-5 | Anthropic SDK | Via system prompt |
| Claude Opus | claude-opus-4-6 | Anthropic SDK (direct) | Via system prompt |

**Fallback strategy:** Try preferred model → try first available → iterate all providers → throw error only if ALL fail.

**Availability:** GPT-5 requires `OPENAI_API_KEY`. Claude Sonnet works via Replit integration or direct key. Claude Opus requires direct `ANTHROPIC_API_KEY` only.

---

## Prompt Template Keys

All prompts are user-editable via `/docs/prompts` page and stored in DB.

| Key | Used In | Purpose |
|-----|---------|---------|
| `extraction` | Step 4c | Generic parameter extraction |
| `extraction_type_a/b/c/d` | Step 4c | Type-specific extraction (requires confirmed type) |
| `clarify` | Step 3 | Clarifying question generation |
| `reviewer_chat` | Step 5 | Conversational UPIF modification |
| `mass_balance_type_a/b/c/d` | Step 6 | Type-specific mass balance |
| `capex_type_a/b/c/d` | Step 7 | Type-specific CapEx estimation |
| `opex_type_a/b/c/d` | Step 8 | Type-specific OpEx estimation |
| `vendor_list` | Step 9 | Equipment vendor identification |
| `pdf_summary` | Step 10 | Report summary generation |

---

## Key Architecture Notes

1. **No AI classification step.** Project type is set manually via a PATCH endpoint. No frontend UI exists for it yet. If not set + confirmed, all extraction uses the generic prompt.

2. **Scenario-level model selection.** Each scenario independently chooses its LLM, allowing A/B comparison of model quality.

3. **Knowledge bases are deterministic.** Feedstock enrichment (140KB library) and output criteria matching (24KB library) use lookup-based matching, not AI.

4. **Validation is rule-based.** The 46KB validation engine runs 8 sequential validators with no LLM involvement.

5. **Every LLM step has a fallback.** Pattern-matching for extraction, deterministic calculators for mass balance, and provider failover for all steps.

6. **Dual deployment.** The system runs on both Node.js/Express (Replit) and Python/FastAPI (Databricks), with identical logic mirrored across both stacks.
