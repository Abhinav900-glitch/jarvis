// ---------------------------------------------------------------------------
// Languages & regions — country selection drives Live Mode behavior:
//   • Speech recognition language hint (Groq Whisper is multilingual)
//   • Jarvis's speaking language & persona (Hindi for India, etc.)
//   • TTS voice selection (browser voices matched by lang code)
// Author credit: Abhinav Kumar Dey (India)
// ---------------------------------------------------------------------------

export interface CountryConfig {
  code: string; // ISO country code
  name: string;
  flag: string;
  timezone: string; // default timezone for the region bar
  /** Primary spoken language for STT + persona */
  language: string;
  /** BCP-47 tag for Web Speech + browser TTS voice matching */
  langTag: string;
  /** Language name shown in UI */
  languageName: string;
  /** Persona instruction appended to the system prompt for this region */
  persona: string;
}

export const COUNTRIES: CountryConfig[] = [
  {
    code: "IN",
    name: "India",
    flag: "🇮🇳",
    timezone: "Asia/Kolkata",
    language: "hi",
    langTag: "hi-IN",
    languageName: "Hindi / English",
    persona:
      "The user is in India. Reply in Hindi (Devanagari script) by default, but freely mix English technical terms (Hinglish) the way Indians naturally speak. If the user writes in English, reply in English.",
  },
  {
    code: "US",
    name: "United States",
    flag: "🇺🇸",
    timezone: "America/New_York",
    language: "en",
    langTag: "en-US",
    languageName: "English (US)",
    persona: "The user is in the United States. Reply in American English, use US units (miles, °F) when relevant.",
  },
  {
    code: "GB",
    name: "United Kingdom",
    flag: "🇬🇧",
    timezone: "Europe/London",
    language: "en",
    langTag: "en-GB",
    languageName: "English (UK)",
    persona: "The user is in the United Kingdom. Reply in British English with British spelling and vocabulary.",
  },
  {
    code: "RU",
    name: "Russia",
    flag: "🇷🇺",
    timezone: "Europe/Moscow",
    language: "ru",
    langTag: "ru-RU",
    languageName: "Русский",
    persona:
      "The user is in Russia. Reply in Russian by default. If the user writes in English, reply in English.",
  },
  {
    code: "AU",
    name: "Australia",
    flag: "🇦🇺",
    timezone: "Australia/Sydney",
    language: "en",
    langTag: "en-AU",
    languageName: "English (AU)",
    persona: "The user is in Australia. Reply in Australian English, use metric units.",
  },
  {
    code: "AE",
    name: "UAE",
    flag: "🇦🇪",
    timezone: "Asia/Dubai",
    language: "ar",
    langTag: "ar-AE",
    languageName: "العربية",
    persona:
      "The user is in the UAE. Reply in Arabic by default. If the user writes in English, reply in English.",
  },
  {
    code: "DE",
    name: "Germany",
    flag: "🇩🇪",
    timezone: "Europe/Berlin",
    language: "de",
    langTag: "de-DE",
    languageName: "Deutsch",
    persona:
      "The user is in Germany. Reply in German by default. If the user writes in English, reply in English.",
  },
  {
    code: "FR",
    name: "France",
    flag: "🇫🇷",
    timezone: "Europe/Paris",
    language: "fr",
    langTag: "fr-FR",
    languageName: "Français",
    persona:
      "The user is in France. Reply in French by default. If the user writes in English, reply in English.",
  },
  {
    code: "JP",
    name: "Japan",
    flag: "🇯🇵",
    timezone: "Asia/Tokyo",
    language: "ja",
    langTag: "ja-JP",
    languageName: "日本語",
    persona:
      "The user is in Japan. Reply in Japanese by default. If the user writes in English, reply in English.",
  },
  {
    code: "CN",
    name: "China",
    flag: "🇨🇳",
    timezone: "Asia/Shanghai",
    language: "zh",
    langTag: "zh-CN",
    languageName: "中文",
    persona:
      "The user is in China. Reply in Simplified Chinese by default. If the user writes in English, reply in English.",
  },
  {
    code: "BR",
    name: "Brazil",
    flag: "🇧🇷",
    timezone: "America/Sao_Paulo",
    language: "pt",
    langTag: "pt-BR",
    languageName: "Português (BR)",
    persona:
      "The user is in Brazil. Reply in Brazilian Portuguese by default. If the user writes in English, reply in English.",
  },
  {
    code: "ES",
    name: "Spain",
    flag: "🇪🇸",
    timezone: "Europe/Madrid",
    language: "es",
    langTag: "es-ES",
    languageName: "Español",
    persona:
      "The user is in Spain. Reply in Spanish by default. If the user writes in English, reply in English.",
  },
  {
    code: "SG",
    name: "Singapore",
    flag: "🇸🇬",
    timezone: "Asia/Singapore",
    language: "en",
    langTag: "en-SG",
    languageName: "English (SG)",
    persona: "The user is in Singapore. Reply in English.",
  },
  {
    code: "NZ",
    name: "New Zealand",
    flag: "🇳🇿",
    timezone: "Pacific/Auckland",
    language: "en",
    langTag: "en-NZ",
    languageName: "English (NZ)",
    persona: "The user is in New Zealand. Reply in English.",
  },
];

export const DEFAULT_COUNTRY = "IN";

export function getCountry(code: string | null | undefined): CountryConfig {
  return (
    COUNTRIES.find((c) => c.code === code) ??
    COUNTRIES.find((c) => c.code === DEFAULT_COUNTRY)!
  );
}

/** Author metadata — shown on the landing page and app footer. */
export const AUTHOR = {
  name: "Abhinav Kumar Dey",
  country: "India",
  flag: "🇮🇳",
  role: "Creator of Jarvis AI",
} as const;
