import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { drainHttpServer } from '../shutdown.js';

/**
 * The bug these cover: `server.close()` reports completion through a callback
 * nothing awaited, so the process exited while requests were still being
 * served. A test that only checked "close was called" would have passed
 * throughout — so these assert the ORDER of events, not the calls.
 */

const servers: Server[] = [];

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe('drainHttpServer', () => {
  it('waits for a request that is still being served', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const inFlight = new Promise<void>((r) => (release = r));

    const { server, port } = await listen(async (_req, res) => {
      order.push('request started');
      await inFlight;
      res.end('done');
      order.push('response sent');
    });

    // Start a request and wait until the handler is actually running, so the
    // drain cannot win by racing.
    const pending = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    while (order.length === 0) await new Promise((r) => setTimeout(r, 5));

    const draining = drainHttpServer(server, 5_000).then((r) => {
      order.push('drain resolved');
      return r;
    });

    // Give the drain a chance to resolve early — it must not.
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(['request started']);

    release();
    await expect(pending).resolves.toBe('done');

    const result = await draining;
    expect(result.drained).toBe(true);
    // The response must have gone out BEFORE the drain reported completion.
    expect(order).toEqual(['request started', 'response sent', 'drain resolved']);
    // And it must not then sit on the now-idle keep-alive socket: a clean
    // shutdown that always takes five seconds is a five-second deploy stall.
    expect(result.waitedMs).toBeLessThan(1_500);
  });

  it('resolves promptly when nothing is in flight', async () => {
    const { server } = await listen((_req, res) => res.end('ok'));
    const result = await drainHttpServer(server, 5_000);
    expect(result.drained).toBe(true);
    expect(result.waitedMs).toBeLessThan(2_000);
  });

  it('gives up rather than hanging a deploy forever', async () => {
    let release: () => void = () => {};
    const stuck = new Promise<void>((r) => (release = r));

    const { server, port } = await listen(async (_req, res) => {
      await stuck;
      res.end('eventually');
    });

    const pending = fetch(`http://127.0.0.1:${port}/`).catch(() => 'aborted');
    await new Promise((r) => setTimeout(r, 30));

    const result = await drainHttpServer(server, 100);
    expect(result.drained).toBe(false);
    expect(result.waitedMs).toBeGreaterThanOrEqual(90);

    release();
    await pending;
  });
});
