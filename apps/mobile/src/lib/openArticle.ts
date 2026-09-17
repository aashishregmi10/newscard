import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
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
 * ── Why the menu still offers the real browser ──────────────────────────────
 *
 * The overflow menu keeps `Linking.openURL` deliberately. Once the two are
 * distinguishable, "Open in browser" means something specific — take this out
 * of the app, to the browser where I am signed in, where my extensions are,
 * where I can save it. Making both do the same thing would have been the easier
 * change and would have removed a choice the reader actually has.
 */

/**
 * Open a URL inside the app.
 *
 * Themed, because the default is a white chrome that flashes against a dark
 * feed — the one moment the reader is most likely to be reading at night.
 *
 * Failure falls back to the system browser rather than doing nothing. Some
 * Android builds ship no Custom Tabs provider at all, and on those the reader
 * should still reach the article.
 */
export async function openArticleInApp(url: string, theme: Theme): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: theme.surface,
      controlsColor: theme.accent,
      // The toolbar retracts as the reader scrolls, which matters on a short
      // screen where the article is already the smaller half.
      enableBarCollapsing: true,
      showTitle: true,
    });
  } catch {
    await Linking.openURL(url).catch(() => undefined);
  }
}
