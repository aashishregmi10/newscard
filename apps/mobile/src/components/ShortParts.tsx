import { memo } from 'react';
import { Animated, Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { VideoCard as VideoCardType } from '../api/client';
import { relativeTime } from '../lib/relativeTime';
import { LINE_HEIGHT, fontFor, textSize } from '../theme/tokens';

/**
 * What every short shows, whoever plays the video.
 *
 * Our own uploaded shorts (VideoCard) carry their words over the video, in
 * ShortText. A YouTube short cannot: YouTube's rules forbid anything drawn in
 * front of its player, so its words go in ShortInfoStrip, underneath. Both are
 * built from here, so the two say the same things the same way.
 */

/**
 * Share a short: its title, who made it, and — for a YouTube short — the
 * Short's own address, so the credit travels with it.
 */
export function shareShort(video: VideoCardType): void {
  const link = video.youtubeId ? `https://www.youtube.com/shorts/${video.youtubeId}` : null;
  const via = video.language === 'ne' ? 'SAAR मा हेरिएको' : 'Seen on SAAR';
  void Share.share({
    message: [video.title, '', `${video.source.name}${link ? ' · YouTube' : ''}`, link ?? via].join('\n'),
  }).catch(() => undefined);
}

/** A steady colour per publisher for the initial in their circle. */
function avatarColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h}, 45%, 38%)`;
}

/**
 * The strip under a YouTube short: who made it and when, Share and sound, the
 * title and the caption, and a thin progress line along its top edge.
 *
 * Laid out in the space a vertical video leaves on a phone, so the player above
 * stays clear of anything of ours.
 */
export function ShortInfoStrip({
  video,
  textScale,
  height,
  muted,
  onToggleMute,
  progress,
  source,
}: {
  video: VideoCardType;
  textScale: number;
  height: number;
  muted: boolean;
  onToggleMute: () => void;
  /** 0–1, or null before the video has started. */
  progress: Animated.Value | null;
  /** Where it was published, after the time: "YouTube". */
  source: string | null;
}) {
  const ne = video.language === 'ne';
  const lh = LINE_HEIGHT[video.language];
  const fontFamily = fontFor(video.language);
  const scale = Math.min(Math.max(textScale, 0.85), 1.4);
  const titleSize = textSize(16) * scale;
  const capSize = textSize(13.5) * scale;
  const initial = [...video.source.name.trim()][0] ?? '·';
  const when = relativeTime(new Date(video.publishedAt), video.language);

  return (
    <View style={[stripStyles.strip, { height }]}>
      <View style={stripStyles.track}>
        {progress !== null && (
          <Animated.View
            style={[stripStyles.fill, { transformOrigin: 'left', transform: [{ scaleX: progress }] }]}
          />
        )}
      </View>

      <View style={stripStyles.head}>
        <View style={[stripStyles.avatar, { backgroundColor: avatarColour(video.source.name) }]}>
          <Text style={stripStyles.avatarText}>{initial}</Text>
        </View>
        <Text style={stripStyles.meta} numberOfLines={1}>
          <Text style={stripStyles.name}>{video.source.name}</Text>
          {`  ·  ${when}${source !== null ? `  ·  ${source}` : ''}`}
        </Text>
        <Pressable
          onPress={() => shareShort(video)}
          hitSlop={8}
          style={stripStyles.action}
          accessibilityRole="button"
          accessibilityLabel={ne ? 'सेयर गर्नुहोस्' : 'Share'}
        >
          <MaterialCommunityIcons name="share-variant-outline" size={21} color="#fff" />
        </Pressable>
        <Pressable
          onPress={onToggleMute}
          hitSlop={8}
          style={stripStyles.action}
          accessibilityRole="button"
          accessibilityLabel={muted ? (ne ? 'आवाज खोल्नुहोस्' : 'Unmute') : ne ? 'आवाज बन्द गर्नुहोस्' : 'Mute'}
        >
          <MaterialCommunityIcons name={muted ? 'volume-off' : 'volume-high'} size={22} color="#fff" />
        </Pressable>
      </View>

      <Text
        style={[stripStyles.title, { fontSize: titleSize, lineHeight: titleSize * 1.28, fontFamily }]}
        numberOfLines={2}
      >
        {video.title}
      </Text>
      {video.caption ? (
        <Text
          style={[stripStyles.caption, { fontSize: capSize, lineHeight: capSize * lh, fontFamily }]}
          numberOfLines={2}
        >
          {video.caption}
        </Text>
      ) : null}
    </View>
  );
}

const stripStyles = StyleSheet.create({
  strip: { paddingHorizontal: 16, backgroundColor: '#000' },
  track: { height: 2, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  fill: { height: 2, width: '100%', backgroundColor: '#fff' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  avatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: textSize(13), fontWeight: '700' },
  meta: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: textSize(12) },
  name: { color: '#fff', fontWeight: '700' },
  action: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '700', marginBottom: 4 },
  caption: { color: 'rgba(255,255,255,0.82)' },
});

/** Split out so the poster keeps its own load state and never re-mounts when
 *  the player above it appears. */
export const PosterImage = memo(function PosterImage({ uri }: { uri: string }) {
  if (!uri) return null;
  return <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />;
});

/**
 * The words over a short: publisher and length, title, caption, credit.
 *
 * `rightInset` keeps them clear of a corner the player owns — YouTube's logo
 * sits bottom right, and their terms do not let us cover it.
 */
export function ShortText({
  video,
  textScale,
  note,
  rightInset = 20,
}: {
  video: VideoCardType;
  textScale: number;
  /** A word after the length, e.g. "YouTube". */
  note?: string;
  rightInset?: number;
}) {
  const lh = LINE_HEIGHT[video.language];
  const fontFamily = fontFor(video.language);
  const titleSize = textSize(21) * textScale;
  const capSize = textSize(14.5) * textScale;

  return (
    <View style={[shortStyles.text, { paddingRight: rightInset }]}>
      <Text style={shortStyles.meta}>
        {video.source.name} · {note !== undefined ? `${note} · ` : ''}
        {video.durationSeconds}s
      </Text>
      <Text
        style={[shortStyles.title, { fontSize: titleSize, lineHeight: titleSize * 1.28, fontFamily }]}
        numberOfLines={3}
      >
        {video.title}
      </Text>
      <Text
        style={[shortStyles.caption, { fontSize: capSize, lineHeight: capSize * lh, fontFamily }]}
        numberOfLines={4}
      >
        {video.caption}
      </Text>
      {/* The credit is required by the licence and is not decoration. */}
      <Text style={shortStyles.credit} numberOfLines={1}>
        {video.credit}
      </Text>
    </View>
  );
}

/**
 * A soft shadow around each letter, in place of a dark band.
 *
 * The words used to sit on a half-black block across the bottom half of the
 * frame, which hid half the video. A shadow keeps white text readable on a
 * bright frame while the footage stays as it was shot.
 */
const readable = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

export const shortStyles = StyleSheet.create({
  card: { justifyContent: 'flex-end', overflow: 'hidden' },
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBig: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  playCost: {
    color: '#fff',
    fontSize: textSize(12.5),
    marginTop: 12,
    opacity: 0.9,
    letterSpacing: 0.3,
  },
  mute: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pausedBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  text: { paddingHorizontal: 20, paddingBottom: 26 },
  meta: {
    ...readable,
    color: 'rgba(255,255,255,0.85)',
    fontSize: textSize(11.5),
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: { ...readable, color: '#fff', fontWeight: '700', marginBottom: 8 },
  caption: { ...readable, color: '#fff' },
  credit: { ...readable, color: 'rgba(255,255,255,0.75)', fontSize: textSize(10.5), marginTop: 10 },
});
