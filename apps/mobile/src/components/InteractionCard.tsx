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
  answerRatings,
  answerVote,
  blurHashAverageColor,
  fetchInteractionState,
  resolveMediaUrl,
  type InteractionCard as InteractionCardData,
  type InteractionState,
} from '../api/client';
import { leaderIndex, ratedCount, ratingTone, voteTileSize, type RatingTone } from '../lib/interactionLayout';
import { useReader } from '../state/ReaderContext';
import { useSettings } from '../state/SettingsContext';
import { fontFor, textSize, type Theme } from '../theme/tokens';
import { SignInSheet } from './SignInSheet';
import { StarAverage, StarRating } from './StarRating';

/**
 * A rating or a vote, as a card between stories.
 *
 * ── The design, and where it comes from ─────────────────────────────────────
 *
 * Redrawn 6 Oct 2026 after a reader's recording showed two small tiles, an
 * empty half-card and four heavy buttons. Modelled on what readers already
 * know:
 *
 *   Vote    YouTube's image polls (up to four photos, each with a caption) and
 *           X's polls (results the moment you vote, as percentages, with the
 *           total and the time left beneath). Photo tiles fill the card. A tap
 *           SELECTS — outline and check — and one button below confirms,
 *           because a vote is final and a stray tap while scrolling must not
 *           cast one. Then each photo shows its share, the reader's own pick
 *           marked, the leader badged.
 *   Rating  A feedback form (redrawn 7 Oct 2026 from the newsroom's example):
 *           the question, then each option's name over a row of large stars.
 *           One Send for the whole form, once every option has stars — also
 *           final. Then each option shows its average, in part-filled stars
 *           and the coloured pill of food apps (green from 4, amber from 3,
 *           red below), with the reader's own stars beside; the bar beneath
 *           gives the overall score and how many rated.
 *
 * Results stay hidden until this reader has answered, or it has closed, so
 * the first answers do not steer the rest.
 *
 * ── Feel ────────────────────────────────────────────────────────────────────
 *
 * A tap is answered at once — haptic, outline — and the request follows.
 * Results fade in over the photos and their numbers count up once. Shown
 * results refresh every ten seconds while the card is mounted and the app is
 * in front. Nothing here is in the cached feed: the card asks for its own
 * reader's state when it appears.
 */

const REFRESH_MS = 10_000;
const NOTE_MS = 4_000;

const COPY = {
  ne: {
    voteKicker: 'मतदान',
    rateKicker: 'रेटिङ',
    choose: 'एउटा छान्नुहोस्',
    voteFor: (name: string) => `मत दिनुहोस् · ${name}`,
    leading: 'अगाडि',
    leadingLine: (name: string, p: number) => `अगाडि: ${name} · ${p}%`,
    tiedLine: 'बराबरी छ',
    yourVote: 'तपाईंको मत',
    send: 'पठाउनुहोस्',
    rateAll: (done: number, all: number) => `सबैलाई तारा दिनुहोस् · ${done}/${all}`,
    you: (n: number) => `तपाईं ${n} ★`,
    people: (n: number) => `${n} जनाले रेटिङ दिए`,
    overall: (avg: string, n: number) => `समग्र ${avg} ★ · ${n} जनाको औसत`,
    noRatings: 'कसैले रेटिङ दिएनन्',
    closed: 'मतदान सकियो',
    ratingClosed: 'रेटिङ सकियो',
    votes: (n: number) => `${n} मत`,
    ratings: (n: number) => `${n} रेटिङ`,
    fresh: 'नयाँ',
    voteRule: 'एउटा Google खाता, एउटा मत · फेर्न मिल्दैन',
    rateRule: 'हरेकलाई तारा दिनुहोस्, अनि पठाउनुहोस् · फेर्न मिल्दैन',
    photos: 'तस्बिर',
    already: 'तपाईंले पहिल्यै मत दिनुभएको छ।',
    alreadyRated: 'तपाईंले पहिल्यै रेटिङ दिनुभएको छ।',
    failed: 'पठाउन सकिएन। फेरि प्रयास गर्नुहोस्।',
    signInAgain: 'फेरि साइन इन गर्नुहोस्।',
    update: 'मत दिन एपको नयाँ संस्करण चाहिन्छ।',
    left: (d: number, h: number) => (d > 0 ? `${d} दिन बाँकी` : h > 0 ? `${h} घण्टा बाँकी` : 'छिट्टै सकिन्छ'),
  },
  en: {
    voteKicker: 'Vote',
    rateKicker: 'Rate',
    choose: 'Choose one',
    voteFor: (name: string) => `Vote · ${name}`,
    leading: 'Leading',
    leadingLine: (name: string, p: number) => `Leading: ${name} · ${p}%`,
    tiedLine: 'It’s a tie',
    yourVote: 'Your vote',
    send: 'Send',
    rateAll: (done: number, all: number) => `Rate all to send · ${done}/${all}`,
    you: (n: number) => `you ${n} ★`,
    people: (n: number) => `${n} ${n === 1 ? 'person' : 'people'} rated`,
    overall: (avg: string, n: number) => `Overall ${avg} ★ · from ${n} ${n === 1 ? 'person' : 'people'}`,
    noRatings: 'Nobody rated',
    closed: 'Voting closed',
    ratingClosed: 'Rating closed',
    votes: (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`,
    ratings: (n: number) => `${n} ${n === 1 ? 'rating' : 'ratings'}`,
    fresh: 'New',
    voteRule: 'One vote per Google account · final',
    rateRule: 'Rate each, then send · final',
    photos: 'Photos',
    already: 'You have already voted.',
    alreadyRated: 'You have already rated this.',
    failed: 'Could not send. Please try again.',
    signInAgain: 'Please sign in again.',
    update: 'Voting needs the latest version of the app.',
    left: (d: number, h: number) => (d > 0 ? `${d} days left` : h > 0 ? `${h} hours left` : 'Closing soon'),
  },
} as const;

/** The average pill's colours, for light and dark. */
const TONES: Record<RatingTone, { light: [string, string]; dark: [string, string] }> = {
  good: { light: ['#EAF3DE', '#27500A'], dark: ['#27500A', '#C0DD97'] },
  fair: { light: ['#FAEEDA', '#633806'], dark: ['#633806', '#FAC775'] },
  poor: { light: ['#FCEBEB', '#791F1F'], dark: ['#791F1F', '#F7C1C1'] },
  new: { light: ['#F1EFE8', '#444441'], dark: ['#444441', '#D3D1C7'] },
};

/** A number that counts up to its value once, when it first appears. */
function CountUp({ value, style }: { value: number; style: object }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let step = 0;
    const steps = 18;
    const id = setInterval(() => {
      step += 1;
      setShown(Math.round((value * step) / steps));
      if (step >= steps) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [value]);
  return <Text style={style}>{shown}%</Text>;
}

/* ── one photo tile of a vote ──────────────────────────────────────────────── */

interface TileProps {
  option: InteractionCardData['options'][number];
  width: number;
  height: number;
  theme: Theme;
  fontFamily: string | undefined;
  dataSaver: boolean;
  selected: boolean;
  dimmed: boolean;
  percent: number | null;
  mine: boolean;
  leader: boolean;
  t: (typeof COPY)['ne' | 'en'];
  onPress: (() => void) | null;
}

function VoteTile({
  option,
  width,
  height,
  theme,
  fontFamily,
  dataSaver,
  selected,
  dimmed,
  percent,
  mine,
  leader,
  t,
  onPress,
}: TileProps) {
  const wash = useRef(new Animated.Value(percent === null ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(wash, { toValue: percent === null ? 0 : 1, duration: 320, useNativeDriver: true }).start();
  }, [percent, wash]);

  const src = dataSaver ? null : resolveMediaUrl(option.image?.urls.md ?? option.image?.urls.sm ?? null);
  const outlined = selected || mine;

  return (
    <Pressable
      onPress={onPress ?? undefined}
      disabled={onPress === null}
      style={[
        styles.tile,
        {
          width,
          height,
          backgroundColor: blurHashAverageColor(option.image?.blurHash ?? null) ?? theme.surfaceRaised,
          opacity: dimmed ? 0.72 : 1,
        },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected: outlined, disabled: onPress === null }}
      accessibilityLabel={`${option.name}${percent !== null ? `, ${percent}%` : ''}`}
    >
      {src !== null && <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" />}

      {/* The result, washed over the photo once it may be seen. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.wash, { opacity: wash, backgroundColor: mine ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.5)' }]}
      >
        {percent !== null && (
          <View style={styles.washText}>
            <CountUp value={percent} style={styles.percent} />
            {mine && <Text style={styles.washNote}>{t.yourVote}</Text>}
          </View>
        )}
      </Animated.View>

      {leader && (
        <View style={[styles.leader, { backgroundColor: theme.accent }]}>
          <MaterialCommunityIcons name="trophy-outline" size={12} color="#fff" />
          <Text style={styles.leaderText}>{t.leading}</Text>
        </View>
      )}

      {outlined && (
        <>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.outline, { borderColor: theme.accent }]} />
          <View style={[styles.check, { backgroundColor: theme.accent }]}>
            <MaterialCommunityIcons name="check" size={15} color="#fff" />
          </View>
        </>
      )}

      <View style={styles.caption}>
        <Text style={[styles.captionName, { fontFamily }]} numberOfLines={1}>
          {option.name}
        </Text>
        {option.detail !== null && (
          <Text style={[styles.captionDetail, { fontFamily }]} numberOfLines={1}>
            {option.detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/* ── the card ──────────────────────────────────────────────────────────────── */

interface Props {
  card: InteractionCardData;
  theme: Theme;
  height: number;
  textScale: number;
  dataSaver: boolean;
}

function InteractionCardInner({ card, theme, height, textScale, dataSaver }: Props) {
  const reader = useReader();
  const { isDark } = useSettings();
  const { width } = useWindowDimensions();
  const ne = card.language === 'ne';
  const t = COPY[card.language];
  const fontFamily = fontFor(card.language);
  const token = reader.session?.token ?? null;

  const [state, setState] = useState<InteractionState | null>(null);
  /** The candidate tapped, not yet confirmed. */
  const [selected, setSelected] = useState<string | null>(null);
  /** The vote or rating on its way to the server. */
  const [pending, setPending] = useState<string | null>(null);
  /** Stars picked but not yet sent, per option. */
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

  /* A message takes the footnote's place for a few seconds, then gives it back. */
  useEffect(() => {
    if (note === null) return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

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

  const confirmVote = () => {
    if (selected === null) return;
    const optionId = selected;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPending(optionId);
    signedIn(async (tk) => {
      try {
        setState(await answerVote(card.id, optionId, tk));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        refused(e, t.already);
      } finally {
        setPending(null);
      }
    });
  };

  /** The whole form, once every option has stars. */
  const sendRatings = () => {
    if (ratedCount(chosen, card.options.map((o) => o.id)) < card.options.length) return;
    const ratings = card.options.map((o) => ({ optionId: o.id, stars: chosen[o.id]! }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPending('ratings');
    signedIn(async (tk) => {
      try {
        setState(await answerRatings(card.id, ratings, tk));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setChosen({});
      } catch (e) {
        refused(e, t.alreadyRated);
      } finally {
        setPending(null);
      }
    });
  };

  const closed = state?.closed ?? false;
  const myVote = state?.myVote ?? null;
  const results = state?.results ?? null;
  const result = (id: string) => results?.options.find((o) => o.id === id) ?? null;
  const credits = [...new Set(card.options.map((o) => o.image?.credit?.trim()).filter((c): c is string => !!c))];

  let left: string | null = null;
  if (card.closesAt !== null && !closed) {
    const ms = Date.parse(card.closesAt) - Date.now();
    if (ms > 0) left = t.left(Math.floor(ms / 86_400_000), Math.floor(ms / 3_600_000));
  }
  const status = closed ? (card.type === 'vote' ? t.closed : t.ratingClosed) : left;
  /* An older server sends no respondents; its total is then the closest figure. */
  const respondents = results === null ? 0 : (results.respondents ?? results.total);
  const totalLabel = results === null ? null : card.type === 'vote' ? t.votes(results.total) : t.people(respondents);
  const meta = [totalLabel, status].filter(Boolean).join(' · ');

  const titleSize = textSize(20) * Math.min(Math.max(textScale, 0.85), 1.4);
  const pad = 18;
  const gap = 10;
  const tile = voteTileSize(width, height, card.options.length, textScale, pad, gap);
  /* Five or six options: smaller stars, so all fit the card. */
  const compact = card.type === 'rating' && card.options.length > 4;

  const footnote =
    note ??
    [card.type === 'vote' ? t.voteRule : t.rateRule, credits.length > 0 ? `${t.photos}: ${credits.join(', ')}` : null]
      .filter(Boolean)
      .join(' · ');

  /* ── the vote ── */
  const voteResults = card.type === 'vote' && results !== null && (myVote !== null || closed);
  const lead = voteResults ? leaderIndex(card.options.map((o) => result(o.id)?.votes ?? 0)) : -1;
  const answered = myVote !== null || closed;
  const selectedName = card.options.find((o) => o.id === selected)?.name ?? null;

  /* ── the rating ── */
  const myRatings = state?.myRatings ?? [];
  const ratingResults = card.type === 'rating' && results !== null;
  const done = ratedCount(chosen, card.options.map((o) => o.id));
  const allRated = done === card.options.length;

  return (
    <View style={[styles.card, { height, backgroundColor: theme.surface, paddingHorizontal: pad }]}>
      <View style={styles.header}>
        <View style={[styles.pill, { backgroundColor: theme.surfaceRaised }]}>
          <MaterialCommunityIcons
            name={card.type === 'vote' ? 'poll' : 'star-outline'}
            size={14}
            color={theme.accent}
          />
          <Text style={[styles.pillText, { color: theme.accent }]}>
            {card.type === 'vote' ? t.voteKicker : t.rateKicker}
          </Text>
        </View>
        {meta !== '' && (
          <Text style={[styles.meta, { color: theme.textSecondary }]} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>

      <Text
        style={[
          styles.title,
          { color: theme.textPrimary, fontSize: titleSize, lineHeight: titleSize * 1.32, fontFamily },
        ]}
        numberOfLines={3}
      >
        {card.title}
      </Text>

      {card.type === 'vote' ? (
        <>
          <View style={[styles.grid, { gap }]}>
            {card.options.map((o, i) => {
              const r = voteResults ? result(o.id) : null;
              return (
                <VoteTile
                  key={o.id}
                  option={o}
                  width={tile.width}
                  height={tile.height}
                  theme={theme}
                  fontFamily={fontFamily}
                  dataSaver={dataSaver}
                  selected={!answered && selected === o.id}
                  dimmed={!answered && selected !== null && selected !== o.id}
                  percent={r === null ? null : r.percent}
                  mine={myVote === o.id}
                  leader={i === lead}
                  t={t}
                  onPress={
                    answered || pending !== null
                      ? null
                      : () => {
                          void Haptics.selectionAsync();
                          setSelected((s) => (s === o.id ? null : o.id));
                        }
                  }
                />
              );
            })}
          </View>

          <View style={styles.bottomBar}>
            {voteResults ? (
              <Text style={[styles.summary, { color: theme.textPrimary, fontFamily }]} numberOfLines={1}>
                {lead >= 0
                  ? t.leadingLine(card.options[lead]!.name, result(card.options[lead]!.id)?.percent ?? 0)
                  : t.tiedLine}
              </Text>
            ) : answered ? null : (
              <Pressable
                onPress={confirmVote}
                disabled={selected === null || pending !== null}
                style={({ pressed }) => [
                  styles.confirm,
                  selected === null
                    ? { backgroundColor: 'transparent', borderColor: theme.divider, borderWidth: 1 }
                    : { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: selected === null }}
              >
                {pending !== null ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text
                    style={[styles.confirmText, { color: selected === null ? theme.textSecondary : '#fff', fontFamily }]}
                    numberOfLines={1}
                  >
                    {selectedName === null ? t.choose : t.voteFor(selectedName)}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </>
      ) : (
        <>
          <View style={styles.rows}>
            {card.options.map((o) => {
              const r = ratingResults ? result(o.id) : null;
              const mine = myRatings.find((m) => m.optionId === o.id)?.stars ?? null;
              const src = dataSaver ? null : resolveMediaUrl(o.image?.urls.sm ?? o.image?.urls.md ?? null);
              const tone = ratingTone(r?.average ?? null);
              const [pillBg, pillFg] = TONES[tone][isDark ? 'dark' : 'light'];
              return (
                <View key={o.id} style={[styles.rateRow, compact && styles.rateRowCompact]}>
                  <View style={styles.rateHead}>
                    {src !== null && <Image source={{ uri: src }} style={styles.rateThumb} resizeMode="cover" />}
                    <Text style={[styles.rateName, { color: theme.textPrimary, fontFamily }]} numberOfLines={1}>
                      {o.name}
                      {o.detail !== null && (
                        <Text style={[styles.rateDetail, { color: theme.textSecondary }]}>{`  ${o.detail}`}</Text>
                      )}
                    </Text>
                    {r !== null && (
                      <View style={[styles.avg, { backgroundColor: pillBg }]}>
                        <Text style={[styles.avgText, { color: pillFg }]}>
                          {r.average !== null ? `${r.average.toFixed(1)} ★` : t.fresh}
                        </Text>
                      </View>
                    )}
                  </View>

                  {r !== null ? (
                    <View style={styles.rateResult}>
                      <StarAverage
                        value={r.average ?? 0}
                        size={compact ? 20 : 24}
                        emptyColor={theme.divider}
                        label={o.name}
                      />
                      <Text style={[styles.rateCount, { color: theme.textSecondary, fontFamily }]} numberOfLines={1}>
                        {mine !== null ? `${t.ratings(r.ratings)} · ${t.you(mine)}` : t.ratings(r.ratings)}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.rateStars}>
                      <StarRating
                        value={chosen[o.id] ?? 0}
                        size={compact ? 28 : 34}
                        onChange={(n) => setChosen((c) => ({ ...c, [o.id]: n }))}
                        disabled={pending !== null || closed}
                        emptyColor={theme.textSecondary}
                        label={`${t.rateKicker}: ${o.name}`}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.bottomBar}>
            {ratingResults ? (
              <Text style={[styles.summary, { color: theme.textPrimary, fontFamily }]} numberOfLines={1}>
                {results!.average !== null ? t.overall(results!.average.toFixed(1), respondents) : t.noRatings}
              </Text>
            ) : closed ? null : (
              <Pressable
                onPress={sendRatings}
                disabled={!allRated || pending !== null}
                style={({ pressed }) => [
                  styles.confirm,
                  allRated
                    ? { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }
                    : { backgroundColor: 'transparent', borderColor: theme.divider, borderWidth: 1 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !allRated }}
              >
                {pending !== null ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text
                    style={[styles.confirmText, { color: allRated ? '#fff' : theme.textSecondary, fontFamily }]}
                    numberOfLines={1}
                  >
                    {allRated ? t.send : t.rateAll(done, card.options.length)}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </>
      )}

      <Text
        style={[styles.footnote, { color: note !== null ? theme.adMark : theme.textSecondary }]}
        numberOfLines={2}
      >
        {footnote}
      </Text>

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
  card: { paddingTop: 16, paddingBottom: 14, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: textSize(12), fontWeight: '700', letterSpacing: 0.3 },
  meta: { flexShrink: 1, fontSize: textSize(12.5) },
  title: { fontWeight: '700', marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  tile: { borderRadius: 14, overflow: 'hidden', justifyContent: 'flex-end' },
  wash: { alignItems: 'center', justifyContent: 'center' },
  washText: { alignItems: 'center', marginBottom: 26 },
  percent: { color: '#fff', fontSize: textSize(28), fontWeight: '800' },
  washNote: { color: '#fff', fontSize: textSize(12), fontWeight: '600', marginTop: 2 },
  outline: { borderWidth: 3, borderRadius: 14 },
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
  leader: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  leaderText: { color: '#fff', fontSize: textSize(11), fontWeight: '700' },
  caption: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: 'rgba(0,0,0,0.55)' },
  captionName: { color: '#fff', fontSize: textSize(14), fontWeight: '700' },
  captionDetail: { color: 'rgba(255,255,255,0.85)', fontSize: textSize(11.5) },
  bottomBar: { height: 52, justifyContent: 'center', marginTop: 12 },
  confirm: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  confirmText: { fontSize: textSize(15), fontWeight: '700' },
  summary: { textAlign: 'center', fontSize: textSize(15), fontWeight: '700' },
  rows: { flex: 1, justifyContent: 'center' },
  rateRow: { paddingVertical: 9 },
  rateRowCompact: { paddingVertical: 5 },
  rateHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  rateThumb: { width: 28, height: 28, borderRadius: 8 },
  rateName: { flex: 1, minWidth: 0, fontSize: textSize(15.5), fontWeight: '700' },
  rateDetail: { fontSize: textSize(12.5), fontWeight: '400' },
  /* The stars' targets are wider than the stars; this lines the first star's
   * edge up with the name above it. */
  rateStars: { marginLeft: -6, marginTop: 2 },
  rateResult: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  rateCount: { flexShrink: 1, fontSize: textSize(12.5) },
  avg: { minWidth: 54, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, alignItems: 'center' },
  avgText: { fontSize: textSize(14), fontWeight: '800' },
  footnote: { marginTop: 'auto', paddingTop: 10, fontSize: textSize(11.5), textAlign: 'center' },
});
