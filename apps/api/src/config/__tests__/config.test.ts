import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../index.js';

/**
 * In production the reader API refuses to start without the settings whose
 * absence would otherwise show up later — as a 500 at the first sign-in, or
 * photos lost on the next deploy. Values are synthetic.
 */

const base = {
  MONGO_URI: 'mongodb://localhost:27017/saar_test',
  CURSOR_SECRET: 'x'.repeat(40),
};

afterEach(() => resetEnvCache());

describe('the reader API in production', () => {
  it('names every missing setting', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /READER_ID_SECRET[\s\S]*GOOGLE_WEB_CLIENT_ID[\s\S]*MEDIA_ROOT/,
    );
  });

  it('starts with them set', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      READER_ID_SECRET: 'y'.repeat(40),
      GOOGLE_WEB_CLIENT_ID: 'sample.apps.googleusercontent.com',
      MEDIA_ROOT: '/data/media',
    });
    expect(env.MEDIA_ROOT).toBe('/data/media');
  });

  it('asks nothing extra in development', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });
});
