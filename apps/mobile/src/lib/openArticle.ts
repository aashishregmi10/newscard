import { Linking } from 'react-native';
import type * as WebBrowserModule from 'expo-web-browser';
import type { Theme } from '../theme/tokens';

/**
 * Opening a publisher's full article.  Contract §4, reader actions.
 *
 * ── Why in-app rather than the system browser ───────────────────────────────
 *
 * `Linking.openURL` hands the reader to Chrome and ends the session. Coming
 * back means finding our icon again, and on an entry-level handset with little
 * free memory the app is often evicted while they are away — so returning is a
 * cold start rather than the card they left. On a metered connection that cold
 * start also refetches.
 *
 * An in-app browser keeps the app alive behind it, so dismissing returns to the
 * exact card, scrolled where it was.
 *
 * ── Why expo-web-browser is required LAZILY ─────────────────────────────────
 *
 * This is the second time this project has been bitten by the same thing, and
 * the first time is written up in pushSupport.ts. A native module that is not
 * in the installed binary throws when it is IMPORTED, not when it is called:
 *
 *   Error: Cannot find native module 'ExpoWebBrowser'
 *
 * A static `import * as WebBrowser from 'expo-web-browser'` therefore kills the
 * module containing it, and the failure cascades. Here it took down NewsCard,
 * then CategoryFeed, then the feed route itself, and expo-router reported the
 * symptom rather than the cause:
 *
 *   Route "./(tabs)/index.tsx" is missing the required default export.
 *
 * Three routes were "missing a default export" and none of them was; they had
 * all failed to evaluate.
 *
 * It happens because JavaScript ships over Metro and NATIVE MODULES DO NOT. Add
 * a native dependency and every already-installed development build lacks it
 * until it is rebuilt — so the app must degrade rather than die, or a colleague
 * pulling the branch has a broken app and no idea why.
 *
 * Guarding the call site is not enough. The throw happens while the module
 * graph is being evaluated, long before any function runs. The only fix is to
 * never import it at module scope.
 */

type WebBrowser = typeof WebBrowserModule;

let cached: WebBrowser | null | undefined;

/** Null where the installed binary has no in-app browser. Cached so a failing
 *  build logs once rather than on every tap. */
function getWebBrowser(): WebBrowser | null {
  if (cached !== undefined) return cached;
  try {
    cached = require('expo-web-browser') as WebBrowser;
  } catch {
    cached = null;
    console.info(
      '[openArticle] expo-web-browser is not in this build; ' +
        'publisher links will open in the system browser. Rebuild to get the in-app one.',
    );
  }
  return cached;
}

/**
 * Open a URL inside the app, falling back to the system browser.
 *
 * Themed, because the default is a white chrome that flashes against a dark
 * feed — the one moment the reader is most likely to be reading at night.
 *
 * The fallback is not only for a stale build: some Android devices ship no
 * Custom Tabs provider at all, and on those the reader should still reach the
 * article.
 */
export async function openArticleInApp(url: string, theme: Theme): Promise<void> {
  const browser = getWebBrowser();

  if (browser) {
    try {
      await browser.openBrowserAsync(url, {
        toolbarColor: theme.surface,
        controlsColor: theme.accent,
        // The toolbar retracts as the reader scrolls, which matters on a short
        // screen where the article is already the smaller half.
        enableBarCollapsing: true,
        showTitle: true,
      });
      return;
    } catch {
      // Fall through — reaching the article matters more than how.
    }
  }

  await Linking.openURL(url).catch(() => undefined);
}
