import { useEffect, useRef, useState, memo } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  resolveMediaUrl,
  pickRendition,
  formatSize,
  blurHashAverageColor,
  type VideoCard as VideoCardType,
} from '../api/client';
import { LINE_HEIGHT, fontFor, type Theme } from '../theme/tokens';

/**
 * One short, full screen.
 *
 * ── The rule this component exists to enforce ───────────────────────────────
 *
 *   Video NEVER costs the reader data they did not agree to spend.
 *
 * On a metered connection nothing is fetched until the reader taps play. The
 * poster — a still, tens of kilobytes — is all that loads, and the play button
 * is labelled with the size of what tapping it will download. That label is the
 * whole design: a reader on a 1 GB monthly plan can see "1.4 MB" and decide.
 *
 * On an unmetered connection the visible short autoplays, muted, because that
 * is what the format is and a tap-to-start wall on Wi-Fi is friction for no
 * benefit.
 *
 * Muted either way until the reader asks otherwise. Sound that starts on its
 * own in a quiet room is the fastest way to have an app closed and not
 * reopened.
 */

interface Props {
  video: VideoCardType;
  theme: Theme;
  height: number;
  textScale: number;
  dataSaver: boolean;
  unmetered: boolean;
  /** Only the short actually on screen plays; the rest hold their poster. */
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
}

function VideoCardInner({
  video,
  theme,
  height,
  textScale,
  dataSaver,
  unmetered,
  active,
  muted,
  onToggleMute,
}: Props) {
  const rendition = pickRendition(video.renditions, { unmetered, dataSaver });
  const uri = resolveMediaUrl(rendition?.url) ?? '';

  /**
   * Whether this short has been allowed to load.
   *
   * On Wi-Fi it starts true, so the format works as a format. On mobile data it
   * starts false and only a deliberate tap changes it — and once changed it
   * stays changed for that card, so scrolling back does not re-ask.
   */
  const [allowed, setAllowed] = useState(unmetered && !dataSaver);
  const [ready, setReady] = useState(false);

  /** Paused by the reader, as distinct from paused because it scrolled away. */
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const trackWidth = useRef(0);

  const player = useVideoPlayer(allowed ? uri : null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  /**
   * The length to scrub against.
   *
   * `durationSeconds` comes from the server and is known before a single byte
   * of video is fetched, so the bar is the right length from the first frame
   * rather than snapping when metadata arrives. The player's own duration wins
   * once it has one, because it is the truth about this file.
   */
  const duration = player.duration > 0 ? player.duration : video.durationSeconds;

  /**
   * Follow playback, but not while the reader has hold of the bar.
   *
   * Polled rather than subscribed: a timeUpdate listener fires far more often
   * than four times a second and every one of them is a React render on a
   * device we are trying not to make work hard.
   */
  useEffect(() => {
    if (!allowed || !ready || scrubbing) return;
    const id = setInterval(() => setPosition(player.currentTime), 250);
    return () => clearInterval(id);
  }, [allowed, ready, scrubbing, player]);

  const seekTo = (seconds: number): void => {
    const clamped = Math.max(0, Math.min(duration, seconds));
    player.currentTime = clamped;
    setPosition(clamped);
  };

  /** Where in the clip a touch at `x` points, given the track's width. */
  const seekFromTouch = (x: number): number =>
    trackWidth.current > 0 ? (x / trackWidth.current) * duration : 0;

  // Mute is a property of the whole tab, not of one card: the reader turns
  // sound on once and it stays on as they scroll.
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  /**
   * Only the visible short plays.
   *
   * Without this every mounted card decodes video at once, which on an
   * entry-level device is the difference between a feed that scrolls and one
   * that stutters — and it downloads several clips the reader never watches.
   */
  useEffect(() => {
    if (!allowed) return;
    // Both conditions, and in this order: scrolling away always pauses, and a
    // reader who paused deliberately stays paused when they scroll back.
    if (active && !paused) player.play();
    else player.pause();
  }, [active, allowed, paused, player]);

  /**
   * Scrolling to another short clears a deliberate pause.
   *
   * Otherwise a reader who paused one clip finds the next one silently frozen,
   * and the cause is three swipes behind them.
   */
  useEffect(() => {
    if (!active) setPaused(false);
  }, [active]);

  const statusRef = useRef(false);
  useEffect(() => {
    if (!allowed || statusRef.current) return;
    statusRef.current = true;
    // A short delay before hiding the poster: swapping the instant the player
    // is created shows a black frame while the first keyframe decodes.
    const t = setTimeout(() => setReady(true), 350);
    return () => clearTimeout(t);
  }, [allowed]);

  const posterColor = blurHashAverageColor(video.posterBlurHash) ?? theme.surfaceRaised;
  const lh = LINE_HEIGHT[video.language];
  const fontFamily = fontFor(video.language);
  const titleSize = 21 * textScale;
  const capSize = 14.5 * textScale;

  return (
    <View style={[styles.card, { height, backgroundColor: '#000' }]}>
      {/* The poster is always mounted underneath. It is what the reader sees
          before playback, and what they fall back to if the video fails. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: posterColor }]}>
        {video.posterUrl ? (
          <PosterImage uri={resolveMediaUrl(video.posterUrl) ?? ''} />
        ) : null}
      </View>

      {allowed && ready ? (
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      ) : null}

      {/* Tap-to-load, on mobile data only. The size is on the button because a
          number is the only thing that lets someone decide. */}
      {!allowed ? (
        <View style={styles.centre}>
          <Pressable
            style={[styles.playBig, { borderColor: 'rgba(255,255,255,0.7)' }]}
            onPress={() => setAllowed(true)}
            accessibilityRole="button"
            accessibilityLabel={
              video.language === 'ne'
                ? `भिडियो चलाउनुहोस्, ${rendition ? formatSize(rendition.bytes) : ''}`
                : `Play video, ${rendition ? formatSize(rendition.bytes) : ''}`
            }
          >
            <MaterialCommunityIcons name="play" size={34} color="#fff" />
          </Pressable>
          <Text style={styles.playCost}>
            {rendition ? formatSize(rendition.bytes) : ''}
            {dataSaver ? (video.language === 'ne' ? ' · डाटा सेभर' : ' · Data Saver') : ''}
          </Text>
        </View>
      ) : !ready ? (
        <View style={styles.centre}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}

      {/*
        * Tap anywhere to pause or resume — what the format has trained people
        * to expect, and reachable wherever the thumb happens to be. Rendered
        * before the controls below so they sit above it and stay tappable.
        */}
      {allowed && ready ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setPaused((p) => !p)}
          accessibilityRole="button"
          accessibilityLabel={
            paused
              ? video.language === 'ne'
                ? 'चलाउनुहोस्'
                : 'Play'
              : video.language === 'ne'
                ? 'रोक्नुहोस्'
                : 'Pause'
          }
        >
          {paused ? (
            <View style={styles.centre}>
              <View style={styles.pausedBadge}>
                <MaterialCommunityIcons name="play" size={30} color="#fff" />
              </View>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {/* Sound control. Top right, away from the thumb that is scrolling. */}
      {allowed ? (
        <Pressable
          style={styles.mute}
          onPress={onToggleMute}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        >
          <MaterialCommunityIcons
            name={muted ? 'volume-off' : 'volume-high'}
            size={19}
            color="#fff"
          />
        </Pressable>
      ) : null}

      {/* Everything readable sits over a scrim, because footage is
          unpredictable and white text on a bright frame is unreadable. */}
      <View style={styles.scrim} pointerEvents="none" />

      {/*
        * The scrub bar.
        *
        * Wider than it looks: the visible line is 3px, the touch target is 28,
        * because a 3px target is unusable with a thumb and the alternative is a
        * bar thick enough to sit on top of the footage.
        *
        * Built on the responder system rather than a gesture library — a track
        * needs press, move and release on one view, which is exactly what the
        * responder system is, and the alternative would be a dependency for
        * three callbacks.
        */}
      {allowed && ready ? (
        <View
          style={styles.trackTouch}
          onLayout={(e) => {
            trackWidth.current = e.nativeEvent.layout.width;
          }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            setScrubbing(true);
            setPosition(seekFromTouch(e.nativeEvent.locationX));
          }}
          onResponderMove={(e) => setPosition(seekFromTouch(e.nativeEvent.locationX))}
          onResponderRelease={(e) => {
            // Seek once, on release. Seeking on every move makes the decoder
            // work far harder than the reader is asking it to.
            seekTo(seekFromTouch(e.nativeEvent.locationX));
            setScrubbing(false);
          }}
          onResponderTerminate={() => setScrubbing(false)}
          accessibilityRole="adjustable"
          accessibilityLabel={video.language === 'ne' ? 'भिडियोको स्थिति' : 'Video position'}
          accessibilityValue={{
            min: 0,
            max: Math.round(duration),
            now: Math.round(position),
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            // Five seconds a step: enough to be worth doing on a 90-second clip,
            // small enough not to overshoot the thing being looked for.
            if (e.nativeEvent.actionName === 'increment') seekTo(position + 5);
            if (e.nativeEvent.actionName === 'decrement') seekTo(position - 5);
          }}
        >
          <View style={styles.trackLine}>
            <View
              style={[
                styles.trackFill,
                { width: `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%` },
              ]}
            />
          </View>
          {/* The handle appears only while scrubbing: a permanent dot on a
              three-pixel line reads as damage rather than as a control. */}
          {scrubbing ? (
            <View
              style={[
                styles.trackHandle,
                { left: `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%` },
              ]}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.text}>
        <Text style={styles.meta}>
          {video.source.name} · {video.durationSeconds}s
        </Text>
        <Text
          style={[styles.title, { fontSize: titleSize, lineHeight: titleSize * 1.28, fontFamily }]}
          numberOfLines={3}
        >
          {video.title}
        </Text>
        <Text
          style={[styles.caption, { fontSize: capSize, lineHeight: capSize * lh, fontFamily }]}
          numberOfLines={4}
        >
          {video.caption}
        </Text>
        {/* The credit is required by the licence and is not decoration. */}
        <Text style={styles.credit} numberOfLines={1}>
          {video.credit}
        </Text>
      </View>
    </View>
  );
}

/** Split out so the poster keeps its own load state and never re-mounts when
 *  the player above it appears. */
const PosterImage = memo(function PosterImage({ uri }: { uri: string }) {
  if (!uri) return null;
  return <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />;
});

export const VideoCard = memo(VideoCardInner);

const styles = StyleSheet.create({
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
    fontSize: 12.5,
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

  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '52%',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  // 28pt of touch around a 3pt line. The target is the point; the line is only
  // what the reader sees.
  trackTouch: {
    paddingHorizontal: 20,
    height: 28,
    justifyContent: 'center',
  },
  trackLine: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  trackHandle: {
    position: 'absolute',
    // Centred on the fill: half the handle's width back, plus the track's own
    // left padding.
    marginLeft: 20 - 7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#fff',
  },

  text: { paddingHorizontal: 20, paddingBottom: 26 },
  meta: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11.5,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: { color: '#fff', fontWeight: '700', marginBottom: 8 },
  caption: { color: 'rgba(255,255,255,0.9)' },
  credit: { color: 'rgba(255,255,255,0.55)', fontSize: 10.5, marginTop: 10 },
});
