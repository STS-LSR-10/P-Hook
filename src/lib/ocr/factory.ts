import { createSlipReaderChain } from "./chain";
import { createSlipOcrProvider, type AiProviderName, type SlipOcrProvider } from "./provider";

const AI_NAMES: AiProviderName[] = ["gemini", "anthropic", "openai"];

/** Readers that can be named in SLIP_READERS: the AI models (slips are read by AI only). */
export const READER_NAMES = AI_NAMES;
export type ReaderName = AiProviderName;

export interface ReaderEnv {
  AI_PROVIDER: AiProviderName;
  AI_MODEL?: string;
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /** Comma-separated override of the order, e.g. "anthropic,gemini". */
  SLIP_READERS?: string;
}

/** Default order: the chosen AI model, then the other configured AI models. */
export function readerOrder(env: ReaderEnv): ReaderName[] {
  const override = env.SLIP_READERS?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ReaderName => (READER_NAMES as readonly string[]).includes(s));
  if (override && override.length > 0) return [...new Set(override)];

  const ai = [env.AI_PROVIDER, ...AI_NAMES.filter((n) => n !== env.AI_PROVIDER)];
  return ai;
}

export interface BuiltReader {
  reader: SlipOcrProvider;
  /** Names actually in the chain, in order. */
  active: ReaderName[];
  /** Names in the order that were left out (no key). */
  skipped: ReaderName[];
}

export function buildSlipReader(
  env: ReaderEnv,
  options: {
    fetchImpl?: typeof fetch;
    onSkip?: (readerName: string, reason: string) => void;
  } = {},
): BuiltReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const aiKey: Record<AiProviderName, string | undefined> = {
    gemini: env.GEMINI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
  };

  const readers: SlipOcrProvider[] = [];
  const active: ReaderName[] = [];
  const skipped: ReaderName[] = [];

  for (const name of readerOrder(env)) {
    const apiKey = aiKey[name];
    if (apiKey) {
      readers.push(
        createSlipOcrProvider(
          { provider: name, apiKey, model: name === env.AI_PROVIDER ? env.AI_MODEL : undefined },
          fetchImpl,
        ),
      );
      active.push(name);
    } else {
      skipped.push(name);
    }
  }

  if (readers.length === 0) throw new Error("no slip reader is configured");
  return {
    reader: createSlipReaderChain(readers, { onSkip: options.onSkip }),
    active,
    skipped,
  };
}
