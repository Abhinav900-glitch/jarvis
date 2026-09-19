import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Client-side Perchance image generation needs two credentials in the
 * browser:
 *  - CORSPROXY_API_KEY: corsproxy.io's free tier only serves browser
 *    requests, so the Perchance calls must run client-side — proxied
 *    through corsproxy.io to get past Perchance's Cloudflare challenge.
 *  - PERCHANCE_USER_KEY: a VERIFIED 64-hex userKey from perchance.org
 *    (grabbed from the api/generate request in DevTools while generating
 *    an image there). Keys stay valid for a while; refresh when expired.
 *
 * Auth-gated so only signed-in users of this app can read them.
 */
export const getPerchanceKeys = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { corsproxyKey: null, perchanceKey: null };
    }
    return {
      corsproxyKey: process.env.CORSPROXY_API_KEY ?? null,
      perchanceKey: process.env.PERCHANCE_USER_KEY ?? null,
    };
  },
});
