import {
  ApolloClient, ApolloLink, HttpLink, InMemoryCache, Observable,
} from "@apollo/client";
import { setToken, getToken } from "../auth/token";

// Keep the app usable with the local API even when no frontend .env file exists.
// FastAPI mounts GraphQL at /graphql (without a trailing slash).
const URI = (import.meta.env.VITE_GRAPHQL_URL || "http://localhost:8000/graphql").replace(/\/$/, "");

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

const refreshLink = new ApolloLink((operation, forward) =>
  new Observable((observer) => {
    let sub: { unsubscribe(): void } | undefined;
    let retrying = false;
    const skip = operation.getContext().skipRefresh === true;

    sub = forward(operation).subscribe({
      next: (result) => {
        if (skip || !isUnauthenticated(result)) return observer.next(result);
        retrying = true;
        refreshAccessToken().then((token) => {
          setToken(token);
          if (!token) {                       // refresh failed: surface the original error
            observer.next(result);
            observer.complete();
            return;
          }
          operation.setContext({ skipRefresh: true });   // retry only once
          sub = forward(operation).subscribe(observer);
        });
      },
      error: (e) => observer.error(e),
      complete: () => { if (!retrying) observer.complete(); },
    });
    return () => sub?.unsubscribe();
  }),
);

export const client = new ApolloClient({
  link: ApolloLink.from([refreshLink, authLink, httpLink]),
  cache: new InMemoryCache(),
});
