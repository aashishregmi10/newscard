import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@saar/shared';
import { clearRateCounter, hitRateCounter } from '@saar/db';

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
 * So the IP is limited as well, and the counter is shared with the public API's
 * (it lives in @saar/db) so both servers agree even when scaled to several
 * processes.
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
 * combined with the per-account lockout below leaves no useful guessing rate.
 */
const LOGIN_RULE = { name: 'cmslogin', limit: 20, windowMs: 15 * 60_000 };

const ip = (req: Request): string => req.ip ?? 'unknown';

export function loginLimit(req: Request, res: Response, next: NextFunction): void {
  hitRateCounter(LOGIN_RULE.name, ip(req), LOGIN_RULE.limit, LOGIN_RULE.windowMs)
    .then(({ allowed, retryAfterSec }) => {
      if (!allowed) {
        res.setHeader('Retry-After', String(retryAfterSec));
        next(
          new AppError('RATE_LIMITED', 'Too many sign-in attempts. Try again shortly.', {
            retryAfterSec,
          }),
        );
        return;
      }
      next();
    })
    .catch(() => {
      // FAIL CLOSED, unlike the read API.
      //
      // There the trade is "serve the news or enforce a limit", and news wins.
      // Here it is "let unlimited password guesses through or refuse to sign
      // anyone in for a moment", and an editor waiting is the cheaper failure.
      next(new AppError('RATE_LIMITED', 'Sign-in is temporarily unavailable. Try again shortly.'));
    });
}

/**
 * Forget this IP's attempts after a successful sign-in.
 *
 * Without it the limiter counts ordinary mistyping: two wrong passwords
 * followed by the right one would still cost two of the ten for the rest of the
 * window, and a shared office IP would run out during a normal morning.
 */
export async function clearLoginAttempts(req: Request): Promise<void> {
  await clearRateCounter(LOGIN_RULE.name, ip(req), LOGIN_RULE.windowMs).catch(() => undefined);
}
