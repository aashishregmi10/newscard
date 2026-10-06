import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type * as WebViewModule from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { blurHashAverageColor, resolveMediaUrl } from '../api/client';
import { shortPlayerBox, shortStripHeight } from '../lib/shortLayout';
import { reportError } from '../lib/telemetry';
import { textSize } from '../theme/tokens';
import { PosterImage, ShortInfoStrip, shortStyles } from './ShortParts';
import type { ShortCardProps } from './VideoCard';

/**
 * A short that plays from a licensed publisher's YouTube channel.
 *
 * ── YouTube's player, and YouTube's rules ───────────────────────────────────
 *
 * The video is played by YouTube's own player inside a web view: that is what
 * their terms allow. Downloading it to serve ourselves is not, whatever the
 * channel agrees. Their rules also say an app must not "display overlays,
 * frames, or other visual elements in front of any part of a YouTube embedded
 * player", nor "remove, obscure, alter, or disable any links that appear in"
 * it (developers.google.com/youtube/terms). So:
 *
 *   - The player sits in a 9:16 box at the top of the card (lib/shortLayout)
 *     with nothing of ours on it. Our words, Share and sound are in a strip
 *     underneath (ShortInfoStrip).
 *   - The player takes its own touches: tapping the video is YouTube's pause
 *     and play, and its small logo — a link to YouTube — works as YouTube
 *     intends. A swipe still moves the feed.
 *   - Nothing of ours sends a reader to YouTube. There is no "Watch on YouTube"
 *     button, here or anywhere; only YouTube's own logo, if the reader taps it.
 *
 * Until 6 Oct 2026 this card drew the title, caption, a sound button and a
 * tap-to-pause layer over the player, and offered "Open in YouTube" when it
 * failed. All of that broke the rules above; the reader asked for an
 * Inshorts-like screen, and this is that screen within them.
 *
 * ── Playing ─────────────────────────────────────────────────────────────────
 *
 *   - Only the short on screen has a player; the rest are posters.
 *   - It starts by itself, WITH SOUND, on Wi-Fi and on mobile data. Only Data
 *     Saver makes it wait for a tap. If the phone refuses to start a video with
 *     sound, the page starts it muted and says so ('forced-mute'), and the
 *     speaker in the strip shows muted.
 *   - The poster stays until the video is actually moving, so the reader never
 *     sees YouTube's loading screen.
 *
 * ── Staying in the app ──────────────────────────────────────────────────────
 *
 * YouTube plays an embed only when the app identifies itself, and documents
 * two ways for an app to do that ("API Client identity"). This tries both:
 *
 *   1. embed  — YouTube's own embed page, loaded with the app in the Referer
 *      header, watched through the page's video element.
 *   2. inline — our own page running YouTube's IFrame API, with the app as its
 *      base address.
 *
 * If one is refused, or nothing moves within START_TIMEOUT_MS, the other is
 * tried; whichever last worked goes first next time. If both fail, the card
 * says so and offers Try again — never YouTube. Every refusal is reported
 * (telemetry.reportError) with YouTube's error code.
 *
 * ── A build without the web view ────────────────────────────────────────────
 *
 * The web view is a native module, looked up lazily (apps/mobile/AGENTS.md).
 * Without it the card says to update the app.
 */

type WebViewComponent = (typeof WebViewModule)['WebView'];
let cachedWebView: WebViewComponent | null | undefined;

/** Null where this build has no web view. Checked once, then remembered. */
function getWebView(): WebViewComponent | null {
  if (cachedWebView !== undefined) return cachedWebView;
  try {
    /* Ask first: the package's own module throws while loading when its
       native half is missing, and that must not be the first we hear of it. */
    if (TurboModuleRegistry.get('RNCWebViewModule') == null) {
      cachedWebView = null;
    } else {
      cachedWebView = (require('react-native-webview') as typeof WebViewModule).WebView;
    }
  } catch {
    cachedWebView = null;
  }
  if (cachedWebView === null) {
    console.info('[YouTubeShortCard] react-native-webview is not in this build; YouTube shorts need an update.');
  }
  return cachedWebView;
}

/**
 * Who the player says it is.
 *
 * `https://<app id>`, ours from app.json — YouTube's documented form for an
 * app. It must not be youtube.com: a page claiming to be YouTube is refused
 * with error 152, every video, every channel. With no identity at all the
 * refusal is error 153.
 */
const PLAYER_ORIGIN = 'https://com.saar.news';

type Mode = 'inline' | 'embed';
/** The order the two ways are tried in, until one has worked. */
const MODES: readonly Mode[] = ['embed', 'inline'];

/** The way that last started a short on this phone, for the next one. */
let lastWorked: Mode | null = null;

function triedInOrder(): Mode[] {
  const first = lastWorked ?? MODES[0]!;
  return [first, ...MODES.filter((m) => m !== first)];
}

/** Long enough for a slow mobile connection to start a short. */
const START_TIMEOUT_MS = 15_000;
/** How often the page says where the video has got to, for the progress line. */
const TIME_EVERY_MS = 500;

/*
 * Messages back from either page, the same words for both:
 *   'playing'           the video is moving (each time it starts or resumes)
 *   'paused'            it stopped (YouTube's own tap, usually)
 *   'time:<cur>/<len>'  where it has got to, every half second while playing
 *   'forced-mute'       the phone would not start it with sound; it is muted
 *   'error:<why>'       refused; <why> is YouTube's code, or 'embed' for its
 *                       error screen on the embed page
 */

/** Way 1: our page, YouTube's IFrame API, the app as the base address. */
function inlineHtml(videoId: string, muted: boolean): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head><body><div id="p"></div><script>
var player,moved=false;
function send(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m);}}
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{width:'100%',height:'100%',videoId:'${videoId}',
    playerVars:{autoplay:1,mute:${muted ? 1 : 0},playsinline:1,loop:1,playlist:'${videoId}',controls:0,rel:0,fs:0,iv_load_policy:3,disablekb:1,origin:'${PLAYER_ORIGIN}',widget_referrer:'${PLAYER_ORIGIN}'},
    events:{
      onReady:function(e){
        ${muted ? 'e.target.mute();' : 'e.target.unMute();'}e.target.playVideo();
        ${
          muted
            ? ''
            : `setTimeout(function(){if(!moved){e.target.mute();e.target.playVideo();send('forced-mute');}},2500);`
        }
      },
      onStateChange:function(e){if(e.data===1){moved=true;send('playing');}else if(e.data===2)send('paused');},
      onError:function(e){send('error:'+e.data);}
    }});
}
setInterval(function(){if(player&&player.getPlayerState&&player.getPlayerState()===1){send('time:'+player.getCurrentTime().toFixed(2)+'/'+player.getDuration().toFixed(2));}},${TIME_EVERY_MS});
var s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
</script></body></html>`;
}

/** Way 2: YouTube's own embed page, the app in the Referer header. */
function embedUrl(videoId: string, muted: boolean): string {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: muted ? '1' : '0',
    playsinline: '1',
    loop: '1',
    playlist: videoId,
    controls: '0',
    rel: '0',
    fs: '0',
    iv_load_policy: '3',
    disablekb: '1',
    origin: PLAYER_ORIGIN,
    widget_referrer: PLAYER_ORIGIN,
  });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

/**
 * Run inside the embed page.
 *
 * Starts the video — with sound if asked, falling back to muted if the phone
 * refuses — and then leaves it to YouTube: once it has moved, a pause is the
 * reader's (YouTube's own tap) and is not undone. Reports moving, stopping,
 * time and YouTube's error screen.
 */
function embedScript(muted: boolean): string {
  return `(function(){
if(window.__saar)return;window.__saar=true;
window.__saarMuted=${muted ? 'true' : 'false'};
function send(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m);}}
var failed=false,moved=false,tries=0;
function start(v){
  v.muted=window.__saarMuted;
  var p=v.play();
  if(p&&p.catch)p.catch(function(){
    if(!v.muted){v.muted=true;window.__saarMuted=true;send('forced-mute');var q=v.play();if(q&&q.catch)q.catch(function(){});}
  });
}
function tick(){
  var err=document.querySelector('.ytp-error');
  if(err&&err.offsetParent!==null){if(!failed){failed=true;send('error:embed');}return;}
  var v=document.querySelector('video');
  if(v){
    if(!v.__saar){v.__saar=true;
      v.addEventListener('playing',function(){moved=true;send('playing');});
      v.addEventListener('pause',function(){send('paused');});}
    /* YouTube may have started it before this ran, so no 'playing' event will
       come: moving now counts as started, and from here a pause is the
       reader's and is left alone. */
    if(!moved&&!v.paused){moved=true;send('playing');}
    if(!moved&&v.paused){tries++;
      if(tries>4&&!v.muted){v.muted=true;window.__saarMuted=true;send('forced-mute');}
      start(v);}
  }
  if(!moved)setTimeout(tick,600);
}
tick();
setInterval(function(){var v=document.querySelector('video');if(v&&!v.paused&&v.duration>0){send('time:'+v.currentTime.toFixed(2)+'/'+v.duration.toFixed(2));}},${TIME_EVERY_MS});
})();true;`;
}

/** What to run in the page to mute or unmute. Pausing is YouTube's own tap. */
function command(mode: Mode, what: 'mute' | 'unmute'): string {
  if (mode === 'inline') {
    const fn = what === 'mute' ? 'mute' : 'unMute';
    return `window.player && player.${fn} && player.${fn}(); true;`;
  }
  return `(function(){var v=document.querySelector('video');window.__saarMuted=${what === 'mute'};if(v)v.muted=window.__saarMuted;})(); true;`;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function YouTubeShortCard({
  video,
  height,
  textScale,
  dataSaver,
  unmetered,
  active,
  muted,
  onToggleMute,
  onMutedByPhone,
}: ShortCardProps) {
  const videoId = video.youtubeId !== null && VIDEO_ID.test(video.youtubeId) ? video.youtubeId : null;
  const WebView = getWebView();
  const { width } = useWindowDimensions();
  const ne = video.language === 'ne';

  const strip = shortStripHeight(textScale, video.language);
  const box = shortPlayerBox(width, height, strip);

  /* It plays by itself unless Data Saver is on; then a tap allows it, and that
     stays for this card. */
  const [allowed, setAllowed] = useState(!dataSaver);
  /* Fixed for this card when it mounts; "try again" starts it over. */
  const [order, setOrder] = useState<Mode[]>(triedInOrder);
  const [attempt, setAttempt] = useState(0);
  const mode = order[attempt] ?? MODES[0]!;
  /** Both ways were refused. */
  const [failed, setFailed] = useState(false);
  /** The video has moved at least once on this mount: the poster can go. */
  const [started, setStarted] = useState(false);
  const web = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const lastFraction = useRef(0);

  /* Each page is built once per video and way. Mute is sent to the running
     player rather than rebuilding it, which would restart the clip. */
  const page = useMemo(
    () =>
      videoId === null ? null : mode === 'inline' ? inlineHtml(videoId, muted) : embedUrl(videoId, muted),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoId, mode],
  );
  const injected = useMemo(
    () => (mode === 'embed' ? embedScript(muted) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode],
  );

  const playing = WebView !== null && videoId !== null && allowed && active && !failed;

  /* Off screen: the player is gone, so is what it had reached. */
  useEffect(() => {
    if (!active) {
      setStarted(false);
      progress.setValue(0);
      lastFraction.current = 0;
    }
  }, [active, progress]);

  /** One way was refused: say so, then try the next, or give up. */
  const refused = (why: string) => {
    reportError(
      new Error(`YouTube would not play ${videoId ?? '?'}: ${why} (${mode}, ${unmetered ? 'wifi' : 'mobile data'})`),
      'youtube-player',
    );
    setStarted(false);
    if (attempt + 1 < order.length) setAttempt(attempt + 1);
    else setFailed(true);
  };
  const refusedNow = useRef(refused);
  refusedNow.current = refused;

  /* Nothing moving after a while counts as a refusal too: a player stuck on
     its loading screen is no better than an error, and says less. */
  useEffect(() => {
    if (!playing || started) return;
    const t = setTimeout(() => refusedNow.current(`did not start within ${START_TIMEOUT_MS / 1000}s`), START_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [playing, started, mode]);

  useEffect(() => {
    if (!started) return;
    web.current?.injectJavaScript(command(mode, muted ? 'mute' : 'unmute'));
  }, [muted, started, mode]);

  /** Where the video has got to, glided between the half-second reports. */
  const moveTo = (fraction: number) => {
    const f = Math.min(1, Math.max(0, fraction));
    if (f < lastFraction.current) {
      /* Looped back to the start. */
      progress.setValue(f);
    } else {
      Animated.timing(progress, {
        toValue: f,
        duration: 500,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
    lastFraction.current = f;
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const m = e.nativeEvent.data;
    if (m === 'playing') {
      setStarted(true);
      lastWorked = mode;
    } else if (m.startsWith('time:')) {
      const [cur, len] = m.slice(5).split('/').map(Number);
      if (cur !== undefined && len !== undefined && len > 0) moveTo(cur / len);
    } else if (m === 'forced-mute') {
      if (!muted) onMutedByPhone();
    } else if (m.startsWith('error:')) {
      refused(`error ${m.slice(6)}`);
    }
  };

  const tryAgain = () => {
    setOrder(triedInOrder());
    setAttempt(0);
    setFailed(false);
    setStarted(false);
    setAllowed(true);
  };

  const posterColor = blurHashAverageColor(video.posterBlurHash) ?? '#111';
  const noPlayer = WebView === null || videoId === null;

  return (
    <View style={[styles.card, { height }]}>
      <View
        style={[
          styles.player,
          { left: box.left, top: box.top, width: box.width, height: box.height, backgroundColor: posterColor },
        ]}
      >
        <PosterImage uri={resolveMediaUrl(video.posterUrl) ?? ''} />

        {playing && WebView !== null && page !== null && (
          /* Hidden until the video moves, and untouchable until then: a page
             still loading must not swallow a swipe. Once it moves it is
             YouTube's, touches and all, with nothing of ours in front of it. */
          <View style={[StyleSheet.absoluteFill, !started && styles.hidden]} pointerEvents={started ? 'auto' : 'none'}>
            <WebView
              key={mode}
              ref={web as never}
              source={
                mode === 'inline'
                  ? { html: page, baseUrl: PLAYER_ORIGIN }
                  : { uri: page, headers: { Referer: `${PLAYER_ORIGIN}/` } }
              }
              injectedJavaScript={injected}
              style={styles.web}
              originWhitelist={['https://*']}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo={false}
              scrollEnabled={false}
              bounces={false}
              setSupportMultipleWindows={false}
              onMessage={onMessage}
              /* YouTube's own links — its logo, the title on pause — open
                 YouTube, as its rules require them to keep working. They are
                 the only way out to YouTube, and only when the reader taps
                 one. The player's own frames load what they need. */
              onShouldStartLoadWithRequest={(req) => {
                const stays =
                  req.url === 'about:blank' ||
                  req.url.startsWith('https://www.youtube.com/embed/') ||
                  req.url.startsWith('https://www.youtube.com/iframe_api') ||
                  /* The inline page itself, which iOS reports as a load of
                     its base address. */
                  req.url === PLAYER_ORIGIN ||
                  req.url === `${PLAYER_ORIGIN}/`;
                if (!stays && req.isTopFrame) {
                  void Linking.openURL(req.url);
                  return false;
                }
                return true;
              }}
            />
          </View>
        )}

        {/* On the poster only — the player is not showing yet, or not at all. */}
        {playing && !started && (
          <View style={shortStyles.centre} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        )}

        {!playing && (
          <View style={shortStyles.centre}>
            {noPlayer ? (
              <Text style={styles.notice}>
                {ne ? 'यो भिडियो हेर्न एप अपडेट गर्नुहोस्' : 'Update the app to play this'}
              </Text>
            ) : failed ? (
              <>
                <Text style={styles.notice}>
                  {ne ? 'यो भिडियो अहिले चल्न सकेन' : 'This short can’t play right now'}
                </Text>
                <Pressable
                  onPress={tryAgain}
                  style={styles.retry}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={ne ? 'फेरि प्रयास गर्नुहोस्' : 'Try again'}
                >
                  <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
                  <Text style={styles.retryText}>{ne ? 'फेरि प्रयास' : 'Try again'}</Text>
                </Pressable>
              </>
            ) : !allowed ? (
              /* Data Saver: nothing loads until a tap. */
              <>
                <Pressable
                  style={[shortStyles.playBig, { borderColor: 'rgba(255,255,255,0.7)' }]}
                  onPress={() => setAllowed(true)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    ne
                      ? `भिडियो चलाउनुहोस्, ${clock(video.durationSeconds)}`
                      : `Play video, ${clock(video.durationSeconds)}`
                  }
                >
                  <MaterialCommunityIcons name="play" size={34} color="#fff" />
                </Pressable>
                <Text style={shortStyles.playCost}>
                  {clock(video.durationSeconds)} · {ne ? 'डाटा सेभर' : 'Data Saver'}
                </Text>
              </>
            ) : null}
          </View>
        )}
      </View>

      <View style={[styles.stripWrap, { height: strip }]}>
        <ShortInfoStrip
          video={video}
          textScale={textScale}
          height={strip}
          muted={muted}
          onToggleMute={onToggleMute}
          progress={started ? progress : null}
          source="YouTube"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#000', overflow: 'hidden' },
  player: { position: 'absolute', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#000' },
  /* Laid out but invisible until the video moves, so the poster — not a white
     page, a black frame or YouTube's loading screen — is what shows. */
  hidden: { opacity: 0 },
  stripWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  notice: {
    color: '#fff',
    fontSize: textSize(14),
    textAlign: 'center',
    paddingHorizontal: 24,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  retryText: { color: '#fff', fontSize: textSize(13), fontWeight: '600' },
});
