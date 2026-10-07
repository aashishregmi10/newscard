import { describe, expect, it } from 'vitest';
import * as server from '@saar/shared';
import * as site from '../lib/interactions';

/**
 * The Interaction rules, held to the same cases in both of their homes.
 *
 * The server's copy (packages/shared) refuses to save; the site's copy marks
 * fields while the editor types. If they disagree, an editor is told a vote is
 * fine and then refused at Save, or the reverse — so every case runs against
 * both. Names are synthetic.
 */

const photo = { credit: 'नमुना फोटो' };
const base: server.InteractionShape = {
  type: 'vote',
  title: 'नमुना: कुन पसल राम्रो?',
  options: [
    { name: 'नमुना एक', detail: null, image: photo },
    { name: 'नमुना दुई', detail: 'ठमेल', image: photo },
  ],
  opensAt: null,
  closesAt: '2026-12-01T00:00:00Z',
};

const CASES: Array<[string, server.InteractionShape]> = [
  ['a complete vote', base],
  ['an empty title', { ...base, title: '  ' }],
  ['a title too long', { ...base, title: 'क'.repeat(121) }],
  ['one candidate', { ...base, options: base.options.slice(0, 1) }],
  [
    'five candidates',
    { ...base, options: ['क', 'ख', 'ग', 'घ', 'ङ'].map((n) => ({ name: `नमुना ${n}`, detail: null, image: photo })) },
  ],
  [
    'the same name twice',
    { ...base, options: [base.options[0]!, { ...base.options[1]!, name: ' नमुना  एक ' }] },
  ],
  ['a candidate without a photo', { ...base, options: [base.options[0]!, { ...base.options[1]!, image: null }] }],
  ['a photo without a credit', { ...base, options: [base.options[0]!, { ...base.options[1]!, image: { credit: '' } }] }],
  ['a detail too long', { ...base, options: [base.options[0]!, { ...base.options[1]!, detail: 'x'.repeat(61) }] }],
  ['no closing date', { ...base, closesAt: null }],
  ['closing before opening', { ...base, opensAt: '2026-12-02T00:00:00Z' }],
  [
    'a rating with seven options',
    {
      ...base,
      type: 'rating',
      closesAt: null,
      options: Array.from({ length: 7 }, (_, i) => ({ name: `Sample ${i + 1}`, detail: null, image: null })),
    },
  ],
  [
    'a rating without photos',
    { ...base, type: 'rating', closesAt: null, options: base.options.map((o) => ({ ...o, image: null })) },
  ],
];

describe('interactionProblems — server and site agree', () => {
  it.each(CASES)('%s', (_label, shape) => {
    expect(site.interactionProblems(shape)).toEqual(server.interactionProblems(shape));
  });

  it('uses the same limits', () => {
    expect(site.INTERACTION_LIMITS).toEqual(server.INTERACTION_LIMITS);
  });
});
