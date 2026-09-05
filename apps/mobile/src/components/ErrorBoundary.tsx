import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Catches render errors and SHOWS them.
 *
 * Without this, any throw during render is caught by the host — Expo Go
 * replaces the whole app with "Sorry, something went wrong / go back to Expo
 * home", which names neither the module nor the message. The failure is
 * perfectly reproducible on the device and completely invisible to whoever has
 * to fix it.
 *
 * This is not only a development aid. In production a single bad card should
 * degrade to a readable message, not a blank app, and the reader should be able
 * to get back to the feed.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    // Also goes to the Metro terminal, so it is visible without the phone.
    console.error('[ErrorBoundary]', error?.message, '\n', info?.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null, info: null });
  };

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const env = [
      `platform      ${Platform.OS} ${Platform.Version}`,
      `expo sdk      ${Constants.expoConfig?.sdkVersion ?? 'unknown'}`,
      `app version   ${Constants.expoConfig?.version ?? 'unknown'}`,
      `runtime       ${Constants.executionEnvironment}`,
      `host          ${Constants.expoConfig?.hostUri ?? 'unknown'}`,
    ].join('\n');

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.sub}>
            This screen exists so the actual error is visible. Copy the block below.
          </Text>

          <Text style={styles.label}>ERROR</Text>
          <View style={styles.block}>
            <Text style={styles.mono} selectable>
              {error.name}: {error.message}
            </Text>
          </View>

          <Text style={styles.label}>ENVIRONMENT</Text>
          <View style={styles.block}>
            <Text style={styles.mono} selectable>
              {env}
            </Text>
          </View>

          {info?.componentStack ? (
            <>
              <Text style={styles.label}>COMPONENT STACK</Text>
              <View style={styles.block}>
                <Text style={styles.mono} selectable>
                  {info.componentStack.trim().split('\n').slice(0, 14).join('\n')}
                </Text>
              </View>
            </>
          ) : null}

          {error.stack ? (
            <>
              <Text style={styles.label}>STACK</Text>
              <View style={styles.block}>
                <Text style={styles.mono} selectable>
                  {error.stack.split('\n').slice(0, 12).join('\n')}
                </Text>
              </View>
            </>
          ) : null}

          <Pressable style={styles.btn} onPress={this.reset}>
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#12141a' },
  body: { padding: 22, paddingTop: 64, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 21, fontWeight: '700', marginBottom: 6 },
  sub: { color: '#9aa3ad', fontSize: 13.5, lineHeight: 19, marginBottom: 22 },
  label: {
    color: '#6f7883',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 14,
  },
  block: {
    backgroundColor: '#1b1f27',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#272d37',
  },
  mono: {
    color: '#e6eaf0',
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  btn: {
    marginTop: 26,
    backgroundColor: '#2f6fb0',
    borderRadius: 24,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
