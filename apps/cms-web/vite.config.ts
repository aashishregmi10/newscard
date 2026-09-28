import { defineConfig, type Plugin } from 'vite';
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
/**
 * Serve /report/ as the directory index it is.
 *
 * Vite's dev server answers any unmatched path with index.html so the SPA can
 * route it, and that fallback runs before the static handler resolves a
 * directory to its index. So `/report/` returned the application shell — a
 * blank React page where the advertiser report should be — while
 * `/report/index.html` served correctly, which is a difference nobody would
 * think to test.
 *
 * Development only. Every static host resolves a directory index natively, so
 * the built site needs nothing.
 */
function serveReportIndex(): Plugin {
  return {
    name: 'saar-report-index',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/report' || req.url === '/report/') {
          req.url = '/report/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveReportIndex()],
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
