/**
 * Forbidden-dependency check.  Spec Ch. 17.4, plan §3 and §9.
 *
 * Two product decisions are enforced here mechanically rather than by memory,
 * because both are the kind of thing that arrives transitively in a dependency
 * upgrade and is never noticed:
 *
 *   1. No advertising, attribution, or session-replay SDK. Year one has no
 *      monetisation (Ch. 1.6), and these libraries are among the largest and
 *      most start-up-expensive in mobile.
 *
 *   2. No LLM or ML runtime. The MVP has no model in the pipeline at all
 *      (Ch. 4.7). The point is not that using one is wrong — it is that having
 *      the SDK present invites someone to switch it on before a human baseline
 *      exists to measure it against.
 *
 * Run: npm run check:forbidden
 */

import { execSync } from 'node:child_process';

interface Rule {
  readonly pattern: RegExp;
  readonly reason: string;
  readonly specRef: string;
}

const RULES: readonly Rule[] = [
  {
    pattern: /^(react-native-)?(google-mobile-ads|admob)|^@react-native-admob|^react-native-fbads/i,
    reason: 'advertising SDK',
    specRef: 'Ch. 1.6 — no monetisation in year one',
  },
  {
    pattern: /^(react-native-)?appsflyer|^branch-sdk|^react-native-branch|^@adjust\//i,
    reason: 'attribution SDK',
    specRef: 'Ch. 15.3 — we do not collect an advertising ID',
  },
  {
    pattern: /^(@sentry\/replay|@fullstory|logrocket|@smartlook|hotjar)/i,
    reason: 'session-replay SDK',
    specRef: 'Ch. 14.7 — replay can capture anything on screen',
  },
  {
    pattern: /^(openai|@anthropic-ai\/|@google\/generative-ai|cohere-ai|@mistralai\/|replicate)/i,
    reason: 'LLM provider SDK',
    specRef: 'Ch. 4.7 — no model in the MVP pipeline',
  },
  {
    pattern: /^(langchain|@langchain\/|llamaindex|@huggingface\/)/i,
    reason: 'LLM orchestration framework',
    specRef: 'Ch. 4.7 — no model in the MVP pipeline',
  },
  {
    pattern: /^(@tensorflow\/|onnxruntime|@xenova\/transformers|brain\.js)/i,
    reason: 'ML runtime',
    specRef: 'plan §3 — clustering is lexical, not learned',
  },
  {
    pattern: /^(chromadb|@pinecone-database\/|weaviate-|@qdrant\/)/i,
    reason: 'vector database',
    specRef: 'plan §3 — no embeddings before ~15 sources',
  },
];

interface DepNode {
  version?: string;
  dependencies?: Record<string, DepNode>;
}

function collect(node: DepNode, out: Map<string, string>, depth = 0): void {
  if (depth > 25 || !node.dependencies) return;
  for (const [name, child] of Object.entries(node.dependencies)) {
    if (!out.has(name)) out.set(name, child.version ?? 'unknown');
    collect(child, out, depth + 1);
  }
}

function main(): void {
  let raw: string;
  // A fixed literal with no interpolation, so there is nothing to inject. This
  // avoids DEP0190, which fires when an ARGUMENT ARRAY is concatenated under
  // shell:true — the resolution that npm.cmd needs on Windows.
  try {
    raw = execSync('npm ls --all --json', {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    // `npm ls` exits non-zero on peer-dependency warnings but still emits JSON.
    raw = (e as { stdout?: string }).stdout ?? '';
    if (!raw) {
      console.error('could not read the dependency tree');
      process.exit(2);
    }
  }

  const tree = JSON.parse(raw) as DepNode;
  const all = new Map<string, string>();
  collect(tree, all);

  const violations: Array<{ name: string; version: string; rule: Rule }> = [];
  for (const [name, version] of all) {
    for (const rule of RULES) {
      if (rule.pattern.test(name)) violations.push({ name, version, rule });
    }
  }

  if (violations.length === 0) {
    console.log(`forbidden-dependency check passed (${all.size} packages scanned)`);
    return;
  }

  console.error('\nFORBIDDEN DEPENDENCIES FOUND\n');
  for (const v of violations) {
    console.error(`  ${v.name}@${v.version}`);
    console.error(`      ${v.rule.reason} — ${v.rule.specRef}\n`);
  }
  console.error(
    'These are excluded by a product decision, not by accident.\n' +
      'If the decision has changed, update RULES in this file in the same pull\n' +
      'request that adds the dependency, so the change is reviewed deliberately.\n',
  );
  process.exit(1);
}

main();
