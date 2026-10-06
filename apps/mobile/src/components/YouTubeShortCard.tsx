import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
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
import { ShortInfoStrip, shortStyles } from './ShortParts';
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
 *   - Nothing of ours sends a reader to YouTube; only YouTube's own logo, if
 *     the reader taps it.
 *
 * ── Smooth, not loading ─────────────────────────────────────────────────────
 *
 * A reader's recording (6 Oct 2026) showed a spinner on every short, a still
 * that "blinked" into the video, and sound switching itself off. So:
 *
 *   - The NEXT short's player is loaded in advance (`preload`), paused — the
 *     page, YouTube's player and the video cued — and only told to play once
 *     it is the one on screen. YouTube allows one playing player at a time and
 *     playback only once it is visible; a cued player is neither. Measured in
 *     a browser: a cued embed starts within half a second of being told to.
 *   - The poster is YouTube's own vertical thumbnail (oar2.jpg, the Short's
 *     shape and sharp), and the player FADES in over it once the video is
 *     moving, rather than replacing it in one frame.
 *   - Sound is the reader's choice, kept in the settings (on by default). If a
 *     phone refuses to start one short with sound, THAT short plays muted and
 *     its speaker says so; the reader's choice is untouched for the next one.
 *     Only a refusal counts: a slow start is not one. (The first version took
 *     any slow start for a refusal and muted every short after it.)
 *
 * ── Staying in the app ──────────────────────────────────────────────────────
 *
 * YouTube plays an embed only when the app identifies itself, and documents
 * two ways for an app to do that ("API Client identity"):
 *
 *   1. embed  — YouTube's own embed page, loaded with the app in the Referer
 *      header, driven through its player element (#movie_player).
 *   2. inline — our own page running YouTube's IFrame API, with the app as its
 *      base address.
 *
 * If one is refused, or nothing moves within START_TIMEOUT_MS of being asked,
 * the other is tried; whichever last worked goes first next time. If both
 * fail, the card says so and offers Try again — never YouTube. Every refusal
 * is reported (telemetry.reportError) with YouTube's error code.
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

/** From being asked to play. Long enough for a slow mobile connection. */
const START_TIMEOUT_MS = 15_000;

/*
 * Both pages answer to the same three calls, injected by the card:
 *   window.__saarPlay(muted)   start (or resume) with sound or without
 *   window.__saarPause()       stop — the card has left the screen
 *   window.__saarMute(muted)   the reader pressed the speaker
 *
 * and send back the same words:
 *   'ready'             the player is loaded and cued; it can be told to play
 *   'playing'           the video is moving (each time it starts or resumes)
 *   'paused'            it stopped (YouTube's own tap, usually)
 *   'time:<cur>/<len>'  where it has got to, every half second while playing
 *   'forced-mute'       asked to play with sound, it would not start until
 *                       muted: this short plays muted
 *   'error:<why>'       refused; <why> is YouTube's code, or 'embed' for its
 *                       error screen on the embed page
 *
 * "Would not start" means neither moving nor buffering three seconds after
 * being asked — a phone's refusal. A buffering player is a slow network, and
 * is left to buffer.
 */
const PAGE_LOOP = `
var wantPlay=false,wantMuted=false,askedAt=0,moved=false,fellBack=false,readySent=false,last=-9,tick=0;
function send(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m);}}
function go(p){if(wantMuted)p.mute();else p.unMute();p.playVideo();}
window.__saarPlay=function(muted){wantPlay=true;wantMuted=muted;askedAt=Date.now();var p=P();if(p)go(p);};
window.__saarPause=function(){wantPlay=false;var p=P();if(p)p.pauseVideo();};
window.__saarMute=function(muted){wantMuted=muted;var p=P();if(p){if(muted)p.mute();else p.unMute();}};
setInterval(function(){
  if(E())return;
  var p=P();if(!p)return;
  if(!readySent){readySent=true;send('ready');if(wantPlay)go(p);}
  var s=p.getPlayerState();
  if(s!==last){last=s;if(s===1){moved=true;send('playing');}else if(s===2&&moved){send('paused');}}
  tick++;
  if(s===1&&tick%2===0){send('time:'+p.getCurrentTime().toFixed(2)+'/'+p.getDuration().toFixed(2));}
  if(wantPlay&&!moved&&!fellBack&&!wantMuted&&askedAt>0&&Date.now()-askedAt>3000&&s!==1&&s!==3){
    fellBack=true;wantMuted=true;p.mute();p.playVideo();send('forced-mute');
  }
},250);`;

/** Way 1: our page, YouTube's IFrame API, the app as the base address. */
function inlineHtml(videoId: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head><body><div id="p"></div><script>
var player=null,failedSent=false;
function P(){return player&&player.getPlayerState?player:null;}
function E(){return failedSent;}
function onYouTubeIframeAPIReady(){
  new YT.Player('p',{width:'100%',height:'100%',videoId:'${videoId}',
    playerVars:{autoplay:0,playsinline:1,loop:1,playlist:'${videoId}',controls:0,rel:0,fs:0,iv_load_policy:3,disablekb:1,origin:'${PLAYER_ORIGIN}',widget_referrer:'${PLAYER_ORIGIN}'},
    events:{
      onReady:function(e){player=e.target;},
      onError:function(e){if(!failedSent){failedSent=true;send('error:'+e.data);}}
    }});
}
${PAGE_LOOP}
var s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
</script></body></html>`;
}

/** Way 2: YouTube's own embed page, cued and waiting, the app in the Referer header. */
function embedUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '0',
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

/** Run inside the embed page, driving YouTube's own player element. */
const EMBED_SCRIPT = `(function(){
if(window.__saar)return;window.__saar=true;
var failedSent=false;
function P(){var p=document.getElementById('movie_player');return p&&typeof p.playVideo==='function'&&typeof p.getPlayerState==='function'?p:null;}
function E(){
  if(failedSent)return true;
  var err=document.querySelector('.ytp-error');
  if(err&&err.offsetParent!==null){failedSent=true;send('error:embed');return true;}
  return false;
}
${PAGE_LOOP}
})();true;`;

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
  preload,
  muted,
  onToggleMute,
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
  /** The page's player is loaded and cued. */
  const [ready, setReady] = useState(false);
  /** The video has moved at least once on this mount. */
  const [started, setStarted] = useState(false);
  /** This short would only start muted, whatever the reader's choice. */
  const [phoneMuted, setPhoneMuted] = useState(false);
  const shownMuted = muted || phoneMuted;

  const web = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const lastFraction = useRef(0);

  /* The poster: YouTube's vertical thumbnail, sharp and in the Short's shape;
     their 4:3 one (the server's) if this Short has none, or with Data Saver. */
  const tallPoster = videoId !== null && !dataSaver ? `https://i.ytimg.com/vi/${videoId}/oar2.jpg` : null;
  const [posterFailed, setPosterFailed] = useState(false);
  const posterUri = tallPoster !== null && !posterFailed ? tallPoster : (resolveMediaUrl(video.posterUrl) ?? '');

  /* Each page is built once per video and way, and never autoplays: the card
     tells it to play once it is the one on screen. */
  const page = useMemo(
    () => (videoId === null ? null : mode === 'inline' ? inlineHtml(videoId) : embedUrl(videoId)),
    [videoId, mode],
  );

  /* Mounted on screen, and one ahead. Gone otherwise: a player off screen is
     memory and data the reader is not using. */
  const mounted = WebView !== null && videoId !== null && allowed && (active || preload) && !failed;

  /* A card leaving both roles starts over next time it is mounted. */
  useEffect(() => {
    if (mounted) return;
    setReady(false);
    setStarted(false);
    setPhoneMuted(false);
    fade.setValue(0);
    progress.setValue(0);
    lastFraction.current = 0;
  }, [mounted, fade, progress]);

  const inject = (js: string) => web.current?.injectJavaScript(`${js}; true;`);

  /* On screen and ready: play, with the reader's sound choice. Off screen but
     still mounted (one ahead, after a swipe back): pause. */
  useEffect(() => {
    if (!mounted || !ready) return;
    if (active) inject(`window.__saarPlay && window.__saarPlay(${muted})`);
    else inject(`window.__saarPause && window.__saarPause()`);
    // `muted` is sent separately below; it must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, ready, active]);

  useEffect(() => {
    if (!mounted || !ready || phoneMuted) return;
    inject(`window.__saarMute && window.__saarMute(${muted})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  /** One way was refused: say so, then try the next, or give up. */
  const refused = (why: string) => {
    reportError(
      new Error(`YouTube would not play ${videoId ?? '?'}: ${why} (${mode}, ${unmetered ? 'wifi' : 'mobile data'})`),
      'youtube-player',
    );
    setReady(false);
    setStarted(false);
    if (attempt + 1 < order.length) setAttempt(attempt + 1);
    else setFailed(true);
  };
  const refusedNow = useRef(refused);
  refusedNow.current = refused;

  /* Asked to play and nothing moving after a while counts as a refusal: a
     player stuck on its loading screen is no better than an error. Counted
     from being on screen, not from preloading. */
  useEffect(() => {
    if (!mounted || !active || started) return;
    const t = setTimeout(() => refusedNow.current(`did not start within ${START_TIMEOUT_MS / 1000}s`), START_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mounted, active, started, mode]);

  /** Where the video has got to, glided between the half-second reports. */
  const moveTo = (fraction: number) => {
    const f = Math.min(1, Math.max(0, fraction));
    if (f < lastFraction.current) {
      /* Looped back to the start. */
      progress.setValue(f);
    } else {
      Animated.timing(progress, { toValue: f, duration: 500, easing: Easing.linear, useNativeDriver: true }).start();
    }
    lastFraction.current = f;
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const m = e.nativeEvent.data;
    if (m === 'ready') {
      setReady(true);
    } else if (m === 'playing') {
      if (!started) {
        setStarted(true);
        lastWorked = mode;
        /* A beat for the first frame to reach the screen, then fade in over
           the poster — no hard cut. */
        Animated.timing(fade, { toValue: 1, duration: 220, delay: 120, useNativeDriver: true }).start();
      }
    } else if (m.startsWith('time:')) {
      const [cur, len] = m.slice(5).split('/').map(Number);
      if (cur !== undefined && len !== undefined && len > 0) moveTo(cur / len);
    } else if (m === 'forced-mute') {
      setPhoneMuted(true);
    } else if (m.startsWith('error:')) {
      refused(`error ${m.slice(6)}`);
    }
  };

  /* The speaker on a short the phone muted: sound on for this one, and the
     reader's choice is "sound on". */
  const onSpeaker = () => {
    if (phoneMuted) {
      setPhoneMuted(false);
      inject(`window.__saarMute && window.__saarMute(false)`);
      if (muted) onToggleMute();
      return;
    }
    onToggleMute();
  };

  const tryAgain = () => {
    setOrder(triedInOrder());
    setAttempt(0);
    setFailed(false);
    setReady(false);
    setStarted(false);
    setAllowed(true);
  };

  const posterColor = blurHashAverageColor(video.posterBlurHash) ?? '#111';
  const noPlayer = WebView === null || videoId === null;
  const waiting = mounted && active && !started;

  return (
    <View style={[styles.card, { height }]}>
      <View
        style={[
          styles.player,
          { left: box.left, top: box.top, width: box.width, height: box.height, backgroundColor: posterColor },
        ]}
      >
        {posterUri ? (
          <Image
            source={{ uri: posterUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setPosterFailed(true)}
            fadeDuration={0}
          />
        ) : null}

        {mounted && WebView !== null && page !== null && (
          /* Invisible and untouchable until the video moves: a page still
             loading must not swallow a swipe. Then it fades in and is
             YouTube's, touches and all, with nothing of ours in front of it. */
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents={started ? 'auto' : 'none'}>
            <WebView
              key={mode}
              ref={web as never}
              source={
                mode === 'inline'
                  ? { html: page, baseUrl: PLAYER_ORIGIN }
                  : { uri: page, headers: { Referer: `${PLAYER_ORIGIN}/` } }
              }
              injectedJavaScript={mode === 'embed' ? EMBED_SCRIPT : undefined}
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
          </Animated.View>
        )}

        {/* On the poster only — the player is not showing yet. */}
        {waiting && (
          <View style={shortStyles.centre} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        )}

        {!mounted && active && (
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
          muted={shownMuted}
          onToggleMute={onSpeaker}
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
