import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Search, X } from "lucide-react";
import { focusApi } from "../../api/focus.js";
import { useI18n } from "../../components/I18nProvider.jsx";
import { parseYouTubeVideoId, youTubePlayerUrl } from "../../lib/youtube.js";
import { useYouTubeMedia } from "../paper/MediaControls.jsx";
import { FOCUS_VIDEO_EVENT, clampPanelPosition, resizePanel } from "./focusVideo.js";
import "./focus-video.css";

const MARGIN = 12;
const START_WIDTH = 360;
const SEARCH_WIDTH = 340;
/** How far a press must travel before it moves the player instead of tapping it. */
const DRAG_SLOP = 6;
const CHROME_IDLE_MS = 2500;
/** The top edge is the title bar, which moves the player; its corners resize. */
const EDGES = ["e", "s", "w", "ne", "se", "sw", "nw"];

function searchErrorKey(error) {
  switch (error?.code) {
    case "youtube_search_unavailable": return "paper.searchUnavailable";
    case "youtube_quota_exceeded": return "paper.searchBusy";
    case "youtube_search_rate_limited": return "paper.searchTooOften";
    default: return "paper.searchFailed";
  }
}

function viewport() {
  const visual = window.visualViewport;
  return { width: visual?.width || window.innerWidth, height: visual?.height || window.innerHeight,
    left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0 };
}

/** Its laid-out size: unlike a bounding box, never shrunk by the opening animation. */
function panelSize(panel) {
  return { width: panel.offsetWidth, height: panel.offsetHeight };
}

/**
 * A YouTube video floating over the Focus workspace, so a lecture plays beside
 * the sheet instead of in another app. It is mounted once next to the kept
 * readers: switching tabs never reloads it. Shown as a manual popover, it sits
 * in the top layer, above the reader even while the reader is in full screen.
 *
 * While a video plays the panel is only the video: press anywhere on it and
 * drag to move it, drag an edge or a corner to resize it, tap to play or pause.
 * The title bar floats over the picture and fades out when left alone.
 */
export function FocusVideoPlayer() {
  const { t } = useI18n();
  const panelRef = useRef(/** @type {HTMLElement | null} */ (null));
  const frameRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const [open, setOpen] = useState(false);
  const [videoId, setVideoId] = useState("");
  const [searching, setSearching] = useState(true);
  const [width, setWidth] = useState(START_WIDTH);
  const [screen, setScreen] = useState(viewport);
  const [position, setPosition] = useState(/** @type {{ x: number, y: number } | null} */ (null));
  const [gesture, setGesture] = useState(/** @type {"" | "move" | "resize"} */ (""));
  const [chromeShown, setChromeShown] = useState(true);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(/** @type {{ status: "idle" | "loading" | "done" | "error", query: string, results: any[], errorKey: string }} */ ({ status: "idle", query: "", results: [], errorKey: "" }));
  const searchSeq = useRef(0);
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const gestureRef = useRef(/** @type {{ kind: "move" | "resize" | "press", id: number, target: HTMLElement, edge?: string, startX: number, startY: number, start: { x: number, y: number, width: number, height: number } } | null} */ (null));
  const chromeTimer = useRef(0);
  const media = useYouTubeMedia(frameRef, videoId);

  const cancelGesture = useCallback(() => {
    const active = gestureRef.current;
    gestureRef.current = null;
    setGesture("");
    if (active?.target.hasPointerCapture?.(active.id)) active.target.releasePointerCapture(active.id);
  }, []);

  useEffect(() => {
    const show = () => { setOpen(true); setSearching(true); };
    window.addEventListener(FOCUS_VIDEO_EVENT, show);
    return () => window.removeEventListener(FOCUS_VIDEO_EVENT, show);
  }, []);

  // The top layer keeps its own order: a reader that enters full screen after
  // the player opened would cover it, so the player steps back on top. Hiding
  // a popover only hides it; the video in it keeps its place. A layout effect,
  // so the panel is shown before it is measured and placed below.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel?.showPopover) return undefined;
    if (!panel.matches(":popover-open")) panel.showPopover();
    // Reopened even if the browser closed it on entering full screen.
    const raise = () => {
      cancelGesture();
      if (panel.matches(":popover-open")) panel.hidePopover();
      panel.showPopover();
    };
    document.addEventListener("fullscreenchange", raise);
    return () => {
      document.removeEventListener("fullscreenchange", raise);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [open, cancelGesture]);

  const keepInside = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const bounds = viewport();
    setScreen((current) => Object.keys(bounds).every((key) => current[key] === bounds[key]) ? current : bounds);
    const measured = panelSize(panel);
    const size = { width: Math.min(measured.width, Math.max(0, bounds.width - MARGIN * 2)),
      height: Math.min(measured.height, Math.max(0, bounds.height - MARGIN * 2)) };
    setPosition((current) => {
      const start = current ?? {
        x: document.documentElement.dir === "rtl" ? bounds.left + MARGIN : bounds.left + bounds.width - size.width - MARGIN,
        y: bounds.top + bounds.height - size.height - MARGIN
      };
      const next = clampPanelPosition(start, size, bounds, MARGIN);
      return current && current.x === next.x && current.y === next.y ? current : next;
    });
  }, []);

  // Placed in the bottom corner when it first opens, and kept on screen when
  // its content changes, or when the window or the iPad's orientation changes.
  useLayoutEffect(() => {
    if (open && !gestureRef.current) keepInside();
  }, [open, width, searching, videoId, search.status, keepInside]);
  // The player was opened (or "another video" pressed) to type into the box,
  // a frame later, once the menu that opened it has finished closing.
  const showingSearch = open && (searching || !videoId);
  useEffect(() => {
    if (!showingSearch) return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [showingSearch]);
  useEffect(() => {
    if (!open) return undefined;
    const visual = window.visualViewport;
    const resize = () => { cancelGesture(); keepInside(); };
    const visibility = () => { if (document.visibilityState === "hidden") cancelGesture(); };
    window.addEventListener("resize", resize);
    window.addEventListener("blur", cancelGesture);
    window.addEventListener("pagehide", cancelGesture);
    document.addEventListener("visibilitychange", visibility);
    visual?.addEventListener("resize", resize);
    visual?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", cancelGesture);
      window.removeEventListener("pagehide", cancelGesture);
      document.removeEventListener("visibilitychange", visibility);
      visual?.removeEventListener("resize", resize);
      visual?.removeEventListener("scroll", resize);
      cancelGesture();
    };
  }, [open, keepInside, cancelGesture]);
  useEffect(() => () => window.clearTimeout(chromeTimer.current), []);

  /** The floating title bar comes back on any touch and fades after a quiet moment. */
  const wakeChrome = useCallback(() => {
    setChromeShown(true);
    window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(() => setChromeShown(false), CHROME_IDLE_MS);
  }, []);

  function close() {
    cancelGesture();
    searchSeq.current += 1;
    setOpen(false);
    setVideoId("");
    setQuery("");
    setSearch({ status: "idle", query: "", results: [], errorKey: "" });
  }

  function play(id) {
    searchSeq.current += 1;
    setVideoId(id);
    setSearching(false);
    setQuery("");
    setSearch({ status: "idle", query: "", results: [], errorKey: "" });
    wakeChrome();
  }

  async function runSearch(text) {
    const id = searchSeq.current + 1;
    searchSeq.current = id;
    setSearch({ status: "loading", query: text, results: [], errorKey: "" });
    try {
      const results = await focusApi.searchYouTube(text);
      if (id === searchSeq.current) setSearch({ status: "done", query: text, results, errorKey: "" });
    } catch (error) {
      if (id === searchSeq.current) setSearch({ status: "error", query: text, results: [], errorKey: searchErrorKey(error) });
    }
  }

  const linkId = parseYouTubeVideoId(query);
  const trimmed = query.trim();
  const current = search.query === trimmed ? search : null;

  function submit(event) {
    event.preventDefault();
    if (linkId) play(linkId);
    else if (trimmed && current?.status !== "loading") runSearch(trimmed);
  }

  /**
   * One pointer gesture on the panel: `move` from the title bar, `press` from
   * the picture (a tap until it travels, then a move), `resize` from an edge.
   */
  function beginGesture(event, kind, edge) {
    if (event.button !== 0 || gestureRef.current || (kind === "move" && event.target.closest?.("button"))) return;
    const panel = panelRef.current;
    if (!panel || !position) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gestureRef.current = { kind, edge, id: event.pointerId, target: event.currentTarget, startX: event.clientX, startY: event.clientY, start: { ...position, ...panelSize(panel) } };
    if (kind !== "press") setGesture(kind === "resize" ? "resize" : "move");
    wakeChrome();
  }

  function continueGesture(event) {
    const active = gestureRef.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.kind === "press") {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      active.kind = "move";
      setGesture("move");
    }
    if (active.kind === "move") {
      setPosition(clampPanelPosition({ x: active.start.x + dx, y: active.start.y + dy }, active.start, viewport(), MARGIN));
      return;
    }
    const next = resizePanel({ edge: active.edge || "se", dx, dy, start: active.start, viewport: viewport(), margin: MARGIN });
    setWidth(next.width);
    setPosition({ x: next.x, y: next.y });
  }

  function endGesture(event) {
    const active = gestureRef.current;
    if (!active || active.id !== event.pointerId) return;
    cancelGesture();
    // A press that never travelled is a tap on the picture: play or pause.
    if (active.kind === "press" && event.type === "pointerup") media.toggle();
  }

  const gestureHandlers = { onPointerMove: continueGesture, onPointerUp: endGesture, onPointerCancel: endGesture, onLostPointerCapture: endGesture };

  if (!open) return null;
  const showSearch = searching || !videoId;
  const title = showSearch ? t("paper.searchLabel") : t("paper.youtubeVideo");
  const panelWidth = showSearch ? Math.max(width, SEARCH_WIDTH) : width;

  return (
    // Keys typed here belong to the player, never to the reader's shortcuts
    // (Space would otherwise switch the reader to the hand tool).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- stops shortcut keys only
    <section
      ref={panelRef}
      className={`focus-video${gesture ? ` is-${gesture === "resize" ? "resizing" : "dragging"}` : ""}`}
      data-mode={showSearch ? "search" : "video"}
      data-chrome={chromeShown || gesture ? "shown" : "hidden"}
      popover="manual"
      role="dialog"
      aria-label={t("focusVideo.label")}
      style={{ width: panelWidth, maxWidth: Math.max(0, screen.width - MARGIN * 2), maxHeight: Math.max(0, screen.height - MARGIN * 2), ...(position ? { left: position.x, top: position.y } : { visibility: "hidden" }) }}
      onPointerMove={showSearch ? undefined : wakeChrome}
      onKeyDown={(event) => {
        if (event.key === "Escape" && showSearch && videoId) setSearching(false);
        event.stopPropagation();
      }}
    >
      {/* The bar is a handle too: drag it to move the player anywhere on screen. */}
      <header className="focus-video-bar" onPointerDown={(event) => beginGesture(event, "move")} {...gestureHandlers}>
        <strong dir="auto">{title}</strong>
        {videoId && !showSearch && (
          <button type="button" aria-label={t("focusVideo.change")} title={t("focusVideo.change")} onClick={() => setSearching(true)}><Search size={16} /></button>
        )}
        <button type="button" aria-label={t("focusVideo.close")} title={t("focusVideo.close")} onClick={close}><X size={17} /></button>
      </header>

      {showSearch && (
        <form className="focus-video-search" role="search" onSubmit={submit}>
          <div className="focus-video-search-box">
            <Search size={16} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("paper.searchPlaceholder")}
              aria-label={t("paper.searchLabel")}
              autoComplete="off"
              enterKeyHint="search"
              dir="auto"
            />
          </div>
          {trimmed && (
            <div className="focus-video-results" aria-busy={current?.status === "loading"}>
              {linkId ? (
                <button type="button" className="focus-video-result" onClick={() => play(linkId)}>
                  <span className="focus-video-result-icon"><Play size={16} /></span>
                  <span><strong>{t("paper.playLink")}</strong><small dir="ltr">youtu.be/{linkId}</small></span>
                </button>
              ) : current?.status === "loading" ? (
                <p className="focus-video-message" role="status">{t("paper.searching")}</p>
              ) : current?.status === "error" ? (
                <p className="focus-video-message" role="alert" dir="auto">{t(current.errorKey)}</p>
              ) : current?.status === "done" && !current.results.length ? (
                <p className="focus-video-message" role="status" dir="auto">{t("paper.noResults")}</p>
              ) : current?.status === "done" ? (
                <ul aria-label={t("paper.searchResults")}>
                  {current.results.map((item) => (
                    <li key={item.video_id}>
                      <button type="button" className="focus-video-result is-video" onClick={() => play(item.video_id)}>
                        <img src={item.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                        <span><strong dir="auto">{item.title}</strong><small dir="auto">{item.channel_title}</small></span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <button type="submit" className="focus-video-result">
                  <span className="focus-video-result-icon"><Search size={16} /></span>
                  <span><strong dir="auto">{t("paper.searchOnYouTube", { query: trimmed })}</strong><small>{t("paper.searchHint")}</small></span>
                </button>
              )}
            </div>
          )}
        </form>
      )}

      {/* Kept mounted (only hidden) while a new video is searched for, so the
          current one keeps playing until another is chosen. */}
      {videoId && (
        <div className="focus-video-frame" hidden={showSearch}>
          <iframe
            key={videoId}
            ref={frameRef}
            src={youTubePlayerUrl(videoId, window.location.origin)}
            title={t("paper.youtubeVideo")}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
          {/* The embed swallows pointer events, so this layer over the
              picture is what moves the player. It leaves YouTube's own control
              strip free, and steps aside until the video has played once, so
              the first tap reaches YouTube's Play (the only way iPad Safari
              starts a video with sound). Pointer-only: the bar's buttons and
              YouTube's controls are the keyboard path. */}
          <div
            className={`focus-video-hit${media.needsTap ? " is-passthrough" : ""}`}
            aria-hidden="true"
            onPointerDown={(event) => beginGesture(event, "press")}
            {...gestureHandlers}
          />
        </div>
      )}

      {/* Edges and corners resize the player, keeping the video's shape. */}
      {!showSearch && EDGES.map((edge) => (
        <span
          key={edge}
          className="focus-video-handle"
          data-edge={edge}
          aria-hidden="true"
          onPointerDown={(event) => beginGesture(event, "resize", edge)}
          {...gestureHandlers}
        />
      ))}
    </section>
  );
}
