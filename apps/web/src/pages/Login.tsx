import { useState, type FormEvent } from "react";
import { isConfigured, supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

export function Login({ denied, reason, onSignOut }: { denied?: boolean; reason?: string | null; onSignOut?: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setState("error");
      setMessage(
        error.status === 429
          ? "Too many sign-in emails were requested. Wait about an hour, then request one link and click it once."
          : `Could not send a sign-in link: ${error.message}`,
      );
    } else setState("sent");
  }

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Social OS</h1>
          <p className="text-sm text-muted-foreground">Sign in with a magic link.</p>
        </div>
        {!isConfigured && (
          <p role="alert" className="rounded-md bg-danger/15 p-3 text-sm text-danger">
            App is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time.
          </p>
        )}
        {denied ? (
          <div className="space-y-3">
            <p role="alert" className="rounded-md bg-danger/15 p-3 text-sm text-danger">
              This account does not have access. {reason}
            </p>
            <Button variant="outline" className="w-full" onClick={onSignOut}>Sign out</Button>
          </div>
        ) : state === "sent" ? (
          <p role="status" className="text-sm">Check your inbox for the sign-in link.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm" htmlFor="email">Email</label>
            <input
              id="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-muted px-3 text-sm"
            />
            {state === "error" && <p role="alert" className="text-sm text-danger">{message}</p>}
            <Button type="submit" className="w-full" disabled={state === "sending" || !isConfigured}>
              {state === "sending" ? "Sending…" : "Email me a link"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
