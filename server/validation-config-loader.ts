import { storage } from "./storage";

let cachedConfig: Record<string, any> = {};
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30000;

export async function getValidationConfigValue<T>(configKey: string, defaultValue: T): Promise<T> {
  const now = Date.now();
  if (now - cacheTimestamp > CACHE_TTL_MS) {
    try {
      const allConfigs = await storage.getAllValidationConfig();
      cachedConfig = {};
      for (const c of allConfigs) {
        cachedConfig[c.configKey] = c.configValue;
      }
      cacheTimestamp = now;
    } catch (err) {
      console.error("Failed to load validation config from DB, using defaults:", err);
    }
  }

  if (configKey in cachedConfig) {
    return cachedConfig[configKey] as T;
  }
  return defaultValue;
}

export function invalidateValidationConfigCache() {
  cacheTimestamp = 0;
}
