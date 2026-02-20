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

export async function enrichBiogasSpecsFromDb(
  feedstockType: string,
  userProvidedParams: Record<string, { value: string; unit?: string; extractionSource?: string }>,
): Promise<Record<string, EnrichedFeedstockSpec>> {
  return originalEnrichBiogasSpecs(feedstockType, userProvidedParams);
}

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
