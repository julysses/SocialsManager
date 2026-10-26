import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isConfigured, supabase } from "./lib/supabase";

export interface Brand {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  settings: Record<string, any>;
}

type Status = "loading" | "signed_out" | "denied" | "ready";
interface AuthState {
  status: Status;
  session: Session | null;
  role: string | null;
  brands: Brand[];
  brand: Brand | null;
  setBrandId: (id: string) => void;
  signOut: () => Promise<void>;
  error: string | null;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // getSession() and onAuthStateChange both fire on load; run the bootstrap once per user.
  const inflight = useRef<string | null>(null);
  const done = useRef<string | null>(null);

  const bootstrap = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      inflight.current = null;
      done.current = null;
      return setStatus("signed_out");
    }
    if (inflight.current === s.user.id || done.current === s.user.id) return;
    inflight.current = s.user.id;
    // First allowlisted login becomes owner of the seeded workspace; later logins are a no-op.
    const claim = await supabase.rpc("claim_owner");
    if (claim.error) {
      inflight.current = null;
      setError(claim.error.message);
      return setStatus("denied");
    }
    setRole(claim.data as string);
    const res = await supabase.from("brands").select("id,name,slug,timezone,settings").order("name");
    if (res.error || !res.data?.length) {
      inflight.current = null;
      setError(res.error?.message ?? "No brands available for this account.");
      return setStatus("denied");
    }
    setBrands(res.data as Brand[]);
    setBrandId((cur) => cur ?? res.data![0]!.id);
    done.current = s.user.id;
    inflight.current = null;
    setStatus("ready");
  }, []);

  useEffect(() => {
    if (!isConfigured) return setStatus("signed_out");
    supabase.auth.getSession().then(({ data }) => bootstrap(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      void bootstrap(s);
    });
    return () => data.subscription.unsubscribe();
  }, [bootstrap]);

  const value = useMemo<AuthState>(
    () => ({
      status, session, role, brands, error,
      brand: brands.find((b) => b.id === brandId) ?? null,
      setBrandId,
      signOut: async () => {
        await supabase.auth.signOut();
        setBrands([]);
        setStatus("signed_out");
      },
    }),
    [status, session, role, brands, brandId, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
