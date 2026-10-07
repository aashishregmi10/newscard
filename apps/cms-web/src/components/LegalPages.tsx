import { useEffect, useRef, useState } from 'react';
import { Routes, routeToHash } from '../nav';
import { SITE } from '../siteInfo';

/**
 * The Privacy Policy, the Terms, and the page for deleting an account.
 *
 * Written from what the software actually does (the launch review of 7 Oct
 * 2026 inventoried every byte that leaves the phone), so each sentence can be
 * checked against the code. They are drafts for the owners — and a lawyer — to
 * review; the operator's name, address and inboxes come from siteInfo.ts.
 *
 * Google Play needs each at a public address: the privacy policy for the
 * listing and the Data safety form, the deletion page because readers can make
 * an account (Google sign-in). YouTube's API terms need the privacy policy to
 * say the app uses YouTube API Services and link Google's privacy policy, and
 * the terms to bind users to YouTube's.
 */

const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms';

function Mail({ to }: { to: string }) {
  return <a href={`mailto:${to}`}>{to}</a>;
}

/* ----------------------------------------------------------------- privacy */

export function Privacy() {
  return (
    <article className="site-legal">
      <h1>Privacy Policy</h1>
      <p className="site-lead">
        What the SAAR app and this website collect, why, how long it is kept, and how to have it deleted.
      </p>
      <p className="site-legal-date">Last updated {SITE.policyDate}</p>

      <h2>Who we are</h2>
      <p>
        SAAR is published by {SITE.operator}, {SITE.address}. For anything about your data, write to{' '}
        <Mail to={SITE.emails.privacy} />.
      </p>

      <h2>The short version</h2>
      <ul className="site-list">
        <li>You can read SAAR without an account. Signing in is only for voting and rating.</li>
        <li>
          We do not collect your name, email, phone number, contacts, location, photos or the advertising ID.
        </li>
        <li>We do not sell data, and we do not share it with advertisers or publishers.</li>
        <li>Everything the app sends us travels encrypted (HTTPS).</li>
      </ul>

      <h2>What the app sends us, and why</h2>
      <p>
        <strong>An install identifier.</strong> On first launch the app makes a random number for that
        installation. It is not linked to your name or your Google account. It lets us send the notifications
        you asked for, keep the daily limit on ads, count what is read, and connect a crash report to the version
        of the app that had it. The install record is deleted once the app has not been used for 180 days.
      </p>
      <p>
        <strong>Notification details.</strong> If you allow notifications: a push token (an address for your
        phone issued through Expo and Google&rsquo;s Firebase Cloud Messaging), the app and Android version,
        your chosen languages and your notification settings. Turning notifications off stops them; the token
        is deleted with the install record.
      </p>
      <p>
        <strong>What is read.</strong> Which story was opened, its section and language, how long it was on
        screen, and whether it was finished, shared, or opened at the publisher. We use this to see what
        readers find useful and to improve the feed. It is kept for 90 days.
      </p>
      <p>
        <strong>Ads.</strong> When an ad is shown or tapped: which campaign, where it appeared, for how long,
        and in which section. Advertisers see only totals — never who saw an ad. Kept for 400 days, for
        advertisers&rsquo; reports and invoices.
      </p>
      <p>
        <strong>Crash reports.</strong> When the app fails: the error, a technical trace, the app and Android
        version, and the install identifier. Kept for 60 days.
      </p>

      <h2>If you sign in with Google</h2>
      <p>
        Signing in is optional and only used for votes and ratings, so that each Google account votes once.
        Google confirms the sign-in to us with a token; we keep only a one-way code computed from your Google
        account number. We never store your name, email or photo — the app shows your name to you from the
        sign-in on your phone, and it does not leave the phone. Your votes and ratings are kept with that code
        until you delete your account. A sign-in on a phone lasts up to 180 days.
      </p>

      <h2>YouTube</h2>
      <p>
        SAAR plays short videos with YouTube&rsquo;s embedded player, using YouTube API Services. While a video
        plays, YouTube may collect information such as your IP address, device details and cookies, under the{' '}
        <a href={GOOGLE_PRIVACY}>Google Privacy Policy</a>. By watching YouTube videos in SAAR you also agree to
        the <a href={YOUTUBE_TERMS}>YouTube Terms of Service</a>.
      </p>

      <h2>Stays on your phone</h2>
      <p>
        Saved stories, your settings and downloaded stories are kept on your phone only and are removed when you
        uninstall the app.
      </p>

      <h2>Who processes data for us</h2>
      <p>
        We use service providers that act on our instructions and may not use the data for anything else:
        MongoDB Atlas (database), Expo and Google Firebase Cloud Messaging (delivering notifications), Google
        (confirming sign-ins), and the company that hosts our servers. Google&rsquo;s Gemini helps our editors
        draft summaries of publishers&rsquo; articles; no reader data is sent to it.
      </p>

      <h2>Security</h2>
      <p>
        Data travels over HTTPS. Sign-in sessions are stored only as one-way hashes, and Google account numbers
        only as keyed one-way codes, so a copy of our database would not reveal who anyone is. Access is
        limited to the staff who need it.
      </p>

      <h2>Deleting your data</h2>
      <ul className="site-list">
        <li>
          <strong>Your account</strong> — in the app: Settings → Account → Delete account and data. Or on the
          web: <a href={routeToHash(Routes.deleteAccount())}>delete your account</a>. This removes the account,
          every sign-in, and all your votes and ratings, at once.
        </li>
        <li>
          <strong>Everything else</strong> is tied only to the install identifier and is deleted on the schedule
          above. Uninstalling the app stops all collection. To ask for earlier deletion, write to{' '}
          <Mail to={SITE.emails.privacy} />.
        </li>
      </ul>

      <h2>Children</h2>
      <p>SAAR is a news service for a general audience and is not directed at children under 13.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the date at the top changes with it, and a change to what we collect will be
        announced in the app before it takes effect.
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------- terms */

export function Terms() {
  return (
    <article className="site-legal">
      <h1>Terms of Use</h1>
      <p className="site-lead">The rules for using the SAAR app and this website.</p>
      <p className="site-legal-date">Last updated {SITE.policyDate}</p>

      <h2>The service</h2>
      <p>
        SAAR is published by {SITE.operator}. Using the app or this site means you accept these terms and our{' '}
        <a href={routeToHash(Routes.privacy())}>Privacy Policy</a>.
      </p>

      <h2>Summaries and the original reporting</h2>
      <p>
        Each card summarises reporting by the publisher it names and links to their article; the reporting,
        photos and logos belong to them and are used under agreement. Summaries are drafted with the help of AI
        and reviewed by an editor before publication. A summary is short by design and can leave things out or
        get them wrong — read the original before relying on it, and tell us at <Mail to={SITE.emails.legal} />{' '}
        so we can correct it.
      </p>

      <h2>YouTube videos</h2>
      <p>
        Short videos are played with YouTube&rsquo;s player. By watching them in SAAR you agree to the{' '}
        <a href={YOUTUBE_TERMS}>YouTube Terms of Service</a>.
      </p>

      <h2>Your account, votes and ratings</h2>
      <p>
        Signing in with Google is optional and only needed to vote or rate. One Google account has one vote on
        each question, and answers cannot be changed. Do not use several accounts, automated tools or anything
        else to distort results. You can delete your account at any time.
      </p>

      <h2>Advertising</h2>
      <p>
        SAAR shows advertising from businesses who pay for it. Advertisers are responsible for what their ads
        say; tapping one takes you to them, outside SAAR.
      </p>

      <h2>What you may not do</h2>
      <ul className="site-list">
        <li>Copy, scrape or republish SAAR&rsquo;s summaries or the publishers&rsquo; content in bulk.</li>
        <li>Interfere with the service, its servers, or other readers&rsquo; use of it.</li>
        <li>Use the SAAR name or logo in a way that suggests we endorse you.</li>
      </ul>

      <h2>No warranty</h2>
      <p>
        SAAR is provided as it is. We work to keep it accurate and available but cannot promise it will be
        either at every moment, and to the extent the law allows we are not liable for losses from relying on
        a summary, an outage, or an advertiser&rsquo;s offer.
      </p>

      <h2>Law, and changes</h2>
      <p>
        These terms are governed by the laws of Nepal. If they change, the date above changes with them. Questions
        to <Mail to={SITE.emails.legal} />.
      </p>
    </article>
  );
}

/* ---------------------------------------------------------- delete account */

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, string | number>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

/** Google's sign-in library for the web, loaded once, only on this page. */
function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('no google')));
    script.onerror = () => reject(new Error('could not load'));
    document.head.appendChild(script);
  });
}

type Step =
  | { name: 'loading' }
  | { name: 'unavailable' }
  | { name: 'signIn' }
  | { name: 'confirm'; idToken: string }
  | { name: 'working' }
  | { name: 'done'; deleted: boolean }
  | { name: 'failed'; message: string };

/**
 * Delete an account without the app — Google Play's web route for it.
 *
 * The server keeps no email to look anyone up by, so the person signs in with
 * Google here and that sign-in names the account; then one more button, so a
 * stray click cannot delete it. Nothing is created for an account that was
 * never here.
 */
export function DeleteAccount() {
  const [step, setStep] = useState<Step>({ name: 'loading' });
  const buttonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const config = (await fetch('/v1/readers/config').then((r) => r.json())) as {
          googleWebClientId: string | null;
        };
        if (!config.googleWebClientId) throw new Error('not set up');
        const google = await loadGoogleIdentity();
        if (!alive) return;
        google.accounts.id.initialize({
          client_id: config.googleWebClientId,
          callback: (r) => setStep({ name: 'confirm', idToken: r.credential }),
        });
        setStep({ name: 'signIn' });
      } catch {
        if (alive) setStep({ name: 'unavailable' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* The button is Google's own, drawn into its box once the box exists. */
  useEffect(() => {
    if (step.name === 'signIn' && buttonRef.current && window.google) {
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
      });
    }
  }, [step.name]);

  const remove = async (idToken: string) => {
    setStep({ name: 'working' });
    try {
      const res = await fetch('/v1/readers/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (res.status === 401) {
        setStep({ name: 'failed', message: 'Google did not confirm that sign-in. Please sign in again.' });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { deleted: boolean };
      setStep({ name: 'done', deleted: body.deleted });
    } catch {
      setStep({ name: 'failed', message: 'Something went wrong. Please try again in a moment.' });
    }
  };

  return (
    <article className="site-legal">
      <h1>Delete your SAAR account</h1>
      <p className="site-lead">
        Signing in to SAAR — only ever needed to vote or rate — makes an account. You can delete it, and
        everything kept with it, here or in the app.
      </p>

      <h2>What is deleted</h2>
      <ul className="site-list">
        <li>Your account (the one-way code we keep for your Google account).</li>
        <li>Every sign-in, on every phone.</li>
        <li>All your votes and ratings — they are taken out of the results too.</li>
      </ul>
      <p>
        Reading statistics and crash reports are not part of your account: they are tied only to an install of
        the app and are deleted on the schedule in our <a href={routeToHash(Routes.privacy())}>Privacy Policy</a>.
      </p>

      <h2>In the app</h2>
      <p>Settings → Account → Delete account and data.</p>

      <h2>Here</h2>
      <div className="site-delete" aria-live="polite">
        {step.name === 'loading' && <p>Loading Google sign-in…</p>}

        {step.name === 'unavailable' && (
          <p>
            Google sign-in could not be loaded here. Delete your account in the app, or write to{' '}
            <Mail to={SITE.emails.privacy} /> from the Gmail address you sign in with.
          </p>
        )}

        {step.name === 'signIn' && (
          <>
            <p>Sign in with the Google account you use in SAAR, so we know which account to delete.</p>
            <div ref={buttonRef} className="site-delete-google" />
          </>
        )}

        {step.name === 'confirm' && (
          <>
            <p>
              <strong>This cannot be undone.</strong> Your account, sign-ins, votes and ratings will be deleted.
            </p>
            <button type="button" className="site-danger" onClick={() => void remove(step.idToken)}>
              Delete my account
            </button>
          </>
        )}

        {step.name === 'working' && <p>Deleting…</p>}

        {step.name === 'done' && (
          <p>
            {step.deleted
              ? 'Your SAAR account has been deleted, with all its votes and ratings.'
              : 'There is no SAAR account for this Google account, so there was nothing to delete.'}
          </p>
        )}

        {step.name === 'failed' && <p role="alert">{step.message}</p>}
      </div>
    </article>
  );
}
