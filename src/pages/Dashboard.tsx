import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Globe,
  Languages,
  Loader2,
  Newspaper,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { MarkdownMessage } from "@/components/markdown-message";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------
// Source types (mirror of convex/ai.ts return shapes)
// ---------------------------------------------------------------------------

interface Source {
  title: string;
  url: string;
  domain?: string;
}

interface NewsItem {
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Message rendering — citations are handled inside MarkdownMessage; user
// messages render as plain pre-wrapped text.
// ---------------------------------------------------------------------------

function SourceList({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Sources
      </p>
      <ul className="mt-2 space-y-1.5">
        {sources.map((s, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs">
            <span className="shrink-0 text-muted-foreground">[{i + 1}]</span>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {s.title}
              {s.domain ? (
                <span className="ml-1 text-muted-foreground/60">— {s.domain}</span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant panel actions
// ---------------------------------------------------------------------------

interface NlpResult {
  language?: unknown;
  entities?: unknown;
  similarity?: unknown;
}

function formatNlp(result: NlpResult | null): string {
  if (!result) return "";
  const lines: string[] = [];
  const lang = result.language as { language_name?: string; language_code?: string } | null;
  if (lang?.language_name) {
    lines.push(`Language: ${lang.language_name}${lang.language_code ? ` (${lang.language_code})` : ""}`);
  }
  const ents = result.entities as Record<string, unknown> | null;
  const list = (ents?.entities ?? ents?.results) as
    | { text?: string; label?: string }[]
    | undefined;
  if (Array.isArray(list) && list.length > 0) {
    const uniq = list
      .slice(0, 8)
      .map((e) => `${e.text ?? "?"}${e.label ? ` (${e.label})` : ""}`);
    lines.push(`Entities: ${uniq.join(", ")}`);
  }
  const sim = result.similarity as { similarity?: number } | null;
  if (typeof sim?.similarity === "number") {
    lines.push(`Similarity score: ${(sim.similarity * 100).toFixed(1)}%`);
  }
  return lines.join("\n");
}

function NewsPanel({ items }: { items: NewsItem[] }) {
  return (
    <div className="border-t pt-3">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Latest news — mediastack
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((n, i) => (
          <li key={i} className="text-xs leading-5">
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-2 hover:underline"
            >
              {n.title}
            </a>
            <span className="ml-1.5 text-muted-foreground">
              {n.source ? `· ${n.source}` : ""}
              {n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleDateString()}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const sessions = useQuery(api.chats.listSessions) ?? [];
  const [activeId, setActiveId] = useState<Id<"chatSessions"> | null>(null);
  const messages = useQuery(
    api.chats.listMessages,
    activeId ? { sessionId: activeId } : "skip",
  );

  const startWithMessage = useMutation(api.chats.startWithMessage);
  const appendMessage = useMutation(api.chats.appendMessage);
  const deleteSession = useMutation(api.chats.deleteSession);
  const askAction = useAction(api.ai.ask);
  const deepResearchAction = useAction(api.ai.deepResearch);
  const analyzeAction = useAction(api.ai.analyzeText);
  const newsAction = useAction(api.ai.searchNews);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [panelNlp, setPanelNlp] = useState<NlpResult | null>(null);
  const [panelNews, setPanelNews] = useState<NewsItem[] | null>(null);
  const [panelBusy, setPanelBusy] = useState<"nlp" | "news" | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMsg = messages?.[messages.length - 1];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages?.length, sending]);

  useEffect(() => {
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
  }, [activeId]);

  const runSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setInput("");

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];

      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: text });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: text });
        history = (messages ?? []).map((m) => ({ role: m.role, content: m.content }));
      }

      // Deep Research path
      if (deepResearch) {
        const { answer, sources } = await runDeepResearch(sessionId, text, history);
        await appendMessage({
          sessionId,
          role: "assistant",
          content: answer.text,
          model: answer.model,
          usedFallback: answer.usedFallback,
          usedSearch: true,
          sources,
        });
      } else {
        const answer = await runAsk(text, history);
        await appendMessage({
          sessionId,
          role: "assistant",
          content: answer.text,
          model: answer.model,
          usedFallback: answer.usedFallback,
          usedSearch: false,
        });
      }
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // The Convex action calls. Wrapped so both paths share error handling.
  const runAsk = async (
    prompt: string,
    history: { role: string; content: string }[],
  ) => {
    return await askAction({ prompt, history });
  };

  const runDeepResearch = async (
    _sessionId: Id<"chatSessions">,
    query: string,
    history: { role: string; content: string }[],
  ) => {
    return await deepResearchAction({ query, history });
  };

  const handleAnalyze = async () => {
    if (!lastMsg || panelBusy) return;
    setPanelBusy("nlp");
    setAssistantError(null);
    try {
      const result = await analyzeAction({ text: lastMsg.content });
      setPanelNlp(result as NlpResult);
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "NLP analysis failed.");
    } finally {
      setPanelBusy(null);
    }
  };

  const handleNews = async () => {
    if (!input.trim() || panelBusy) return;
    setPanelBusy("news");
    setAssistantError(null);
    try {
      const items = await newsAction({ keywords: input.trim() });
      setPanelNews(items as NewsItem[]);
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "News search failed.");
    } finally {
      setPanelBusy(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void runSend();
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm font-semibold tracking-tight">JARVIS</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setActiveId(null)}
              title="New chat"
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <Separator />
          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No chats yet</p>
            ) : (
              <ul className="space-y-0.5">
                {sessions.map((s) => (
                  <li key={s._id} className="group relative">
                    <button
                      onClick={() => setActiveId(s._id)}
                      className={`w-full truncate rounded-md px-3 py-2 pr-8 text-left text-sm transition-colors ${
                        activeId === s._id
                          ? "bg-accent font-medium"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      }`}
                    >
                      {s.title}
                    </button>
                    <button
                      onClick={() => {
                        void deleteSession({ sessionId: s._id });
                        if (activeId === s._id) setActiveId(null);
                      }}
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="Delete chat"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between px-5 py-3 text-xs text-muted-foreground">
            <span className="truncate">
              {user?.name || user?.email || "Guest"}
            </span>
            <button
              onClick={handleSignOut}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* Chat column */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="flex items-center justify-between border-b px-6 py-3.5">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tracking-tight md:hidden">JARVIS</span>
              <span className="hidden text-sm text-muted-foreground md:inline">
                {activeId
                  ? sessions.find((s) => s._id === activeId)?.title
                  : "New chat"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDeepResearch((v) => !v)}
                className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors ${
                  deepResearch
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Globe className="size-3.5" />
                Deep Research
                <span
                  className={`ml-0.5 size-1.5 rounded-full transition-colors ${
                    deepResearch ? "bg-background" : "bg-muted-foreground/40"
                  }`}
                />
              </button>
              <div className="hidden h-4 w-px bg-border sm:block" />
              <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <Zap className="size-3" />
                Auto-fallback on
              </div>
            </div>
          </header>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {!messages || messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6">
                <Sparkles className="size-5 text-muted-foreground/40" strokeWidth={1.5} />
                <h1 className="mt-4 text-2xl font-semibold tracking-tight">
                  How can I help?
                </h1>
                <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
                  Ask anything. Toggle Deep Research for live web answers with
                  citations — Groq answers first, Hugging Face takes over
                  automatically if it fails.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  {[
                    "Explain quantum computing simply",
                    "What's new in AI this week?",
                    "Summarize the history of the internet",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setInput(s);
                        inputRef.current?.focus();
                      }}
                      className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl px-6 py-8">
                <ul className="space-y-8">
                  {messages.map((m) => (
                    <li key={m._id}>
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                          {m.role === "user" ? "You" : "Jarvis"}
                        </span>
                        {m.role === "assistant" && (m.usedFallback || m.usedSearch) ? (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            {m.usedSearch && <Globe className="size-3" />}
                            {m.usedFallback && <RotateCcw className="size-3" />}
                            {m.usedSearch ? "web" : "fallback"}
                            {" · "}
                            {m.model?.split("/")[0]}
                          </span>
                        ) : null}
                      </div>
                      {m.role === "user" ? (
                        <div className="mt-2 text-sm leading-7 whitespace-pre-wrap text-foreground">
                          {m.content}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-foreground/90">
                          <MarkdownMessage content={m.content} sources={m.sources} />
                        </div>
                      )}
                      {m.role === "assistant" && m.sources && m.sources.length > 0 ? (
                        <SourceList sources={m.sources} />
                      ) : null}
                    </li>
                  ))}
                  {sending && (
                    <li className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {deepResearch
                        ? "Searching the web, then thinking…"
                        : "Thinking…"}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Assistant panel — NLP / news / errors */}
          <AnimatePresence>
            {(panelNlp || panelNews || assistantError) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t px-6 py-3"
              >
                <div className="mx-auto max-w-2xl">
                  {assistantError && (
                    <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
                      <span className="mt-px">⚠</span>
                      <span>{assistantError}</span>
                    </p>
                  )}
                  {panelNlp && (
                    <pre className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                      {formatNlp(panelNlp)}
                    </pre>
                  )}
                  {panelNews && panelNews.length > 0 && <NewsPanel items={panelNews} />}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Composer */}
          <div className="border-t px-6 py-4">
            <div className="mx-auto max-w-2xl">
              <div className="relative rounded-lg border bg-card transition-colors focus-within:border-foreground/30">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    deepResearch
                      ? "Research anything on the live web…"
                      : "Message Jarvis…"
                  }
                  rows={1}
                  className="max-h-40 w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm outline-none placeholder:text-muted-foreground/70"
                />
                <Button
                  size="icon-sm"
                  onClick={() => void runSend()}
                  disabled={!input.trim() || sending}
                  className="absolute right-2.5 bottom-2.5"
                >
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="size-3.5" />
                  )}
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Enter to send · Shift+Enter for newline
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleNews}
                    disabled={panelBusy !== null || !input.trim()}
                    className="inline-flex items-center gap-1 underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-40"
                  >
                    {panelBusy === "news" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Newspaper className="size-3" />
                    )}
                    News
                  </button>
                  <button
                    onClick={handleAnalyze}
                    disabled={panelBusy !== null || !lastMsg}
                    className="inline-flex items-center gap-1 underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-40"
                  >
                    {panelBusy === "nlp" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Languages className="size-3" />
                    )}
                    Analyze
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
