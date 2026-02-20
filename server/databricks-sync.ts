interface DatabricksConfig {
  host: string;
  httpPath: string;
  catalog: string;
  clientId: string;
  clientSecret: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function getConfig(): DatabricksConfig | null {
  const host = process.env.DATABRICKS_HOST;
  const httpPath = process.env.DATABRICKS_HTTP_PATH;
  const catalog = process.env.DATABRICKS_CATALOG;
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;

  if (!host || !httpPath || !catalog || !clientId || !clientSecret) {
    return null;
  }

  return { host, httpPath, catalog, clientId, clientSecret };
}

async function getAccessToken(config: DatabricksConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const tokenUrl = `https://${config.host}/oidc/v1/token`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "all-apis",
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: params.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Databricks token fetch failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

async function executeSql(config: DatabricksConfig, statement: string, parameters?: any[]): Promise<any> {
  const token = await getAccessToken(config);
  const warehouseId = config.httpPath.split("/").pop();

  const body: any = {
    statement,
    warehouse_id: warehouseId,
    wait_timeout: "30s",
    on_wait_timeout: "CANCEL",
    catalog: config.catalog,
    schema: "default",
  };

  if (parameters && parameters.length > 0) {
    body.parameters = parameters;
  }

  const resp = await fetch(`https://${config.host}/api/2.0/sql/statements/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Databricks SQL failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

function escapeString(val: string): string {
  return val.replace(/'/g, "''");
}

export async function syncPromptToDatabricks(promptKey: string, promptText: string): Promise<boolean> {
  const config = getConfig();
  if (!config) {
    console.log("[Databricks Sync] Skipping prompt sync - credentials not configured");
    return false;
  }

  try {
    const sql = `
      MERGE INTO ${config.catalog}.default.prompt_templates AS target
      USING (SELECT '${escapeString(promptKey)}' AS prompt_key, '${escapeString(promptText)}' AS prompt_text) AS source
      ON target.prompt_key = source.prompt_key
      WHEN MATCHED THEN UPDATE SET prompt_text = source.prompt_text, updated_at = current_timestamp()
      WHEN NOT MATCHED THEN INSERT (prompt_key, prompt_text, updated_at) VALUES (source.prompt_key, source.prompt_text, current_timestamp())
    `;

    await executeSql(config, sql);
    console.log(`[Databricks Sync] Prompt "${promptKey}" synced successfully`);
    return true;
  } catch (err) {
    console.error(`[Databricks Sync] Failed to sync prompt "${promptKey}":`, err);
    return false;
  }
}

export async function syncLibraryProfileToDatabricks(profile: {
  libraryType: string;
  name: string;
  aliases: string[];
  category: string;
  properties: any;
  sortOrder: number;
  isCustomized: boolean;
}): Promise<boolean> {
  const config = getConfig();
  if (!config) {
    console.log("[Databricks Sync] Skipping library profile sync - credentials not configured");
    return false;
  }

  try {
    const aliasesJson = escapeString(JSON.stringify(profile.aliases));
    const propsJson = escapeString(JSON.stringify(profile.properties));

    const sql = `
      MERGE INTO ${config.catalog}.default.library_profiles AS target
      USING (SELECT '${escapeString(profile.libraryType)}' AS library_type, '${escapeString(profile.name)}' AS name) AS source
      ON target.library_type = source.library_type AND target.name = source.name
      WHEN MATCHED THEN UPDATE SET
        aliases = '${aliasesJson}',
        category = '${escapeString(profile.category)}',
        properties = '${propsJson}',
        sort_order = ${profile.sortOrder},
        is_customized = ${profile.isCustomized},
        updated_at = current_timestamp()
      WHEN NOT MATCHED THEN INSERT (library_type, name, aliases, category, properties, sort_order, is_customized, updated_at)
        VALUES (source.library_type, source.name, '${aliasesJson}', '${escapeString(profile.category)}', '${propsJson}', ${profile.sortOrder}, ${profile.isCustomized}, current_timestamp())
    `;

    await executeSql(config, sql);
    console.log(`[Databricks Sync] Library profile "${profile.name}" (${profile.libraryType}) synced`);
    return true;
  } catch (err) {
    console.error(`[Databricks Sync] Failed to sync library profile "${profile.name}":`, err);
    return false;
  }
}

export async function syncValidationConfigToDatabricks(configEntry: {
  configKey: string;
  configValue: any;
  description: string;
  category: string;
}): Promise<boolean> {
  const config = getConfig();
  if (!config) {
    console.log("[Databricks Sync] Skipping validation config sync - credentials not configured");
    return false;
  }

  try {
    const valueJson = escapeString(JSON.stringify(configEntry.configValue));

    const sql = `
      MERGE INTO ${config.catalog}.default.validation_config AS target
      USING (SELECT '${escapeString(configEntry.configKey)}' AS config_key) AS source
      ON target.config_key = source.config_key
      WHEN MATCHED THEN UPDATE SET
        config_value = '${valueJson}',
        description = '${escapeString(configEntry.description)}',
        category = '${escapeString(configEntry.category)}',
        updated_at = current_timestamp()
      WHEN NOT MATCHED THEN INSERT (config_key, config_value, description, category, updated_at)
        VALUES (source.config_key, '${valueJson}', '${escapeString(configEntry.description)}', '${escapeString(configEntry.category)}', current_timestamp())
    `;

    await executeSql(config, sql);
    console.log(`[Databricks Sync] Validation config "${configEntry.configKey}" synced`);
    return true;
  } catch (err) {
    console.error(`[Databricks Sync] Failed to sync validation config "${configEntry.configKey}":`, err);
    return false;
  }
}
