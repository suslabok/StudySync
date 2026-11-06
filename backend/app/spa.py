"""Serve the built React app from the same FastAPI service (one origin: no CORS, and the SameSite=Lax login cookie just works).

Put this file in app/ and add TWO lines at the very bottom of app/main.py (after every route and mount):

    from app.spa import mount_frontend
    mount_frontend(app)

Does nothing when there is no build folder, so local development is unchanged.
"""
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parent.parent / "static"))
API_PREFIXES = ("graphql", "media", "docs", "openapi.json")


def mount_frontend(app: FastAPI) -> None:
    index = DIST / "index.html"
    if not index.is_file():
        return
    if (DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith(API_PREFIXES):
            raise HTTPException(status_code=404)
        file = (DIST / path).resolve()
        if path and file.is_file() and DIST.resolve() in file.parents:   # favicon, robots.txt, ... never outside the build
            return FileResponse(file)
        return FileResponse(index)   # any other URL is a React route (/study, /courses/3, ...)