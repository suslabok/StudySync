import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { gql } from "@apollo/client";
import { useApolloClient } from "@apollo/client/react";
import { getToken, setToken, subscribeToken } from "./token";

const ME = gql`query Me { me { id email displayName onboarded } }`;
const LOGOUT = gql`mutation Logout { logout }`;

type User = { id: string; email: string; displayName: string; onboarded: boolean };
type Ctx = {
  user: User | null;
  loading: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useApolloClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load there is no in-memory token: try the refresh cookie once.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await client.query<{ me: User }>({ query: ME, fetchPolicy: "network-only" });
        setUser(data!.me);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

useEffect(() => {
  const unsubscribe = subscribeToken(() => {
    if (!getToken()) setUser(null);
  });

  return () => void unsubscribe();
}, []);

  const signIn = (token: string, u: User) => { setToken(token); setUser(u); };
  const signOut = async () => {
    try { await client.mutate({ mutation: LOGOUT, context: { skipRefresh: true } }); } catch {}
    setToken(null);
    setUser(null);
    await client.clearStore();
  };

  return <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};