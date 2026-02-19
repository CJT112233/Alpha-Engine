# Project Factory - Databricks App Deployment Guide

## Architecture

Project Factory runs as a **Databricks App** with:
- **Frontend**: React (built to static files, served by FastAPI)
- **Backend**: FastAPI (Python) with Databricks SQL Connector
- **Data**: Delta tables in Unity Catalog (`burnham_rng` catalog)
- **AI**: Databricks Model Serving endpoints (GPT-5, Claude Opus, Gemini Pro)
- **Auth**: Databricks App built-in service principal for SQL warehouse and model serving

## Prerequisites

1. **Databricks Workspace** with Unity Catalog enabled
2. **SQL Warehouse** (Serverless or Pro) with access to `burnham_rng` catalog
3. **Databricks App Service Principal** (automatically provisioned when the app is created) with:
   - `USE CATALOG` on `burnham_rng`
   - `USE SCHEMA` on `burnham_rng.project_intakes` and `burnham_rng.raw_documents`
   - `SELECT`, `INSERT`, `UPDATE`, `DELETE` on all tables
   - Access to Model Serving endpoints
   - Note: The app's service principal name is visible in **Compute > Apps > your app > Settings**
4. **Model Serving Endpoints** deployed:
   - `databricks-gpt-5-2-codex`
   - `databricks-claude-opus-4-6`
   - `databricks-claude-sonnet-4-5`
   - `databricks-claude-sonnet-4-5`

## Step 1: Create Delta Tables

Run the SQL statements in `sql/create_tables.sql` against your workspace using a SQL warehouse or notebook:

```sql
-- In a Databricks SQL editor or notebook
-- Execute sql/create_tables.sql
```

This creates:
- `burnham_rng.project_intakes` schema (7 tables)
- `burnham_rng.raw_documents` schema (1 table)

## Step 2: Build the React Frontend

From the root project directory (where the original Node.js app lives):

```bash
npm run build
```

Then copy the built assets:

```bash
cp -r dist/public/ databricks_app/static/
```

The `static/` directory should contain `index.html` and an `assets/` folder.

## Step 3: Configure Environment Variables

The following connection defaults are hardcoded in `app.yaml` and the service files, so they work out of the box for the Burnham RNG workspace:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABRICKS_HOST` | `adb-582457799522203.3.azuredatabricks.net` | Workspace hostname |
| `DATABRICKS_HTTP_PATH` | `/sql/1.0/warehouses/7740505e6e4de417` | SQL warehouse HTTP path |
| `DATABRICKS_CATALOG` | `burnham_rng` | Unity Catalog catalog name |

**Authentication** is handled automatically by the Databricks App's built-in service principal. No manual `DATABRICKS_CLIENT_ID` or `DATABRICKS_CLIENT_SECRET` is needed — the Databricks SDK resolves credentials from the app runtime environment.

## Step 4: Deploy as Databricks App

### Option A: Using Databricks CLI

```bash
# Install Databricks CLI
pip install databricks-cli

# Configure
databricks configure --host https://adb-582457799522203.3.azuredatabricks.net

# Deploy the app
databricks apps deploy project-factory \
  --source-code-path databricks_app/ \
  --description "Project Factory - AI-enabled UPIF system"
```

### Option B: Using Databricks Workspace UI

1. Navigate to **Compute > Apps** in your workspace
2. Click **Create App**
3. Name: `project-factory`
4. Upload the `databricks_app/` directory
5. Set environment variables in the app configuration
6. Click **Deploy**

### Option C: Using Databricks SDK

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
app = w.apps.deploy(
    name="project-factory",
    source_code_path="databricks_app/",
    description="Project Factory - AI-enabled UPIF system"
)
```

## Step 5: Verify Deployment

1. Access the app URL provided by Databricks (e.g., `https://project-factory.cloud.databricks.com/`)
2. Create a test project and scenario
3. Add text input describing a biogas project
4. Generate the UPIF and verify feedstock enrichment
5. Test the reviewer chat
6. Export a PDF

## File Structure

```
databricks_app/
  app.yaml              # Databricks App manifest
  main.py               # FastAPI entry point
  requirements.txt      # Python dependencies
  DEPLOY.md             # This guide
  api/
    __init__.py
    routes.py            # All API routes (FastAPI)
  services/
    __init__.py
    storage.py           # Databricks SQL storage layer
    llm.py               # Databricks Model Serving AI service
  knowledge_base/
    __init__.py
    feedstock_library.py # AD feedstock design parameters
    output_criteria_library.py  # Output acceptance criteria
    default_prompts.py   # AI prompt templates
  models/
    __init__.py
    schemas.py           # Pydantic data models
  sql/
    create_tables.sql    # Delta table CREATE statements
  static/               # React build output (after npm run build)
    index.html
    assets/
```

## Troubleshooting

### Connection Issues
- Verify the app's built-in service principal has the correct permissions (see Prerequisites)
- Check that the SQL warehouse is running
- Ensure `DATABRICKS_HOST` does not include `https://`

### Model Serving Issues
- Verify endpoints are deployed and running in the Serving tab
- Check that the app's built-in service principal has `CAN_QUERY` permission on each endpoint
- Model endpoint names must match exactly (e.g., `databricks-gpt-5-2-codex`)

### Table Access Issues
- Run `SHOW GRANTS ON CATALOG burnham_rng` to verify catalog permissions
- Ensure schemas exist: `SHOW SCHEMAS IN burnham_rng`
- Verify tables: `SHOW TABLES IN burnham_rng.project_intakes`

### Frontend Not Loading
- Ensure `static/` directory exists with `index.html`
- Check that the React build was copied correctly
- Verify the `assets/` directory is present under `static/`
