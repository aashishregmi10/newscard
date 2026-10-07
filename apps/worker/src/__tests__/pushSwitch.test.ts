import { afterEach, describe, expect, it } from 'vitest';
import { PUSH_DISABLED_MESSAGE, pushEnabled, sendPush } from '../push/expoPush.js';

/**
 * The kill switch: nothing reaches Expo unless NOTIFICATIONS_ENABLED is
 * exactly "true". A development machine shares a database holding real
 * devices' tokens; a test send from it must go nowhere, and say so.
 */

const target = {
  deviceId: 'device-1',
  token: 'ExponentPushToken[sample-not-real]',
  title: 'नमुना',
  body: 'Sample',
  data: { articleId: 'x' },
};

const before = process.env.NOTIFICATIONS_ENABLED;
afterEach(() => {
  if (before === undefined) delete process.env.NOTIFICATIONS_ENABLED;
  else process.env.NOTIFICATIONS_ENABLED = before;
});

describe('the push kill switch', () => {
  it('is off unless set to exactly "true"', () => {
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      if (v === undefined) delete process.env.NOTIFICATIONS_ENABLED;
      else process.env.NOTIFICATIONS_ENABLED = v;
      expect(pushEnabled()).toBe(false);
    }
    process.env.NOTIFICATIONS_ENABLED = 'true';
    expect(pushEnabled()).toBe(true);
  });

  it('sends nothing while off, and reports every target as not sent, with the reason', async () => {
    process.env.NOTIFICATIONS_ENABLED = 'false';
    const out = await sendPush([target, { ...target, deviceId: 'device-2' }]);
    expect(out.accepted).toEqual([]);
    expect(out.failed).toEqual([
      { deviceId: 'device-1', message: PUSH_DISABLED_MESSAGE },
      { deviceId: 'device-2', message: PUSH_DISABLED_MESSAGE },
    ]);
  });
});
