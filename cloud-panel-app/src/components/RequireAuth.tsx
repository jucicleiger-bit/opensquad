import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useSession } from "@/lib/useSession";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const [aalOk, setAalOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) {
      setAalOk(null);
      return;
    }
    let cancelled = false;
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (cancelled) return;
      setAalOk(!error && !!data && data.currentLevel === data.nextLevel);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (loading || (session && aalOk === null)) return <div className="card">Carregando...</div>;
  if (!session || !aalOk) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
