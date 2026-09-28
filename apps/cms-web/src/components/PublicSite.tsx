import type { ReactNode } from 'react';
import { Routes, routeToHash, type Route } from '../nav';
import { Icon } from '../ui';

/**
 * The public site.
 *
 * -- Why it lives inside the editorial application ---------------------------
 *
 * Because there is one address. A person who is told about this product should
 * not have to be told which of three hosts to open; the reader API is an API
 * and nothing else visits it, and a second deployment for four pages of prose
 * would be a second thing to renew a certificate for.
 *
 * -- Why it renders before the session is known ------------------------------
 *
 * `App.tsx` checks these routes first, ahead of the session gate. A visitor who
 * has never signed in must not see the sign-in form flash, and must not wait on
 * a request that is only ever going to answer "nobody". Staff routes wait to
 * find out who you are; these never ask.
 *
 * -- Why the copy claims so little -------------------------------------------
 *
 * Every number here is either true of the software as written or absent. There
 * are no reader counts, no publisher counts and no launch dates, because none
 * of those are facts yet and a public page is exactly the wrong place to round
 * one up. What the product is for, and what it deliberately does not do, are
 * both known — so that is what it says.
 */

interface PublicSiteProps {
  route: Route;
}

const NAV: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Home', href: routeToHash(Routes.home()) },
  { label: 'About', href: routeToHash(Routes.about()) },
  { label: 'Contact', href: routeToHash(Routes.contact()) },
  /* A real path, not a hash: the report is a static page in `public/`, outside
     this application entirely. See vite.config.ts for why it stays that way. */
  { label: 'Advertiser report', href: '/report/' },
];

export function PublicSite({ route }: PublicSiteProps) {
  return (
    <div className="site">
      <header className="site-top">
        <div className="site-wrap site-bar">
          <a className="site-brand" href={routeToHash(Routes.home())}>
            <span className="site-mark">SAAR</span>
          </a>

          <nav className="site-nav" aria-label="Site">
            {NAV.map((item) => (
              <a
                key={item.href}
                className="site-link"
                href={item.href}
                aria-current={item.href === routeToHash(route) ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/*
            * The way in for staff, and deliberately the quietest thing here.
            * It points at the queue rather than a sign-in screen, because the
            * application asks for a password itself when it needs one — and
            * someone with a live session should land on their work rather than
            * on a form telling them they are already signed in.
            */}
          <a className="site-staff" href={routeToHash(Routes.queue())}>
            Staff sign in <Icon name="arrowLeft" className="site-staff-icon" />
          </a>
        </div>
      </header>

      <main className="site-wrap site-main">
        {route.name === 'about' ? <About /> : route.name === 'contact' ? <Contact /> : <Home />}
      </main>

      <footer className="site-foot">
        <div className="site-wrap">
          <p>
            SAAR — bilingual short-form news for Nepal.{' '}
            <a href="/report/">Advertiser report</a> ·{' '}
            <a href={routeToHash(Routes.contact())}>Contact</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------- home */

function Home() {
  return (
    <>
      <section className="site-hero">
        <h1>The day&rsquo;s news, in sixty words a story.</h1>
        <p className="site-lead">
          Nepali and English in one feed, every card credited to the publisher who reported it,
          built for an entry-level Android phone on a metered connection.
        </p>
      </section>

      <section className="site-grid">
        <Feature title="Both languages, one feed" icon="globe">
          A reader chooses Nepali, English or both, and the feed is theirs from the first card.
          Devanagari is measured and set properly rather than squeezed into a layout designed for
          Latin script.
        </Feature>
        <Feature title="Readable offline" icon="inbox">
          Anything already downloaded stays readable with no connection at all. Intermittent
          service is the normal case here, not an error state.
        </Feature>
        <Feature title="Credited, and licensed" icon="newspaper">
          Every summary links back to the publisher who did the reporting, and nothing is
          published against a publisher we have no agreement with.
        </Feature>
        <Feature title="Quiet by design" icon="bell">
          At most three notifications a day, none between 9:30pm and 6:30am, and no streaks or
          reminders engineered to pull anyone back.
        </Feature>
      </section>

      <section className="site-panel">
        <h2>For advertisers</h2>
        <p>
          At most one sponsored card in ten, never before the fourth card of a session, and twelve
          a day. Those limits are enforced on our servers, so no future release can quietly raise
          them.
        </p>
        <p>
          Campaign reporting is open to you without an account:{' '}
          <a href="/report/">open your report</a> with the campaign ID and token we sent you.
        </p>
      </section>
    </>
  );
}

function Feature({ title, icon, children }: { title: string; icon: 'globe' | 'inbox' | 'newspaper' | 'bell'; children: ReactNode }) {
  return (
    <article className="site-card">
      <span className="site-card-icon">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </article>
  );
}

/* ------------------------------------------------------------------ about */

function About() {
  return (
    <>
      <h1>About</h1>
      <p className="site-lead">
        SAAR summarises the day&rsquo;s reporting from Nepali news organisations and links back to
        them.
      </p>

      <h2>What we do</h2>
      <p>
        A reader gets one story per card, written short enough to finish and long enough to be
        worth reading, in the language they chose. Every card names the publisher and opens their
        article. We are not trying to replace them — the summary exists to get their work in front
        of someone who would otherwise have scrolled past it.
      </p>

      <h2>How we work with publishers</h2>
      <p>
        We summarise nothing without an agreement. A publisher&rsquo;s feed may be read to learn
        that a story exists, but writing and publishing a summary against them requires a licence
        recorded in our system, and the check runs again at the moment of publication. Takedown
        requests go to a named contact and are answered within 24 hours.
      </p>

      <h2>What we do not do</h2>
      <ul className="site-list">
        <li>No streaks, no daily-ritual counters, no notifications whose purpose is re-entry.</li>
        <li>
          No advertising, attribution or session-replay SDK anywhere in the app — a build check
          fails if one appears, even indirectly.
        </li>
        <li>
          No advertising identifier, no location, and no profile. Measurement is an install-scoped
          random id, how long a card was on screen, and whether the publisher&rsquo;s article was
          opened.
        </li>
        <li>Summaries are written by people. There is no model in the pipeline.</li>
      </ul>

      <h2>Where it runs</h2>
      <p>
        Android first, built for entry-level handsets and metered data. Short video is capped at 90
        seconds, stored at three sizes, and never plays by itself on a mobile connection — the
        player shows what a clip will cost before it spends it.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------- contact */

function Contact() {
  return (
    <>
      <h1>Contact</h1>
      <p className="site-lead">
        For publishing agreements, advertising, corrections and takedown requests.
      </p>

      <div className="site-contacts">
        <Contacted title="Publishers" note="Licensing, syndication, and how your work is credited.">
          publishers@example.invalid
        </Contacted>
        <Contacted title="Advertising" note="Campaigns, rates, and reporting.">
          advertising@example.invalid
        </Contacted>
        <Contacted
          title="Corrections and takedowns"
          note="Answered within 24 hours. Tell us the story and what is wrong with it."
        >
          legal@example.invalid
        </Contacted>
      </div>

      <h2>Post</h2>
      <p className="site-address">
        {/* TODO: the registered business name and address. */}
        Kathmandu, Nepal
      </p>
    </>
  );
}

function Contacted({ title, note, children }: { title: string; note: string; children: string }) {
  return (
    <article className="site-contact">
      <h2>{title}</h2>
      <p className="site-contact-address">
        <a href={`mailto:${children}`}>{children}</a>
      </p>
      <p className="site-contact-note">{note}</p>
    </article>
  );
}
