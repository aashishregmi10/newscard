import { describe, expect, it } from 'vitest';
import * as server from '@saar/shared';
import * as composer from '../lib/overlap';

/**
 * The own-words rule, held to the same cases in both of its homes.
 *
 * The server's copy (packages/shared) refuses to publish; the composer's copy
 * warns while the editor types. If they ever disagree, an editor is told their
 * summary is fine and then refused at Publish, or the reverse — so every case
 * runs against both. The text is synthetic.
 */

const ORIGINAL =
  'नमुना नगरपालिकाले आज नयाँ खानेपानी आयोजनाको काम औपचारिक रूपमा सुरु गरेको छ। ' +
  'आयोजना दुई वर्षभित्र सम्पन्न हुने र दश हजार घरधुरीले नियमित खानेपानी पाउने नगरपालिकाले जनाएको छ। ' +
  'आयोजनाको कुल लागत पचास करोड रुपैयाँ रहेको र त्यसमध्ये आधा संघीय सरकारले बेहोर्ने छ।';

const COPIED =
  'नमुना नगरपालिकाले आज नयाँ खानेपानी आयोजनाको काम औपचारिक रूपमा सुरु गरेको छ। ' +
  'आयोजना दुई वर्षभित्र सम्पन्न हुने र दश हजार घरधुरीले नियमित खानेपानी पाउने नगरपालिकाले जनाएको छ।';

const REWRITTEN =
  'दश हजार घरमा नियमित पानी पुर्‍याउने लक्ष्यसहित नमुना नगरपालिकामा खानेपानी आयोजना थालिएको छ। ' +
  'पचास करोडको लागतमध्ये आधा रकम संघीय सरकारले दिनेछ र काम दुई वर्षमा सकिने बताइएको छ।';

const IMPLEMENTATIONS = [
  ['server (packages/shared)', server.copiedShare, server.COPIED_SHARE_LIMIT],
  ['composer (cms-web/lib/overlap)', composer.copiedShare, composer.COPIED_SHARE_LIMIT],
] as const;

describe.each(IMPLEMENTATIONS)('%s', (_name, copiedShare, limit) => {
  it('draws the line at the same place', () => {
    expect(limit).toBe(0.5);
  });

  it('scores a summary pasted from the original as copied', () => {
    expect(copiedShare(COPIED, ORIGINAL)).toBeGreaterThanOrEqual(limit);
  });

  it('scores a summary in its own words as not copied', () => {
    expect(copiedShare(REWRITTEN, ORIGINAL)).toBeLessThan(0.2);
  });

  it('is not fooled by changed punctuation', () => {
    const repunctuated = COPIED.replace(/।/g, ',');
    expect(copiedShare(repunctuated, ORIGINAL)).toBeGreaterThanOrEqual(limit);
  });

  it('cannot judge a summary shorter than one run, and does not try', () => {
    expect(copiedShare('पाँच शब्दको छोटो वाक्य यहाँ', ORIGINAL)).toBe(0);
  });

  it('has nothing to compare against an empty original', () => {
    expect(copiedShare(COPIED, '')).toBe(0);
  });
});

describe('both copies', () => {
  it('give the same share for the same text', () => {
    for (const text of [COPIED, REWRITTEN, `${REWRITTEN} ${COPIED}`]) {
      expect(composer.copiedShare(text, ORIGINAL)).toBe(server.copiedShare(text, ORIGINAL));
    }
  });
});
