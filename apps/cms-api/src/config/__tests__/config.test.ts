import { afterEach, describe, expect, it } from 'vitest';
import { loadCmsEnv, resetCmsEnvCache } from '../index.js';

/** In production the editorial API needs a persistent media folder and an https site. Values are synthetic. */

const base = { MONGO_URI: 'mongodb://localhost:27017/saar_test' };

afterEach(() => resetCmsEnvCache());

describe('the editorial API in production', () => {
  it('refuses to start without MEDIA_ROOT, or with a site on plain http', () => {
    expect(() => loadCmsEnv({ ...base, NODE_ENV: 'production', CMS_ORIGIN: 'http://saar.example.invalid' })).toThrow(
      /MEDIA_ROOT[\s\S]*CMS_ORIGIN/,
    );
  });

  it('starts with both', () => {
    expect(() =>
      loadCmsEnv({
        ...base,
        NODE_ENV: 'production',
        CMS_ORIGIN: 'https://saar.example.invalid',
        MEDIA_ROOT: '/data/media',
      }),
    ).not.toThrow();
  });

  it('keeps the development defaults', () => {
    expect(loadCmsEnv({ ...base }).CMS_ORIGIN).toBe('http://localhost:5173');
  });
});
