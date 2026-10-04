import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { VideoCard as VideoCardType } from '../api/client';
import { LINE_HEIGHT, fontFor, textSize } from '../theme/tokens';

/**
 * What every short shows, whoever plays the video.
 *
 * An uploaded short (VideoCard) and a YouTube one (YouTubeShortCard) differ in
 * the player and nothing else a reader reads: the poster underneath and the
 * words over it are the same, from here, so the two cannot drift.
 */

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
