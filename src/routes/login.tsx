import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-bg)] px-4 text-[var(--color-fg)]">
      <div className="panel w-full max-w-sm space-y-5 p-6 sm:p-7">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            NeuroTrend AI — optional account for sync later. Paper trading works as guest.
          </p>
        </div>
        {authEnabled ? (
          <div className="space-y-2">
            {GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              >
                Continue with {p.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Sign-in is disabled.</p>
        )}
        <Link
          to="/"
          className="block text-center text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
