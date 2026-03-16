/**
 * Database-First Enrichment Layer
 *
 * Wraps the in-memory feedstock/wastewater enrichment functions with a
 * database-first lookup strategy. When a user customizes a library profile
 * via the Documentation page (isCustomized=true), those customized values
 * take precedence over the hardcoded in-memory FEEDSTOCK_LIBRARY.
 *
 * Lookup order:
 *   1. Check PostgreSQL for matching profile with isCustomized=true
 *   2. If found: use DB profile properties, then overlay user-provided params
 *   3. If not found: fall back to in-memory library (originalEnrichFeedstockSpecs)
 *
 * Type A (Wastewater) projects use the "wastewater_influent" library type;
 * all other project types use the "feedstock" library type.
 */
import { storage } from "./storage";
import type { FeedstockProfile, FeedstockProperty, WastewaterInfluentProfile, EnrichedFeedstockSpec } from "@shared/feedstock-library";
import type { LibraryProfile } from "@shared/schema";
import { enrichFeedstockSpecs as originalEnrichFeedstockSpecs, enrichBiogasSpecs as originalEnrichBiogasSpecs } from "@shared/feedstock-library";

function profileToFeedstock(p: LibraryProfile): FeedstockProfile {
  return {
    name: p.name,
    aliases: p.aliases as string[],
    category: p.category,
    properties: p.properties as Record<string, FeedstockProperty>,
  };
}

function profileToWastewater(p: LibraryProfile): WastewaterInfluentProfile {
  return {
    name: p.name,
    aliases: p.aliases as string[],
    category: p.category,
    properties: p.properties as Record<string, FeedstockProperty>,
  };
}

/**
 * Searches the database for a matching library profile by name or alias.
 * Uses simple case-insensitive exact match + substring alias matching.
 * Returns undefined if no match found (caller falls back to in-memory library).
 */
async function matchFromDb(feedstockName: string, libraryType: string): Promise<LibraryProfile | undefined> {
  const profiles = await storage.getLibraryProfilesByType(libraryType);
  const lower = feedstockName.toLowerCase().trim();
  for (const profile of profiles) {
    if (profile.name.toLowerCase() === lower) return profile;
    const aliases = (profile.aliases as string[]) || [];
    for (const alias of aliases) {
      if (lower.includes(alias) || alias.includes(lower)) return profile;
    }
  }
  return undefined;
}

/**
 * Main enrichment entry point — checks DB for customized profiles first,
 * falls back to in-memory library if no customized DB match exists.
 * User-provided parameters always override library defaults regardless of source.
 */
export async function enrichFeedstockSpecsFromDb(
  feedstockType: string,
  userProvidedParams: Record<string, { value: string; unit?: string; extractionSource?: string }>,
  projectType?: string | null,
): Promise<Record<string, EnrichedFeedstockSpec>> {
  const isTypeA = projectType === "A";

  if (isTypeA) {
    const dbProfile = await matchFromDb(feedstockType, "wastewater_influent");
    if (dbProfile && dbProfile.isCustomized) {
      const wwProfile = profileToWastewater(dbProfile);
      const specs: Record<string, EnrichedFeedstockSpec> = {};
      for (const [key, prop] of Object.entries(wwProfile.properties)) {
        specs[key] = {
          value: prop.value,
          unit: prop.unit,
          source: "estimated_default",
          confidence: prop.confidence,
          provenance: prop.provenance,
          group: prop.group,
          displayName: prop.displayName,
          sortOrder: prop.sortOrder,
        };
      }
      return applyUserParams(specs, userProvidedParams, projectType);
    }
  } else {
    const dbProfile = await matchFromDb(feedstockType, "feedstock");
    if (dbProfile && dbProfile.isCustomized) {
      const profile = profileToFeedstock(dbProfile);
      const specs: Record<string, EnrichedFeedstockSpec> = {};
      for (const [key, prop] of Object.entries(profile.properties)) {
        specs[key] = {
          value: prop.value,
          unit: prop.unit,
          source: "estimated_default",
          confidence: prop.confidence,
          provenance: prop.provenance,
          group: prop.group,
          displayName: prop.displayName,
          sortOrder: prop.sortOrder,
        };
      }
      return applyUserParams(specs, userProvidedParams, projectType);
    }
  }

  return originalEnrichFeedstockSpecs(feedstockType, userProvidedParams, projectType);
}

/** Enriches biogas output specs — delegates directly to in-memory library (no DB override needed for outputs) */
export async function enrichBiogasSpecsFromDb(
  feedstockType: string,
  userProvidedParams: Record<string, { value: string; unit?: string; extractionSource?: string }>,
): Promise<Record<string, EnrichedFeedstockSpec>> {
  return originalEnrichBiogasSpecs(feedstockType, userProvidedParams);
}

/**
 * Overlays user-provided parameters onto library-derived specs.
 * Uses a key mapping (e.g., "total solids" → "totalSolids", "bod5" → "bod")
 * to handle variations in parameter naming from AI extraction.
 * User-provided values get "high" confidence; AI-inferred values retain their source tag.
 */
function applyUserParams(
  specs: Record<string, EnrichedFeedstockSpec>,
  userProvidedParams: Record<string, { value: string; unit?: string; extractionSource?: string }>,
  projectType?: string | null,
): Record<string, EnrichedFeedstockSpec> {
  const paramKeyMap: Record<string, string> = {
    "total solids": "totalSolids",
    "ts": "totalSolids",
    "volatile solids": "volatileSolids",
    "vs": "volatileSolids",
    "moisture content": "moistureContent",
    "bod": "bod",
    "bod5": "bod",
    "cod": "cod",
    "tss": "tss",
    "fog": "fog",
    "tkn": "tkn",
    "tn": "totalNitrogen",
    "total nitrogen": "totalNitrogen",
    "ph": "ph",
    "average flow": "avgFlow",
    "min flow": "minFlow",
    "peak flow": "peakFlow",
  };

  for (const [rawKey, val] of Object.entries(userProvidedParams)) {
    const mappedKey = paramKeyMap[rawKey.toLowerCase()] || rawKey;
    if (specs[mappedKey]) {
      specs[mappedKey] = {
        ...specs[mappedKey],
        value: val.value,
        unit: val.unit || specs[mappedKey].unit,
        source: val.extractionSource === "ai_inferred" ? "ai_inferred" : "user_provided",
        confidence: "high",
      };
    } else {
      specs[rawKey] = {
        value: val.value,
        unit: val.unit || "",
        source: val.extractionSource === "ai_inferred" ? "ai_inferred" : "user_provided",
        confidence: "high",
        provenance: "User provided",
        group: "extended",
        displayName: rawKey,
        sortOrder: 999,
      };
    }
  }

  return specs;
}
