import { query } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Public client config. Only items that are SAFE to expose in the browser
// (Desmos keys are public client tokens restricted to your registered domain)
// ---------------------------------------------------------------------------

export const desmosApiKey = query({
  args: {},
  handler: async () => {
    return { apiKey: process.env.DESMOS_API_KEY ?? null };
  },
});

export const getConfig = query({
  args: {},
  handler: async () => {
    return {
      desmos: process.env.DESMOS_API_KEY ?? null,
    };
  },
});
