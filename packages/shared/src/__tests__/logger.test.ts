import { describe, it, expect } from 'vitest';
import { createLogger, type LogLevel } from '../logger.js';

/**
 * The finding these exist for: LOG_LEVEL was validated at boot and never read,
 * so the setting did nothing. The first test is the one that would have caught
 * it.
 */

function capture(level: LogLevel, pretty = false) {
  const lines: Array<{ level: LogLevel; line: string }> = [];
  const log = createLogger({
    level,
    service: 'test',
    pretty,
    now: () => new Date('2026-09-17T10:00:00.000Z'),
    write: (l, line) => lines.push({ level: l, line }),
  });
  return { log, lines };
}

describe('createLogger', () => {
  it('honours the level — the setting that previously did nothing', () => {
    const { log, lines } = capture('warn');
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('emits everything at debug', () => {
    const { log, lines } = capture('debug');
    log.debug('a');
    log.info('b');
    expect(lines).toHaveLength(2);
  });

  it('writes one JSON object per line', () => {
    const { log, lines } = capture('info');
    log.info('feed served', { requestId: 'abc', ms: 12 });
    const parsed = JSON.parse(lines[0]!.line);
    expect(parsed).toEqual({
      t: '2026-09-17T10:00:00.000Z',
      level: 'info',
      service: 'test',
      msg: 'feed served',
      requestId: 'abc',
      ms: 12,
    });
  });

  it('carries child fields onto every line, so a request id is searchable', () => {
    const { log, lines } = capture('info');
    const req = log.child({ requestId: 'r-1' });
    req.info('started');
    req.info('finished', { status: 200 });
    const all = lines.map((l) => JSON.parse(l.line));
    expect(all[0].requestId).toBe('r-1');
    expect(all[1]).toMatchObject({ requestId: 'r-1', status: 200 });
  });

  it('serialises an Error instead of logging {}', () => {
    // JSON.stringify(new Error('x')) is '{}' — the least useful possible record
    // of the one event most worth reading.
    const { log, lines } = capture('error');
    log.error('dispatch failed', { err: new Error('boom') });
    const parsed = JSON.parse(lines[0]!.line);
    expect(parsed.err.name).toBe('Error');
    expect(parsed.err.message).toBe('boom');
    expect(typeof parsed.err.stack).toBe('string');
  });

  it('sends warnings and errors to the error stream', () => {
    const { log, lines } = capture('debug');
    log.info('a');
    log.warn('b');
    log.error('c');
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error']);
  });

  it('prints readable lines in pretty mode', () => {
    const { log, lines } = capture('info', true);
    log.info('listening', { port: 3000 });
    expect(lines[0]!.line).toBe('info  listening port=3000');
  });
});
