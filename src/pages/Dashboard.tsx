import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Box,
  Calculator,
  Check,
  ChevronDown,
  Download,
  FileText,
  Equal,
  Copy,
  FunctionSquare,
  Globe,
  ImagePlus,
  Languages,
  Loader2,
  Link2,
  Mic,
  Menu,
  Moon,
  Newspaper,
  Pencil,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shapes,
  Square,
  Sun,
  Trash2,
  User,
  Volume2,
  VolumeX,
  Wand2,
  X,
  Zap,
  Home,
  Lightbulb,
  Bookmark,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { JarvisIcon } from "@/components/jarvis-icon";
import { JarvisOrb } from "@/components/jarvis-orb";
import { Lightbox } from "@/components/lightbox";
import { MarkdownMessage, looksLikeMathOrMarkdown } from "@/components/markdown-message";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useVoicePlayer, useVoiceRecorder } from "@/hooks/use-voice";
import { useLiveMode } from "@/hooks/use-live";
import { COUNTRIES, getCountry, AUTHOR } from "@/lib/languages";
import { generateImageWithPuter } from "@/lib/puter";
import { Radio } from "lucide-react";
import { CalculatorPanel } from "@/components/calculator-panel";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Source types
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
// Sub-components
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
                <span className="ml-1 text-muted-foreground/60">
                  — {s.domain}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface NlpResult {
  language?: unknown;
  entities?: unknown;
  similarity?: unknown;
}

function formatNlp(result: NlpResult | null): string {
  if (!result) return "";
  const lines: string[] = [];
  const lang = result.language as
    | { language_name?: string; language_code?: string }
    | null;
  if (lang?.language_name) {
    lines.push(
      `Language: ${lang.language_name}${lang.language_code ? ` (${lang.language_code})` : ""}`,
    );
  }
  const ents = result.entities as Record<string, unknown> | null;
  const list = (ents?.entities ?? ents?.results) as
    | { text?: string; label?: string }[]
    | undefined;
  if (Array.isArray(list) && list.length > 0) {
    const uniq = list
      .slice(0, 8)
      .map(
        (e) => `${e.text ?? "?"}${e.label ? ` (${e.label})` : ""}`,
      );
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
              {n.publishedAt
                ? ` · ${new Date(n.publishedAt).toLocaleDateString()}`
                : ""}
            </span>
          </li>
        ))}
      </ul>    </div>
  );
}

// Region result card component
function RegionResultCard({ result, onClose }: { result: Record<string, unknown>; onClose: () => void }) {
  const Close = () => (
    <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
  );

  if (result.type === "time") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">World Time</span>
          <Close />
        </div>
        <p className="text-2xl font-mono font-semibold tabular-nums">{String(result.time)}</p>
        <p className="text-xs text-muted-foreground">{String(result.dayOfWeek)}, {String(result.date)} · {String(result.timezone)} ({String(result.offset)})</p>
      </div>
    );
  }

  if (result.type === "weather") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Weather</span>
          <Close />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl">{String(result.icon)}</span>
          <span className="text-2xl font-semibold">{String(result.temp)}°C</span>
          <span className="text-xs text-muted-foreground">feels like {String(result.feelsLike)}°C</span>
        </div>
        <p className="text-xs text-muted-foreground">{String(result.description)} · {String(result.city)}, {String(result.country)} · 💧 {String(result.humidity)}% · 💨 {String(result.wind)} km/h</p>
      </div>
    );
  }

  if (result.type === "currency") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Currency</span>
          <Close />
        </div>
        <p className="text-2xl font-semibold tabular-nums">{String(result.amount)} {String(result.from)} = <span className="text-primary">{String(result.result)} {String(result.to)}</span></p>
        <p className="text-xs text-muted-foreground">1 {String(result.from)} = {String(result.rate)} {String(result.to)}</p>
      </div>
    );
  }

  if (result.type === "country") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Country</span>
          <Close />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl">{String(result.flag)}</span>
          <span className="text-lg font-semibold">{String(result.name)}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div><span className="text-muted-foreground">Official:</span> {String(result.officialName)}</div>
          <div><span className="text-muted-foreground">Capital:</span> {String(result.capital)}</div>
          <div><span className="text-muted-foreground">Region:</span> {String(result.region)}{result.subregion ? ` / ${String(result.subregion)}` : ""}</div>
          <div><span className="text-muted-foreground">Population:</span> {typeof result.population === "number" ? result.population.toLocaleString() : String(result.population)}</div>
          <div><span className="text-muted-foreground">Area:</span> {typeof result.area === "number" ? result.area.toLocaleString() : String(result.area)} km²</div>
          <div><span className="text-muted-foreground">Languages:</span> {Array.isArray(result.languages) ? (result.languages as string[]).join(", ") : String(result.languages)}</div>
          <div><span className="text-muted-foreground">Currencies:</span> {Array.isArray(result.currencies) ? (result.currencies as string[]).join(", ") : String(result.currencies)}</div>
          <div><span className="text-muted-foreground">Timezones:</span> {Array.isArray(result.timezones) ? (result.timezones as string[]).slice(0, 3).join(", ") : String(result.timezones)}{Array.isArray(result.timezones) && (result.timezones as string[]).length > 3 ? ` +${(result.timezones as string[]).length - 3} more` : ""}</div>
        </div>
        {result.maps ? (
          <a href={String(result.maps)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
            Open in Maps
          </a>
        ) : null}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Voice panel
// ---------------------------------------------------------------------------

interface VoiceNoteResult {
  text: string;
  summary?: string;
  sentiment: { positive: number; neutral: number; negative: number };
  chapters?: { headline: string; summary: string }[];
}

function SentimentBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] text-muted-foreground">
        {value}%
      </span>
    </div>
  );
}

function VoicePanel({
  note,
  onUse,
}: {
  note: VoiceNoteResult;
  onUse: (text: string) => void;
}) {
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Voice note — AssemblyAI
        </p>
        <button
          onClick={() => onUse(note.text)}
          className="text-[10px] uppercase tracking-widest text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Use text
        </button>
      </div>
      <p className="mt-2 text-sm leading-6">{note.text}</p>
      {note.summary ? (
        <p className="mt-2 border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
          {note.summary}
        </p>
      ) : null}
      <div className="mt-3 space-y-1.5">
        <SentimentBar
          label="Positive"
          value={note.sentiment.positive}
          tone="bg-foreground"
        />
        <SentimentBar
          label="Neutral"
          value={note.sentiment.neutral}
          tone="bg-muted-foreground/50"
        />
        <SentimentBar
          label="Negative"
          value={note.sentiment.negative}
          tone="bg-destructive/60"
        />
      </div>    </div>
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
  const transcribeAction = useAction(api.voice.transcribe);
  const transcribeWhisperAction = useAction(api.voice.transcribeWhisper);
  const speakAction = useAction(api.voice.speak);
  const getSignedUploadUrl = useAction(api.cloudinary.getSignedUploadUrl);
  const generateImageAction = useAction(api.cloudinary.generateImage);
  const summarizeUrlAction = useAction(api.ai.summarizeUrl);
  const getWorldTimeAction = useAction(api.ai.getWorldTime);
  const getCurrencyRateAction = useAction(api.ai.getCurrencyRate);
  const getWeatherAction = useAction(api.ai.getWeather);
  const detectWeatherAction = useAction(api.ai.detectWeatherQuery);
  const indexMessagesAction = useAction(api.rag.indexMessages);
  const getCountryInfoAction = useAction(api.ai.getCountryInfo);
  const getOAuthStartUrlAction = useAction(api.cloudinary.getOAuthStartUrl);
  const disconnectCloudinaryAction = useAction(api.cloudinary.disconnectCloudinary);
  const generateTitleAction = useAction(api.ai.generateTitle);
  const extractPdfTextAction = useAction(api.ai.extractPdfText);
  const renameSessionMutation = useMutation(api.chats.renameSession);
  const savePromptMutation = useMutation(api.chats.savePrompt);
  const deletePromptMutation = useMutation(api.chats.deletePrompt);
  const promptsList = useQuery(api.chats.listPrompts);

  // Cloudinary OAuth connection status (live query)
  const cloudinaryStatus = useQuery(api.cloudinaryOAuth.getStatus);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [panelNlp, setPanelNlp] = useState<NlpResult | null>(null);
  const [panelNews, setPanelNews] = useState<NewsItem[] | null>(null);
  const [panelBusy, setPanelBusy] = useState<"nlp" | "news" | null>(null);
  const [panelVoice, setPanelVoice] = useState<VoiceNoteResult | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<
    { url: string; publicId: string; provider?: string }[]
  >([]);
  const [pendingFile, setPendingFile] = useState<{
    url: string;
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<Id<"chatMessages"> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [summarizingUrl, setSummarizingUrl] = useState(false);
  const [summarizeInput, setSummarizeInput] = useState("");
  const [regionTime, setRegionTime] = useState<string | null>(null);
  const [regionTimezone, setRegionTimezone] = useState(() => {
    try {
      return localStorage.getItem("jarvis-timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  });
  const [countryCode, setCountryCode] = useState(() => {
    try {
      return localStorage.getItem("jarvis-country") || "IN";
    } catch {
      return "IN";
    }
  });

  const changeCountry = (code: string) => {
    setCountryCode(code);
    const cfg = getCountry(code);
    setRegionTimezone(cfg.timezone);
    try {
      localStorage.setItem("jarvis-country", code);
      localStorage.setItem("jarvis-timezone", cfg.timezone);
    } catch {
      // ignore
    }
  };
  const [regionResult, setRegionResult] = useState<Record<string, unknown> | null>(null);
  const [regionBusy, setRegionBusy] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [cloudinaryConnecting, setCloudinaryConnecting] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const editMessage = useMutation(api.chats.editMessage);
  const searchSessionsQuery = useQuery(
    api.chats.searchSessions,
    searchQuery.length >= 2 ? { query: searchQuery } : "skip",
  );
  const [uploadCount, setUploadCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- File upload: any type, signed upload to Cloudinary (multi) ----
  const uploadFile = async (
    file: File,
  ): Promise<{ url: string; publicId: string; resourceType: string } | null> => {
    try {
      const signed = await getSignedUploadUrl({ filename: file.name });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", signed.apiKey);
      formData.append("timestamp", String(signed.timestamp));
      formData.append("signature", signed.signature);
      formData.append("folder", signed.folder);
      formData.append("public_id", signed.publicId);

      const res = await fetch(signed.url, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Upload failed: ${err.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        secure_url: string;
        public_id: string;
        resource_type: string;
      };

      return {
        url: data.secure_url,
        publicId: data.public_id,
        resourceType: data.resource_type,
      };
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Upload failed.");
      return null;
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    // Reject oversized files before upload starts (25 MB per file)
    const MAX_FILE_BYTES = 25 * 1024 * 1024;
    const tooBig = files.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      setAssistantError(
        `${tooBig.map((f) => f.name).join(", ")} ${tooBig.length > 1 ? "exceed" : "exceeds"} the 25 MB limit.`,
      );
    }
    const acceptable = files.filter((f) => f.size <= MAX_FILE_BYTES);
    if (acceptable.length === 0) return;
    files = acceptable;
    setUploading(true);
    setUploadCount(acceptable.length);
    setAssistantError(null);
    try {
      const results = await Promise.all(acceptable.map((f) => uploadFile(f)));
      const images: { url: string; publicId: string; provider?: string }[] =
        [];
      let firstFile: {
        url: string;
        name: string;
        type: string;
        size: number;
      } | null = null;

      results.forEach((r, i) => {
        if (!r) return;
        if (r.resourceType === "image") {
          images.push({ url: r.url, publicId: r.publicId });
        } else if (!firstFile) {
          firstFile = {
            url: r.url,
            name: acceptable[i].name,
            type: acceptable[i].type || r.resourceType,
            size: acceptable[i].size,
          };
        }
      });

      if (images.length > 0) {
        setPendingImages((prev) => [...prev, ...images]);
      }
      if (firstFile) setPendingFile(firstFile);
    } finally {
      setUploading(false);
      setUploadCount(0);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void uploadFiles(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void uploadFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  // ---- AI image generation: Puter.js → Cloudinary → Hugging Face → Pollinations ----
  // Puter runs client-side and is keyless ("user pays"), so it goes first;
  // the server chain is the fallback.
  const generateImageSmart = async (
    prompt: string,
  ): Promise<{ url: string; publicId: string; provider: string }> => {
    try {
      return await generateImageWithPuter(prompt, uploadFile);
    } catch {
      // Puter unavailable/refused/failed or storage failed → server chain.
      // Clear any error the client upload path surfaced on the way down.
      setAssistantError(null);
    }
    return generateImageAction({ prompt });
  };

  const generateImageWithPrompt = async (prompt: string) => {
    setGenerating(true);
    setAssistantError(null);
    try {
      const { url, publicId, provider } = await generateImageSmart(prompt);
      setPendingImages((prev) => [
        ...prev,
        { url, publicId, provider },
      ]);
      inputRef.current?.focus();
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Image generation failed.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    const prompt = input.trim();
    if (!prompt || generating) return;
    setInput("");
    await generateImageWithPrompt(prompt);
  };

  // /image <prompt> — generate AND send as a message in one step
  const handleGenerateImageWithText = async (prompt: string) => {
    if (!prompt.trim() || generating) return;
    await generateImageWithPrompt(prompt);
    // Once attached, auto-send with the prompt as caption
    setTimeout(() => {
      void runSendWithText(prompt);
    }, 100);
  };

  const [voiceOutput, setVoiceOutput] = useState(() => {
    try {
      return localStorage.getItem("jarvis-voice-output") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("jarvis-voice-output", String(voiceOutput));
    } catch {
      /* ignore */
    }
  }, [voiceOutput]);

  // --- Voice output ---
  const player = useVoicePlayer();

  const handleRecording = async (blob: Blob) => {
    setTranscribing(true);
    setAssistantError(null);
    setPanelVoice(null);
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const result = (await transcribeAction({
        audio: bytes.buffer,
      })) as VoiceNoteResult;
      setPanelVoice(result);
      setInput(result.text);
      inputRef.current?.focus();
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Transcription failed.",
      );
    } finally {
      setTranscribing(false);
    }
  };

  const recorder = useVoiceRecorder(handleRecording);

  // ---- Live mode: Whisper STT → chat pipeline → spoken reply ----
  const liveTurnRef = useRef<(text: string) => Promise<void>>(async () => {});
  const live = useLiveMode(
    async (audio: Blob, country: string) => {
      const lang = getCountry(country).language;
      const bytes = await audio.arrayBuffer();
      const { text } = await transcribeWhisperAction({ audio: bytes, language: lang });
      if (!text) return "";
      await liveTurnRef.current(text);
      return text;
    },
    countryCode,
  );
  // Speak each new assistant reply when live mode is active
  const spokenReplyRef = useRef<Id<"chatMessages"> | null>(null);
  useEffect(() => {
    if (!live.active || !messages || messages.length === 0 || sending) return;
    const last = messages[messages.length - 1];
    if (
      last.role === "assistant" &&
      spokenReplyRef.current !== last._id
    ) {
      spokenReplyRef.current = last._id;
      live.deliverReply(last.content);
    }
  }, [messages, sending, live]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMsg = messages?.[messages.length - 1];

  // Smart auto-scroll: stick to the bottom while the reply streams, but never
  // yank the page away if the user scrolled up to read — a jump-to-latest
  // pill appears instead.
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (atBottom) {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages?.length, sending, atBottom]);

  // Auto-speak new assistant replies when voice output is enabled
  const prevMsgCount = useRef(messages?.length ?? 0);
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (voiceOutput && count > prevMsgCount.current && !sending) {
      const newest = messages![count - 1];
      if (
        newest.role === "assistant" &&
        !player.playingId &&
        !player.loadingId
      ) {
        void handleSpeak(newest._id, newest.content);
      }
    }
    prevMsgCount.current = count;
  }, [messages?.length, sending, voiceOutput]);

  useEffect(() => {
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setPanelVoice(null);
    setPendingImages([]);
    setPendingFile(null);
    setEditingId(null);
    setRegionResult(null);
    setShowCalculator(false);
    setFollowUps([]);
    player.stop();
  }, [activeId]);

  // Keyboard shortcuts: Ctrl/Cmd+K starts a new chat, "/" focuses the input
  // (when not already typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setActiveId(null);
        setSidebarOpen(false);
        return;
      }
      if (
        e.key === "/" &&
        !(e.ctrlKey || e.metaKey || e.altKey) &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Refresh displayed time every second
  useEffect(() => {
    const tick = () => {
      try {
        setRegionTime(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: regionTimezone,
          }),
        );
      } catch {
        setRegionTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [regionTimezone]);

  // Persist timezone
  useEffect(() => {
    try {
      localStorage.setItem("jarvis-timezone", regionTimezone);
    } catch { /* ignore */ }
  }, [regionTimezone]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCalculator((v) => !v);
        setRegionResult(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Edit a user message: load into input, delete all later messages
  const handleEditMessage = async (msgId: Id<"chatMessages">, content: string) => {
    setEditingId(msgId);
    setInput(content);
    inputRef.current?.focus();
  };

  // ---- Natural-language weather: store user msg, fetch data, AI narrates ----
  const runWeatherReply = async (city: string, originalText: string) => {
    setSending(true);
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setPanelVoice(null);
    if (recorder.recording) recorder.stop();
    setInput("");

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: originalText });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: originalText });
        history = (messages ?? []).slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      const w = await getWeatherAction({ city });

      const narration = await askAction({
        prompt:
          `The user asked: "${originalText}"\n\n` +
          `Live weather data for ${w.city}${w.country ? ", " + w.country : ""} (via ${w.provider}):\n` +
          `- Condition: ${w.description} ${w.icon}\n- Temperature: ${w.temp}°C (feels like ${w.feelsLike}°C)\n` +
          (w.high !== undefined && w.low !== undefined ? `- Today's range: ${w.low}°C to ${w.high}°C\n` : "") +
          `- Humidity: ${w.humidity}%\n- Wind: ${w.wind} km/h\n` +
          (w.pressure !== undefined ? `- Pressure: ${w.pressure} hPa\n` : "") +
          (w.visibility !== undefined ? `- Visibility: ${w.visibility} km\n` : "") +
          (w.sunrise ? `- Sunrise: ${w.sunrise}, Sunset: ${w.sunset}\n` : "") +
          `\nAnswer the user's question naturally in 2-4 short sentences using this data. ` +
          `Include the temperature and condition. Add one practical suggestion (umbrella, jacket, etc.) if relevant. ` +
          `Do NOT mention slash commands, APIs, or that you were given structured data.`,
        history,
      });

      await appendMessage({
        sessionId,
        role: "assistant",
        content: narration.text,
        model: narration.model,
        usedFallback: narration.usedFallback,
        usedSearch: false,
      });

      // Also show the visual weather card
      setRegionResult({ type: "weather", ...w } as Record<string, unknown>);
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Weather lookup failed.",
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };


  // ---- Natural-language image gen: stores msg, generates, sends result ----
  const runImageGenerationMessage = async (prompt: string, originalText: string) => {
    setSending(true);
    setAssistantError(null);
    setInput("");
    if (recorder.recording) recorder.stop();

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: originalText });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: originalText });
        history = (messages ?? []).slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      setGenerating(true);
      let generated: { url: string; publicId: string; provider: string } | null = null;
      let genError: string | null = null;
      try {
        generated = await generateImageSmart(prompt);
      } catch (err) {
        genError = err instanceof Error ? err.message : "Image generation failed.";
      }
      setGenerating(false);

      // Attach the generated image and send it as an assistant message
      if (generated) {
        await appendMessage({
          sessionId,
          role: "assistant",
          content: `Generated image: **${prompt}**`,
          model: generated.provider.startsWith("hf/") ? "huggingface" : generated.provider,
          imageUrl: generated.url,
          imagePublicId: generated.publicId,
          images: [{ url: generated.url, publicId: generated.publicId }],
        });
      } else {
        // All providers failed — have the LLM acknowledge gracefully
        const answer = await askAction({
          prompt: `The user asked me to generate an image of "${prompt}" but the image service failed (${genError}). Apologize briefly and suggest they try again or rephrase.`,
          history,
        });
        await appendMessage({
          sessionId,
          role: "assistant",
          content: answer.text,
          model: answer.model,
          usedFallback: answer.usedFallback,
        });
      }
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Image message failed.");
    } finally {
      setGenerating(false);
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const runSendWithText = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if ((!text && pendingImages.length === 0 && !pendingFile) || sending)
      return;
    if (text.length > 8000) {
      setAssistantError("Message too long — keep it under 8,000 characters.");
      return;
    }

    // PDF attachments route through the document-Q&A flow (extract text + ask)
    if (pendingFile && /pdf/.test(pendingFile.type)) {
      setInput("");
      await handlePdfQuestion(text);
      return;
    }

    // Country persona: Jarvis speaks the user's language & regional context
    const countryPersona = getCountry(countryCode).persona;
    const effectiveText = editingId || deepResearch || pendingImages.length > 0 || pendingFile
      ? text
      : `${text}\n\n[System: ${countryPersona}]`;

    // Natural-language image generation: "generate an image of..." etc.
    if (!editingId && text && pendingImages.length === 0 && !pendingFile && !deepResearch) {
      const imgIntent = text.match(
        /^\s*(?:please\s+)?(?:generate|create|make|draw|paint|render|give)\s+(?:me\s+)?(?:an?|the)??\s*(?:ai\s+)?(?:image|picture|photo|artwork|drawing|painting|illustration)\s*(?:of|showing|with|about|for)?\s*[:]?\s*([\s\S]{3,400})/i,
      );
      if (imgIntent?.[1]) {
        const prompt = imgIntent[1].replace(/[.?!]+$/, "").trim();
        await runImageGenerationMessage(prompt, text);
        return;
      }
    }

    // Natural-language weather: fetch live data directly, no slash command needed
    if (!editingId && text && pendingImages.length === 0 && !pendingFile) {
      try {
        const detection = await detectWeatherAction({ message: text });
        if (detection.isWeather && detection.city) {
          await runWeatherReply(detection.city, text);
          return;
        }
        if (detection.isWeather && !detection.city) {
          // Weather asked but no city parsed — use detected timezone city guess
          const guess = regionTimezone.split("/").pop()?.replace(/_/g, " ") ?? "";
          if (guess) {
            await runWeatherReply(guess, text);
            return;
          }
        }
      } catch {
        // detection is best-effort — fall through to normal AI chat
      }
    }

    setSending(true);
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setPanelVoice(null);
    if (recorder.recording) recorder.stop();

    const hasImages = pendingImages.length > 0;
    const imagePayload = hasImages
      ? {
          images: pendingImages.map((img) => ({
            url: img.url,
            publicId: img.publicId,
          })),
          // Back-compat single fields for the first image
          imageUrl: pendingImages[0].url,
          imagePublicId: pendingImages[0].publicId,
        }
      : undefined;
    const filePayload = pendingFile
      ? {
          fileUrl: pendingFile.url,
          fileName: pendingFile.name,
          fileType: pendingFile.type,
          fileSize: pendingFile.size,
        }
      : undefined;
    setPendingImages([]);
    setPendingFile(null);
    setInput("");

    const messageContent =
      text ||
      (hasImages
        ? "[Image]"
        : filePayload
          ? `[File: ${filePayload.fileName}]`
          : "");

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      let userMsgId: Id<"chatMessages"> | undefined;

      if (editingId) {
        // Edit flow: update the existing message, which also deletes later messages
        const result = await editMessage({
          messageId: editingId,
          content: messageContent,
          ...imagePayload,
          ...filePayload,
        });
        sessionId = result.sessionId;
        setEditingId(null);
        history = (messages ?? [])
          .filter((m) => m._id !== editingId)
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }));
      } else if (!activeId) {
        const { sessionId: sid, messageId: uid } = await startWithMessage({
          content: messageContent,
          ...imagePayload,
          ...filePayload,
        });
        sessionId = sid;
        userMsgId = uid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        userMsgId = await appendMessage({
          sessionId,
          role: "user",
          content: messageContent,
          ...imagePayload,
          ...filePayload,
        });
        history = (messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      // Strip the "SUGGEST: a, b, c" trailer off the reply: the items become
      // clickable follow-up chips and the raw line never enters the saved
      // message (so it can never render as literal text).
      const extractFollowUps = (raw: string): string => {
        const m = raw.match(/^SUGGEST:\s*(.+)$/im);
        if (!m) {
          setFollowUps([]);
          return raw;
        }
        const items = m[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3);
        setFollowUps(items);
        return raw.replace(/^SUGGEST:\s*.+$/im, "").trimEnd();
      };

      let answerText = "";
      if (deepResearch) {
        const { answer, sources } = await runDeepResearch(
          sessionId,
          text,
          history,
        );
        answerText = extractFollowUps(answer.text);
        const msgId = await appendMessage({
          sessionId,
          role: "assistant",
          content: answerText,
          model: answer.model,
          usedFallback: answer.usedFallback,
          usedSearch: true,
          sources,
        });
        void indexForRag(sessionId, userMsgId, msgId, messageContent, answerText).catch(() => {});
      } else {
        const visionUrls = imagePayload?.images?.map((i) => i.url);
        const answer = await runAsk(effectiveText, history, visionUrls && visionUrls.length > 0 ? visionUrls : undefined);
        answerText = extractFollowUps(answer.text);
        const msgId = await appendMessage({
          sessionId,
          role: "assistant",
          content: answerText,
          model: answer.model,
          usedFallback: answer.usedFallback,
          usedSearch: false,
        });
        void indexForRag(sessionId, userMsgId, msgId, messageContent, answerText).catch(() => {});
      }
    } catch (err) {
      setAssistantError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };


  // ---- RAG indexing: embed an exchange so future questions can recall it ----
  const indexForRag = async (
    sessionId: Id<"chatSessions">,
    userMsgId: Id<"chatMessages"> | undefined,
    assistantMsgId: Id<"chatMessages">,
    userContent: string,
    assistantContent: string,
  ) => {
    const messages: {
      messageId: Id<"chatMessages">;
      role: string;
      content: string;
    }[] = [];
    if (userMsgId && userContent) {
      messages.push({ messageId: userMsgId, role: "user", content: userContent });
    }
    if (assistantMsgId && assistantContent) {
      messages.push({
        messageId: assistantMsgId,
        role: "assistant",
        content: assistantContent,
      });
    }
    if (messages.length === 0) return;
    await indexMessagesAction({ sessionId, messages });
  };

  const runSend = () => runSendWithText();
  liveTurnRef.current = async (text: string) => {
    await runSendWithText(text);
  };

  const runAsk = async (
    prompt: string,
    history: { role: string; content: string }[],
    imageUrls?: string[],
  ) => {
    return await askAction({ prompt, history, imageUrls });
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
      setAssistantError(
        err instanceof Error ? err.message : "NLP analysis failed.",
      );
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
      setAssistantError(
        err instanceof Error ? err.message : "News search failed.",
      );
    } finally {
      setPanelBusy(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  // --- Summarize URL ---
  const handleSummarizeUrl = async () => {
    const url = summarizeInput.trim();
    if (!url || summarizingUrl) return;
    setSummarizingUrl(true);
    setAssistantError(null);
    setSummarizeInput("");
    try {
      // Create a session if needed
      let sessionId = activeId;
      if (!sessionId) {
        const { sessionId: sid } = await startWithMessage({
          content: `Summarize: ${url}`,
        });
        sessionId = sid;
        setActiveId(sid);
      } else {
        await appendMessage({
          sessionId,
          role: "user",
          content: `Summarize: ${url}`,
        });
      }
      const history = (messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const answer = await summarizeUrlAction({ url, history });
      await appendMessage({
        sessionId,
        role: "assistant",
        content: answer.text,
        model: answer.model,
        usedFallback: answer.usedFallback,
        usedSearch: false,
      });
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Failed to summarize URL.",
      );
    } finally {
      setSummarizingUrl(false);
    }
  };

  // --- Cloudinary OAuth connect / disconnect ---
  const handleConnectCloudinary = async () => {
    setCloudinaryConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/cloudinary/callback`;
      const { url } = await getOAuthStartUrlAction({ redirectUri });
      window.location.href = url; // full-page redirect to Cloudinary consent
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start Cloudinary connection.",
      );
      setCloudinaryConnecting(false);
    }
  };

  const handleDisconnectCloudinary = async () => {
    try {
      await disconnectCloudinaryAction({});
      toast.success("Cloudinary disconnected — using API key auth.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to disconnect Cloudinary.",
      );
    }
  };

  // ---- Dark mode toggle (persisted) ----
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("jarvis-theme", next ? "dark" : "light");
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("jarvis-theme");
      if (saved === "dark") {
        setIsDark(true);
        document.documentElement.classList.add("dark");
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // ---- AI-generated chat titles: run once after the first exchange ----
  const titleGeneratedFor = useRef<Id<"chatSessions"> | null>(null);
  useEffect(() => {
    if (
      !activeId ||
      sending ||
      !messages ||
      messages.length < 2 ||
      titleGeneratedFor.current === activeId
    )
      return;
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser || firstUser.content.startsWith("[Image]")) return;
    titleGeneratedFor.current = activeId;
    void generateTitleAction({ firstMessage: firstUser.content })
      .then(({ title }) => renameSessionMutation({ sessionId: activeId, title }))
      .catch(() => {
        // silent — truncation fallback already applied server-side
      });
  }, [activeId, messages, sending, generateTitleAction, renameSessionMutation]);

  // ---- PDF Q&A: extract text from a PDF and ask Jarvis about it ----
  const handlePdfQuestion = async (question: string) => {
    if (!pendingFile || pdfBusy) return;
    const file = pendingFile;
    setPdfBusy(true);
    setAssistantError(null);
    const userQuestion = question || "Summarize this document";
    setPendingFile(null);
    try {
      const { text, pages } = await extractPdfTextAction({ url: file.url });

      // Build a session if needed
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({
          content: `[PDF: ${file.name}] ${userQuestion}`,
          fileUrl: file.url,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({
          sessionId,
          role: "user",
          content: `[PDF: ${file.name}] ${userQuestion}`,
          fileUrl: file.url,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        });
        history = (messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      const answer = await askAction({
        prompt:
          `A user uploaded a PDF document (${file.name}, ${pages} pages). ` +
          `Here is its extracted text:\n\n<document>\n${text}\n</document>\n\n` +
          `The user asks: ${userQuestion}\n\n` +
          "Answer grounded ONLY in the document. If the answer isn't in the document, say so.",
        history,
      });

      await appendMessage({
        sessionId,
        role: "assistant",
        content: answer.text,
        model: answer.model,
        usedFallback: answer.usedFallback,
        usedSearch: false,
      });
      setPendingFile(null);
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "PDF analysis failed.",
      );
    } finally {
      setPdfBusy(false);
    }
  };

  // ---- Prompt library ----
  const [promptTitle, setPromptTitle] = useState("");
  const handleSavePrompt = async () => {
    const content = input.trim();
    if (!content) return;
    try {
      await savePromptMutation({
        title: promptTitle.trim() || content.slice(0, 40),
        content,
      });
      toast.success("Prompt saved to library.");
      setPromptTitle("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save prompt.");
    }
  };

  const handleUsePrompt = (content: string) => {
    setInput(content);
    setShowPrompts(false);
    inputRef.current?.focus();
  };

  // Insert a ready-to-fill ```desmos block for the given calculator mode.
  // Scientific/geometry take no expressions; graphing/3d get a fill-in slot.
  const insertDesmosBlock = (mode: "graphing" | "3d" | "scientific" | "geometry" | "fourfunction") => {
    const block =
      mode === "scientific" || mode === "geometry" || mode === "fourfunction"
        ? "```desmos\nmode: " + mode + "\n```"
        : "```desmos\nmode: " + mode + "\nzoom: 10\nexpressions:\n\n```";
    setInput((prev) => (prev.trim() ? prev.replace(/\s*$/, "\n\n" + block) : block));
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      if (mode === "scientific" || mode === "geometry" || mode === "fourfunction") {
        el.setSelectionRange(el.value.length, el.value.length);
        return;
      }
      const pos = el.value.length - 4; // just before the closing fence
      el.setSelectionRange(pos, pos);
    });
  };

  // --- Export chat as Markdown ---
  const handleExportChat = () => {
    if (!messages || messages.length === 0) return;
    const lines = messages.map((m) => {
      const role = m.role === "user" ? "**You**" : "**Jarvis**";
      const meta = m.model ? ` _(${m.model})_` : "";
      const imgs = m.images && m.images.length > 0
        ? m.images.map((i) => `![image](${i.url})`).join("\n")
        : m.imageUrl
          ? `![image](${m.imageUrl})`
          : "";
      const file = m.fileUrl ? `\n[Attachment: ${m.fileName ?? "file"}](${m.fileUrl})` : "";
      return `${role}${meta}:\n${imgs ? imgs + "\n" : ""}${m.content}${file}`;
    });
    const md = `# Jarvis Chat\n\n${lines.join("\n\n---\n\n")}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jarvis-chat-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // --- Voice output: Groq TTS → browser SpeechSynthesis fallback ---
  const browserSpeakRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speakViaBrowser = (id: string, text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setAssistantError("Speech synthesis not supported in this browser.");
      return;
    }
    synth.cancel();
    const utt = new SpeechSynthesisUtterance(
      text
        .replace(/```[\s\S]*?```/g, " code block ")
        .replace(/[#*_`~\[\]]/g, ""),
    );
    // Match the voice to the selected country's language
    const tag = getCountry(countryCode).langTag;
    const langPrefix = tag.split("-")[0];
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang === tag) ??
      voices.find((v) => v.lang.startsWith(langPrefix));
    if (voice) {
      utt.voice = voice;
      utt.lang = voice.lang;
    } else {
      utt.lang = tag;
    }
    utt.rate = 1;
    utt.pitch = 1;
    utt.onend = () => {
      browserSpeakRef.current = null;
      player.setPlayingId(null);
    };
    utt.onerror = () => {
      browserSpeakRef.current = null;
      player.setPlayingId(null);
    };
    browserSpeakRef.current = utt;
    player.setPlayingId(id);
    synth.speak(utt);
  };

  const handleSpeak = async (id: string, content: string) => {
    if (player.playingId === id) {
      player.stop();
      window.speechSynthesis?.cancel();
      return;
    }
    player.setLoadingId(id);
    setAssistantError(null);
    try {
      const { audio } = await speakAction({ text: content });
      if (audio) {
        player.play(id, audio);
      } else {
        // No server TTS available — browser voice takes over seamlessly.
        player.setLoadingId(null);
        speakViaBrowser(id, content);
      }
    } catch {
      player.setLoadingId(null);
      speakViaBrowser(id, content);
    }
  };

  // --- Region command handlers ---
  const handleRegionCommand = async (cmd: string, arg: string) => {
    setRegionBusy(true);
    setRegionResult(null);
    setAssistantError(null);
    try {
      switch (cmd) {
        case "time": {
          const result = await getWorldTimeAction({ timezone: arg || undefined });
          setRegionResult({ type: "time", ...result });
          break;
        }
        case "weather": {
          if (!arg) throw new Error("Usage: /weather <city>");
          const result = await getWeatherAction({ city: arg });
          setRegionResult({ type: "weather", ...result });
          break;
        }
        case "currency": {
          // Parse: /currency 100 USD to EUR
          const match = arg.match(/(\d+\.?\d*)\s+(\w{3})\s+to\s+(\w{3})/i);
          if (!match) throw new Error("Usage: /currency <amount> <FROM> to <TO>\nExample: /currency 100 USD to EUR");
          const [, amount, from, to] = match;
          const result = await getCurrencyRateAction({ from, to, amount: parseFloat(amount) });
          setRegionResult({ type: "currency", ...result });
          break;
        }
        case "country": {
          if (!arg) throw new Error("Usage: /country <name>");
          const result = await getCountryInfoAction({ query: arg });
          setRegionResult({ type: "country", ...result });
          break;
        }
      }
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Command failed.");
    } finally {
      setRegionBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.trim();
      // Check for slash commands
      const slashMatch = text.match(/^\/(time|weather|currency|country)\s*(.*)/i);
      if (slashMatch) {
        const [, cmd, arg] = slashMatch;
        setInput("");
        void handleRegionCommand(cmd.toLowerCase(), arg.trim());
        return;
      }
      // /solve — structured step-by-step math solution
      const solveMatch = text.match(/^\/(solve|math)\s+([\s\S]+)/i);
      if (solveMatch) {
        const [, , problem] = solveMatch;
        setInput(
          `Solve this step by step using proper LaTeX math notation. FORMAT RULES (strict): inline math as $...$; display math as $$ on its OWN line, the math on the next line, then $$ on its own line (never $$math$$ on one line); never put text, headers, or --- on the same line as $$; always close every \\begin{...} with \\end{...}; use \\boxed{...} for the final result. Show your method, every step with working, and end with brief Remarks. If the problem mentions a graph, plot, or visualizing the function (e.g. \"x² in graph\"), ALSO emit an interactive Desmos block so the graph renders live: a fenced code block tagged desmos with \`mode: graphing\`, an optional \`zoom: 10\`, then \`expressions:\` and the function in Desmos plain-text syntax (like \`y = x^2\`, no $ or backslashes), one per line: ${problem}`,
        );
        // Small delay so the state lands, then trigger send
        setTimeout(() => {
          const btn = document.querySelector<HTMLButtonElement>("[data-send-button]");
          btn?.click();
        }, 50);
        return;
      }
      // /image — generate directly from the message bar
      // /plot — force an interactive Desmos graph of the given expression(s)
      const plotMatch = text.match(/^\/(plot|graph)\s+([\s\S]+)/i);
      if (plotMatch) {
        const [, , expr] = plotMatch;
        const exprLines = expr
          .split(/[;,\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const is3d = exprLines.some((l) => /\bz\s*=/i.test(l));
        const block =
          "```desmos\nmode: " + (is3d ? "3d" : "graphing") + "\nzoom: 10\nexpressions:\n" +
          exprLines.join("\n") + "\n```";
        setInput("");
        void runSendWithText(block);
        return;
      }

      const imageMatch = text.match(/^\/(image|img|draw)\s+([\s\S]+)/i);
      if (imageMatch) {
        const [, , prompt] = imageMatch;
        setInput("");
        void handleGenerateImageWithText(prompt);
        return;
      }
      void runSend();
    }
  };

  const sessionTitle = activeId
    ? sessions.find((s) => s._id === activeId)?.title ?? "Chat"
    : "New chat";

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        {/* ---- Desktop sidebar ---- */}
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex items-center justify-between px-5 py-4">
            <Link to="/" className="flex items-center gap-2.5">
              <JarvisIcon className="size-5" />
              <span className="text-sm font-semibold tracking-tight">
                JARVIS
              </span>
            </Link>
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
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No chats yet
              </p>
            ) : (
              <ul className="space-y-0.5">
                {sessions.map((s) => (
                  <li key={s._id} className="group relative">
                    <button
                      onClick={() => {
                        setActiveId(s._id);
                        setSidebarOpen(false);
                      }}
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

        {/* ---- Mobile sidebar overlay ---- */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/40 md:hidden"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: "spring", damping: 30, stiffness: 350 }}
                className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-sidebar md:hidden"
              >
                <div className="flex items-center justify-between px-5 py-4">
                  <Link
                    to="/"
                    className="flex items-center gap-2.5"
                  >
                    <JarvisIcon className="size-5" />
                    <span className="text-sm font-semibold tracking-tight">
                      JARVIS
                    </span>
                  </Link>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <Separator />
                <div className="flex-1 overflow-y-auto p-2">
                  <Button
                    variant="ghost"
                    className="mb-1 w-full justify-start gap-2 text-sm"
                    onClick={() => {
                      setActiveId(null);
                      setSidebarOpen(false);
                    }}
                  >
                    <Plus className="size-4" /> New chat
                  </Button>
                  {sessions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      No chats yet
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {sessions.map((s) => (
                        <li key={s._id} className="group relative">
                          <button
                            onClick={() => {
                              setActiveId(s._id);
                              setSidebarOpen(false);
                            }}
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
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* ---- Main area ---- */}
        <main
          className="flex min-w-0 flex-1 flex-col"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* ---- Menu bar ---- */}
          <header className="flex items-center justify-between border-b px-4 py-2 sm:px-6">
            {/* Left: hamburger + title */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
                title="Menu"
              >
                <Menu className="size-4" />
              </button>
              <div className="hidden items-center gap-2 md:flex">
                <JarvisIcon className="size-4 text-muted-foreground" />
                <Separator orientation="vertical" className="h-4" />
              </div>
              <span className="max-w-[180px] truncate text-sm text-muted-foreground sm:max-w-none">
                {sessionTitle}
              </span>
            </div>

            {/* Right: menu bar actions */}
            <div className="flex items-center gap-1">
              {/* New chat (desktop) */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden md:inline-flex"
                onClick={() => setActiveId(null)}
                title="New chat"
              >
                <Plus className="size-4" />
              </Button>

              {/* Tools menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Tools"
                  >
                    <Settings className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Tools</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeepResearch((v) => !v)}
                  >
                    <Globe className="size-4" />
                    Deep Research
                    {deepResearch ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setVoiceOutput((v) => !v)}
                  >
                    {voiceOutput ? (
                      <Volume2 className="size-4" />
                    ) : (
                      <VolumeX className="size-4" />
                    )}
                    Voice output
                    {voiceOutput ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowSearch((v) => !v)}>
                    <Search className="size-4" />
                    Search conversations
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSummarizeInput("https://"); }}>
                    <Link2 className="size-4" />
                    Summarize URL
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportChat} disabled={!messages || messages.length === 0}>
                    <Download className="size-4" />
                    Export chat
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void handleRegionCommand("time", regionTimezone)}>
                    🕐 Current time
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setInput("/weather "); inputRef.current?.focus(); }}>
                    🌤 Weather lookup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setInput("/currency 100 "); inputRef.current?.focus(); }}>
                    💱 Currency convert
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setInput("/country "); inputRef.current?.focus(); }}>
                    🌍 Country info
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setShowCalculator((v) => !v); setRegionResult(null); }}>
                    🧮 Calculator (ML & Math)
                    {showCalculator ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setShowPrompts((v) => !v); setShowSearch(false); }}>
                    <Bookmark className="size-4" />
                    Prompt library
                    {showPrompts ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleTheme}>
                    {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                    {isDark ? "Light mode" : "Dark mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleConnectCloudinary} disabled={cloudinaryConnecting || cloudinaryStatus?.connected}>
                    <Link2 className="size-4" />
                    {cloudinaryStatus?.connected
                      ? "Cloudinary connected ✓"
                      : cloudinaryConnecting
                        ? "Connecting to Cloudinary…"
                        : "Connect Cloudinary (OAuth)"}
                  </DropdownMenuItem>
                  {cloudinaryStatus?.connected ? (
                    <DropdownMenuItem onClick={handleDisconnectCloudinary}>
                      <X className="size-4" />
                      Disconnect Cloudinary
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleAnalyze} disabled={!lastMsg}>
                    <Languages className="size-4" />
                    Analyze last message
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleNews}
                    disabled={!input.trim()}
                  >
                    <Newspaper className="size-4" />
                    Search news
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                    {user?.name?.[0]?.toUpperCase() ||
                      user?.email?.[0]?.toUpperCase() ||
                      "G"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {user?.name || "Guest"}
                      </span>
                      {user?.email ? (
                        <span className="text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      ) : null}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/">
                      <Home className="size-4" /> Home
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSignOut}>
                    <User className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* ---- Region bar ---- */}
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground sm:px-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                🌐
                <select
                  value={countryCode}
                  onChange={(e) => changeCountry(e.target.value)}
                  className="cursor-pointer appearance-none bg-transparent font-medium text-foreground outline-none"
                  title="Select country — Jarvis adapts language & region"
                >
                  {COUNTRIES.map((cn) => (
                    <option key={cn.code} value={cn.code}>
                      {cn.flag} {cn.name} — {cn.languageName}
                    </option>
                  ))}
                </select>
              </span>
              {regionTime && (
                <span className="tabular-nums font-mono text-foreground">{regionTime}</span>
              )}
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <span className="cursor-default" title="/time, /weather, /currency, /country, /solve <problem>, /image <prompt>">
                Commands: <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/plot</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/solve</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/time</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/weather</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/currency</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/country</code>
                <span className="ml-1 text-muted-foreground/60">|</span>
                <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">Ctrl+K</kbd> Calculator
              </span>
            </div>
          </div>

          {/* ---- Messages ---- */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {!messages || messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6">
                <div className="text-muted-foreground/50">
                  <JarvisOrb size={72} />
                </div>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">
                  How can I help?
                </h1>
                <p className="mt-2 max-w-md text-center text-sm leading-6 text-muted-foreground">
                  Ask anything — try “solve x² in graph” for a live plot, or /solve
                  for step-by-step math. Toggle Deep Research for cited web
                  answers — Groq answers first, Hugging Face takes over
                  automatically if it fails.
                </p>
                <div className="mt-8 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    "Explain quantum computing simply",
                    "What's new in AI this week?",
                    "Summarize the history of the internet",
                    "Compare React vs Vue in 2026",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setInput(s);
                        inputRef.current?.focus();
                      }}
                      className="rounded-lg border px-4 py-3 text-left text-xs leading-5 text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {/* Region quick actions */}
                <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "🕐 Time", cmd: "/time Asia/Tokyo" },
                    { label: "🌤 Weather", cmd: "/weather London" },
                    { label: "💱 Currency", cmd: "/currency 100 USD to EUR" },
                    { label: "🌍 Country", cmd: "/country Japan" },
                    { label: "🧮 Solve math", cmd: "/solve " },
                    { label: "🎨 Generate image", cmd: "/image " },
                    { label: "📈 Plot graph", cmd: "/plot y = x^2" },
                    { label: "🔬 Deep research", cmd: "__research__" },

                  ].map((item) => (
                    <button
                      key={item.cmd}
                      onClick={() => {
                        if (item.cmd === "__research__") {
                          setDeepResearch(true);
                          inputRef.current?.focus();
                          return;
                        }
                        setInput(item.cmd);
                        inputRef.current?.focus();
                      }}
                      className="rounded-lg border px-3 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent hover:text-foreground"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground/60">
                  <span className="inline-flex items-center gap-1">
                    <Globe className="size-3" /> Web search
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Mic className="size-3" /> Voice
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Languages className="size-3" /> NLP
                  </span>
                  <span className="inline-flex items-center gap-1">
                    🌐 Region
                  </span>
                  <span className="inline-flex items-center gap-1">
                    🧮 ML & Math
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Zap className="size-3" /> Auto-fallback
                  </span>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl px-6 py-8">
                <ul className="space-y-8">
                  {messages.map((m) => (
                    <li key={m._id}>
                      {/* Label row */}
                      <div className="flex items-center gap-2.5">
                        {m.role === "assistant" ? (
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent">
                            <JarvisIcon className="size-3.5" />
                          </div>
                        ) : (
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-muted-foreground">
                            {user?.name?.[0]?.toUpperCase() ||
                              user?.email?.[0]?.toUpperCase() ||
                              "Y"}
                          </div>
                        )}
                        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                          {m.role === "user" ? "You" : "Jarvis"}
                        </span>
                        <button
                          onClick={() => {
                            if (!navigator.clipboard) return;
                            navigator.clipboard.writeText(m.content).then(() => {
                              setCopiedId(m._id);
                              setTimeout(() => setCopiedId(null), 1500);
                            }).catch(() => {});
                          }}
                          title="Copy message"
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {copiedId === m._id ? (
                            <Check className="size-3" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                        {m.role === "user" && !sending && (
                          <button
                            onClick={() => void handleEditMessage(m._id, m.content)}
                            title="Edit this message"
                            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                          </button>
                        )}
                        {m.role === "assistant" && m._id === lastMsg?._id && !sending && (
                          <button
                            onClick={() => {
                              const prevUser = [...(messages ?? [])]
                                .reverse()
                                .find((x) => x.role === "user");
                              if (prevUser) void handleEditMessage(prevUser._id, prevUser.content);
                            }}
                            title="Regenerate this reply"
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <RotateCcw className="size-3" />
                          </button>
                        )}
                        {m.role === "assistant" && (
                          <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                            {m.usedSearch || m.usedFallback ? (
                              <span className="flex items-center gap-1">
                                {m.usedSearch && (
                                  <Globe className="size-3" />
                                )}
                                {m.usedFallback && (
                                  <RotateCcw className="size-3" />
                                )}
                                {m.usedSearch ? "web" : "fallback"}
                                {" · "}
                                {m.model?.split("/")[0]}
                              </span>
                            ) : null}
                            <button
                              onClick={() =>
                                void handleSpeak(m._id, m.content)
                              }
                              title={
                                player.playingId === m._id
                                  ? "Stop playback"
                                  : "Speak"
                              }
                              className="rounded p-0.5 transition-colors hover:text-foreground"
                            >
                              {player.loadingId === m._id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : player.playingId === m._id ? (
                                <VolumeX className="size-3" />
                              ) : (
                                <Volume2 className="size-3" />
                              )}
                            </button>
                          </span>
                        )}
                      </div>
                      {/* Message body */}
                      {m.role === "user" ? (
                        <div className="mt-2 ml-8.5">
                          {(() => {
                            const imgs =
                              m.images && m.images.length > 0
                                ? m.images.map((i) => i.url)
                                : m.imageUrl
                                  ? [m.imageUrl]
                                  : [];
                            if (imgs.length === 0) return null;
                            return (
                              <div
                                className={`mb-2 grid max-w-md gap-1.5 ${
                                  imgs.length === 1
                                    ? "grid-cols-1"
                                    : imgs.length === 2
                                      ? "grid-cols-2"
                                      : "grid-cols-3"
                                }`}
                              >
                                {imgs.map((url, i) => (
                                  <button
                                    key={url + i}
                                    onClick={() =>
                                      setLightbox({ images: imgs, index: i })
                                    }
                                    className="block cursor-zoom-in overflow-hidden rounded-lg border"
                                    title="View full size"
                                  >
                                    <img
                                      src={url}
                                      alt={`Image ${i + 1}`}
                                      className={`w-full object-cover transition-opacity hover:opacity-90 ${
                                        imgs.length === 1
                                          ? "max-h-64"
                                          : "h-28"
                                      }`}
                                    />
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                          {m.fileUrl ? (
                            <a
                              href={m.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mb-2 flex max-w-xs items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs transition-colors hover:bg-accent"
                            >
                              <FileText className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {m.fileName ?? "Attachment"}
                              </span>
                              {m.fileSize ? (
                                <span className="shrink-0 text-muted-foreground">
                                  {(m.fileSize / 1024).toFixed(0)} KB
                                </span>
                              ) : null}
                            </a>
                          ) : null}
                          {m.content &&
                          m.content !== "[Image]" &&
                          !m.content.startsWith("[File:") ? (
                            looksLikeMathOrMarkdown(m.content) ? (
                              <div className="md-body text-sm leading-7 text-foreground">
                                <MarkdownMessage content={m.content} />
                              </div>
                            ) : (
                              <div className="text-sm leading-7 whitespace-pre-wrap text-foreground">
                                {m.content}
                              </div>
                            )
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 ml-8.5 text-sm text-foreground/90">
                          <MarkdownMessage
                            content={m.content}
                            sources={m.sources}
                          />
                        </div>
                      )}
                      {m.role === "assistant" &&
                      m.sources &&
                      m.sources.length > 0 ? (
                        <div className="ml-8.5">
                          <SourceList sources={m.sources} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {sending && (
                    <li className="flex items-center gap-2.5 py-1 text-sm text-muted-foreground">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
                        <JarvisOrb size={18} />
                      </span>
                      {deepResearch
                        ? "Searching the web, then thinking…"
                        : "Thinking…"}
                    </li>
                  )}
                  {!sending && followUps.length > 0 && (
                    <li className="ml-9 mt-1 flex flex-wrap gap-1.5">
                      {followUps.map((f) => (
                        <button
                          key={f}
                          onClick={() => {
                            setFollowUps([]);
                            void runSendWithText(f);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
                        >
                          <Lightbulb className="size-3" />
                          {f}
                        </button>
                      ))}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Jump-to-latest pill when the user scrolled up during a stream */}
          <div className="relative z-10 h-0">
            {!atBottom && messages && messages.length > 0 && (
              <button
                onClick={() => {
                  scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                  setAtBottom(true);
                }}
                className="absolute -top-5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowDown className="size-3" />
                Jump to latest
              </button>
            )}
          </div>

          {/* ---- Search panel ---- */}
          <AnimatePresence>
            {showSearch && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t px-6 py-3"
              >
                <div className="mx-auto max-w-2xl">
                  <div className="mb-2 flex items-center gap-2">
                    <Search className="size-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Search conversations</span>
                    <button onClick={() => { setShowSearch(false); setSearchQuery(""); }} className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </div>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search across all chats…"
                    className="mb-2 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
                    autoFocus
                  />
                  {searchSessionsQuery && !Array.isArray(searchSessionsQuery) && (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {searchSessionsQuery.sessions.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Sessions</p>
                          <ul className="mt-1 space-y-1">
                            {searchSessionsQuery.sessions.map((s) => (
                              <li key={s.id}>
                                <button
                                  onClick={() => { setActiveId(s.id); setShowSearch(false); setSearchQuery(""); }}
                                  className="w-full truncate rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
                                >
                                  {s.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {searchSessionsQuery.messages.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Messages</p>
                          <ul className="mt-1 space-y-1">
                            {searchSessionsQuery.messages.map((m, i) => (
                              <li key={i}>
                                <button
                                  onClick={() => { setActiveId(m.sessionId); setShowSearch(false); setSearchQuery(""); }}
                                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                                >
                                  <span className="text-muted-foreground">[{m.role}]</span> {m.content}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {searchSessionsQuery.sessions.length === 0 && searchSessionsQuery.messages.length === 0 && (
                        <p className="text-xs text-muted-foreground">No results found.</p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Prompt library panel ---- */}
          <AnimatePresence>
            {showPrompts && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t px-6 py-3"
              >
                <div className="mx-auto max-w-2xl">
                  <div className="mb-2 flex items-center gap-2">
                    <Bookmark className="size-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Prompt library</span>
                    <button onClick={() => setShowPrompts(false)} className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </div>
                  <div className="mb-2 flex gap-2">
                    <input
                      value={promptTitle}
                      onChange={(e) => setPromptTitle(e.target.value)}
                      placeholder="Prompt title (optional)"
                      className="w-44 rounded-lg border bg-transparent px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
                    />
                    <button
                      onClick={() => void handleSavePrompt()}
                      disabled={!input.trim()}
                      className="rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      Save current input
                    </button>
                  </div>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto">
                    {promptsList && promptsList.length > 0 ? (
                      promptsList.map((p) => (
                        <div key={p._id} className="group flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
                          <button
                            onClick={() => handleUsePrompt(p.content)}
                            className="min-w-0 flex-1 text-left text-xs transition-colors hover:text-foreground"
                          >
                            <span className="block truncate font-medium">{p.title}</span>
                            <span className="block truncate text-muted-foreground">{p.content}</span>
                          </button>
                          <button
                            onClick={() => void deletePromptMutation({ promptId: p._id })}
                            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                            aria-label="Delete prompt"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">No saved prompts yet. Type a prompt, then save it.</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Region result panel ---- */}
          <AnimatePresence>
            {(regionResult || regionBusy) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t px-6 py-3"
              >
                <div className="mx-auto max-w-2xl">
                  {regionBusy && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Loading region data…
                    </div>
                  )}
                  {regionResult && !regionBusy && (
                    <RegionResultCard result={regionResult} onClose={() => setRegionResult(null)} />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Calculator panel ---- */}
          <AnimatePresence>
            {showCalculator && (
              <CalculatorPanel onClose={() => setShowCalculator(false)} />
            )}
          </AnimatePresence>

          {/* ---- Panel (NLP / news / voice / errors) ---- */}
          <AnimatePresence>
            {(panelNlp || panelNews || panelVoice || assistantError) && (
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
                    <pre className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {formatNlp(panelNlp)}
                    </pre>
                  )}
                  {panelNews && panelNews.length > 0 && (
                    <NewsPanel items={panelNews} />
                  )}
                  {panelVoice && (
                    <VoicePanel
                      note={panelVoice}
                      onUse={(t) => {
                        setInput(t);
                        inputRef.current?.focus();
                      }}
                    />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Composer ---- */}
          <div className="border-t px-4 py-3 sm:px-6 sm:py-4">
            <div className="mx-auto max-w-2xl">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`relative rounded-xl border bg-card transition-all focus-within:border-foreground/30 focus-within:shadow-sm ${
                  dragOver
                    ? "border-foreground/50 bg-accent/50 ring-2 ring-foreground/10"
                    : ""
                }`}
              >
                {dragOver ? (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-background/80">
                    <ImagePlus className="size-5 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground">
                      Drop file to attach
                    </p>
                  </div>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileInput}
                />
                {/* Previews: image thumbnails + file chip */}
                {pendingImages.length > 0 || pendingFile ? (
                  <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                    {pendingImages.map((img, i) => (
                      <div key={img.url} className="relative inline-block">
                        <button
                          onClick={() =>
                            setLightbox({
                              images: pendingImages.map((p) => p.url),
                              index: i,
                            })
                          }
                          className="block cursor-zoom-in"
                          title="View full size"
                        >
                          <img
                            src={img.url}
                            alt={`Attachment ${i + 1}`}
                            className="h-20 w-20 rounded-lg border object-cover transition-opacity hover:opacity-90"
                          />
                        </button>
                        {img.provider ? (
                          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
                            {img.provider === "puter"
                              ? "Puter"
                              : img.provider === "replicate"
                                ? "Rep"
                                : img.provider === "perchance"
                                  ? "Per"
                                  : img.provider === "pollinations"
                                    ? "Poll"
                                    : img.provider?.startsWith("hf/")
                                      ? "HF"
                                      : "Cld"}
                          </span>
                        ) : null}
                        <button
                          onClick={() =>
                            setPendingImages((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                    {pendingFile ? (
                      <div className="relative inline-flex max-w-[240px] items-center gap-2 rounded-lg border bg-background px-3 py-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {pendingFile.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {(pendingFile.size / 1024).toFixed(0)} KB
                        </span>
                        {/pdf/.test(pendingFile.type) ? (
                          <button
                            onClick={() => void handlePdfQuestion("")}
                            disabled={pdfBusy}
                            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                            title="Summarize this PDF with Jarvis"
                          >
                            {pdfBusy ? "Reading…" : "Summarize"}
                          </button>
                        ) : null}
                        <button
                          onClick={() => setPendingFile(null)}
                          className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {/* URL summarize input */}
                {summarizeInput && (
                  <div className="flex items-center gap-2 px-4 pt-3">
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={summarizeInput}
                      onChange={(e) => setSummarizeInput(e.target.value)}
                      placeholder="Paste a URL to summarize…"
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                      autoFocus
                    />
                    <button
                      onClick={() => void handleSummarizeUrl()}
                      disabled={summarizingUrl || !summarizeInput.trim()}
                      className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-accent/80 disabled:opacity-40"
                    >
                      {summarizingUrl ? <Loader2 className="size-3 animate-spin" /> : "Go"}
                    </button>
                    <button onClick={() => setSummarizeInput("")} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </div>
                )}
                <div className="relative flex items-end">
                  <div className="absolute left-1.5 bottom-2 flex items-center gap-0.5">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploading}
                      title="Attach files (or drag & drop)"
                      className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      {uploading ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium tabular-nums">
                          <Loader2 className="size-3 animate-spin" />
                          {uploadCount > 1 ? uploadCount : ""}
                        </span>
                      ) : (
                        <Paperclip className="size-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => void handleGenerateImage()}
                      disabled={generating || !input.trim()}
                      title="Generate image with AI (uses your message as prompt — or type /image <prompt>)"
                      className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      {generating ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="size-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        const block = "```desmos\nmode: graphing\nzoom: 10\nexpressions:\n\n```";
                        setInput((prev) =>
                          prev.trim()
                            ? prev.replace(/\s*$/, "\n\n" + block)
                            : block,
                        );
                        inputRef.current?.focus();
                        requestAnimationFrame(() => {
                          const el = inputRef.current;
                          if (!el) return;
                          const pos = el.value.length - 4; // just before the closing fence
                          el.setSelectionRange(pos, pos);
                        });
                      }}
                      disabled={sending || editingId !== null}
                      title="Insert a Desmos graph block — type an expression like y = x^2 inside, Jarvis plots it live"
                      className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      <FunctionSquare className="size-3.5" />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          disabled={sending || editingId !== null}
                          title="More calculators — 3D graph, scientific, geometry"
                          className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                        >
                          <ChevronDown className="size-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => insertDesmosBlock("3d")}>
                          <Box className="size-3.5" />
                          3D graph — z = f(x, y)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("scientific")}>
                          <Calculator className="size-3.5" />
                          Scientific calculator
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("fourfunction")}>
                          <Equal className="size-3.5" />
                          Four-function calculator
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("geometry")}>
                          <Shapes className="size-3.5" />
                          Geometry tool
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      recorder.recording
                        ? "Listening… click the stop square when done."
                        : editingId
                          ? "Edit your message and press Enter…"
                          : deepResearch
                            ? "Research anything on the live web…"
                            : "Message Jarvis…"
                    }
                    rows={1}
                    className="max-h-40 w-full resize-none bg-transparent pl-20 pr-24 py-3 text-sm outline-none placeholder:text-muted-foreground/70"
                  />
                <div className="absolute right-2 bottom-2 flex items-center gap-1">
                  <button
                    onClick={() =>
                      recorder.recording
                        ? recorder.stop()
                        : void recorder.start()
                    }
                    disabled={sending || transcribing}
                    title={
                      recorder.recording
                        ? "Stop recording"
                        : "Record voice note"
                    }
                    className={`inline-flex size-7 items-center justify-center rounded-lg transition-colors ${
                      recorder.recording
                        ? "bg-destructive text-white"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    } disabled:opacity-40`}
                  >
                    {transcribing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : recorder.recording ? (
                      <Square className="size-3" />
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => (live.active ? live.stop() : live.start())}
                    disabled={sending && !live.active}
                    title={live.active ? "Stop Live Mode" : "Live voice conversation (hands-free)"}
                    className={`inline-flex size-7 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
                      live.active
                        ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <Radio className={`size-3.5 ${live.active ? "animate-pulse" : ""}`} />
                  </button>
                  <Button
                    size="icon-sm"
                    onClick={() => void runSend()}
                    data-send-button
                    disabled={(!input.trim() && pendingImages.length === 0 && !pendingFile) || sending}
                    className="size-7 rounded-lg"
                  >
                    {sending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowUp className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              </div>
              {live.active && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs">
                  <Radio className={`size-3.5 text-red-500 ${live.speaking ? "" : "animate-pulse"}`} />
                  {live.speaking ? (
                    <span className="text-foreground">Jarvis speaking — interrupt anytime, just talk…</span>
                  ) : live.processing ? (
                    <span className="text-foreground">Thinking…</span>
                  ) : live.listening ? (
                    <span>
                      Listening
                      <span className="ml-2 inline-flex gap-0.5">
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className="inline-block h-2.5 w-0.5 rounded-full bg-red-500"
                            style={{
                              opacity: 0.35 + Math.min(0.65, live.level * 3),
                              transform: `scaleY(${0.5 + Math.min(1.2, live.level * 6)})`,
                              transition: "transform 90ms linear",
                            }}
                          />
                        ))}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Live mode — say something</span>
                  )}
                  <button
                    onClick={live.stop}
                    className="ml-auto rounded px-1.5 py-0.5 font-medium text-red-500 transition-colors hover:bg-red-500/10"
                  >
                    End
                  </button>
                </div>
              )}
              {live.error && (
                <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {live.error}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                {recorder.recording ? (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
                    Recording{" "}
                    {Math.floor(recorder.seconds / 60)}:
                    {String(recorder.seconds % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="hidden sm:inline">
                    Enter to send · Shift+Enter for newline
                  </span>
                )}
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
      <Lightbox
        images={lightbox?.images ?? []}
        startIndex={lightbox?.index ?? 0}
        alt="Chat image"
        onClose={() => setLightbox(null)}
      />
    </TooltipProvider>
  );
}
