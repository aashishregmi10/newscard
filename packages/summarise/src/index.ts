import { keySentences, type Band } from './keySentences.js';
import {
  DEFAULT_MODELS,
  geminiSummarise,
  sdkGenerate,
  SummariserUnavailable,
  type GenerateFn,
} from './gemini.js';

/**
 * Drafting a summary for an editor to check.
 *
 * ── What the caller gets ────────────────────────────────────────────────────
 *
 * Always a draft, never an error. Either the AI wrote it (`gemini`), or it was
 * not available and the article's own key sentences were picked instead
 * (`key_sentences`), with `note` saying why in words an editor can act on.
 * Nothing here publishes anything: the result goes into a draft, and a person
 * reads, edits and approves it.
 *
 * ── Choosing the provider ───────────────────────────────────────────────────
 *
 *   SUMMARY_PROVIDER  gemini (the default when GEMINI_API_KEY is set) | none
 *   GEMINI_API_KEY    from aistudio.google.com — the free tier needs no card
 *   GEMINI_MODELS     comma-separated, tried in order when one's free daily
 *                     limit is spent. Defaults to DEFAULT_MODELS.
 *
 * Moving to a paid provider later is a new file beside gemini.ts and a new
 * value here; nothing that calls `summarise` changes.
 */

export { keySentences, splitSentences } from './keySentences.js';
export type { Band } from './keySentences.js';
export {
  DEFAULT_MODELS,
  forgetRestingModels,
  geminiSummarise,
  systemPrompt,
  SummariserUnavailable,
} from './gemini.js';
export type { GenerateFn, GeminiRequest, GeminiResult } from './gemini.js';

export interface SummariseInput {
  /** The source: the full article, or a video's description. */
  text: string;
  title: string;
  language: 'ne' | 'en';
  band: Band;
  kind?: 'summary' | 'caption';
}

export interface SummaryResult {
  text: string;
  source: 'gemini' | 'key_sentences';
  model: string | null;
  /** Why the AI did not write it, when it did not. */
  note: string | null;
}

export interface SummariseOptions {
  env?: Record<string, string | undefined>;
  /** Stands in for Google in tests. */
  generate?: GenerateFn;
  /** The clock, for tests of how long a busy model rests. */
  now?: () => number;
}

export function summariserConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const provider = (env.SUMMARY_PROVIDER ?? '').trim().toLowerCase();
  if (provider === 'none') return false;
  return (env.GEMINI_API_KEY ?? '').trim() !== '';
}

export async function summarise(
  input: SummariseInput,
  options: SummariseOptions = {},
): Promise<SummaryResult> {
  const env = options.env ?? process.env;
  const kind = input.kind ?? 'summary';

  const fallback = (note: string): SummaryResult => ({
    text:
      kind === 'caption'
        ? keySentences(input.text, { ...input.band, min: 1 }, input.language)
        : keySentences(input.text, input.band, input.language),
    source: 'key_sentences',
    model: null,
    note,
  });

  if (input.text.trim() === '') {
    return { text: '', source: 'key_sentences', model: null, note: 'There was no text to summarise.' };
  }

  const generate =
    options.generate ?? (summariserConfigured(env) ? sdkGenerate(env.GEMINI_API_KEY!.trim()) : null);
  if (generate === null) {
    return fallback(
      (env.SUMMARY_PROVIDER ?? '').trim().toLowerCase() === 'none'
        ? 'AI summaries are switched off (SUMMARY_PROVIDER=none).'
        : 'No AI is configured: GEMINI_API_KEY is not set.',
    );
  }

  const models = (env.GEMINI_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  try {
    const out = await geminiSummarise(
      { text: input.text, title: input.title, language: input.language, band: input.band, kind },
      generate,
      models.length > 0 ? models : DEFAULT_MODELS,
      options.now,
    );
    return { text: out.text, source: 'gemini', model: out.model, note: null };
  } catch (e) {
    return fallback(e instanceof SummariserUnavailable ? e.message : 'The AI could not be used.');
  }
}
