import type { Request } from 'express';
import { clearRateCounter } from '@saar/db';
import { rateLimit, byIp } from '@saar/http';

/**
 * Login throttling.  Spec Ch. 13.7, 15.4.
 *
 * ── Why the per-account lockout was not enough on its own ───────────────────
 *
 * The login route already locks one account after five failures. That stops
 * someone grinding a single password, and stops nothing else:
 *
 *   • Spraying. One common password tried against every editor's address costs
 *     four attempts per account and never trips a lockout.
 *   • CPU. Every attempt against a real account runs Argon2id at 64 MB. A few
 *     hundred concurrent requests is a memory-exhaustion attack dressed as a
 *     login form, and the lockout only bites after the fifth.
 *   • Enumeration. The lockout is per account, so its behaviour differs between
 *     an address that exists and one that does not.
 *
 * So the IP is limited as well, against the same counter the public API uses,
 * so both servers agree even when scaled to several processes.
 */

/**
 * Twenty attempts per IP per fifteen minutes.
 *
 * Deliberately not tighter. A newsroom sits behind one NAT address, and in
 * Nepal that address may be shared far more widely than one office — the same
 * reasoning the public API applies to its per-IP limits. Ten would be tripped
 * by two editors having a bad morning, and a limiter that locks out the people
 * it is protecting gets switched off.
 *
 * Twenty still costs an attacker a 15-minute wait for every 20 guesses, which
 * combined with the per-account lockout leaves no useful guessing rate.
 */
const LOGIN_RULE = { name: 'cmslogin', limit: 20, windowMs: 15 * 60_000 };

export const loginLimit = rateLimit({
  ...LOGIN_RULE,
  key: byIp,
  /**
   * FAIL CLOSED, unlike the read API.
   *
   * There the trade is "serve the news or enforce a limit", and news wins. Here
   * it is "let unlimited password guesses through or refuse to sign anyone in
   * for a moment", and an editor waiting is the cheaper failure.
   */
  onStoreFailure: 'closed',
  message: 'Too many sign-in attempts. Try again shortly.',
});

/**
 * Forget this IP's attempts after a successful sign-in.
 *
 * Without it the limiter counts ordinary mistyping: two wrong passwords
 * followed by the right one would still cost two of the twenty for the rest of
 * the window, and a shared office address would run down during a normal
 * morning.
 */
export async function clearLoginAttempts(req: Request): Promise<void> {
  await clearRateCounter(LOGIN_RULE.name, byIp(req), LOGIN_RULE.windowMs).catch(() => undefined);
}
