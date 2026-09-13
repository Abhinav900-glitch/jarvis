import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Fingerprint,
  Globe,
  Languages,
  Layers,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

const pillars = [
  {
    icon: Layers,
    title: "Dual-model engine",
    body: "Every message runs on Groq first. If Groq is down, rate-limited, or returns nothing, Jarvis automatically retries the same turn on Hugging Face — no manual switching.",
  },
  {
    icon: Globe,
    title: "Deep Research",
    body: "One toggle turns any prompt into live web research. Serpstack pulls fresh results, and Jarvis synthesizes a grounded answer with inline [n] citations.",
  },
  {
    icon: Languages,
    title: "Language intelligence",
    body: "The apilayer NLP API detects the language of your text, extracts named entities, and scores similarity — available on any message you send.",
  },
  {
    icon: Terminal,
    title: "Live news wire",
    body: "mediastack brings the latest headlines into the chat, so Jarvis can talk about what's happening right now, not just what it memorized.",
  },
];

const specs = [
  { label: "Primary model", value: "Groq · Llama 3.1 8B Instant" },
  { label: "Fallback model", value: "Hugging Face · Llama 3.1 8B Instruct" },
  { label: "Search layer", value: "Serpstack live web results" },
  { label: "Language layer", value: "apilayer NLP" },
  { label: "News layer", value: "mediastack" },
  { label: "Persistence", value: "Convex — every chat saved" },
];

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-sm border border-foreground/20">
        <span className="size-1.5 rounded-full bg-foreground" />
      </span>
      <span className="text-sm font-semibold tracking-tight">JARVIS</span>
    </span>
  );
}

export default function Landing() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      {/* Header */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Wordmark />
        <nav className="flex items-center gap-1">
          {isLoading ? null : isAuthenticated ? (
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">
                Open Jarvis
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/auth">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-16 pb-20 sm:pt-24">
        <motion.p {...fadeUp} className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Personal AI · Version 1
        </motion.p>
        <motion.h1
          {...fadeUp}
          className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
        >
          Your own Jarvis — chat that thinks, searches, and never goes down.
        </motion.h1>
        <motion.p
          {...fadeUp}
          className="mt-6 max-w-xl text-base leading-7 text-muted-foreground"
        >
          A minimalist AI assistant built on a dual-model engine. Groq answers
          first; if it ever fails, Hugging Face takes over the same turn
          automatically. Flip on Deep Research and Jarvis reads the live web
          before it replies.
        </motion.p>
        <motion.div {...fadeUp} className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="px-6">
            <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
              Start chatting
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="px-6">
            <Link to="/auth">Continue as guest</Link>
          </Button>
        </motion.div>
        <motion.p {...fadeUp} className="mt-4 text-xs text-muted-foreground">
          No credit card. Guests get the full engine.
        </motion.p>
      </section>

      <Separator className="mx-auto max-w-5xl" />

      {/* Pillars */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <motion.h2 {...fadeUp} className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          How it works
        </motion.h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
          {pillars.map((p) => (
            <motion.div
              key={p.title}
              {...fadeUp}
              className="bg-card p-8 transition-colors hover:bg-accent/40"
            >
              <p.icon className="size-4 text-foreground" strokeWidth={1.5} />
              <h3 className="mt-4 text-sm font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Failover explainer */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <motion.div
          {...fadeUp}
          className="rounded-lg border bg-card p-8 sm:p-12"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-foreground" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold tracking-tight">Automatic failover</h2>
          </div>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              { step: "01", title: "Try Groq", body: "Fast, primary path for every message." },
              { step: "02", title: "Detect failure", body: "Errors, empty replies, or outages trigger fallback." },
              { step: "03", title: "Retry on Hugging Face", body: "Same conversation, same turn — you never notice." },
            ].map((s) => (
              <div key={s.step}>
                <p className="text-xs font-medium text-muted-foreground">{s.step}</p>
                <p className="mt-2 text-sm font-semibold">{s.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Spec sheet */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <motion.h2 {...fadeUp} className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Under the hood
        </motion.h2>
        <div className="mt-8 divide-y rounded-lg border">
          {specs.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <span className="text-sm font-medium">{s.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <motion.div
          {...fadeUp}
          className="rounded-lg border bg-primary px-8 py-14 text-center text-primary-foreground"
        >
          <Fingerprint className="mx-auto size-5 opacity-80" strokeWidth={1.5} />
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">
            Talk to Jarvis in under a minute.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 opacity-80">
            Sign in with email or continue as a guest. Your conversations are
            saved and synced across sessions.
          </p>
          <Button asChild variant="secondary" className="mt-8 px-6">
            <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
              Open Jarvis
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 text-xs text-muted-foreground">
          <Wordmark />
          <span>Version 1 — Chat · Deep Research · Auto-fallback</span>
        </div>
      </footer>
    </motion.div>
  );
}
