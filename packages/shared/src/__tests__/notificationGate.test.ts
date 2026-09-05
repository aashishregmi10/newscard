import { describe, it, expect } from 'vitest';
import {
  evaluateSendGate,
  isQuietHours,
  nptMinutesOfDay,
  nextQuietWindowEnd,
  channelFor,
  type DeviceNotifState,
  type NotificationType,
} from '../notificationGate.js';

/**
 * The send gate carries 100% branch coverage. It is the only thing between an
 * editor's enthusiasm and a reader's uninstall, and every reason code below
 * corresponds to a real complaint in the competitor research.
 */

/** 10:00 NPT = 04:15 UTC — comfortably inside waking hours. */
const DAYTIME = new Date('2026-09-05T04:15:00Z');
/** 23:00 NPT = 17:15 UTC — inside quiet hours. */
const NIGHT = new Date('2026-09-05T17:15:00Z');

const device = (over: Partial<DeviceNotifState> = {}): DeviceNotifState => ({
  enabled: true,
  channels: { breaking: true, digest: true, categories: false },
  dailyCap: 3,
  sentToday: 0,
  lastSentAt: null,
  langPrefs: ['ne', 'en'],
  ...over,
});

const gate = (type: NotificationType, d: Partial<DeviceNotifState> = {}, now = DAYTIME) =>
  evaluateSendGate({
    device: device(d),
    type,
    availableLanguages: ['ne', 'en'],
    now,
  });

describe('time helpers (Nepal Time is UTC+05:45)', () => {
  it('converts UTC to minutes past midnight NPT', () => {
    expect(nptMinutesOfDay(new Date('2026-09-05T04:15:00Z'))).toBe(10 * 60); // 10:00
    expect(nptMinutesOfDay(new Date('2026-09-05T18:15:00Z'))).toBe(0); // midnight
  });

  it('wraps correctly across midnight UTC', () => {
    // 19:00 UTC -> 00:45 NPT the next day
    expect(nptMinutesOfDay(new Date('2026-09-05T19:00:00Z'))).toBe(45);
  });

  it('treats the quiet window as wrapping midnight', () => {
    expect(isQuietHours(new Date('2026-09-05T04:15:00Z'))).toBe(false); // 10:00
    expect(isQuietHours(new Date('2026-09-05T17:15:00Z'))).toBe(true); // 23:00
    expect(isQuietHours(new Date('2026-09-05T19:30:00Z'))).toBe(true); // 01:15
    expect(isQuietHours(new Date('2026-09-05T01:00:00Z'))).toBe(false); // 06:45
  });

  it('computes the next 06:30 NPT', () => {
    const end = nextQuietWindowEnd(new Date('2026-09-05T17:15:00Z')); // 23:00 NPT
    expect(nptMinutesOfDay(end)).toBe(6 * 60 + 30);
    expect(end.getTime()).toBeGreaterThan(new Date('2026-09-05T17:15:00Z').getTime());
  });

  it('maps types to channels', () => {
    expect(channelFor('digest')).toBe('digest');
    expect(channelFor('category')).toBe('categories');
    expect(channelFor('breaking')).toBe('breaking');
    // Corrections ride the breaking channel — opting out of urgent
    // interruptions opts out of urgent corrections too.
    expect(channelFor('correction')).toBe('breaking');
    expect(channelFor('article_retracted')).toBe('breaking');
  });
});

describe('the daily cap', () => {
  it('allows sends below the cap', () => {
    expect(gate('digest', { sentToday: 2, dailyCap: 3 }).send).toBe(true);
  });

  it('refuses once the cap is reached', () => {
    expect(gate('digest', { sentToday: 3, dailyCap: 3 })).toEqual({
      send: false,
      reason: 'cap_reached',
    });
  });

  it('honours a cap the user lowered to zero', () => {
    expect(gate('breaking', { dailyCap: 0 }).reason).toBe('cap_reached');
  });

  it('clamps a stored cap above the ceiling — it is a product decision, not a preference', () => {
    // Even if something wrote 99 straight to the database, 3 is the maximum.
    expect(gate('digest', { dailyCap: 99, sentToday: 3 }).reason).toBe('cap_reached');
  });

  it('breaking news bypasses the minimum gap but NEVER the cap', () => {
    const recent = new Date(DAYTIME.getTime() - 5 * 60_000);
    expect(gate('breaking', { lastSentAt: recent, sentToday: 0 }).send).toBe(true);
    expect(gate('breaking', { lastSentAt: recent, sentToday: 3 }).reason).toBe('cap_reached');
  });
});

describe('corrections are exempt from the cap', () => {
  it('sends a correction even at the cap', () => {
    // Otherwise the readers most likely to have seen the error are the least
    // likely to see the correction (Ch. 15.7).
    expect(gate('correction', { sentToday: 3, dailyCap: 3 }).send).toBe(true);
    expect(gate('article_retracted', { sentToday: 3, dailyCap: 3 }).send).toBe(true);
  });

  it('sends a correction during quiet hours', () => {
    expect(gate('correction', { sentToday: 3 }, NIGHT).send).toBe(true);
  });

  it('sends a correction inside the minimum gap', () => {
    const recent = new Date(DAYTIME.getTime() - 60_000);
    expect(gate('correction', { lastSentAt: recent }).send).toBe(true);
  });

  it('still respects an explicitly disabled channel', () => {
    // Exempt from the cap is not exempt from consent.
    expect(gate('correction', { channels: { breaking: false, digest: true, categories: true } }).reason).toBe(
      'channel_off',
    );
  });
});

describe('the minimum gap', () => {
  it('refuses a second digest inside 90 minutes', () => {
    const recent = new Date(DAYTIME.getTime() - 30 * 60_000);
    expect(gate('digest', { lastSentAt: recent }).reason).toBe('min_gap');
  });

  it('allows one outside 90 minutes', () => {
    const old = new Date(DAYTIME.getTime() - 120 * 60_000);
    expect(gate('digest', { lastSentAt: old }).send).toBe(true);
  });

  it('applies no gap when nothing has been sent yet', () => {
    expect(gate('digest', { lastSentAt: null }).send).toBe(true);
  });
});

describe('quiet hours', () => {
  it('holds breaking news until the window opens rather than dropping it', () => {
    const d = gate('breaking', {}, NIGHT);
    expect(d.send).toBe(false);
    expect(d.reason).toBe('quiet_hours');
    expect(d.deferUntil).toBeInstanceOf(Date);
    expect(nptMinutesOfDay(d.deferUntil!)).toBe(6 * 60 + 30);
  });

  it('suppresses a digest outright — one arriving six hours late is not a digest', () => {
    const d = gate('digest', {}, NIGHT);
    expect(d.send).toBe(false);
    expect(d.reason).toBe('quiet_hours');
    expect(d.deferUntil).toBeUndefined();
  });

  it('sends normally outside quiet hours', () => {
    expect(gate('breaking', {}, DAYTIME).send).toBe(true);
  });
});

describe('consent and language', () => {
  it('refuses when notifications are switched off entirely', () => {
    expect(gate('breaking', { enabled: false }).reason).toBe('disabled');
  });

  it('refuses a category alert when that channel is off — it is off by default', () => {
    expect(gate('category').reason).toBe('channel_off');
  });

  it('sends a category alert once the reader opts in', () => {
    expect(gate('category', { channels: { breaking: true, digest: true, categories: true } }).send).toBe(
      true,
    );
  });

  it('never sends copy in a language the reader does not read', () => {
    const d = evaluateSendGate({
      device: device({ langPrefs: ['ne'] }),
      type: 'breaking',
      availableLanguages: ['en'],
      now: DAYTIME,
    });
    expect(d).toEqual({ send: false, reason: 'no_language' });
  });

  it('checks language before the cap, so an unreadable alert burns no slot', () => {
    const d = evaluateSendGate({
      device: device({ langPrefs: ['ne'], sentToday: 3 }),
      type: 'breaking',
      availableLanguages: ['en'],
      now: DAYTIME,
    });
    expect(d.reason).toBe('no_language');
  });
});

describe('precedence between reasons', () => {
  it('reports disabled ahead of everything else', () => {
    expect(
      gate('breaking', { enabled: false, sentToday: 3, channels: { breaking: false, digest: false, categories: false } })
        .reason,
    ).toBe('disabled');
  });

  it('reports channel_off ahead of the cap', () => {
    expect(
      gate('digest', { sentToday: 3, channels: { breaking: true, digest: false, categories: false } }).reason,
    ).toBe('channel_off');
  });
});
