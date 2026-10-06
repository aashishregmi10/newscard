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
import { leaderIndex, ratingTone, voteTileSize, type RatingTone } from '../lib/interactionLayout';
import { useReader } from '../state/ReaderContext';
import { useSettings } from '../state/SettingsContext';
import { fontFor, textSize, type Theme } from '../theme/tokens';
import { SignInSheet } from './SignInSheet';
import { StarRating } from './StarRating';

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
 *   Rating  Google Play's large average beside its stars, and the coloured
 *           average pill of food apps (green from 4, amber from 3, red below).
 *           Large stars to pick, then Send — also final.
 *
 * Totals stay hidden until this reader has voted, or the vote has closed, so
 * the first votes do not steer the rest; a rating's averages always show.
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
    yourRating: 'तपाईंको रेटिङ',
    send: 'पठाउनुहोस्',
    closed: 'मतदान सकियो',
    ratingClosed: 'रेटिङ सकियो',
    votes: (n: number) => `${n} मत`,
    ratings: (n: number) => `${n} रेटिङ`,
    fresh: 'नयाँ',
    voteRule: 'एउटा Google खाता, एउटा मत · फेर्न मिल्दैन',
    rateRule: 'ताराहरू छुनुहोस्, अनि पठाउनुहोस् · फेर्न मिल्दैन',
    photos: 'तस्बिर',
    already: 'तपाईंले पहिल्यै मत दिनुभएको छ।',
    alreadyRated: 'यसलाई तपाईंले पहिल्यै रेटिङ दिनुभएको छ।',
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
    yourRating: 'Your rating',
    send: 'Send',
    closed: 'Voting closed',
    ratingClosed: 'Rating closed',
    votes: (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`,
    ratings: (n: number) => `${n} ${n === 1 ? 'rating' : 'ratings'}`,
    fresh: 'New',
    voteRule: 'One vote per Google account · final',
    rateRule: 'Pick stars, then send · final',
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

/** A steady colour per name, for a business without a photo. */
function initialColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h}, 42%, 42%)`;
}

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
  /** Stars picked but not yet sent, per business. */
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

  const sendRating = (optionId: string) => {
    const stars = chosen[optionId];
    if (!stars) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPending(optionId);
    signedIn(async (tk) => {
      try {
        setState(await answerRating(card.id, optionId, stars, tk));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
  const results = state?.results ?? null;
  const result = (id: string) => results?.options.find((o) => o.id === id) ?? null;
  const credits = [...new Set(card.options.map((o) => o.image?.credit?.trim()).filter((c): c is string => !!c))];

  let left: string | null = null;
  if (card.closesAt !== null && !closed) {
    const ms = Date.parse(card.closesAt) - Date.now();
    if (ms > 0) left = t.left(Math.floor(ms / 86_400_000), Math.floor(ms / 3_600_000));
  }
  const status = closed ? (card.type === 'vote' ? t.closed : t.ratingClosed) : left;
  const totalLabel =
    results === null ? null : card.type === 'vote' ? t.votes(results.total) : t.ratings(results.total);
  const meta = [totalLabel, status].filter(Boolean).join(' · ');

  const titleSize = textSize(20) * Math.min(Math.max(textScale, 0.85), 1.4);
  const pad = 18;
  const gap = 10;
  const tile = voteTileSize(width, height, card.options.length, textScale, pad, gap);
  /* Five or six businesses: smaller photos and stars, so all fit the card. */
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
        <View style={styles.rows}>
          {card.options.map((o, i) => {
            const r = result(o.id);
            const mine = state?.myRatings.find((m) => m.optionId === o.id)?.stars ?? null;
            const picked = chosen[o.id] ?? 0;
            const tone = ratingTone(r?.average ?? null);
            const [pillBg, pillFg] = TONES[tone][isDark ? 'dark' : 'light'];
            const src = dataSaver ? null : resolveMediaUrl(o.image?.urls.sm ?? o.image?.urls.md ?? null);
            const sub = [o.detail, r !== null && r.ratings > 0 ? t.ratings(r.ratings) : null].filter(Boolean).join(' · ');
            return (
              <View
                key={o.id}
                style={[
                  styles.row,
                  { maxHeight: compact ? 96 : 124 },
                  i < card.options.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
                ]}
              >
                <View style={styles.rowTop}>
                  <View
                    style={[
                      styles.thumb,
                      compact && styles.thumbCompact,
                      { backgroundColor: src !== null ? theme.surfaceRaised : initialColour(o.name) },
                    ]}
                  >
                    {src !== null ? (
                      <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                      <Text style={styles.thumbInitial}>{[...o.name.trim()][0] ?? '·'}</Text>
                    )}
                  </View>
                  <View style={styles.rowMiddle}>
                    <Text style={[styles.rowName, { color: theme.textPrimary, fontFamily }]} numberOfLines={1}>
                      {o.name}
                    </Text>
                    {sub !== '' && (
                      <Text style={[styles.rowSub, { color: theme.textSecondary, fontFamily }]} numberOfLines={1}>
                        {sub}
                      </Text>
                    )}
                  </View>
                  <View style={[styles.avg, { backgroundColor: pillBg }]}>
                    <Text style={[styles.avgText, { color: pillFg }]}>
                      {r?.average != null ? `${r.average.toFixed(1)} ★` : t.fresh}
                    </Text>
                  </View>
                </View>

                <View style={styles.starsLine}>
                  {mine !== null ? (
                    <>
                      <StarRating value={mine} size={compact ? 18 : 20} emptyColor={theme.divider} label={o.name} />
                      <MaterialCommunityIcons name="check-circle" size={16} color={pillFg} />
                      <Text style={[styles.rowSub, { color: theme.textSecondary }]}>{t.yourRating}</Text>
                    </>
                  ) : closed ? null : (
                    <>
                      <StarRating
                        value={picked}
                        size={compact ? 24 : 28}
                        onChange={(n) => setChosen((c) => ({ ...c, [o.id]: n }))}
                        disabled={pending !== null}
                        emptyColor={theme.textSecondary}
                        label={`${t.rateKicker}: ${o.name}`}
                      />
                      {picked > 0 && (
                        <Pressable
                          onPress={() => sendRating(o.id)}
                          disabled={pending !== null}
                          style={({ pressed }) => [styles.send, { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${t.send}: ${o.name}, ${picked} / 5`}
                        >
                          {pending === o.id ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={styles.sendText}>{t.send}</Text>
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
  rows: { flex: 1 },
  row: { flex: 1, justifyContent: 'center', paddingVertical: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbCompact: { width: 40, height: 40, borderRadius: 10 },
  thumbInitial: { color: '#fff', fontSize: textSize(20), fontWeight: '700' },
  rowMiddle: { flex: 1, minWidth: 0 },
  rowName: { fontSize: textSize(15), fontWeight: '700' },
  rowSub: { fontSize: textSize(12) },
  starsLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, minHeight: 36 },
  send: { height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: textSize(13), fontWeight: '700' },
  avg: { minWidth: 54, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, alignItems: 'center' },
  avgText: { fontSize: textSize(14), fontWeight: '800' },
  footnote: { marginTop: 'auto', paddingTop: 10, fontSize: textSize(11.5), textAlign: 'center' },
});
