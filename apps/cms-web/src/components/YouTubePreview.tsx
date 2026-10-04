/**
 * A YouTube Short, playable, in the editorial site.
 *
 * YouTube's own player, in its privacy-enhanced mode (youtube-nocookie.com),
 * which sets no tracking cookie until the editor presses play. Shown at the
 * Short's own shape, so the editor sees what a reader will.
 *
 * The video is YouTube's, served by YouTube; nothing here copies it.
 */
export function YouTubePreview({ videoId, title }: { videoId: string; title: string }) {
  return (
    <span className="yt-preview">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&playsinline=1`}
        title={title}
        loading="lazy"
        allow="encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </span>
  );
}
