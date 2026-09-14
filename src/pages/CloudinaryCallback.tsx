import { api } from "@/convex/_generated/api";
import { JarvisIcon } from "@/components/jarvis-icon";
import { useAction } from "convex/react";
import { Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";

/**
 * OAuth 2.0 redirect target for Cloudinary.
 * Cloudinary redirects here with ?code=...&state=... (or ?error=...).
 * We exchange the code for tokens server-side, then bounce back to the app.
 */
export default function CloudinaryCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const exchangeCode = useAction(api.cloudinary.exchangeCode);

  const [status, setStatus] = useState<"working" | "success" | "error">(
    "working",
  );
  const [message, setMessage] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    const errorDescription = params.get("error_description");

    async function run() {
      try {
        if (oauthError) {
          throw new Error(
            errorDescription
              ? `${oauthError}: ${errorDescription}`
              : `Cloudinary returned an error: ${oauthError}`,
          );
        }
        if (!code || !state) {
          throw new Error(
            "Missing authorization code — restart the connection from the app.",
          );
        }

        await exchangeCode({
          code,
          state,
          redirectUri: `${window.location.origin}/cloudinary/callback`,
        });

        setStatus("success");
        setMessage("Cloudinary connected. You can close this page.");
        setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
      } catch (err) {
        setStatus("error");
        setMessage(
          err instanceof Error ? err.message : "Unknown OAuth error.",
        );
      }
    }
    void run();
  }, [params, exchangeCode, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border/60 bg-background">
          {status === "working" && (
            <JarvisIcon className="size-6 animate-pulse" />
          )}
          {status === "success" && (
            <CheckCircle2 className="size-6 text-emerald-600" />
          )}
          {status === "error" && <XCircle className="size-6 text-red-500" />}
        </div>

        <h1 className="mt-5 text-lg font-semibold tracking-tight">
          {status === "working" && "Connecting Cloudinary…"}
          {status === "success" && "Cloudinary connected"}
          {status === "error" && "Connection failed"}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {status === "working" && "Exchanging your authorization code securely."}
          {message}
        </p>

        {status === "working" && (
          <Loader2 className="mx-auto mt-5 size-4 animate-spin text-muted-foreground" />
        )}

        {status === "error" && (
          <Button asChild variant="outline" className="mt-5">
            <Link to="/dashboard">Back to Jarvis</Link>
          </Button>
        )}
      </div>
    </main>
  );
}
