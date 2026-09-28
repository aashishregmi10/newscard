import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The reader API, on this origin.
 *
 * Everything a person opens is served from the editorial site: the queue,
 * the composer, and the advertiser report at /report. The report is a
 * static page in `public/` that calls `/v1/ads/campaigns/:id/report`, and
 * these proxies are what make that call same-origin.
 *
 * The alternative was CORS on the reader API — a new permission on the most
 * exposed service in the system, granted so one page could live somewhere
 * else. A proxy costs nothing and grants nothing.
 *
 * Production does the same thing one layer up: whatever terminates TLS
 * sends /v1 and /media to the reader API and everything else here. Keep the
 * two in step — if a path is added to one it has to be added to the other,
 * and the symptom of forgetting is a 404 that only appears once deployed.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': { target: 'http://localhost:3000', changeOrigin: true },
      '/media': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
