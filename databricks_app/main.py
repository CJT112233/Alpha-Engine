"""
Project Factory - Databricks App Entry Point

FastAPI application serving both the React frontend (static files)
and the backend API. Deployed as a Databricks App with OAuth
service principal authentication to Unity Catalog Delta tables.
"""
import os
import logging
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from api.routes import api_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("project-factory")

app = FastAPI(
    title="Project Factory",
    description="AI-enabled Unified Project Intake Form system for biogas/anaerobic digestion projects",
    version="1.0.0",
)

app.include_router(api_router)

STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": "Not found"})

        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))

        return FileResponse(str(STATIC_DIR / "index.html"))
else:
    logger.warning(
        "Static directory not found at %s. "
        "Run 'npm run build' in the frontend project and copy dist/ to databricks_app/static/",
        STATIC_DIR,
    )

    @app.get("/")
    async def root():
        return {
            "status": "running",
            "message": "Project Factory API is running. Frontend static files not found.",
            "docs": "/docs",
        }


@app.on_event("startup")
async def startup_event():
    host = os.environ.get("DATABRICKS_HOST", "adb-582457799522203.3.azuredatabricks.net")
    http_path = os.environ.get("DATABRICKS_HTTP_PATH", "/sql/1.0/warehouses/7740505e6e4de417")
    catalog = os.environ.get("DATABRICKS_CATALOG", "burnham_rng")

    logger.info("Project Factory starting up...")
    logger.info("Databricks Host: %s", host)
    logger.info("HTTP Path: %s", http_path)
    logger.info("Catalog: %s", catalog)

    required_vars = ["DATABRICKS_CLIENT_ID", "DATABRICKS_CLIENT_SECRET"]
    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        logger.warning("Missing environment variables: %s", ", ".join(missing))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
