import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi, type SessionUser } from './auth';

interface SessionState {
  /** undefined while the first check is running, null when signed out. */
  user: SessionUser | null | undefined;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState>({ user: undefined, refresh: async () => {}, signOut: async () => {} });

/** One shared session check for the header, the home page and product pages. Runs only in the browser. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const r = await authApi<SessionUser>('session');
    setUser(r.ok && r.data ? { email: r.data.email, name: r.data.name, role: r.data.role } : null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await authApi('logout', 'POST');
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, refresh, signOut }), [user, refresh, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

export const firstName = (u: SessionUser) => (u.name ?? u.email.split('@')[0]).split(' ')[0];
