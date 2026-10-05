import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type * as WebViewModule from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { blurHashAverageColor, resolveMediaUrl } from '../api/client';
import { reportError } from '../lib/telemetry';
import { textSize } from '../theme/tokens';
import { PosterImage, ShortText, shortStyles } from './ShortParts';
import type { ShortCardProps } from './VideoCard';

/**
 * A short that plays from a licensed publisher's YouTube channel.
 *
 * ── YouTube's player, never a copy ──────────────────────────────────────────
 *
 * The video is played by YouTube's own player inside a web view: that is what
 * their terms allow. Downloading it to serve ourselves is not, whatever the
 * channel agrees. Their logo stays visible, our words stay clear of it, and no
 * ad is ever put on it.
 *
 * ── The same rules as every other short ─────────────────────────────────────
 *
 *   - Only the short on screen has a player; the rest are posters. A web view
 *     is heavier than our own player, so this matters more here, not less.
 *   - On Wi-Fi it starts by itself, muted. On mobile data or with Data Saver
 *     nothing loads until a tap.
 *   - The tab's mute applies; a tap anywhere pauses.
 *   - The poster stays until the video is actually moving, so the reader never
 *     sees YouTube's loading screen or its controls.
 *
 * ── Staying in the app ──────────────────────────────────────────────────────
 *
 * YouTube plays an embed only when the app identifies itself, and it documents
 * two ways for an app to do that (developers.google.com/youtube/terms/
 * required-minimum-functionality, "API Client identity"). This tries both:
 *
 *   1. embed  — YouTube's own embed page, loaded with the app in the Referer
 *      header. Controlled through the page's video element.
 *   2. inline — our own page running YouTube's IFrame API, with the app as its
 *      base address. Controlled through the API.
 *
 * The inline way alone shipped first, and on a reader's phone (5 Oct 2026)
 * shorts still ended on "Watch on YouTube". The embed way was then seen to
 * start by itself, muted, and to pause, resume and unmute, so it goes first.
 *
 * If one is refused, or does not start within START_TIMEOUT_MS, the other is
 * tried. Whichever way last worked is tried first by the next short, so a
 * phone where only one works pays for finding that out once. Only if both fail
 * does the card say so — and then the big button tries again. Opening YouTube
 * is a separate, smaller choice the reader makes; the app never sends them
 * there on its own.
 *
 * Every refusal is reported (telemetry.reportError) with YouTube's error code,
 * because a phone is the only place this can fail and the only place nobody is
 * watching the logs.
 *
 * ── A build without the web view ────────────────────────────────────────────
 *
 * The web view is a native module. A build made before it was added does not
 * have it, and importing it there would take down the whole Shorts tab — see
 * apps/mobile/AGENTS.md. So it is looked up lazily, and without it the poster
 * offers to open the Short in YouTube instead.
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
    console.info('[YouTubeShortCard] react-native-webview is not in this build; Shorts open in YouTube.');
  }
  return cachedWebView;
}

/**
 * Who the player says it is.
 *
 * `https://<app id>`, ours from app.json — YouTube's documented form for an
 * app. It must not be youtube.com: a page claiming to be YouTube is refused
 * with error 152, every video, every channel. That was this file's first
 * version. With no identity at all the refusal is error 153.
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

/*
 * Messages back from either page, the same words for both:
 *   'playing'      the video is moving (each time it starts or resumes)
 *   'paused'       it stopped
 *   'error:<why>'  refused; <why> is YouTube's code, or 'embed' for its error
 *                  screen on the embed page
 */

/** Way 1: our page, YouTube's IFrame API, the app as the base address. */
function inlineHtml(videoId: string, muted: boolean): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head><body><div id="p"></div><script>
var player;
function send(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m);}}
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{width:'100%',height:'100%',videoId:'${videoId}',
    playerVars:{autoplay:1,mute:1,playsinline:1,loop:1,playlist:'${videoId}',controls:0,rel:0,fs:0,iv_load_policy:3,disablekb:1,origin:'${PLAYER_ORIGIN}',widget_referrer:'${PLAYER_ORIGIN}'},
    events:{
      onReady:function(e){${muted ? 'e.target.mute();' : 'e.target.unMute();'}e.target.playVideo();},
      onStateChange:function(e){if(e.data===1)send('playing');else if(e.data===2)send('paused');},
      onError:function(e){send('error:'+e.data);}
    }});
}
var s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
</script></body></html>`;
}

/** Way 2: YouTube's own embed page, the app in the Referer header. */
function embedUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
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
 * Run inside the embed page: report its video moving or stopping, and keep it
 * playing (muted as asked) unless the reader has paused it. YouTube's own
 * error screen is reported as 'error:embed'.
 */
function embedScript(muted: boolean): string {
  return `(function(){
if(window.__saar)return;window.__saar=true;
window.__saarMuted=${muted ? 'true' : 'false'};window.__saarHeld=false;
function send(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m);}}
var failed=false;
function tick(){
  var err=document.querySelector('.ytp-error');
  if(err&&err.offsetParent!==null){if(!failed){failed=true;send('error:embed');}return;}
  var v=document.querySelector('video');
  if(v){
    if(!v.__saar){v.__saar=true;
      v.addEventListener('playing',function(){send('playing');});
      v.addEventListener('pause',function(){send('paused');});}
    v.muted=window.__saarMuted;
    if(v.paused&&!window.__saarHeld){var p=v.play();if(p&&p.catch)p.catch(function(){});}
  }
  setTimeout(tick,700);
}
tick();
})();true;`;
}

/** What to run in the page to mute, unmute, pause or resume. */
function command(mode: Mode, what: 'mute' | 'unmute' | 'pause' | 'play'): string {
  if (mode === 'inline') {
    const fn = { mute: 'mute', unmute: 'unMute', pause: 'pauseVideo', play: 'playVideo' }[what];
    return `window.player && player.${fn} && player.${fn}(); true;`;
  }
  const state =
    what === 'mute' || what === 'unmute'
      ? `window.__saarMuted=${what === 'mute'};if(v)v.muted=window.__saarMuted;`
      : `window.__saarHeld=${what === 'pause'};if(v){${what === 'pause' ? 'v.pause()' : 'var p=v.play();if(p&&p.catch)p.catch(function(){})'};}`;
  return `(function(){var v=document.querySelector('video');${state}})(); true;`;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function YouTubeShortCard({
  video,
  theme,
  height,
  textScale,
  dataSaver,
  unmetered,
  active,
  muted,
  onToggleMute,
}: ShortCardProps) {
  const videoId = video.youtubeId !== null && VIDEO_ID.test(video.youtubeId) ? video.youtubeId : null;
  const WebView = getWebView();

  /* Same as an uploaded short: on Wi-Fi it is allowed from the start; on
     mobile data only a tap allows it, and that stays for this card. */
  const [allowed, setAllowed] = useState(unmetered && !dataSaver);
  /* Fixed for this card when it mounts; "try again" starts it over. */
  const [order, setOrder] = useState<Mode[]>(triedInOrder);
  const [attempt, setAttempt] = useState(0);
  const mode = order[attempt] ?? MODES[0]!;
  /** Both ways were refused. */
  const [failed, setFailed] = useState(false);
  /** The video has moved at least once on this mount: the poster can go. */
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const web = useRef<{ injectJavaScript: (js: string) => void } | null>(null);

  /* Each page is built once per video and way. Mute and pause are sent to the
     running player rather than rebuilding it, which would restart the clip. */
  const page = useMemo(
    () => (videoId === null ? null : mode === 'inline' ? inlineHtml(videoId, muted) : embedUrl(videoId)),
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
      setPaused(false);
    }
  }, [active]);

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

  useEffect(() => {
    if (!started) return;
    web.current?.injectJavaScript(command(mode, paused ? 'pause' : 'play'));
  }, [paused, started, mode]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = e.nativeEvent.data;
    if (m === 'playing') {
      setStarted(true);
      lastWorked = mode;
    }
    else if (m.startsWith('error:')) refused(`error ${m.slice(6)}`);
  };

  const openInYouTube = () => {
    if (videoId !== null) void Linking.openURL(`https://www.youtube.com/shorts/${videoId}`);
  };

  const tryAgain = () => {
    setOrder(triedInOrder());
    setAttempt(0);
    setFailed(false);
    setStarted(false);
    setPaused(false);
    setAllowed(true);
  };

  const posterColor = blurHashAverageColor(video.posterBlurHash) ?? theme.surfaceRaised;
  const ne = video.language === 'ne';
  const noPlayer = WebView === null || videoId === null;

  return (
    <View style={[shortStyles.card, { height, backgroundColor: '#000' }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: posterColor }]}>
        <PosterImage uri={resolveMediaUrl(video.posterUrl) ?? ''} />
      </View>

      {playing && WebView !== null && page !== null && (
        /* Never touched directly: once it moves, the pause layer below takes
           every tap, and until then a hidden web page must not swallow the
           swipe to the next short or the pull to refresh. */
        <View style={[StyleSheet.absoluteFill, !started && styles.hidden]} pointerEvents="none">
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
            /* Anything that would navigate the player away — YouTube's own
               logo, a suggested video — goes to YouTube instead of replacing
               the short inside our app. Only the top frame: the player's own
               frames load what they need. */
            onShouldStartLoadWithRequest={(req) => {
              const stays =
                req.url === 'about:blank' ||
                req.url.startsWith('https://www.youtube.com/embed/') ||
                req.url.startsWith('https://www.youtube.com/iframe_api') ||
                /* The inline page itself, which iOS reports as a load of its
                   base address. */
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

      {/* Waiting for a tap (mobile data, Data Saver), or both ways refused, or
          a build without the web view. */}
      {!playing && (
        <View style={shortStyles.centre}>
          <Pressable
            style={[shortStyles.playBig, { borderColor: 'rgba(255,255,255,0.7)' }]}
            onPress={noPlayer ? openInYouTube : failed ? tryAgain : () => setAllowed(true)}
            accessibilityRole="button"
            accessibilityLabel={
              noPlayer
                ? ne
                  ? 'युट्युबमा हेर्नुहोस्'
                  : 'Watch on YouTube'
                : failed
                  ? ne
                    ? 'फेरि चलाउनुहोस्'
                    : 'Try playing again'
                  : ne
                    ? `भिडियो चलाउनुहोस्, ${clock(video.durationSeconds)}`
                    : `Play video, ${clock(video.durationSeconds)}`
            }
          >
            <MaterialCommunityIcons
              name={noPlayer ? 'youtube' : failed ? 'refresh' : 'play'}
              size={34}
              color="#fff"
            />
          </Pressable>
          <Text style={shortStyles.playCost}>
            {noPlayer
              ? ne
                ? 'युट्युबमा हेर्नुहोस्'
                : 'Watch on YouTube'
              : failed
                ? ne
                  ? 'चलेन — फेरि प्रयास गर्नुहोस्'
                  : 'Could not play — try again'
                : `${ne ? 'चलाउनुहोस्' : 'Play'} · ${clock(video.durationSeconds)}`}
          </Text>
          {/* Only after both ways failed, and only if the reader chooses it. */}
          {failed && !noPlayer && (
            <Pressable onPress={openInYouTube} hitSlop={10} accessibilityRole="link" style={styles.elsewhere}>
              <Text style={styles.elsewhereText}>{ne ? 'युट्युबमा खोल्नुहोस्' : 'Open in YouTube'}</Text>
            </Pressable>
          )}
        </View>
      )}

      {playing && !started && (
        <View style={shortStyles.centre} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {/* Tap anywhere to pause or resume. Above the web view, so the touch is
          ours and the player's own controls never appear. */}
      {playing && started && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setPaused((p) => !p)}
          accessibilityRole="button"
          accessibilityLabel={paused ? (ne ? 'चलाउनुहोस्' : 'Play') : ne ? 'रोक्नुहोस्' : 'Pause'}
        >
          {paused ? (
            <View style={shortStyles.centre}>
              <View style={shortStyles.pausedBadge}>
                <MaterialCommunityIcons name="play" size={30} color="#fff" />
              </View>
            </View>
          ) : null}
        </Pressable>
      )}

      {playing && (
        <Pressable
          style={shortStyles.mute}
          onPress={onToggleMute}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        >
          <MaterialCommunityIcons name={muted ? 'volume-off' : 'volume-high'} size={19} color="#fff" />
        </Pressable>
      )}

      {/* Clear of the bottom-right corner, where YouTube's logo sits. */}
      <ShortText video={video} textScale={textScale} note="YouTube" rightInset={84} />
    </View>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#000' },
  /* Laid out but invisible until the video moves, so the poster — not a
     white page, a black frame or YouTube's loading screen — is what shows. */
  hidden: { opacity: 0 },
  elsewhere: { marginTop: 14, paddingVertical: 4, paddingHorizontal: 8 },
  elsewhereText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: textSize(12),
    textDecorationLine: 'underline',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
