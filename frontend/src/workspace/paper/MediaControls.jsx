import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { Icon } from "../../lib/icons.jsx";
import { cssVars } from "../../lib/utils.js";
import { YOUTUBE_EMBED_ORIGIN } from "../../lib/youtube.js";
import { renderLofiLoop } from "./lofiAudio.js";
import { IDLE_DELAY_MS, SKIP_SECONDS, formatMediaTime, skipTarget } from "./mediaTime.js";

/**
 * Paper Workspace's one media control bar and the adapters that drive it.
 *
 * Every source exposes the same shape, so the bar never branches on where the
 * picture comes from:
 *   { canPlay, canSeek, hasAudio, needsTap, playing, time, duration, volume, muted,
 *     toggle(), seekTo(seconds, final), skip(delta), setVolume(0..1), toggleMute() }
 *
 * - an admin video is a real <video> element;
 * - a YouTube embed is driven over postMessage (see lib/youtube.js);
 * - the default lofi (the built-in scene, or an admin image) plays and pauses
 *   its generated soundtrack (lofiAudio.js) together with the animation.
 */

const NO_MEDIA = { canPlay: false, canSeek: false, hasAudio: false, needsTap: false, playing: false, time: 0, duration: 0, volume: 1, muted: false, toggle() {}, seekTo() {}, skip() {}, setVolume() {}, toggleMute() {} };

function reducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

/** A <video> element. Autoplay is attempted with sound, never muted on purpose. */
export function useVideoMedia(ref, { enabled, src }) {
  const [state, setState] = useState({ playing: false, time: 0, duration: 0, volume: 1, muted: false });

  useEffect(() => {
    const video = ref.current;
    if (!enabled || !video) return undefined;
    const sync = () => setState({
      playing: !video.paused && !video.ended,
      time: video.currentTime || 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      volume: video.volume,
      muted: video.muted
    });
    const events = ["play", "pause", "timeupdate", "durationchange", "loadedmetadata", "volumechange", "ended", "seeked"];
    events.forEach((name) => video.addEventListener(name, sync));
    sync();
    // A browser that refuses autoplay with sound leaves the video paused; the
    // reader's first Play is a user gesture and starts it with sound.
    if (!reducedMotion()) video.play()?.catch?.(sync);
    return () => events.forEach((name) => video.removeEventListener(name, sync));
  }, [ref, enabled, src]);

  const seekTo = useCallback((seconds) => {
    const video = ref.current;
    if (video) video.currentTime = skipTarget(seconds, 0, video.duration);
  }, [ref]);

  if (!enabled) return NO_MEDIA;
  return {
    ...state,
    canPlay: true,
    canSeek: state.duration > 0,
    hasAudio: true,
    needsTap: false,
    toggle: () => {
      const video = ref.current;
      if (!video) return;
      if (video.paused || video.ended) video.play()?.catch?.(() => {});
      else video.pause();
    },
    seekTo,
    skip: (delta) => { const video = ref.current; if (video) video.currentTime = skipTarget(video.currentTime, delta, video.duration); },
    setVolume: (value) => {
      const video = ref.current;
      if (!video) return;
      video.volume = Math.min(1, Math.max(0, value));
      if (value > 0 && video.muted) video.muted = false;
    },
    toggleMute: () => { const video = ref.current; if (video) video.muted = !video.muted; }
  };
}

/** A YouTube embed, driven through the iframe API's postMessage protocol. */
export function useYouTubeMedia(frameRef, videoId) {
  const [state, setState] = useState({ playing: false, time: 0, duration: 0, volume: 1, muted: false });
  // Until the video has played once, taps go to the embed itself: iPad and
  // iPhone Safari only start an embedded video with sound from a tap inside
  // its frame, never from a command sent by the page.
  const [started, setStarted] = useState(false);

  const command = useCallback((func, args = []) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), YOUTUBE_EMBED_ORIGIN);
  }, [frameRef]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!videoId || !frame) return undefined;
    setState({ playing: false, time: 0, duration: 0, volume: 1, muted: false });
    setStarted(false);
    let heard = false;
    const listen = () => frame.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YOUTUBE_EMBED_ORIGIN);
    // The player only reports once it has been asked to, and it may not be
    // ready for the first request.
    const retry = window.setInterval(() => { if (heard) window.clearInterval(retry); else listen(); }, 800);
    frame.addEventListener("load", listen);
    function onMessage(event) {
      if (event.origin !== YOUTUBE_EMBED_ORIGIN || event.source !== frame.contentWindow) return;
      let data;
      try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!data || typeof data !== "object") return;
      heard = true;
      const info = data.info;
      if (info === 1 || info?.playerState === 1) setStarted(true);
      if (data.event === "onStateChange" && typeof info === "number") {
        setState((current) => ({ ...current, playing: info === 1 || info === 3 }));
        return;
      }
      if ((data.event === "infoDelivery" || data.event === "initialDelivery") && info && typeof info === "object") {
        setState((current) => ({
          playing: typeof info.playerState === "number" ? info.playerState === 1 || info.playerState === 3 : current.playing,
          time: typeof info.currentTime === "number" ? info.currentTime : current.time,
          duration: typeof info.duration === "number" ? info.duration : current.duration,
          volume: typeof info.volume === "number" ? info.volume / 100 : current.volume,
          muted: typeof info.muted === "boolean" ? info.muted : current.muted
        }));
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.clearInterval(retry);
      frame.removeEventListener("load", listen);
      window.removeEventListener("message", onMessage);
    };
  }, [frameRef, videoId]);

  if (!videoId) return NO_MEDIA;
  const seekTo = (seconds, final = true) => {
    const target = skipTarget(seconds, 0, state.duration);
    setState((current) => ({ ...current, time: target }));
    command("seekTo", [target, final]);
  };
  return {
    ...state,
    canPlay: true,
    canSeek: state.duration > 0,
    hasAudio: true,
    needsTap: !started,
    toggle: () => {
      setState((current) => ({ ...current, playing: !current.playing }));
      command(state.playing ? "pauseVideo" : "playVideo");
    },
    seekTo,
    skip: (delta) => seekTo(skipTarget(state.time, delta, state.duration), true),
    setVolume: (value) => {
      const volume = Math.min(1, Math.max(0, value));
      setState((current) => ({ ...current, volume, muted: volume > 0 ? false : current.muted }));
      command("setVolume", [Math.round(volume * 100)]);
      if (volume > 0) command("unMute");
    },
    toggleMute: () => {
      setState((current) => ({ ...current, muted: !current.muted }));
      command(state.muted ? "unMute" : "mute");
    }
  };
}

/**
 * The default lofi: its animation (when there is one) and its generated
 * soundtrack play and pause together. The sound is built on first play and
 * fades rather than clicks on every change. A browser that refuses to start
 * audio before a gesture gets it on the reader's next tap or key.
 */
export function useLofiMedia({ enabled, playing, setPlaying }) {
  const [level, setLevel] = useState({ volume: 0.7, muted: false });
  const engineRef = useRef(/** @type {{ context: AudioContext, gain: GainNode, closed: boolean } | null} */ (null));
  const supported = typeof window !== "undefined" && Boolean(window.AudioContext || /** @type {any} */ (window).webkitAudioContext);
  const on = enabled && playing;

  useEffect(() => {
    if (!on || engineRef.current || !supported) return;
    const Context = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    const context = /** @type {AudioContext} */ (new Context());
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    const engine = { context, gain, closed: false };
    engineRef.current = engine;
    // Synthesized after this commit, off the render that started playing.
    Promise.resolve().then(() => renderLofiLoop(context)).then((buffer) => {
      if (!buffer || engine.closed) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
    }).catch(() => { /* no sound; the scene still plays */ });
  }, [on, supported]);

  useEffect(() => () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.closed = true;
    engineRef.current = null;
    engine.context.close().catch(() => {});
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return undefined;
    const { context, gain } = engine;
    // Squared, so the slider feels even to the ear.
    const target = on && !level.muted ? level.volume * level.volume : 0;
    gain.gain.setTargetAtTime(target, context.currentTime, 0.12);
    if (!on) {
      const id = window.setTimeout(() => { if (context.state === "running") context.suspend().catch(() => {}); }, 600);
      return () => window.clearTimeout(id);
    }
    const resume = () => { if (context.state !== "running") context.resume().catch(() => {}); };
    resume();
    const gestures = ["pointerdown", "keydown", "touchend"];
    const onGesture = () => { resume(); gestures.forEach((name) => document.removeEventListener(name, onGesture, true)); };
    gestures.forEach((name) => document.addEventListener(name, onGesture, true));
    return () => gestures.forEach((name) => document.removeEventListener(name, onGesture, true));
  }, [on, level]);

  if (!enabled) return NO_MEDIA;
  return {
    ...NO_MEDIA,
    canPlay: true,
    playing,
    hasAudio: supported,
    volume: level.volume,
    muted: level.muted,
    toggle: () => setPlaying((value) => !value),
    setVolume: (value) => {
      const volume = Math.min(1, Math.max(0, value));
      setLevel((current) => ({ volume, muted: volume > 0 ? false : current.muted }));
    },
    toggleMute: () => setLevel((current) => ({ ...current, muted: !current.muted }))
  };
}

/**
 * Controls stay fully visible while the reader works the player, then fade to
 * almost nothing after a few quiet seconds. `hold` keeps them up (a scrub in
 * progress, keyboard focus inside the bar).
 */
export function useIdleControls(delay = IDLE_DELAY_MS) {
  const [idle, setIdle] = useState(false);
  const holdRef = useRef(false);
  const timerRef = useRef(0);
  const schedule = useCallback(() => {
    window.clearTimeout(timerRef.current);
    if (holdRef.current) return;
    timerRef.current = window.setTimeout(() => setIdle(true), delay);
  }, [delay]);
  const wake = useCallback(() => { setIdle(false); schedule(); }, [schedule]);
  const hold = useCallback((value) => { holdRef.current = value; if (value) { window.clearTimeout(timerRef.current); setIdle(false); } else schedule(); }, [schedule]);
  useEffect(() => { schedule(); return () => window.clearTimeout(timerRef.current); }, [schedule]);
  return { idle, wake, hold };
}

export function MediaControlBar({ media, fullscreen, onToggleFullscreen, onHold }) {
  const { t } = useI18n();
  const [scrub, setScrub] = useState(/** @type {number | null} */ (null));
  const shown = scrub ?? media.time;
  const progress = media.duration > 0 ? Math.min(1, shown / media.duration) : 0;

  function finishScrub(event) {
    if (scrub === null) return;
    media.seekTo(Number(event.currentTarget.value), true);
    setScrub(null);
    onHold(false);
  }

  return (
    <div
      className="paper-media-bar"
      role="group"
      aria-label={t("media.controls")}
      onFocus={(event) => { if (event.target.matches?.(":focus-visible")) onHold(true); }}
      onBlur={(event) => { if (!event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) onHold(false); }}
    >
      {media.canPlay && (
        <button type="button" className="paper-media-button is-primary" onClick={media.toggle} aria-label={media.playing ? t("paper.pause") : t("paper.play")}>
          <Icon name={media.playing ? "pause" : "play"} size={20} />
        </button>
      )}
      {media.canSeek && (
        <>
          <button type="button" className="paper-media-button paper-media-skip" onClick={() => media.skip(-SKIP_SECONDS)} aria-label={t("media.back10")}>
            <Icon name="rotate-back" size={19} /><span aria-hidden="true">{SKIP_SECONDS}</span>
          </button>
          <button type="button" className="paper-media-button paper-media-skip" onClick={() => media.skip(SKIP_SECONDS)} aria-label={t("media.forward10")}>
            <Icon name="rotate-forward" size={19} /><span aria-hidden="true">{SKIP_SECONDS}</span>
          </button>
          {/* A timeline reads left to right in every language, as on the platforms. */}
          <div className="paper-media-timeline" dir="ltr">
            <span className="paper-media-time" aria-hidden="true">{formatMediaTime(shown)}</span>
            <input
              type="range"
              className="paper-media-seek"
              min={0}
              max={media.duration}
              step={0.1}
              value={shown}
              style={cssVars({ "--media-progress": progress })}
              aria-label={t("media.seek")}
              aria-valuetext={`${formatMediaTime(shown)} / ${formatMediaTime(media.duration)}`}
              onPointerDown={() => { setScrub(media.time); onHold(true); }}
              onChange={(event) => {
                const value = Number(event.target.value);
                setScrub(value);
                media.seekTo(value, false);
              }}
              onPointerUp={finishScrub}
              onKeyUp={finishScrub}
              onBlur={finishScrub}
            />
            <span className="paper-media-time" aria-hidden="true">{formatMediaTime(media.duration)}</span>
          </div>
        </>
      )}
      <span className="paper-media-spacer" />
      {media.hasAudio && (
        <div className="paper-media-volume">
          <button type="button" className="paper-media-button" onClick={media.toggleMute} aria-label={media.muted || media.volume === 0 ? t("media.unmute") : t("media.mute")}>
            <Icon name={media.muted || media.volume === 0 ? "volume-off" : "volume"} size={19} />
          </button>
          <input
            type="range"
            className="paper-media-volume-range"
            dir="ltr"
            min={0}
            max={1}
            step={0.05}
            value={media.muted ? 0 : media.volume}
            style={cssVars({ "--media-progress": media.muted ? 0 : media.volume })}
            aria-label={t("media.volume")}
            onChange={(event) => media.setVolume(Number(event.target.value))}
          />
        </div>
      )}
      <button type="button" className="paper-media-button" onClick={onToggleFullscreen} aria-label={fullscreen ? t("paper.exitFullscreen") : t("paper.fullscreen")}>
        <Icon name={fullscreen ? "minimize" : "expand"} size={18} />
      </button>
    </div>
  );
}
