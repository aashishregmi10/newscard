import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ArticleCardDto, AdCardDto, VideoCardDto, VideoRendition } from '@saar/schemas';

/**
 * Generate the mobile app's DTO types from the Zod schemas.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `packages/schemas` is the single source of truth for the data model, and that
 * held everywhere except the largest consumer. `apps/mobile` is deliberately
 * NOT an npm workspace — Metro resolves modules by walking up from the project
 * root, and a hoisted install would give it two copies of React — so it cannot
 * import @saar/schemas, and it declared its own `Card`, `AdCard` and
 * `VideoCard` by hand instead.
 *
 * Those copies agreed with the server field for field, because someone
 * remembered. Nothing failed if someone forgot. Every one of these passed
 * typecheck, lint and CI while being wrong:
 *
 *   - the server adds a field        -> mobile silently never reads it
 *   - a field becomes non-nullable   -> mobile keeps a dead null check
 *   - a field becomes nullable       -> mobile crashes on a real card, in
 *                                       production, on a handset nobody can
 *                                       reach
 *
 * ── Why generated types rather than a shared import ─────────────────────────
 *
 * The emitted file has NO imports at all. That matters: a type-only import
 * would still make TypeScript resolve `zod` from inside apps/mobile, which does
 * not have it, and a runtime import would hand Metro a second React. Plain
 * interfaces with no dependencies cross the boundary that a module cannot.
 *
 * ── Why the schema is read rather than described ────────────────────────────
 *
 * This walks the actual Zod definitions at runtime. It is not a second
 * description of the model that could itself drift — if it cannot express a
 * construct it throws, rather than emitting something plausible and wrong.
 *
 * ── Build order matters ─────────────────────────────────────────────────────
 *
 * This imports @saar/schemas, whose package main points at dist/ — so it reads
 * the BUILT schemas, not the sources. Run it after `npm run typecheck` (which
 * is `tsc -b`, and builds them). Run it against a stale dist/ and it cheerfully
 * reports that everything is up to date, which is the one answer it must never
 * give wrongly.
 *
 * Run: npm run gen:types      (CI re-runs it and fails if the output differs)
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'apps', 'mobile', 'src', 'api', 'generated');
const OUT_FILE = join(OUT_DIR, 'dto.ts');

/** Schemas that get their own named interface rather than being inlined. */
const NAMED = new Map<z.ZodTypeAny, string>([
  [VideoRendition, 'VideoRendition'],
  [ArticleCardDto, 'ArticleCardDto'],
  [AdCardDto, 'AdCardDto'],
  [VideoCardDto, 'VideoCardDto'],
]);

/**
 * Render one schema as a TypeScript type expression.
 *
 * `topLevel` suppresses the name lookup for the schema currently being declared
 * — without it, `interface ArticleCardDto` would emit as `= ArticleCardDto`.
 */
function render(schema: z.ZodTypeAny, indent: string, topLevel = false): string {
  if (!topLevel) {
    const named = NAMED.get(schema);
    if (named) return named;
  }

  const def = schema._def as { typeName: string; [k: string]: unknown };

  switch (def.typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';

    case 'ZodLiteral':
      return JSON.stringify((def as { value: unknown }).value);

    case 'ZodEnum':
      return (def as { values: string[] }).values.map((v) => JSON.stringify(v)).join(' | ');

    case 'ZodNullable':
      return `${render((def as { innerType: z.ZodTypeAny }).innerType, indent)} | null`;

    // The `?` is added by the object renderer; here we only unwrap.
    case 'ZodOptional':
      return render((def as { innerType: z.ZodTypeAny }).innerType, indent);

    case 'ZodDefault':
      return render((def as { innerType: z.ZodTypeAny }).innerType, indent);

    case 'ZodArray': {
      const inner = render((def as { type: z.ZodTypeAny }).type, indent);
      // Parenthesise unions so `A | null[]` cannot be produced.
      return /[|&]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
    }

    case 'ZodUnion':
      return (def as { options: z.ZodTypeAny[] }).options
        .map((o) => render(o, indent))
        .join(' | ');

    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const next = indent + '  ';
      const lines = Object.entries(shape).map(([key, value]) => {
        const v = value as z.ZodTypeAny;
        const optional = v._def.typeName === 'ZodOptional' || v.isOptional();
        return `${next}${key}${optional ? '?' : ''}: ${render(v, next)};`;
      });
      return `{\n${lines.join('\n')}\n${indent}}`;
    }

    default:
      // Loudly, rather than emitting something plausible and wrong.
      throw new Error(
        `gen-client-types: no TypeScript rendering for ${def.typeName}. ` +
          `Add a case above — do not hand-edit the generated file.`,
      );
  }
}

function declare(name: string, schema: z.ZodTypeAny, doc: string): string {
  return `${doc}\nexport interface ${name} ${render(schema, '', true)}\n`;
}

const banner = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced from packages/schemas by \`npm run gen:types\`, which CI re-runs and
 * compares. Editing this by hand reintroduces exactly the drift it exists to
 * prevent: the server's shape and the app's belief about it diverging silently.
 *
 * To change a shape, change the Zod schema and regenerate.
 */
`;

const body = [
  banner,
  declare(
    'VideoRendition',
    VideoRendition,
    '/** One encoded size of a short video. The CLIENT picks which to play. */',
  ),
  declare(
    'ArticleCardDto',
    ArticleCardDto,
    '/** A story as the feed returns it. Mirrors GET /v1/feed items. */',
  ),
  declare(
    'AdCardDto',
    AdCardDto,
    '/** A sponsored card. Discriminated from editorial on `kind`. */',
  ),
  declare('VideoCardDto', VideoCardDto, '/** A short, as GET /v1/videos returns it. */'),
].join('\n');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const previous = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : null;
writeFileSync(OUT_FILE, body, 'utf8');

if (previous === body) {
  console.log('client types are up to date');
} else {
  console.log(`wrote ${OUT_FILE.replace(ROOT, '.')}`);
  if (previous !== null && process.env.CI) {
    console.error(
      '\nThe generated client types did not match the committed ones.\n' +
        'A schema changed without `npm run gen:types` being run.\n' +
        'Run it locally and commit the result.\n',
    );
    process.exit(1);
  }
}
