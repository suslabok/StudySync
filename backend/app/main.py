import os

from dotenv import load_dotenv
from ariadne.asgi import GraphQL
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

load_dotenv()          # must run before the app modules below read their settings

from app.api import schema
from app.profile import MEDIA_DIR
from app.security import BodyLimitMiddleware, QueryLimits, SecurityHeadersMiddleware, safe_format_error
from app.spa import mount_frontend

try:                    # production: a browser opening /graphql must not get an API playground
    from ariadne.explorer import ExplorerHttp405
except ImportError:     # very old ariadne
    ExplorerHttp405 = None

# DEBUG=1 (in your local backend/.env only) shows error details, the /docs page and the GraphQL explorer.
DEBUG = os.getenv("DEBUG", "0") == "1"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"
MAX_BODY_BYTES = int(float(os.getenv("MAX_BODY_MB", "12")) * 1024 * 1024)
CSP_MODE = os.getenv("CSP_MODE", "report")      # report | enforce | off


class CookieMiddleware:
    """Lets resolvers queue Set-Cookie headers on scope['pending_cookies']."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        scope["pending_cookies"] = []

        async def send_with_cookies(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers += [(b"set-cookie", c.encode()) for c in scope["pending_cookies"]]
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_cookies)


app = FastAPI(
    title="StudySync API",
    docs_url="/docs" if DEBUG else None,
    redoc_url=None,
    openapi_url="/openapi.json" if DEBUG else None,
)

# The last middleware added is the outermost one, so CORS answers first.
app.add_middleware(SecurityHeadersMiddleware, csp_mode=CSP_MODE, hsts=COOKIE_SECURE)
app.add_middleware(BodyLimitMiddleware, max_bytes=MAX_BODY_BYTES)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# profile photos: files in backend/media/avatars are served at /media/avatars/<name>
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")

app.mount("/graphql", CookieMiddleware(GraphQL(
    schema,
    context_value=lambda request, data: {"request": request},
    debug=DEBUG,
    introspection=DEBUG,
    validation_rules=[QueryLimits],
    error_formatter=safe_format_error,
    explorer=None if (DEBUG or ExplorerHttp405 is None) else ExplorerHttp405(),
)))

mount_frontend(app)