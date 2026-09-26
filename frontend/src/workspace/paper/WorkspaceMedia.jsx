/**
 * The admin-chosen Paper Workspace background: a looping video or an image. It
 * always fills its frame (`object-fit: cover`) and crops around the
 * administrator's focal point, so one 16:9 upload works on a wide desktop
 * player, an iPad in either orientation, and a phone.
 *
 * Playback belongs to the player's control bar (MediaControls.jsx), which
 * receives the <video> through `videoRef`. The video is not muted: sound plays
 * normally, and a browser that refuses autoplay with sound waits for Play.
 * `preview` (the admin cropping frames) plays silently on its own instead.
 *
 * @param {{
 *   media: { url: string, media_type: "video" | "image", focal_x: number, focal_y: number },
 *   label: string,
 *   className?: string,
 *   videoRef?: import("react").Ref<HTMLVideoElement>,
 *   preview?: boolean,
 *   onError?: () => void
 * }} props
 */
export function WorkspaceMedia({ media, label, className = "", videoRef = undefined, preview = false, onError }) {
  const style = { objectPosition: `${clamp(media.focal_x)}% ${clamp(media.focal_y)}%` };
  const classes = `paper-media ${className}`.trim();
  if (media.media_type === "video") {
    return (
      // Ambient study music behind the workspace: there is no speech, and no
      // caption track exists for an administrator's upload.
      // eslint-disable-next-line jsx-a11y/media-has-caption -- see above
      <video
        ref={videoRef}
        className={classes}
        src={media.url}
        style={style}
        aria-label={label}
        loop
        muted={preview}
        autoPlay={preview}
        playsInline
        preload="auto"
        disablePictureInPicture
        onError={onError}
      />
    );
  }
  return <img className={classes} src={media.url} style={style} alt={label} decoding="async" onError={onError} />;
}

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 50;
}
