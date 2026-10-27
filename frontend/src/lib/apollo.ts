import {
  ApolloClient, ApolloLink, HttpLink, InMemoryCache, Observable,
} from "@apollo/client";
import { setToken, getToken } from "../auth/token";

const URI = (import.meta.env.VITE_GRAPHQL_URL || "http://localhost:8000/graphql").replace(/\/*$/, "/");

const httpLink = new HttpLink({ uri: URI, credentials: "include" });

const authLink = new ApolloLink((operation, forward) => {
  const token = getToken();
  operation.setContext(({ headers = {} }) => ({
    headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }));
  return forward(operation);
});

// One refresh at a time; concurrent 401s wait on the same promise.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = fetch(URI, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "studysync" },
      body: JSON.stringify({ query: "mutation { refreshToken { accessToken } }" }),
    })
      .then((r) => r.json())
      .then((j) => j?.data?.refreshToken?.accessToken ?? null)
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

const isUnauthenticated = (result: any) =>
  result?.errors?.some((e: any) => e.extensions?.code === "UNAUTHENTICATED");

// The API answers an unauthenticated `me` with HTTP 400 (data is null), and Apollo then raises it
// as an *error*, not a result. Look inside it, or the refresh never runs on page reload.
function errorIsUnauthenticated(e: any): boolean {
  let errors = e?.result?.errors;                                   // Apollo Client 3
  if (!errors && typeof e?.bodyText === "string") {                 // Apollo Client 4
    try { errors = JSON.parse(e.bodyText)?.errors; } catch { /* not JSON */ }
  }
  return !!errors?.some((x: any) => x?.extensions?.code === "UNAUTHENTICATED");
}

const refreshLink = new ApolloLink((operation, forward) =>
  new Observable((observer) => {
    let sub: { unsubscribe(): void } | undefined;
    let retrying = false;
    const skip = operation.getContext().skipRefresh === true;

    const retry = (onFail: () => void) => {
      retrying = true;
      refreshAccessToken().then((token) => {
        setToken(token);
        if (!token) return onFail();                     // refresh failed: surface the original error
        operation.setContext({ skipRefresh: true });     // retry only once
        sub = forward(operation).subscribe(observer);
      });
    };

    sub = forward(operation).subscribe({
      next: (result) => {
        if (skip || !isUnauthenticated(result)) return observer.next(result);
        retry(() => { observer.next(result); observer.complete(); });
      },
      error: (e) => {
        if (skip || !errorIsUnauthenticated(e)) return observer.error(e);
        retry(() => observer.error(e));
      },
      complete: () => { if (!retrying) observer.complete(); },
    });
    return () => sub?.unsubscribe();
  }),
);

export const client = new ApolloClient({
  link: ApolloLink.from([refreshLink, authLink, httpLink]),
  cache: new InMemoryCache(),
});