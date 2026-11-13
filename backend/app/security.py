"""Security helpers: login/register throttling, GraphQL limits, request size cap, response headers.

Everything here is plain Python plus graphql-core, so it needs no new packages.
The throttle keeps its counters in memory. That is right for one server (the free Render
plan); with several servers move the counters to Redis or the database.
"""
import os
import threading
import time
from collections import deque

from graphql import FieldNode, FragmentDefinitionNode, FragmentSpreadNode, GraphQLError, InlineFragmentNode
from graphql.validation import ValidationRule

# ---------------------------------------------------------------- throttling


class AttemptLimiter:
    """Allow `max_attempts` recorded failures per key in a sliding window."""

    def __init__(self, max_attempts: int, window_seconds: int, max_keys: int = 20000):
        self.max_attempts, self.window, self.max_keys = max_attempts, window_seconds, max_keys
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def _trim(self, q: deque, now: float) -> None:
        while q and now - q[0] > self.window:
            q.popleft()

    def wait_seconds(self, key: str) -> int:
        """0 when the key may try again, otherwise how many seconds to wait."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return 0
            self._trim(q, now)
            if len(q) < self.max_attempts:
                return 0
            return max(1, int(self.window - (now - q[0])) + 1)

    def record(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) >= self.max_keys:          # memory guard: drop expired keys first
                for k in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
                    del self._hits[k]
                if len(self._hits) >= self.max_keys:
                    self._hits.clear()
            q = self._hits.setdefault(key, deque())
            self._trim(q, now)
            q.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


def client_ip(request) -> str:
    """The caller's address. Behind a proxy uvicorn (--proxy-headers) already put the real one here."""
    return request.client.host if request.client else "unknown"


def describe_wait(seconds: int) -> str:
    minutes = (seconds + 59) // 60
    return "less than a minute" if minutes <= 1 else f"{minutes} minutes"


class LoginGuard:
    """Three limits at once: this person from this address, this account from anywhere, this address overall."""

    def __init__(self):
        self.by_pair = AttemptLimiter(5, 15 * 60)
        self.by_email = AttemptLimiter(20, 15 * 60)
        self.by_ip = AttemptLimiter(30, 15 * 60)

    @staticmethod
    def _keys(ip: str, email: str):
        e = email.strip().lower()[:255]
        return f"{ip}|{e}", e, ip

    def blocked(self, ip: str, email: str) -> int:
        pair, e, i = self._keys(ip, email)
        return max(self.by_pair.wait_seconds(pair), self.by_email.wait_seconds(e), self.by_ip.wait_seconds(i))

    def failed(self, ip: str, email: str) -> None:
        pair, e, i = self._keys(ip, email)
        self.by_pair.record(pair)
        self.by_email.record(e)
        self.by_ip.record(i)

    def succeeded(self, ip: str, email: str) -> None:
        pair, _, _ = self._keys(ip, email)
        self.by_pair.reset(pair)


class RegisterGuard:
    """Sign-ups per address per hour (every attempt counts, successful or not)."""

    def __init__(self, per_hour: int = 10):
        self.limiter = AttemptLimiter(per_hour, 3600)

    def blocked(self, ip: str) -> int:
        return self.limiter.wait_seconds(ip)

    def hit(self, ip: str) -> None:
        self.limiter.record(ip)


login_guard = LoginGuard()
register_guard = RegisterGuard()

# ---------------------------------------------------------------- GraphQL limits

MAX_DEPTH = int(os.getenv("GRAPHQL_MAX_DEPTH", "12"))
MAX_FIELDS = int(os.getenv("GRAPHQL_MAX_FIELDS", "1000"))


class QueryLimits(ValidationRule):
    """Reject queries that are very deep or ask for a huge number of fields (a cheap way to overload a server)."""

    def __init__(self, context):
        super().__init__(context)
        self.fragments = {d.name.value: d for d in context.document.definitions
                          if isinstance(d, FragmentDefinitionNode)}
        self._memo: dict[str, tuple[int, int]] = {}

    def _measure(self, selection_set, stack: frozenset) -> tuple[int, int]:
        """(depth, field count) of a selection set, following fragments once each."""
        depth, count = 0, 0
        if selection_set is None:
            return depth, count
        for sel in selection_set.selections:
            if isinstance(sel, FieldNode):
                if sel.name.value == "__typename":
                    continue
                d, c = self._measure(sel.selection_set, stack)
                depth, count = max(depth, 1 + d), count + 1 + c
            elif isinstance(sel, InlineFragmentNode):
                d, c = self._measure(sel.selection_set, stack)
                depth, count = max(depth, d), count + c
            elif isinstance(sel, FragmentSpreadNode):
                name = sel.name.value
                frag = self.fragments.get(name)
                if frag is None or name in stack:       # unknown or cyclic: other rules report it
                    continue
                if name not in self._memo:
                    self._memo[name] = self._measure(frag.selection_set, stack | {name})
                d, c = self._memo[name]
                depth, count = max(depth, d), count + c
        return depth, count

    def enter_operation_definition(self, node, *_):
        depth, count = self._measure(node.selection_set, frozenset())
        if depth > MAX_DEPTH:
            self.report_error(GraphQLError(f"Query is too deep ({depth} levels, the limit is {MAX_DEPTH})."))
        elif count > MAX_FIELDS:
            self.report_error(GraphQLError(f"Query asks for too many fields ({count}, the limit is {MAX_FIELDS})."))

# ---------------------------------------------------------------- error messages


def safe_format_error(error: GraphQLError, debug: bool = False) -> dict:
    """In production, never send the text of unexpected exceptions (database errors, bugs) to the browser.

    Kept as they are: GraphQL errors (not signed in, invalid query) and exceptions your own code defines
    (classes in the app package), because those messages are written for people.
    """
    from ariadne import format_error
    formatted = format_error(error, debug)
    if debug:
        return formatted
    original = getattr(error, "original_error", None)
    if (original is not None and not isinstance(original, GraphQLError)
            and not type(original).__module__.startswith("app.")):
        formatted["message"] = "Something went wrong. Please try again."
    return formatted

# ---------------------------------------------------------------- ASGI middleware


class BodyLimitMiddleware:
    """Refuse request bodies larger than max_bytes with 413, before they are parsed."""

    class _TooLarge(Exception):
        pass

    def __init__(self, app, max_bytes: int):
        self.app, self.max_bytes = app, max_bytes

    async def _reject(self, send):
        body = b'{"errors":[{"message":"Request is too large"}]}'
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        declared = dict(scope["headers"]).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            return await self._reject(send)

        seen, started = 0, False

        async def limited_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    raise self._TooLarge()
            return message

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except self._TooLarge:
            if not started:
                await self._reject(send)


CSP = ("default-src 'self'; "
       "script-src 'self' https://accounts.google.com; "
       "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com; "
       "font-src 'self' data: https://fonts.gstatic.com; "
       "img-src 'self' data: blob: https:; "
       "connect-src 'self' https://accounts.google.com; "
       "frame-src https://accounts.google.com; "
       "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")


class SecurityHeadersMiddleware:
    """Add browser-hardening headers to every response.

    csp_mode: "report" (default, the browser only logs violations in the Console), "enforce" or "off".
    hsts: send Strict-Transport-Security (only when the site is served over HTTPS).
    """

    def __init__(self, app, csp_mode: str = "report", hsts: bool = False):
        headers = [
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=()"),
        ]
        if hsts:
            headers.append((b"strict-transport-security", b"max-age=31536000"))
        if csp_mode == "enforce":
            headers.append((b"content-security-policy", CSP.encode()))
        elif csp_mode == "report":
            headers.append((b"content-security-policy-report-only", CSP.encode()))
        self.app, self.headers = app, headers

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                present = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [h for h in self.headers if h[0] not in present]
            await send(message)

        await self.app(scope, receive, send_with_headers)