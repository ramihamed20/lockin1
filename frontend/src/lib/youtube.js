/**
 * YouTube helpers for the Paper Workspace player.
 *
 * Only a video identifier ever leaves this module. The embed is served from
 * the privacy-enhanced youtube-nocookie.com host, which is the one video origin
 * the production Content-Security-Policy admits as a frame source.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

/**
 * The video identifier in a pasted YouTube link, or "" when the text is not one.
 * Accepts watch, share (youtu.be), shorts, live and embed links, and a bare id.
 * @param {string} input
 */
export function parseYouTubeVideoId(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (VIDEO_ID.test(text)) return text;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase();
  let candidate = "";
  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = url.pathname.split("/")[1] || "";
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first = "", second = ""] = url.pathname.split("/");
    if (first === "watch") candidate = url.searchParams.get("v") || "";
    else if (["shorts", "live", "embed", "v"].includes(first)) candidate = second;
  }
  return VIDEO_ID.test(candidate) ? candidate : "";
}

export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * The embed drives Lock-in's own control bar: YouTube's controls are hidden
 * and `enablejsapi` lets the page send play/seek/volume commands and read the
 * playback time through postMessage, with no YouTube script on the page (the
 * CSP only admits the frame). Sound is never muted on purpose; if the browser
 * refuses autoplay with sound, the video waits for the reader's Play.
 * @param {string} videoId
 * @param {string} [origin] the embedding page's origin, which the API requires
 */
export function youTubeEmbedUrl(videoId, origin = "") {
  if (!VIDEO_ID.test(videoId)) return "";
  const params = new URLSearchParams({ autoplay: "1", rel: "0", modestbranding: "1", playsinline: "1", enablejsapi: "1", controls: "0", fs: "0", disablekb: "1", iv_load_policy: "3" });
  if (origin) params.set("origin", origin);
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}?${params}`;
}

/**
 * youtube.com's own results page for a free-text query. Searching inside the
 * app needs a server-side YouTube Data API integration that does not exist yet,
 * so text searches are handed to YouTube in a new tab.
 * @param {string} query
 */
export function youTubeSearchUrl(query) {
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: String(query || "").trim() })}`;
}
