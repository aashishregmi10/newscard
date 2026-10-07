import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { reportError } from '../lib/telemetry';
import { textSize, type Theme } from '../theme/tokens';

/**
 * One card that fails to draw takes that card down — not the whole app.
 *
 * Without it, an exception in any card reached the root ErrorBoundary and
 * replaced the feed with the "something went wrong" screen (launch review,
 * 7 Oct 2026). Now the card's own slot, at its own height so the feed's
 * paging does not shift, says the story could not be shown; the reader swipes
 * on, and the error is reported like any other.
 */

interface Props {
  theme: Theme;
  height: number;
  lang: 'ne' | 'en';
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class CardBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, `card${info.componentStack ? `:${info.componentStack.split('\n')[1]?.trim() ?? ''}` : ''}`);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { theme, height, lang } = this.props;
    return (
      <View style={[styles.slot, { height, backgroundColor: theme.surface }]}>
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          {lang === 'ne' ? 'यो कार्ड देखाउन सकिएन। अर्कोमा जानुहोस्।' : 'This card could not be shown. Swipe on.'}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  text: { fontSize: textSize(14), textAlign: 'center' },
});
