let accessToken: string | null = null;
const listeners = new Set<() => void>();

export const getToken = () => accessToken;

export function setToken(token: string | null) {
  accessToken = token;
  listeners.forEach((fn) => fn());
}

export function subscribeToken(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}