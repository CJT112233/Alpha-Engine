"""
Project Factory - Databricks App Entry Point

FastAPI application serving both the React frontend (static files)
and the backend API. Deployed as a Databricks App with OAuth
service principal authentication to Unity Catalog Delta tables.
"""
import json
import os
import re
import logging
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from api.routes import api_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("project-factory")

# ---------------------------------------------------------------------------
# Snake_case → camelCase API response middleware
# ---------------------------------------------------------------------------

_SNAKE_RE = re.compile(r"_([a-z])")


def _to_camel(snake: str) -> str:
    """Convert snake_case string to camelCase."""
    return _SNAKE_RE.sub(lambda m: m.group(1).upper(), snake)


def _convert_keys(obj):
    """Recursively convert all dict keys from snake_case to camelCase
    and serialize datetime objects to ISO 8601 strings."""
    if isinstance(obj, dict):
        return {_to_camel(k): _convert_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_keys(item) for item in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


class CamelCaseMiddleware(BaseHTTPMiddleware):
    """Middleware that converts JSON API responses from snake_case to camelCase."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Only transform JSON responses from /api/ routes
        if not request.url.path.startswith("/api/"):
            return response

        content_type = response.headers.get("content-type", "")
        if "application/json" not in content_type:
            return response

        # Read the response body
        body_chunks = []
        async for chunk in response.body_iterator:
            if isinstance(chunk, bytes):
                body_chunks.append(chunk)
            else:
                body_chunks.append(chunk.encode("utf-8"))
        body = b"".join(body_chunks)

        try:
            data = json.loads(body)
            converted = _convert_keys(data)
            new_body = json.dumps(converted, default=str)
            headers = dict(response.headers)
            headers.pop("content-length", None)  # Will be recalculated
            return Response(
                content=new_body,
                status_code=response.status_code,
                headers=headers,
                media_type="application/json",
            )
        except (json.JSONDecodeError, TypeError):
            # Not valid JSON or conversion failed — return original
            return Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=content_type,
            )


app = FastAPI(
    title="Project Factory",
    description="AI-enabled Unified Project Intake Form system for biogas/anaerobic digestion projects",
    version="1.0.0",
)

app.add_middleware(CamelCaseMiddleware)
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

    logger.info("Using Databricks App built-in service principal for authentication")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
