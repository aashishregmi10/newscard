import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  AnswerError,
  answerRating,
  answerVote,
  blurHashAverageColor,
  fetchInteractionState,
  resolveMediaUrl,
  type InteractionCard as InteractionCardData,
  type InteractionState,
} from '../api/client';
import { useReader } from '../state/ReaderContext';
import { fontFor, textSize, type Theme } from '../theme/tokens';
import { SignInSheet } from './SignInSheet';
import { StarRating } from './StarRating';

/**
 * A rating or a vote, as a card between stories.
 *
 * ── What a reader sees, and when ────────────────────────────────────────────
 *
 *   Vote    a 2×2 grid of candidates, each with a Vote button. The totals stay
 *           hidden until this reader has voted — so the first votes do not
 *           steer the rest — or the vote has closed. Then every candidate shows
 *           its share, their own choice marked.
 *   Rating  a row per business: its average and number of ratings, always,
 *           and five stars to choose. Choosing shows Submit, because a rating
 *           cannot be changed once sent.
 *
 * Both are one per Google account and final; the server enforces it, and says
 * so if a second phone on the same account tries again.
 *
 * ── Feel ────────────────────────────────────────────────────────────────────
 *
 * A tap is answered at once — the haptic, the choice marked — and the request
 * follows. Results grow in on the UI thread. While results are showing, they
 * are refreshed every ten seconds, and only while the card is mounted (on or
 * next to the screen) and the app is in front.
 *
 * Nothing here is in the cached feed: the card asks for its own reader's
 * state when it appears, so a cached card never shows someone else's answer.
 */

const REFRESH_MS = 10_000;

const COPY = {
  ne: {
    vote: 'मत दिनुहोस्',
    rate: 'रेटिङ दिनुहोस्',
    voteKicker: 'मतदान',
    rateKicker: 'रेटिङ',
    submit: 'पठाउनुहोस्',
    youVoted: 'तपाईंले मत दिनुभयो',
    youRated: 'तपाईंको रेटिङ',
    closed: 'मतदान सकियो',
    ratingClosed: 'रेटिङ सकियो',
    votes: (n: number) => `${n} मत`,
    ratings: (n: number) => `${n} रेटिङ`,
    noRatings: 'अहिलेसम्म रेटिङ छैन',
    already: 'तपाईंले पहिल्यै मत दिनुभएको छ।',
    alreadyRated: 'यसलाई तपाईंले पहिल्यै रेटिङ दिनुभएको छ।',
    failed: 'पठाउन सकिएन। फेरि प्रयास गर्नुहोस्।',
    signInAgain: 'फेरि साइन इन गर्नुहोस्।',
    update: 'मत दिन एपको नयाँ संस्करण चाहिन्छ।',
    closesIn: (d: number, h: number) => (d > 0 ? `${d} दिन बाँकी` : h > 0 ? `${h} घण्टा बाँकी` : 'छिट्टै सकिन्छ'),
    photo: 'तस्बिर',
  },
  en: {
    vote: 'Vote',
    rate: 'Rate',
    voteKicker: 'Vote',
    rateKicker: 'Rate',
    submit: 'Submit',
    youVoted: 'You voted',
    youRated: 'You rated',
    closed: 'Voting closed',
    ratingClosed: 'Rating closed',
    votes: (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`,
    ratings: (n: number) => `${n} ${n === 1 ? 'rating' : 'ratings'}`,
    noRatings: 'No ratings yet',
    already: 'You have already voted.',
    alreadyRated: 'You have already rated this.',
    failed: 'Could not send. Please try again.',
    signInAgain: 'Please sign in again.',
    update: 'Voting needs the latest version of the app.',
    closesIn: (d: number, h: number) => (d > 0 ? `${d} days left` : h > 0 ? `${h} hours left` : 'Closing soon'),
    photo: 'Photos',
  },
} as const;

/** A share bar that grows from the left, on the UI thread. */
function ShareBar({ percent, color, track }: { percent: number; color: string; track: string }) {
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, { toValue: percent / 100, duration: 420, useNativeDriver: true }).start();
  }, [percent, grow]);
  return (
    <View style={[styles.track, { backgroundColor: track }]}>
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: color, transformOrigin: 'left', transform: [{ scaleX: grow }] },
        ]}
      />
    </View>
  );
}

interface Props {
  card: InteractionCardData;
  theme: Theme;
  height: number;
  textScale: number;
  dataSaver: boolean;
}

function InteractionCardInner({ card, theme, height, textScale, dataSaver }: Props) {
  const reader = useReader();
  const { width } = useWindowDimensions();
  const ne = card.language === 'ne';
  const t = COPY[card.language];
  const fontFamily = fontFor(card.language);
  const token = reader.session?.token ?? null;

  const [state, setState] = useState<InteractionState | null>(null);
  /** The candidate just pressed, or the business just submitted — marked at once. */
  const [pending, setPending] = useState<string | null>(null);
  /** Stars chosen but not yet submitted, per business. */
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const afterSignIn = useRef<((token: string) => void) | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await fetchInteractionState(card.id, token));
    } catch (e) {
      if (e instanceof AnswerError && e.status === 401) reader.forget();
      /* Otherwise the card still works: the next answer brings the state. */
    }
  }, [card.id, token, reader]);

  useEffect(() => {
    if (!reader.ready) return;
    void load();
  }, [load, reader.ready]);

  /* Keep shown results moving while they are on screen and the app is in front. */
  const showingResults = state !== null && state.results !== null && !state.closed;
  useEffect(() => {
    if (!showingResults) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [showingResults, load]);

  const refused = (e: unknown, already: string) => {
    if (e instanceof AnswerError) {
      if (e.status === 401) {
        reader.forget();
        setNote(t.signInAgain);
        return;
      }
      if (e.status === 409) {
        if (e.state) setState(e.state);
        setNote(already);
        return;
      }
      if (e.status === 410) {
        void load();
        setNote(card.type === 'vote' ? t.closed : t.ratingClosed);
        return;
      }
    }
    setNote(t.failed);
  };

  /** Run with a session — asking for one first if there is none. */
  const signedIn = (act: (token: string) => void) => {
    setNote(null);
    if (!reader.available) {
      setPending(null);
      setNote(t.update);
      return;
    }
    if (token !== null) act(token);
    else {
      afterSignIn.current = act;
      setAsking(true);
    }
  };

  const vote = (optionId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPending(optionId);
    signedIn(async (tk) => {
      try {
        setState(await answerVote(card.id, optionId, tk));
      } catch (e) {
        refused(e, t.already);
      } finally {
        setPending(null);
      }
    });
  };

  const submitRating = (optionId: string) => {
    const stars = chosen[optionId];
    if (!stars) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPending(optionId);
    signedIn(async (tk) => {
      try {
        setState(await answerRating(card.id, optionId, stars, tk));
        setChosen((c) => {
          const { [optionId]: _sent, ...rest } = c;
          return rest;
        });
      } catch (e) {
        refused(e, t.alreadyRated);
      } finally {
        setPending(null);
      }
    });
  };

  const closed = state?.closed ?? false;
  const myVote = state?.myVote ?? null;
  const result = (id: string) => state?.results?.options.find((o) => o.id === id) ?? null;
  const credits = [...new Set(card.options.map((o) => o.image?.credit).filter((c): c is string => !!c))];

  /* How long is left, from the closing date. */
  let left: string | null = null;
  if (card.closesAt !== null && !closed) {
    const ms = Date.parse(card.closesAt) - Date.now();
    if (ms > 0) left = t.closesIn(Math.floor(ms / 86_400_000), Math.floor(ms / 3_600_000));
  }

  const titleSize = textSize(19) * textScale;
  const pad = 18;
  const gap = 10;
  /* Four tiles must fit the card: the photo shrinks before anything is cut. */
  const tile = Math.max(
    84,
    Math.min((width - pad * 2 - gap) / 2 - 2, (height - 230 * textScale) / 2 - 96 * textScale),
  );

  return (
    <View style={[styles.card, { height, backgroundColor: theme.surface, paddingHorizontal: pad }]}>
      <View style={styles.kickerRow}>
        <View style={[styles.kicker, { backgroundColor: theme.surfaceRaised }]}>
          <MaterialCommunityIcons
            name={card.type === 'vote' ? 'vote-outline' : 'star-outline'}
            size={15}
            color={theme.accent}
          />
          <Text style={[styles.kickerText, { color: theme.accent }]}>
            {card.type === 'vote' ? t.voteKicker : t.rateKicker}
          </Text>
        </View>
        {closed ? (
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {card.type === 'vote' ? t.closed : t.ratingClosed}
          </Text>
        ) : left !== null ? (
          <Text style={[styles.meta, { color: theme.textSecondary }]}>{left}</Text>
        ) : null}
      </View>

      <Text
        style={[styles.title, { color: theme.textPrimary, fontSize: titleSize, lineHeight: titleSize * 1.35, fontFamily }]}
        numberOfLines={3}
      >
        {card.title}
      </Text>

      {card.type === 'vote' ? (
        <View style={[styles.grid, { gap }]}>
          {card.options.map((o) => {
            const r = myVote !== null || closed ? result(o.id) : null;
            const mine = myVote === o.id || (myVote === null && pending === o.id);
            const src = dataSaver ? null : resolveMediaUrl(o.image?.urls.md ?? o.image?.urls.sm ?? null);
            return (
              <View
                key={o.id}
                style={[
                  styles.tile,
                  {
                    width: tile + 2,
                    borderColor: mine ? theme.accent : theme.divider,
                    borderWidth: mine ? 2 : StyleSheet.hairlineWidth,
                    backgroundColor: theme.surfaceRaised,
                  },
                ]}
              >
                <View
                  style={[
                    styles.photo,
                    { width: tile, height: tile, backgroundColor: blurHashAverageColor(o.image?.blurHash ?? null) ?? theme.divider },
                  ]}
                >
                  {src !== null && <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
                  {mine && (
                    <View style={[styles.check, { backgroundColor: theme.accent }]}>
                      <MaterialCommunityIcons name="check" size={16} color="#fff" />
                    </View>
                  )}
                </View>
                <View style={styles.tileText}>
                  <Text style={[styles.name, { color: theme.textPrimary, fontFamily }]} numberOfLines={1}>
                    {o.name}
                  </Text>
                  {o.detail !== null && (
                    <Text style={[styles.detail, { color: theme.textSecondary, fontFamily }]} numberOfLines={1}>
                      {o.detail}
                    </Text>
                  )}
                  {r !== null ? (
                    <View style={styles.result}>
                      <ShareBar percent={r.percent} color={mine ? theme.accent : theme.textSecondary} track={theme.divider} />
                      <Text style={[styles.percent, { color: theme.textPrimary }]}>
                        {r.percent}%<Text style={[styles.detail, { color: theme.textSecondary }]}>  {t.votes(r.votes)}</Text>
                      </Text>
                    </View>
                  ) : closed ? null : (
                    <Pressable
                      onPress={() => vote(o.id)}
                      disabled={pending !== null || myVote !== null}
                      style={({ pressed }) => [
                        styles.voteButton,
                        { backgroundColor: theme.accent, opacity: pressed ? 0.8 : pending !== null && pending !== o.id ? 0.5 : 1 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.vote}: ${o.name}`}
                    >
                      {pending === o.id ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.voteText}>{t.vote}</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View>
          {card.options.map((o) => {
            const r = result(o.id);
            const mine = state?.myRatings.find((m) => m.optionId === o.id)?.stars ?? null;
            const picked = chosen[o.id] ?? 0;
            const src = dataSaver ? null : resolveMediaUrl(o.image?.urls.sm ?? o.image?.urls.md ?? null);
            return (
              <View key={o.id} style={[styles.row, { borderBottomColor: theme.divider }]}>
                <View style={styles.rowTop}>
                  <View style={[styles.thumb, { backgroundColor: theme.surfaceRaised }]}>
                    {src !== null ? (
                      <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                      <MaterialCommunityIcons name="storefront-outline" size={22} color={theme.textSecondary} />
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={[styles.name, { color: theme.textPrimary, fontFamily }]} numberOfLines={1}>
                      {o.name}
                    </Text>
                    <Text style={[styles.detail, { color: theme.textSecondary, fontFamily }]} numberOfLines={1}>
                      {r !== null && r.average !== null
                        ? `★ ${r.average.toFixed(1)} · ${t.ratings(r.ratings)}`
                        : t.noRatings}
                      {o.detail !== null ? `  ·  ${o.detail}` : ''}
                    </Text>
                  </View>
                </View>
                <View style={styles.rowStars}>
                  {mine !== null ? (
                    <>
                      <Text style={[styles.detail, { color: theme.textSecondary }]}>{t.youRated}</Text>
                      <StarRating value={mine} size={20} emptyColor={theme.divider} label={o.name} />
                    </>
                  ) : closed ? null : (
                    <>
                      <StarRating
                        value={picked}
                        onChange={(n) => setChosen((c) => ({ ...c, [o.id]: n }))}
                        disabled={pending !== null}
                        emptyColor={theme.textSecondary}
                        label={`${t.rate}: ${o.name}`}
                      />
                      {picked > 0 && (
                        <Pressable
                          onPress={() => submitRating(o.id)}
                          disabled={pending !== null}
                          style={({ pressed }) => [
                            styles.submit,
                            { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`${t.submit}: ${o.name}, ${picked} / 5`}
                        >
                          {pending === o.id ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={styles.voteText}>{t.submit}</Text>
                          )}
                        </Pressable>
                      )}
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.footer}>
        {note !== null ? (
          <Text style={[styles.note, { color: theme.adMark }]}>{note}</Text>
        ) : card.type === 'vote' && state?.results ? (
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {myVote !== null ? `${t.youVoted} · ` : ''}
            {t.votes(state.results.total)}
          </Text>
        ) : null}
        {credits.length > 0 && (
          <Text style={[styles.credit, { color: theme.textSecondary }]} numberOfLines={1}>
            {t.photo}: {credits.join(', ')}
          </Text>
        )}
      </View>

      <SignInSheet
        visible={asking}
        lang={ne ? 'ne' : 'en'}
        theme={theme}
        onClose={() => {
          setAsking(false);
          setPending(null);
        }}
        onSignedIn={(tk) => {
          const act = afterSignIn.current;
          afterSignIn.current = null;
          act?.(tk);
        }}
      />
    </View>
  );
}

/** Props are stable for the life of a card, like the cards around it. */
export const InteractionCard = memo(InteractionCardInner);

const styles = StyleSheet.create({
  card: { paddingTop: 18, overflow: 'hidden' },
  kickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  kickerText: { fontSize: textSize(12), fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  meta: { fontSize: textSize(12.5) },
  title: { fontWeight: '700', marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  tile: { borderRadius: 12, overflow: 'hidden' },
  photo: { overflow: 'hidden' },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { padding: 8, gap: 2 },
  name: { fontSize: textSize(14.5), fontWeight: '600' },
  detail: { fontSize: textSize(12) },
  result: { marginTop: 6, gap: 4 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, width: '100%', borderRadius: 3 },
  percent: { fontSize: textSize(14), fontWeight: '700' },
  voteButton: {
    marginTop: 6,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voteText: { color: '#fff', fontSize: textSize(13.5), fontWeight: '700' },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowStars: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, marginLeft: 46 },
  submit: { height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  footer: { marginTop: 'auto', paddingBottom: 16, paddingTop: 8, gap: 4 },
  note: { fontSize: textSize(13), fontWeight: '600' },
  credit: { fontSize: textSize(10.5), opacity: 0.8 },
});
