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
import { PosterImage, ShortText, shortStyles } from './ShortParts';
import type { ShortCardProps } from './VideoCard';

/**
 * A short that plays from a licensed publisher's YouTube channel.
 *
 * ── YouTube's player, never a copy ──────────────────────────────────────────
 *
 * The video is played by YouTube's own IFrame player inside a web view: that
 * is what their terms allow. Downloading it to serve ourselves is not, whatever
 * the channel agrees. Their logo stays visible, our words stay clear of it,
 * and no ad is ever put on it.
 *
 * ── The same rules as every other short ─────────────────────────────────────
 *
 *   - Only the short on screen has a player; the rest are posters. A web view
 *     is heavier than our own player, so this matters more here, not less.
 *   - On Wi-Fi it starts by itself, muted. On mobile data or with Data Saver
 *     nothing loads until a tap — YouTube chooses the quality, so the button
 *     says "YouTube · 0:48" where an uploaded short says its size.
 *   - The tab's mute applies; a tap anywhere pauses.
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
 * Who the player page says it is.
 *
 * YouTube plays an embed only when it can tell who is embedding it, and for a
 * page an app loads itself that is the page's base address. The convention is
 * `https://<app id>` — ours, from app.json. It must not be youtube.com: a page
 * claiming to be YouTube is refused with error 152, every video, every channel.
 * That was this file's first version, and it is why every short fell back to
 * "Watch on YouTube". With no address at all the refusal is error 153.
 */
const PLAYER_ORIGIN = 'https://com.saar.news';

/**
 * The page the web view loads: YouTube's IFrame player API, filling the screen.
 *
 * Messages come back as 'ready', 'state:<n>' and 'error:<n>'. The video id is
 * checked by the caller against YouTube's eleven-character alphabet before it
 * is put in here.
 */
function playerHtml(videoId: string, muted: boolean): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head><body><div id="p"></div><script>
var player;
function send(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m);}}
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{width:'100%',height:'100%',videoId:'${videoId}',
    playerVars:{autoplay:1,mute:1,playsinline:1,loop:1,playlist:'${videoId}',controls:0,rel:0,fs:0,iv_load_policy:3,disablekb:1,origin:'${PLAYER_ORIGIN}'},
    events:{
      onReady:function(e){${muted ? 'e.target.mute();' : 'e.target.unMute();'}e.target.playVideo();send('ready');},
      onStateChange:function(e){send('state:'+e.data);},
      onError:function(e){send('error:'+e.data);}
    }});
}
var s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
</script></body></html>`;
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
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const web = useRef<{ injectJavaScript: (js: string) => void } | null>(null);

  /* The page is built once per video. Mute and pause are sent to the running
     player rather than rebuilding it, which would restart the clip. */
  const html = useMemo(
    () => (videoId !== null ? playerHtml(videoId, muted) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoId],
  );

  const playing = WebView !== null && videoId !== null && allowed && active && !failed;

  useEffect(() => {
    if (!active) {
      setReady(false);
      setPaused(false);
    }
  }, [active]);

  useEffect(() => {
    if (!ready) return;
    web.current?.injectJavaScript(`player && player.${muted ? 'mute' : 'unMute'}(); true;`);
  }, [muted, ready]);

  useEffect(() => {
    if (!ready) return;
    web.current?.injectJavaScript(`player && player.${paused ? 'pauseVideo' : 'playVideo'}(); true;`);
  }, [paused, ready]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = e.nativeEvent.data;
    if (m === 'ready') setReady(true);
    /* 100: removed or private. 101/150: its owner no longer allows embedding.
       Either way the poster stays, with the way out to YouTube. */
    else if (m.startsWith('error:')) setFailed(true);
  };

  const openInYouTube = () => {
    if (videoId !== null) void Linking.openURL(`https://www.youtube.com/shorts/${videoId}`);
  };

  const posterColor = blurHashAverageColor(video.posterBlurHash) ?? theme.surfaceRaised;
  const ne = video.language === 'ne';

  return (
    <View style={[shortStyles.card, { height, backgroundColor: '#000' }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: posterColor }]}>
        <PosterImage uri={resolveMediaUrl(video.posterUrl) ?? ''} />
      </View>

      {playing && WebView !== null && (
        <View style={[StyleSheet.absoluteFill, !ready && styles.hidden]}>
          <WebView
            ref={web as never}
            source={{ html, baseUrl: PLAYER_ORIGIN }}
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
               the short inside our app. */
            onShouldStartLoadWithRequest={(req) => {
              const stays =
                req.url === 'about:blank' ||
                req.url.startsWith('https://www.youtube.com/embed/') ||
                req.url.startsWith('https://www.youtube.com/iframe_api') ||
                /* The player page itself, which iOS reports as a load of its
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

      {/* Waiting for a tap: mobile data, Data Saver, or a build without the
          web view. The label is the length and where it plays, because
          YouTube, not us, decides how many megabytes that is. */}
      {!playing && (
        <View style={shortStyles.centre}>
          <Pressable
            style={[shortStyles.playBig, { borderColor: 'rgba(255,255,255,0.7)' }]}
            onPress={() => {
              if (WebView === null || failed) openInYouTube();
              else setAllowed(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              WebView === null || failed
                ? ne
                  ? 'युट्युबमा हेर्नुहोस्'
                  : 'Watch on YouTube'
                : ne
                  ? `भिडियो चलाउनुहोस्, युट्युब, ${clock(video.durationSeconds)}`
                  : `Play video from YouTube, ${clock(video.durationSeconds)}`
            }
          >
            <MaterialCommunityIcons
              name={WebView === null || failed ? 'youtube' : 'play'}
              size={34}
              color="#fff"
            />
          </Pressable>
          <Text style={shortStyles.playCost}>
            {WebView === null || failed
              ? ne
                ? 'युट्युबमा हेर्नुहोस्'
                : 'Watch on YouTube'
              : `YouTube · ${clock(video.durationSeconds)}`}
          </Text>
        </View>
      )}

      {playing && !ready && (
        <View style={shortStyles.centre} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {/* Tap anywhere to pause or resume. Above the web view, so the touch is
          ours and the player's own controls never appear. */}
      {playing && ready && (
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

      <View style={shortStyles.scrim} pointerEvents="none" />
      {/* Clear of the bottom-right corner, where YouTube's logo sits. */}
      <ShortText video={video} textScale={textScale} note="YouTube" rightInset={84} />
    </View>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#000' },
  /* Laid out but invisible until the player says it is ready, so the poster —
     not a white page or a black frame — is what shows while YouTube loads. */
  hidden: { opacity: 0 },
});
