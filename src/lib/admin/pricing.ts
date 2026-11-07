/**
 * Prices used by the admin page to turn usage into money. They are list prices checked on
 * 2026-11-07 and can change: verify against each provider's pricing page.
 */

type EnvSource = Record<string, string | undefined>;

// ---------- AI (USD per 1 million tokens, standard paid tier) ----------

export interface TokenPrice {
  input: number;
  output: number;
}

/** Gemini API paid tier; on the free tier Google charges nothing. Override with AI_PRICES. */
export const AI_PRICES_USD_PER_M: Record<string, TokenPrice> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/**
 * The price table, with AI_PRICES (JSON: {"model": {"input": 0.3, "output": 2.5}}) laid over it for
 * models not listed here or prices that changed. A malformed override is ignored.
 */
export function readAiPrices(source: EnvSource = process.env): Record<string, TokenPrice> {
  const prices = { ...AI_PRICES_USD_PER_M };
  const raw = source.AI_PRICES?.trim();
  if (!raw) return prices;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [model, value] of Object.entries(parsed)) {
      const v = value as Partial<TokenPrice> | null;
      if (
        v &&
        typeof v.input === "number" &&
        typeof v.output === "number" &&
        v.input >= 0 &&
        v.output >= 0
      ) {
        prices[model] = { input: v.input, output: v.output };
      }
    }
  } catch {
    // keep the built-in table
  }
  return prices;
}

/** USD for these tokens, or null when the model has no known price. */
export function aiCostUsd(
  prices: Record<string, TokenPrice>,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = prices[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// ---------- LINE Official Account, Thailand (THB, before 7% VAT) ----------

export interface LinePlan {
  id: "free" | "basic" | "pro";
  name: string;
  included: number;
  feeThb: number;
  extraThb: number;
}

export const LINE_PLANS: LinePlan[] = [
  { id: "free", name: "Free", included: 300, feeThb: 0, extraThb: 0 },
  { id: "basic", name: "Basic", included: 15_000, feeThb: 1_280, extraThb: 0.1 },
  { id: "pro", name: "Pro", included: 35_000, feeThb: 1_780, extraThb: 0.06 },
];

export const THAI_VAT = 0.07;

/**
 * The plan of the OA: LINE_OA_PLAN when set (free | basic | pro), else the plan whose monthly quota
 * is `quotaLimit`. Null when it cannot be told.
 */
export function resolveLinePlan(
  quotaLimit: number | null,
  source: EnvSource = process.env,
): LinePlan | null {
  const forced = source.LINE_OA_PLAN?.trim().toLowerCase();
  if (forced) return LINE_PLANS.find((p) => p.id === forced) ?? null;
  if (quotaLimit === null) return null;
  return LINE_PLANS.find((p) => p.included === quotaLimit) ?? null;
}

export interface LineCost {
  feeThb: number;
  extraMessages: number;
  extraThb: number;
  vatThb: number;
  totalThb: number;
}

/** This month's LINE bill: the plan fee plus messages past the plan's quota, with VAT. */
export function lineCostThb(plan: LinePlan, quotaUsed: number): LineCost {
  const extraMessages = Math.max(0, quotaUsed - plan.included);
  const extraThb = extraMessages * plan.extraThb;
  const vatThb = (plan.feeThb + extraThb) * THAI_VAT;
  return {
    feeThb: plan.feeThb,
    extraMessages,
    extraThb,
    vatThb,
    totalThb: plan.feeThb + extraThb + vatThb,
  };
}

// ---------- Cloudflare R2, Standard storage (USD) ----------

export const R2_PRICES = {
  storagePerGbMonth: 0.015,
  classAPerMillion: 4.5,
  classBPerMillion: 0.36,
  freeStorageGb: 10,
  freeClassA: 1_000_000,
  freeClassB: 10_000_000,
};

const CLASS_A = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

const CLASS_B = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);

/** Which price class an R2 operation falls in. Deletes and aborts are free. */
export function r2OperationClass(actionType: string): "A" | "B" | "free" {
  if (CLASS_A.has(actionType)) return "A";
  if (CLASS_B.has(actionType)) return "B";
  return "free";
}

const GB = 1024 ** 3;

export interface R2Cost {
  storageUsd: number;
  classAUsd: number;
  classBUsd: number;
  totalUsd: number;
}

/**
 * The R2 bill for a month: storage past the free 10 GB (taking today's size as the month's average)
 * and operations past their free allowance. Pass null operations when they are not known.
 */
export function r2CostUsd(bytes: number, classA: number | null, classB: number | null): R2Cost {
  const p = R2_PRICES;
  const storageUsd = Math.max(0, bytes / GB - p.freeStorageGb) * p.storagePerGbMonth;
  const classAUsd =
    classA === null ? 0 : (Math.max(0, classA - p.freeClassA) / 1_000_000) * p.classAPerMillion;
  const classBUsd =
    classB === null ? 0 : (Math.max(0, classB - p.freeClassB) / 1_000_000) * p.classBPerMillion;
  return { storageUsd, classAUsd, classBUsd, totalUsd: storageUsd + classAUsd + classBUsd };
}
