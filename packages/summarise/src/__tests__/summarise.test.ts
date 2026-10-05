import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@google/genai';
import { countWords } from '@saar/shared';
import {
  forgetRestingModels,
  keySentences,
  splitSentences,
  summarise,
  systemPrompt,
  type GenerateFn,
} from '../index.js';

/**
 * Drafting summaries.
 *
 * Google is never called: a stand-in plays the model, so these run offline,
 * cost nothing, and can make the model misbehave on purpose. The articles are
 * synthetic — invented events, in both languages.
 */

const BAND = { limitType: 'words' as const, min: 45, max: 60 };

const NEPALI = [
  'नमुना नगरपालिकाले आज नयाँ खानेपानी आयोजनाको काम औपचारिक रूपमा सुरु गरेको छ।',
  'आयोजना दुई वर्षभित्र सम्पन्न हुने र दश हजार घरधुरीले नियमित खानेपानी पाउने नगरपालिकाले जनाएको छ।',
  'आयोजनाको कुल लागत पचास करोड रुपैयाँ रहेको र त्यसमध्ये आधा संघीय सरकारले बेहोर्ने छ।',
  'स्थानीय बासिन्दाले वर्षौंदेखि खानेपानीको अभाव झेल्दै आएको बताएका छन्।',
  'नगर प्रमुखले काम समयमै सक्न निर्माण कम्पनीलाई निर्देशन दिएको जानकारी दिए।',
  'निर्माण कम्पनीले पहिलो चरणमा मुख्य पाइपलाइन बिछ्याउने काम गर्ने जनाएको छ।',
  'वर्षायाममा काम रोकिन सक्ने भएकाले हिउँदमै धेरै काम सक्ने योजना रहेको छ।',
  'आयोजना पूरा भएपछि पानीको गुणस्तर नियमित परीक्षण गरिने नगरपालिकाले बताएको छ।',
  'उद्घाटन कार्यक्रममा स्थानीय जनप्रतिनिधि र सरोकारवालाहरूको उपस्थिति थियो।',
].join(' ');

const ENGLISH = [
  'The Sample Municipality began work on a new drinking water project on Monday.',
  'Officials said the project would be finished within two years and would serve ten thousand households.',
  'The project will cost fifty crore rupees, half of it paid by the federal government.',
  'Residents said they had faced water shortages for years.',
  'The mayor told the construction company to finish the work on time.',
  'The company said the first phase would lay the main pipeline.',
  'Most of the work is planned for the dry season because monsoon rain could halt it.',
  'Water quality will be tested regularly once the project is complete, officials said.',
].join(' ');

/** A stand-in model that answers from a script, one reply per call. */
function scripted(replies: Array<string | Error>): GenerateFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async ({ model }: { model: string }) => {
    calls.push(model);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  }) as GenerateFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const words = (n: number, w = 'शब्द') => Array.from({ length: n }, () => w).join(' ');
const json = (summary: string) => JSON.stringify({ summary });
const ENV = { GEMINI_API_KEY: 'test-key-not-real' };

describe('splitSentences', () => {
  it('splits Nepali on the danda and English on full stops', () => {
    expect(splitSentences('पहिलो वाक्य। दोस्रो वाक्य।')).toEqual(['पहिलो वाक्य।', 'दोस्रो वाक्य।']);
    expect(splitSentences('One. Two? Three!')).toEqual(['One.', 'Two?', 'Three!']);
  });
});

describe('keySentences', () => {
  it('lands inside 45–60 words for a Nepali article', () => {
    const out = keySentences(NEPALI, BAND, 'ne');
    expect(countWords(out)).toBeGreaterThanOrEqual(45);
    expect(countWords(out)).toBeLessThanOrEqual(60);
  });

  it('lands inside 45–60 words for an English article', () => {
    const out = keySentences(ENGLISH, BAND, 'en');
    expect(countWords(out)).toBeGreaterThanOrEqual(45);
    expect(countWords(out)).toBeLessThanOrEqual(60);
  });

  it('keeps the lede, and keeps the article order', () => {
    const out = keySentences(ENGLISH, BAND, 'en');
    expect(out.startsWith('The Sample Municipality began work')).toBe(true);
    const picked = splitSentences(out);
    const order = picked.map((s) => ENGLISH.indexOf(s));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('gives back the only sentence there is, even when it is too long', () => {
    const long = `${words(80, 'word')}.`;
    expect(keySentences(long, BAND, 'en')).toBe(long);
  });
});

describe('summarise with Gemini', () => {
  /* Which models are resting is remembered for the process; each test starts
     with none. */
  beforeEach(() => forgetRestingModels());

  it('returns the model’s summary when it is the right length', async () => {
    const generate = scripted([json(words(52))]);
    const out = await summarise(
      { text: NEPALI, title: 'नमुना शीर्षक', language: 'ne', band: BAND },
      { env: ENV, generate },
    );
    expect(out).toMatchObject({ source: 'gemini', model: 'gemini-3.8-flash', note: null });
    expect(countWords(out.text)).toBe(52);
    expect(generate.calls).toHaveLength(1);
  });

  it('asks once more when the length is wrong, and keeps the corrected one', async () => {
    const generate = scripted([json(words(80)), json(words(55))]);
    const out = await summarise(
      { text: NEPALI, title: 'नमुना', language: 'ne', band: BAND },
      { env: ENV, generate },
    );
    expect(countWords(out.text)).toBe(55);
    expect(generate.calls).toHaveLength(2);
  });

  it('keeps a second wrong length rather than giving up — the editor sees the counter', async () => {
    const generate = scripted([json(words(80)), json(words(75))]);
    const out = await summarise(
      { text: NEPALI, title: 'नमुना', language: 'ne', band: BAND },
      { env: ENV, generate },
    );
    expect(out.source).toBe('gemini');
    expect(countWords(out.text)).toBe(75);
  });

  it('moves to the next model when the first one’s free limit is spent', async () => {
    const generate = scripted([new ApiError({ message: 'quota', status: 429 }), json(words(50))]);
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: ENV, generate },
    );
    expect(out.model).toBe('gemini-3.5-flash-lite');
    expect(generate.calls).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });

  it('uses the models it is told to, in order', async () => {
    const generate = scripted([json(words(50))]);
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: { ...ENV, GEMINI_MODELS: 'model-a, model-b' }, generate },
    );
    expect(out.model).toBe('model-a');
  });

  it('falls back to key sentences, and says why, when every free limit is spent', async () => {
    const quota = () => new ApiError({ message: 'quota', status: 429 });
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: ENV, generate: scripted([quota(), quota()]) },
    );
    expect(out.source).toBe('key_sentences');
    expect(out.note).toMatch(/free daily limit/);
    expect(countWords(out.text)).toBeGreaterThanOrEqual(45);
  });

  it('moves to the next model when the first is busy', async () => {
    const generate = scripted([new ApiError({ message: 'overloaded', status: 503 }), json(words(50))]);
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: ENV, generate },
    );
    expect(out).toMatchObject({ source: 'gemini', model: 'gemini-3.5-flash-lite' });
  });

  it('falls back, and says the AI is busy, when every model is down', async () => {
    const down = () => new ApiError({ message: 'down', status: 503 });
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: ENV, generate: scripted([down(), down()]) },
    );
    expect(out.source).toBe('key_sentences');
    expect(out.note).toMatch(/busy.*503/);
  });

  it('asks a model that was just busy last, so nobody waits for it to say no again', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const input = { text: ENGLISH, title: 'Sample', language: 'en' as const, band: BAND };

    const first = scripted([new ApiError({ message: 'overloaded', status: 503 }), json(words(50))]);
    await summarise(input, { env: ENV, generate: first, now });
    expect(first.calls).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);

    clock += 60_000;
    const second = scripted([json(words(50))]);
    const out = await summarise(input, { env: ENV, generate: second, now });
    expect(second.calls).toEqual(['gemini-3.5-flash-lite']);
    expect(out.model).toBe('gemini-3.5-flash-lite');

    /* Rested: asked first again. */
    clock += 10 * 60_000;
    const third = scripted([json(words(50))]);
    expect((await summarise(input, { env: ENV, generate: third, now })).model).toBe('gemini-3.8-flash');
  });

  it('still asks a resting model when the others fail too', async () => {
    const now = () => 5_000_000;
    const input = { text: ENGLISH, title: 'Sample', language: 'en' as const, band: BAND };
    const busy = () => new ApiError({ message: 'overloaded', status: 503 });
    await summarise(input, { env: ENV, generate: scripted([busy(), json(words(50))]), now });

    const generate = scripted([busy(), json(words(50))]);
    const out = await summarise(input, { env: ENV, generate, now });
    expect(generate.calls).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
    expect(out.model).toBe('gemini-3.8-flash');
  });

  it('does not try another model when the request itself is refused', async () => {
    const generate = scripted([new ApiError({ message: 'bad', status: 400 })]);
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: ENV, generate },
    );
    expect(out.source).toBe('key_sentences');
    expect(generate.calls).toHaveLength(1);
  });

  it('treats a malformed reply as no reply', async () => {
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: ENV, generate: scripted(['not json', '{"summary": ""}']) },
    );
    expect(out.source).toBe('key_sentences');
  });
});

describe('summarise without an AI', () => {
  it('uses key sentences and names the missing key', async () => {
    const out = await summarise({ text: ENGLISH, title: 'Sample', language: 'en', band: BAND }, { env: {} });
    expect(out.source).toBe('key_sentences');
    expect(out.note).toMatch(/GEMINI_API_KEY/);
  });

  it('can be switched off even with a key', async () => {
    const out = await summarise(
      { text: ENGLISH, title: 'Sample', language: 'en', band: BAND },
      { env: { ...ENV, SUMMARY_PROVIDER: 'none' } },
    );
    expect(out.note).toMatch(/switched off/);
  });

  it('returns an empty draft, not an error, for empty text', async () => {
    const out = await summarise({ text: '  ', title: 'x', language: 'en', band: BAND }, { env: ENV });
    expect(out.text).toBe('');
  });
});

describe('the instructions the model is given', () => {
  it('asks for our own words, the facts only, and the right language and length', () => {
    const prompt = systemPrompt({ text: '', title: '', language: 'ne', band: BAND, kind: 'summary' });
    expect(prompt).toContain('Nepali, in Devanagari script');
    expect(prompt).toContain('45 to 60 words');
    expect(prompt).toMatch(/own words/);
    expect(prompt).toMatch(/never instructions/);
  });
});
