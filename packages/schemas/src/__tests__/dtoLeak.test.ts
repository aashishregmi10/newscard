import { describe, it, expect } from 'vitest';
import { Article, ArticleCardDto, ARTICLE_CARD_KEYS, canTransition } from '../article.js';

/**
 * Spec Ch. 6.3. These tests exist so that adding a field to the Article schema
 * cannot silently expose it on a public endpoint. If someone adds a sensitive
 * field and does not think about the DTO, this fails.
 */

const INTERNAL_FIELDS = [
  'editorialNotes',
  'reviewedBy',
  'authoredBy',
  'retractionReason',
  'spikeReason',
  'selfApproved',
  'revisionCount',
  'draftSource',
  'status',
  'scheduledFor',
  'possibleDuplicate',
  'possibleLanguageMismatch',
  'clusterId',
  'summaryWordCount',
  'summaryCharCount',
];

describe('card DTO does not leak internal fields', () => {
  it.each(INTERNAL_FIELDS)('%s is absent from the public card', (field) => {
    expect(ARTICLE_CARD_KEYS).not.toContain(field);
  });

  it('has exactly the expected key set', () => {
    // A snapshot of intent. Changing this list is a deliberate act that shows up
    // in review, which is the point.
    expect(ARTICLE_CARD_KEYS).toEqual(
      [
        'author',
        'category',
        'headline',
        'id',
        'image',
        'language',
        'originatingAgency',
        'publishedAt',
        'publisherUrl',
        'pullQuote',
        'slug',
        'source',
        'sourcePublishedAt',
        'summary',
      ].sort(),
    );
  });

  it('every internal field named here actually exists on Article — otherwise the test is vacuous', () => {
    const articleKeys = Object.keys(Article.shape);
    for (const f of INTERNAL_FIELDS) {
      expect(articleKeys).toContain(f);
    }
  });
});

describe('article state machine', () => {
  it('allows the documented happy path', () => {
    expect(canTransition('draft', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'approved')).toBe(true);
    expect(canTransition('approved', 'published')).toBe(true);
    expect(canTransition('approved', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'published')).toBe(true);
  });

  it('allows rejection back to draft', () => {
    expect(canTransition('in_review', 'draft')).toBe(true);
  });

  it('never allows publishing straight from draft — the human boundary', () => {
    expect(canTransition('draft', 'published')).toBe(false);
    expect(canTransition('draft', 'approved')).toBe(false);
  });

  it('treats spiked and retracted as terminal', () => {
    expect(canTransition('spiked', 'draft')).toBe(false);
    expect(canTransition('spiked', 'published')).toBe(false);
    expect(canTransition('retracted', 'published')).toBe(false);
    expect(canTransition('retracted', 'draft')).toBe(false);
  });

  it('allows retraction only from published', () => {
    expect(canTransition('published', 'retracted')).toBe(true);
    expect(canTransition('draft', 'retracted')).toBe(false);
    expect(canTransition('approved', 'retracted')).toBe(false);
  });

  it('does not allow a published article to be un-published', () => {
    // Users may have it cached, shared, or bookmarked. Retraction is the only
    // exit, and the client understands it (Ch. 3.3.2).
    expect(canTransition('published', 'draft')).toBe(false);
    expect(canTransition('published', 'spiked')).toBe(false);
  });
});
