import os

from dotenv import load_dotenv
from ariadne.asgi import GraphQL
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import schema
from app.profile import MEDIA_DIR

load_dotenv()


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


app = FastAPI(title="StudySync API")
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
    debug=True,
)))