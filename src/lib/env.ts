import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_LIFF_ID: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  APP_BASE_URL: z.string().url(),
});

export const AI_PROVIDERS = ["gemini", "anthropic", "openai"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

const AI_KEY_BY_PROVIDER = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
} as const satisfies Record<AiProviderName, string>;

// Treat empty strings (e.g. `GEMINI_API_KEY=` in .env) as unset.
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const serverSchema = z
  .object({
    LINE_CHANNEL_ID: z.string().min(1),
    LINE_CHANNEL_SECRET: z.string().min(1),
    LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SESSION_JWT_SECRET: z.string().min(32, "SESSION_JWT_SECRET must be at least 32 chars"),
    // While SESSION_JWT_SECRET is being replaced: the old one, still accepted (never used to sign).
    SESSION_JWT_SECRET_PREVIOUS: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().min(32, "SESSION_JWT_SECRET_PREVIOUS must be at least 32 chars").optional(),
    ),
    CRON_SECRET: z.string().min(1),
    // The LIFF app lives in a LINE Login channel; its id is the `client_id` for ID token
    // verification. Falls back to LINE_CHANNEL_ID when both live in the same channel.
    LINE_LOGIN_CHANNEL_ID: optionalString,
    // AI: pick one provider; only that provider's key is required.
    AI_PROVIDER: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.enum(AI_PROVIDERS).default("gemini"),
    ),
    AI_MODEL: optionalString, // overrides the provider's default model
    // Slips are read by AI only (see src/lib/ocr/factory.ts); optional order, e.g. "anthropic,gemini"
    SLIP_READERS: optionalString,
    GEMINI_API_KEY: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    const keyName = AI_KEY_BY_PROVIDER[env.AI_PROVIDER];
    if (!env[keyName]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [keyName],
        message: `${keyName} is required when AI_PROVIDER=${env.AI_PROVIDER}`,
      });
    }
  });

type EnvSource = Record<string, string | undefined>;

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, source: EnvSource, label: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const keys = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid ${label} environment variables: ${keys}`);
  }
  return result.data;
}

/** Safe on client and server. */
export function getPublicEnv(source: EnvSource = process.env): PublicEnv {
  return parse(publicSchema, source, "public");
}

const supabaseAdminSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * Only what the service-role client needs, so the webhook does not depend on
 * unrelated variables (LIFF id, base URL). Server only.
 */
export function getSupabaseAdminEnv(source: EnvSource = process.env) {
  if (typeof window !== "undefined") {
    throw new Error("getSupabaseAdminEnv() must not be called in the browser");
  }
  return parse(supabaseAdminSchema, source, "supabase");
}

/** Server only. Never import this from client components. */
export function getServerEnv(source: EnvSource = process.env): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must not be called in the browser");
  }
  return parse(serverSchema, source, "server");
}

export interface StripeEnv {
  secretKey: string;
  webhookSecret: string;
  baseUrl: string;
}

/**
 * Stripe settings, or null when payments are not configured (the app then shows "not open yet").
 * Both keys and the public base URL are needed. Server only.
 */
export function getStripeEnv(source: EnvSource = process.env): StripeEnv | null {
  const secretKey = source.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = source.STRIPE_WEBHOOK_SECRET?.trim();
  const baseUrl = source.APP_BASE_URL?.trim();
  if (!secretKey || !webhookSecret || !baseUrl) return null;
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) return null;
  if (!webhookSecret.startsWith("whsec_")) return null;
  return { secretKey, webhookSecret, baseUrl };
}
