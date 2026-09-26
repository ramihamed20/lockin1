import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { focusApi } from "../api/focus.js";
import { useCatalogMaterials } from "../hooks/useCatalogMaterials.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { CheckpointExitDialog, CheckpointRestartDialog } from "../components/shared/CheckpointExitDialog.jsx";
import { QuestionExplanation } from "../components/shared/QuestionExplanation.jsx";
import { useExitGuard } from "../hooks/useExitGuard.js";
import { Icon } from "../lib/icons.jsx";
import { acquireBodyScrollLock } from "../lib/bodyScrollLock.js";
import { cssVars } from "../lib/utils.js";
import { parseYouTubeVideoId, youTubeEmbedUrl } from "../lib/youtube.js";
import { LofiScene } from "../workspace/paper/LofiScene.jsx";
import { WorkspaceMedia } from "../workspace/paper/WorkspaceMedia.jsx";
import { MediaControlBar, useIdleControls, useLofiMedia, useVideoMedia, useYouTubeMedia } from "../workspace/paper/MediaControls.jsx";
import "./paper-workspace.css";

/**
 * Paper Workspace: the screen a student keeps open while studying from a
 * printed sheet. Setup picks the sheet and the Active Study difficulty; the
 * session shows a focus timer, a quiet video area and the run's progress.
 *
 * Active Study progress is owned by the server (the managed run). This page
 * only keeps per-device conveniences locally: the last setup choice and notes.
 */

const DIFFICULTIES = ["easy", "medium", "hard"];
const FOCUS_SECONDS = 50 * 60;
const SETUP_KEY = "lock-in.paper-workspace.setup";
const NOTES_KEY_PREFIX = "lock-in.paper-workspace.notes.";

function readStorage(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function readSetup() {
  try { return JSON.parse(readStorage(SETUP_KEY) || "null") || {}; } catch { return {}; }
}

/** The edition the sheet's Active Study plan belongs to ("" = University). */
function editionFor(sheet) {
  const primary = sheet?.editions?.[0]?.edition;
  return primary && primary !== "university" ? primary : "";
}

export default function PaperWorkspace({ user }) {
  const { t } = useI18n();
  const { materials, loading, error, reload } = useCatalogMaterials(user);
  const [session, setSession] = useState(null);

  const groups = useMemo(() => materials
    .map((material) => ({
      slug: material.slug,
      title: material.title,
      sheets: (material.sheets || []).filter((sheet) => sheet.learningObjectId && sheet.hasActiveStudy)
    }))
    .filter((group) => group.sheets.length), [materials]);

  if (loading) return <LoadingPanel />;
  if (error) return <ErrorPanel message={error} onRetry={reload} />;

  return (
    <Page title={t("route.paperWorkspace")}>
      {session
        ? <PaperSession session={session} onSessionChange={setSession} onEnd={() => setSession(null)} />
        : <PaperSetup groups={groups} onStart={setSession} />}
    </Page>
  );
}

/* ------------------------------------------------------------------ Setup */

function PaperSetup({ groups, onStart }) {
  const { t } = useI18n();
  const saved = useMemo(readSetup, []);
  // Subject -> Sheet -> Difficulty. A single subject (or a single sheet in the
  // chosen subject) is picked automatically, so a student is never asked a
  // question with only one answer.
  const [subjectSlug, setSubjectSlug] = useState(() => (
    groups.some((group) => group.slug === saved.subjectSlug) ? saved.subjectSlug : groups.length === 1 ? groups[0].slug : ""
  ));
  const subject = groups.find((group) => group.slug === subjectSlug) || null;
  const [sheetId, setSheetId] = useState(() => {
    const sheets = groups.find((group) => group.slug === subjectSlug)?.sheets || [];
    if (sheets.some((item) => item.learningObjectId === saved.sheetId)) return saved.sheetId;
    return sheets.length === 1 ? sheets[0].learningObjectId : "";
  });
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.includes(saved.difficulty) ? saved.difficulty : "medium");
  // "loading" | "failed" | the server's availability payload. Start waits for
  // the server to confirm the chosen difficulty: a sheet the catalog lists can
  // still be unknown to Active Study (a stale or fixture entry).
  const [availability, setAvailability] = useState(/** @type {any} */ ("loading"));
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState("");
  const sheet = subject?.sheets.find((item) => item.learningObjectId === sheetId) || null;

  function chooseSubject(slug) {
    const sheets = groups.find((group) => group.slug === slug)?.sheets || [];
    setSubjectSlug(slug);
    setSheetId(sheets.length === 1 ? sheets[0].learningObjectId : "");
  }

  useEffect(() => {
    if (!sheet) return undefined;
    let cancelled = false;
    setAvailability("loading");
    setStartError("");
    focusApi.getManagedActiveStudyAvailability(sheet.learningObjectId, editionFor(sheet))
      .then((/** @type {any} */ payload) => {
        if (cancelled) return;
        setAvailability(payload);
        const ready = DIFFICULTIES.filter((key) => payload?.difficulties?.some((row) => row.difficulty === key && row.status === "ready"));
        setDifficulty((current) => (ready.includes(current) || !ready.length ? current : ready[0]));
      })
      .catch(() => { if (!cancelled) setAvailability("failed"); });
    return () => { cancelled = true; };
  }, [sheet]);

  const checked = typeof availability === "object" && availability !== null;
  const isReady = (key) => checked && availability.difficulties?.some((row) => row.difficulty === key && row.status === "ready");
  // While loading, difficulties stay selectable; only Start waits.
  const isSelectable = (key) => !checked || isReady(key);
  const unavailable = Boolean(sheet) && (availability === "failed" || (checked && !DIFFICULTIES.some(isReady)));
  const difficultyIndex = DIFFICULTIES.indexOf(difficulty);

  async function start() {
    if (!sheet || !subject || busy) return;
    setBusy(true);
    setStartError("");
    try {
      const edition = editionFor(sheet);
      const payload = await focusApi.startManagedActiveStudy({ sheetId: sheet.learningObjectId, difficulty, edition });
      writeStorage(SETUP_KEY, JSON.stringify({ subjectSlug: subject.slug, sheetId: sheet.learningObjectId, difficulty }));
      onStart({ sheet, material: subject, edition, difficulty, run: payload.run });
    } catch (requestError) {
      setStartError(requestError?.message || t("paper.startFailed"));
      setBusy(false);
    }
  }

  if (!groups.length) {
    return (
      <div className="paper-setup">
        <EmptyState title={t("paper.noSheetsTitle")} text={t("paper.noSheetsText")} />
        <Link className="btn btn-primary paper-empty-action" to="/materials">{t("paper.openMaterials")}</Link>
      </div>
    );
  }

  return (
    <div className="paper-setup">
      <header className="paper-setup-head">
        <span className="paper-setup-mark"><Icon name="file" size={24} /></span>
        <h2 dir="auto">{t("paper.setupTitle")}</h2>
        <p dir="auto">{t("paper.setupLead")}</p>
      </header>

      <section className="paper-panel" aria-labelledby="paper-subject-label">
        <h3 className="paper-label" id="paper-subject-label">{t("paper.subject")}</h3>
        {subject ? (
          <div className="paper-picked">
            <span className="paper-sheet-glyph is-picked"><Icon name="book-open" size={19} /></span>
            <strong dir="auto">{subject.title}</strong>
            {groups.length > 1 && <button type="button" className="paper-change" onClick={() => { setSubjectSlug(""); setSheetId(""); }}>{t("paper.changeSheet")}</button>}
          </div>
        ) : (
          <div className="paper-sheet-list">
            {groups.map((group) => (
              <button key={group.slug} type="button" className="paper-sheet" onClick={() => chooseSubject(group.slug)}>
                <span className="paper-sheet-glyph"><Icon name="book-open" size={19} /></span>
                <span className="paper-sheet-meta">
                  <strong dir="auto">{group.title}</strong>
                  <small>{t("paper.sheetCount", { count: group.sheets.length })}</small>
                </span>
                <Icon name="chevron-right" size={18} className="paper-row-chevron" />
              </button>
            ))}
          </div>
        )}
      </section>

      {subject && (
        <section className="paper-panel paper-step-in" aria-labelledby="paper-sheet-label">
          <h3 className="paper-label" id="paper-sheet-label">{t("paper.sheet")}</h3>
          <div className="paper-sheet-list" role="radiogroup" aria-labelledby="paper-sheet-label">
            {subject.sheets.map((item) => (
              <button key={item.learningObjectId} type="button" role="radio" aria-checked={item.learningObjectId === sheetId} className="paper-sheet" onClick={() => setSheetId(item.learningObjectId)}>
                <span className="paper-sheet-glyph"><Icon name="file" size={19} /></span>
                <span className="paper-sheet-meta">
                  <strong dir="auto">{item.title}</strong>
                  {item.pageCount ? <small>{t("paper.pageCount", { count: item.pageCount })}</small> : null}
                </span>
                <span className="paper-radio" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      {sheet && (
        <>
          <section className="paper-panel paper-step-in" aria-labelledby="paper-difficulty-label">
            <h3 className="paper-label" id="paper-difficulty-label">{t("paper.difficulty")}</h3>
            <div className="paper-segmented" role="radiogroup" aria-labelledby="paper-difficulty-label" style={cssVars({ "--paper-segment": difficultyIndex })}>
              <span className="paper-segmented-thumb" aria-hidden="true" />
              {DIFFICULTIES.map((key) => (
                <button key={key} type="button" role="radio" aria-checked={difficulty === key} disabled={!isSelectable(key)} title={isSelectable(key) ? undefined : t("paper.difficultyUnavailable")} onClick={() => setDifficulty(key)}>
                  {t(`paper.difficulty.${key}`)}
                </button>
              ))}
            </div>
          </section>

          {unavailable && <p className="paper-error" role="alert" dir="auto">{t("paper.sheetUnavailable")}</p>}
          {startError && <p className="paper-error" role="alert" dir="auto">{startError}</p>}
          <button type="button" className="paper-primary" onClick={start} disabled={busy || !isReady(difficulty)}>
            {busy ? t("paper.starting") : availability === "loading" ? t("paper.checking") : t("paper.start")}
            <Icon name="chevron-right" size={19} />
          </button>
          <p className="paper-setup-foot">{t("paper.setupFoot")}</p>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Session */

function formatClock(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function useFocusTimer(onFinish) {
  // Wall-clock based, so a throttled background tab still shows the right time.
  const [state, setState] = useState(() => ({ running: true, endsAt: Date.now() + FOCUS_SECONDS * 1000, left: FOCUS_SECONDS, focused: 0, since: Date.now() }));
  const [, force] = useState(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    if (!state.running) return undefined;
    const id = window.setInterval(() => {
      force((value) => value + 1);
      if (Date.now() >= state.endsAt) {
        setState((current) => ({ ...current, running: false, left: 0, focused: current.focused + (current.endsAt - current.since) / 1000 }));
        finishRef.current?.();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.running, state.endsAt]);

  const now = Date.now();
  const left = state.running ? Math.max(0, (state.endsAt - now) / 1000) : state.left;
  const focused = state.focused + (state.running ? (Math.min(now, state.endsAt) - state.since) / 1000 : 0);
  return {
    left,
    running: state.running,
    focusedMinutes: Math.floor(focused / 60),
    pause: () => setState((current) => (current.running
      ? { ...current, running: false, left: Math.max(0, (current.endsAt - Date.now()) / 1000), focused: current.focused + (Date.now() - current.since) / 1000 }
      : current)),
    resume: () => setState((current) => (!current.running && current.left > 0
      ? { ...current, running: true, endsAt: Date.now() + current.left * 1000, since: Date.now() }
      : current)),
    reset: () => setState((current) => ({
      ...current,
      left: FOCUS_SECONDS,
      endsAt: Date.now() + FOCUS_SECONDS * 1000,
      since: Date.now(),
      focused: current.focused + (current.running ? (Date.now() - current.since) / 1000 : 0)
    }))
  };
}

function PaperSession({ session, onSessionChange, onEnd }) {
  const { t } = useI18n();
  const [notice, setNotice] = useState("");
  const timer = useFocusTimer(() => setNotice(t("paper.focusDone")));
  const [endOpen, setEndOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const run = session.run;
  const setRun = useCallback((nextRun) => onSessionChange((current) => ({ ...current, run: nextRun })), [onSessionChange]);

  useEffect(() => {
    if (!notice) return undefined;
    const id = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  const progress = 1 - timer.left / FOCUS_SECONDS;

  return (
    // Grid areas: timer + search beside a compact Notes, then the player and
    // Status at full width (see paper-workspace.css).
    <div className="paper-workspace">
        <div className="paper-timer" role="group" aria-label={t("paper.timer")}>
          <span className="paper-ring" style={cssVars({ "--paper-progress": progress })} aria-hidden="true"><Icon name="clock" size={18} /></span>
          <span className="paper-time" role="timer" aria-label={t("paper.timer")}>{formatClock(timer.left)}</span>
          <span className={`paper-chip${timer.running ? "" : " is-paused"}`}><span className="paper-chip-dot" />{timer.running ? t("paper.focus") : t("paper.paused")}</span>
          <div className="paper-timer-actions">
            <button type="button" className="paper-round is-accent" onClick={timer.running ? timer.pause : timer.resume} aria-label={timer.running ? t("paper.pause") : t("paper.resume")} disabled={!timer.running && timer.left <= 0}>
              <Icon name={timer.running ? "pause" : "play"} size={19} />
            </button>
            <button type="button" className="paper-round" onClick={timer.reset} aria-label={t("paper.reset")}><Icon name="reset" size={19} /></button>
            <button type="button" className="paper-round" onClick={() => setEndOpen(true)} aria-label={t("paper.end")}><Icon name="square" size={17} /></button>
          </div>
        </div>

        <PaperPlayer />
        <PaperNotes sheetId={session.sheet.learningObjectId} />
        <PaperStatus session={session} focusedMinutes={timer.focusedMinutes} onCheckpoint={() => setStudyOpen(true)} onChangeSheet={onEnd} />

      {studyOpen && (
        <ActiveStudyDialog
          run={run}
          difficulty={session.difficulty}
          onRunChange={setRun}
          onNotice={setNotice}
          onClose={() => setStudyOpen(false)}
        />
      )}
      <ConfirmDialog
        open={endOpen}
        title={t("paper.endTitle")}
        message={t("paper.endMessage", { minutes: timer.focusedMinutes })}
        confirmLabel={t("paper.end")}
        onCancel={() => setEndOpen(false)}
        onConfirm={() => { setEndOpen(false); onEnd(); }}
      />
      {notice && <div className="paper-toast" role="status">{notice}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Player */

/** The reader-facing message for a failed search, by the server's error code. */
function searchErrorKey(error) {
  switch (error?.code) {
    case "youtube_search_unavailable": return "paper.searchUnavailable";
    case "youtube_quota_exceeded": return "paper.searchBusy";
    case "youtube_search_rate_limited": return "paper.searchTooOften";
    default: return "paper.searchFailed";
  }
}

function PaperPlayer() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Results belong to the query they were fetched for; editing the text
  // offers a new search instead of showing stale results.
  const [search, setSearch] = useState(/** @type {{ status: "idle" | "loading" | "done" | "error", query: string, results: any[], errorKey: string }} */ ({ status: "idle", query: "", results: [], errorKey: "" }));
  const searchSeq = useRef(0);
  const [videoId, setVideoId] = useState("");
  const [lofiPlaying, setLofiPlaying] = useState(true);
  // The administrator's media when one is published; the built-in scene
  // otherwise, and whenever the media cannot be loaded.
  const [media, setMedia] = useState(null);
  useEffect(() => {
    let cancelled = false;
    focusApi.getPaperWorkspaceMedia()
      .then((payload) => { if (!cancelled) setMedia(/** @type {any} */ (payload).media || null); })
      .catch(() => { /* keep the built-in scene */ });
    return () => { cancelled = true; };
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);
  const playerRef = useRef(null);
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const tapWakesRef = useRef(false);
  const linkId = parseYouTubeVideoId(query);
  const trimmed = query.trim();
  const adminVideo = !videoId && media?.media_type === "video";
  const videoMedia = useVideoMedia(videoRef, { enabled: adminVideo, src: media?.url || "" });
  const youTubeMedia = useYouTubeMedia(frameRef, videoId);
  // The default lofi (the built-in scene or an admin image) has its own
  // soundtrack, silenced whenever a YouTube video or an admin video plays.
  const lofiMedia = useLofiMedia({ enabled: !videoId && !adminVideo, playing: lofiPlaying, setPlaying: setLofiPlaying });
  const source = videoId ? youTubeMedia : adminVideo ? videoMedia : lofiMedia;
  const controls = useIdleControls();

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === playerRef.current);
    const onPointer = (event) => { if (!searchRef.current?.contains(event.target)) setOpen(false); };
    const onSlash = (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      searchRef.current?.querySelector("input")?.focus();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onSlash);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onSlash);
    };
  }, []);

  function play(id) {
    searchSeq.current += 1;
    setVideoId(id);
    setQuery("");
    setOpen(false);
    setSearch({ status: "idle", query: "", results: [], errorKey: "" });
  }

  async function runSearch(text) {
    const id = searchSeq.current + 1;
    searchSeq.current = id;
    setOpen(true);
    setSearch({ status: "loading", query: text, results: [], errorKey: "" });
    try {
      const results = await focusApi.searchYouTube(text);
      if (id === searchSeq.current) setSearch({ status: "done", query: text, results, errorKey: "" });
    } catch (error) {
      if (id === searchSeq.current) setSearch({ status: "error", query: text, results: [], errorKey: searchErrorKey(error) });
    }
  }

  function submit(event) {
    event.preventDefault();
    if (linkId) play(linkId);
    else if (trimmed && !(search.query === trimmed && search.status === "loading")) runSearch(trimmed);
  }

  /** Arrow keys move between the input and the rows below it. */
  function moveFocus(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = /** @type {HTMLElement[]} */ ([...(resultsRef.current?.querySelectorAll("button.paper-result") || [])]);
    if (!rows.length) return;
    event.preventDefault();
    const index = rows.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    if (next < 0) searchRef.current?.querySelector("input")?.focus();
    else rows[Math.min(next, rows.length - 1)].focus();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen();
      // iPhone Safari has no element fullscreen, only the video's own.
      else /** @type {any} */ (videoRef.current)?.webkitEnterFullscreen?.();
    } catch { /* fullscreen refused by the browser */ }
  }

  const current = search.query === trimmed ? search : null;

  return (
    <>
      {/* Results open directly below the box and never leave Lock-in: a
          chosen video plays in the player below. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys between the box and its results */}
      <form className="paper-search" ref={searchRef} onSubmit={submit} onKeyDown={moveFocus} role="search">
        <div className="paper-search-box">
          <span className="paper-yt-mark" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(Boolean(event.target.value.trim())); }}
            onFocus={() => setOpen(Boolean(trimmed))}
            onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
            placeholder={t("paper.searchPlaceholder")}
            aria-label={t("paper.searchLabel")}
            aria-controls="paper-search-results"
            autoComplete="off"
            enterKeyHint="search"
            dir="auto"
          />
          {current?.status === "loading"
            ? <span className="paper-search-spinner" aria-hidden="true" />
            : <kbd className="paper-kbd" aria-hidden="true">/</kbd>}
        </div>
        {open && trimmed && (
          <div className="paper-results" id="paper-search-results" ref={resultsRef} aria-busy={current?.status === "loading"}>
            {linkId ? (
              <button type="button" className="paper-result" onClick={() => play(linkId)}>
                <span className="paper-result-thumb"><Icon name="play" size={18} /></span>
                <span><strong>{t("paper.playLink")}</strong><small dir="ltr">youtu.be/{linkId}</small></span>
              </button>
            ) : current?.status === "loading" ? (
              <div className="paper-results-status" role="status">
                <span className="visually-hidden">{t("paper.searching")}</span>
                {[0, 1, 2].map((item) => <span key={item} className="paper-result-skeleton" aria-hidden="true"><i /><span><i /><i /></span></span>)}
              </div>
            ) : current?.status === "error" ? (
              <p className="paper-results-message" role="alert" dir="auto">{t(current.errorKey)}</p>
            ) : current?.status === "done" && !current.results.length ? (
              <p className="paper-results-message" role="status" dir="auto">{t("paper.noResults")}</p>
            ) : current?.status === "done" ? (
              <ul className="paper-result-list" aria-label={t("paper.searchResults")}>
                {current.results.map((item) => (
                  <li key={item.video_id}>
                    <button type="button" className="paper-result is-video" onClick={() => play(item.video_id)}>
                      <span className="paper-result-video-thumb">
                        <img src={item.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                        <Icon name="play" size={16} />
                      </span>
                      <span><strong dir="auto">{item.title}</strong><small dir="auto">{item.channel_title}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <button type="submit" className="paper-result">
                <span className="paper-result-thumb"><Icon name="search" size={18} /></span>
                <span><strong dir="auto">{t("paper.searchOnYouTube", { query: trimmed })}</strong><small>{t("paper.searchHint")}</small></span>
              </button>
            )}
          </div>
        )}
      </form>

      {/* Any pointer, touch, pencil or key on the player brings the controls
          back; after a few quiet seconds they fade to almost nothing. These
          are activity listeners, not an interaction of their own. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- see above */}
      <div
        className={`paper-player${fullscreen ? " is-fullscreen" : ""}${controls.idle ? " is-idle" : ""}`}
        ref={playerRef}
        onPointerMove={controls.wake}
        onPointerDown={controls.wake}
        onKeyDown={controls.wake}
      >
        {videoId
          ? <iframe ref={frameRef} className="paper-player-frame" src={youTubeEmbedUrl(videoId, window.location.origin)} title={t("paper.youtubeVideo")} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : media
            ? <WorkspaceMedia media={media} videoRef={videoRef} label={t("paper.lofi")} onError={() => setMedia(null)} />
            : <LofiScene playing={lofiPlaying} label={t("paper.lofiLabel")} />}
        {/* The embed swallows pointer events, so this layer is what notices
            the reader over a YouTube video. A tap on faded controls only
            brings them back; a tap on visible ones plays or pauses. Until a
            video has played once the layer steps aside, so a tap reaches the
            embed's own Play (the only way iPad Safari starts it with sound). */}
        {/* Pointer-only surface: the bar's Play button is its keyboard equivalent. */}
        <div
          className={`paper-player-hit${source.needsTap ? " is-passthrough" : ""}`}
          aria-hidden="true"
          onPointerDown={() => { tapWakesRef.current = controls.idle; }}
          onClick={() => { if (!tapWakesRef.current && source.canPlay) source.toggle(); }}
        />
        {videoId && (
          <div className="paper-player-top">
            <button type="button" className="paper-glass-button" onClick={() => setVideoId("")}><Icon name="headphones" size={15} />{t("paper.backToLofi")}</button>
          </div>
        )}
        <MediaControlBar media={source} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} onHold={controls.hold} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Notes */

function PaperNotes({ sheetId }) {
  const { t } = useI18n();
  const key = NOTES_KEY_PREFIX + sheetId;
  const [value, setValue] = useState(() => readStorage(key) || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!saving) return undefined;
    const id = window.setTimeout(() => { writeStorage(key, value); setSaving(false); }, 450);
    return () => window.clearTimeout(id);
  }, [key, value, saving]);

  return (
    <section className="paper-box paper-notes" aria-labelledby="paper-notes-title">
      <div className="paper-box-head">
        <h2 id="paper-notes-title"><Icon name="pencil" size={17} />{t("paper.notes")}</h2>
        {value && <span className="paper-saved" aria-live="polite">{saving ? "…" : t("paper.saved")}</span>}
      </div>
      <textarea value={value} onChange={(event) => { setValue(event.target.value); setSaving(true); }} placeholder={t("paper.notesPlaceholder")} aria-labelledby="paper-notes-title" dir="auto" />
    </section>
  );
}

/* ----------------------------------------------------------------- Status */

function stepStates(run) {
  const total = run?.number_of_parts || 0;
  const completed = new Set(run?.completed_parts || []);
  const finished = run?.status === "completed";
  const inFinal = run?.stage === "final" || run?.stage === "final_result";
  const parts = Array.from({ length: total }, (_, index) => {
    const part = index + 1;
    const state = finished || completed.has(part) ? "done" : !inFinal && run?.current_part === part ? "current" : "pending";
    return { key: `part-${part}`, part, final: false, state };
  });
  return [...parts, { key: "final", part: 0, final: true, state: finished ? "done" : inFinal ? "current" : "pending" }];
}

function PaperStatus({ session, focusedMinutes, onCheckpoint, onChangeSheet }) {
  const { t } = useI18n();
  const { run, sheet, difficulty } = session;
  const range = run?.current_page_range;
  const finished = run?.status === "completed";
  const inFinal = run?.stage === "final" || run?.stage === "final_result";
  const level = DIFFICULTIES.indexOf(difficulty) + 1;
  const hint = finished ? t("paper.completedHint")
    : inFinal ? t("paper.finalHint")
      : run?.stage === "checkpoint_result" ? t("paper.resultHint")
        : t("paper.checkpointHint");

  return (
    <section className="paper-box paper-status" aria-labelledby="paper-status-title">
      <h2 className="paper-label" id="paper-status-title">{t("paper.status")}</h2>
      <div className="paper-status-sheet">
        <span className="paper-status-glyph"><Icon name="file" size={22} /></span>
        <div>
          <strong dir="auto">{sheet.title}</strong>
          <span className="paper-status-difficulty">
            {t(`paper.difficulty.${difficulty}`)}
            <span className="paper-dots" aria-hidden="true">{[1, 2, 3].map((dot) => <i key={dot} className={dot <= level ? "is-on" : ""} />)}</span>
          </span>
        </div>
        <button type="button" className="paper-change" onClick={onChangeSheet}>{t("paper.changeSheet")}</button>
      </div>
      <dl className="paper-facts">
        <div className="is-wide">
          <dt>{t("paper.currentPart")}</dt>
          <dd>{finished ? t("paper.completedHint") : inFinal ? t("paper.final") : t("paper.partOf", { part: run?.current_part || 1, total: run?.number_of_parts || 1 })}</dd>
        </div>
        <div>
          <dt>{t("paper.pages")}</dt>
          <dd dir="ltr">{range && !inFinal && !finished ? `${range.start_page} – ${range.end_page}` : "—"}</dd>
        </div>
        <div>
          <dt>{t("paper.focused")}</dt>
          <dd>{t("paper.minutes", { minutes: focusedMinutes })}</dd>
        </div>
      </dl>
      <ol className="paper-steps">
        {stepStates(run).map((step) => (
          <li key={step.key} className={`paper-step is-${step.state}`}>
            <span className="paper-step-node">{step.state === "done" && <Icon name="check" size={14} strokeWidth={2.8} />}</span>
            <span className="paper-step-label">{step.final ? t("paper.final") : t("paper.part", { part: step.part })}</span>
            <small>{t(`paper.step.${step.state}`)}</small>
          </li>
        ))}
      </ol>
      <button type="button" className="paper-checkpoint" onClick={onCheckpoint} disabled={finished}>
        <Icon name="flag" size={21} />
        <span><strong>{t("paper.checkpoint")}</strong><small>{hint}</small></span>
        <Icon name="chevron-right" size={19} />
      </button>
    </section>
  );
}

/* ----------------------------------------------------------- Active Study */

function useDialogFocus(ref, onClose, locked, suspended = false) {
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  const suspendedRef = useRef(suspended);
  closeRef.current = onClose;
  lockedRef.current = locked;
  // A confirmation on top owns the keyboard until it closes.
  suspendedRef.current = suspended;
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = acquireBodyScrollLock();
    ref.current?.focus();
    function onKey(event) {
      if (suspendedRef.current) return;
      if (event.key === "Escape" && !lockedRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const focusable = Array.from(ref.current?.querySelectorAll("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") || []);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === ref.current || document.activeElement === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      release();
      document.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [ref]);
}

function ActiveStudyDialog({ run, difficulty, onRunChange, onNotice, onClose }) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const [view, setView] = useState(/** @type {any} */ ({ kind: "loading" }));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(/** @type {"" | "exit" | "restart"} */ (""));
  // An unfinished question attempt is never left by accident: the close
  // button, the backdrop, Escape and the browser's Back all ask first.
  const inQuiz = view.kind === "quiz";
  const requestClose = () => { if (inQuiz) setConfirming("exit"); else onClose(); };
  useDialogFocus(dialogRef, requestClose, busy, Boolean(confirming));
  // Held for the dialog's whole life, so a brief loading state (Restart)
  // never drops it: Back asks during questions and simply closes a result.
  useExitGuard({ active: true, onRequestExit: requestClose });

  const loadQuestions = useCallback(async (currentRun) => {
    const payload = await focusApi.getManagedActiveStudyQuestions(currentRun.id);
    const questions = /** @type {any[]} */ (payload.questions).map((item) => ({
      position: item.position,
      prompt: item.question,
      options: Object.entries(item.options || {}).map(([id, text]) => ({ id, text })),
      answered: item.answered || ""
    }));
    if (payload.run) onRunChange(payload.run);
    const firstOpen = questions.findIndex((item) => !item.answered);
    setView({ kind: "quiz", quizKind: payload.kind, attemptId: payload.attempt_id, questions, index: firstOpen === -1 ? questions.length - 1 : firstOpen, feedback: null });
  }, [onRunChange]);

  // Opening the dialog moves the run to whatever its stage asks for next.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (run.stage === "checkpoint_result") { setView({ kind: "result", quizKind: "checkpoint", result: { score: run.last_score, passed: false } }); return; }
        if (run.stage === "final_result") { setView({ kind: "result", quizKind: "final", result: { score: run.last_score, passed: false } }); return; }
        let current = run;
        if (run.stage === "reading") {
          try {
            current = /** @type {any} */ ((await focusApi.managedActiveStudyAction(run.id, "complete-reading")).run);
          } catch {
            // Already moved on by an earlier request (a double open, another
            // tab). The questions request below reports any real refusal.
          }
        }
        if (cancelled) return;
        await loadQuestions(current);
      } catch (requestError) {
        if (!cancelled) setView({ kind: "error", message: requestError?.message || t("paper.loadFailed") });
      }
    })();
    return () => { cancelled = true; };
    // Runs once per opening; later run updates come from this dialog itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function answer(optionId) {
    if (view.kind !== "quiz" || view.feedback || busy) return;
    const question = view.questions[view.index];
    setBusy(true);
    try {
      const payload = await focusApi.answerManagedActiveStudyQuestion(run.id, { attemptId: view.attemptId, position: question.position, selectedAnswer: optionId });
      setView((current) => ({
        ...current,
        questions: current.questions.map((item, index) => (index === current.index ? { ...item, answered: optionId } : item)),
        feedback: { selected: optionId, correct: Boolean(payload.correct), correctAnswer: String(payload.correct_answer || ""), explanation: String(payload.explanation || "") }
      }));
    } catch (requestError) {
      onNotice(requestError?.message || t("paper.answerFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (view.kind !== "quiz" || busy) return;
    const remaining = view.questions.findIndex((item, index) => index > view.index && !item.answered);
    if (remaining !== -1) { setView({ ...view, index: remaining, feedback: null }); return; }
    const unanswered = view.questions.findIndex((item) => !item.answered);
    if (unanswered !== -1) { setView({ ...view, index: unanswered, feedback: null }); return; }
    setBusy(true);
    try {
      const payload = await focusApi.submitManagedActiveStudy(run.id, view.attemptId);
      onRunChange(payload.run);
      setView({ kind: "result", quizKind: view.quizKind, result: payload.result });
    } catch (requestError) {
      onNotice(requestError?.message || t("paper.submitFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function act(action, { reload = false, notice = "" } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await focusApi.managedActiveStudyAction(run.id, action);
      onRunChange(payload.run);
      if (reload) { setView({ kind: "loading" }); await loadQuestions(payload.run); }
      else { if (notice) onNotice(notice); onClose(); }
    } catch (requestError) {
      onNotice(requestError?.message || t("paper.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  // Answers are saved on the server as each one is chosen, so keeping them is
  // simply closing: reopening resumes at the first unanswered question.
  function exitAndSave() {
    setConfirming("");
    onClose();
  }

  /** Clears only this unsubmitted attempt; completed parts stay completed. */
  async function discardAttempt({ restart }) {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await focusApi.managedActiveStudyAction(run.id, "discard-attempt");
      onRunChange(payload.run);
      setConfirming("");
      if (restart) { setView({ kind: "loading" }); await loadQuestions(payload.run); }
      else onClose();
    } catch (requestError) {
      onNotice(requestError?.message || t("checkpoint.resetFailed"));
    } finally {
      setBusy(false);
    }
  }

  const question = view.kind === "quiz" ? view.questions[view.index] : null;
  const answeredCount = view.kind === "quiz" ? view.questions.filter((item) => item.answered).length : 0;

  return (
    <div className="paper-scrim">
      <button className="paper-scrim-dismiss" type="button" tabIndex={-1} aria-label={t("common.close")} disabled={busy} onClick={requestClose} />
      <div className="paper-dialog" role="dialog" aria-modal="true" aria-labelledby="paper-dialog-title" aria-busy={busy} ref={dialogRef} tabIndex={-1}>
        <div className="paper-dialog-top">
          <span className="paper-chip is-gold"><Icon name="flag" size={14} />{t("paper.activeStudy")}</span>
          <span className="paper-chip">{t(`paper.difficulty.${difficulty}`)}</span>
          {inQuiz && <button type="button" className="paper-ghost paper-dialog-restart" onClick={() => setConfirming("restart")} disabled={busy}><Icon name="reset" size={15} />{t("checkpoint.restart")}</button>}
          <button type="button" className="paper-round paper-dialog-close" onClick={requestClose} disabled={busy} aria-label={t("common.close")}><Icon name="x" size={18} /></button>
        </div>

        {view.kind === "loading" && <div className="paper-dialog-state" id="paper-dialog-title">{t("paper.loading")}</div>}
        {view.kind === "error" && <div className="paper-dialog-state" role="alert" id="paper-dialog-title" dir="auto">{view.message}</div>}

        {question && (
          <>
            <div className="paper-quiz-progress" aria-hidden="true">
              {view.questions.map((item, index) => <i key={item.position} className={index === view.index ? "is-current" : item.answered ? "is-answered" : ""} />)}
            </div>
            <p className="paper-quiz-count">
              {view.quizKind === "final" ? t("paper.final") : t("paper.part", { part: run.current_part })}
              {" · "}
              {t("paper.questionCount", { current: view.index + 1, total: view.questions.length })}
            </p>
            <h2 className="paper-quiz-prompt" id="paper-dialog-title" dir="auto">{question.prompt}</h2>
            <div className="paper-options">
              {question.options.map((option) => {
                const feedback = view.feedback;
                const state = !feedback ? (question.answered === option.id ? " is-selected" : "")
                  : option.id === feedback.correctAnswer ? " is-correct"
                    : option.id === feedback.selected ? " is-wrong" : "";
                return (
                  <button key={option.id} type="button" className={`paper-option${state}`} disabled={Boolean(feedback) || Boolean(question.answered) || busy} onClick={() => answer(option.id)}>
                    <span className="paper-option-key">{option.id}</span>
                    <span dir="auto">{option.text}</span>
                  </button>
                );
              })}
            </div>
            <div className="paper-dialog-foot">
              <div className="paper-explanation" aria-live="polite">
                <QuestionExplanation key={question.position} explanation={view.feedback?.explanation} />
              </div>
              {(view.feedback || question.answered) && (
                <button type="button" className="paper-primary is-compact" onClick={next} disabled={busy}>
                  {answeredCount === view.questions.length ? t("paper.seeResult") : t("paper.next")}
                  <Icon name="chevron-right" size={18} />
                </button>
              )}
            </div>
          </>
        )}

        {view.kind === "result" && (
          <ResultView view={view} run={run} busy={busy} onClose={onClose} onAct={act} />
        )}
      </div>
      <CheckpointExitDialog
        open={confirming === "exit"}
        busy={busy}
        onSave={exitAndSave}
        onDiscard={() => discardAttempt({ restart: false })}
        onCancel={() => setConfirming("")}
      />
      <CheckpointRestartDialog
        open={confirming === "restart"}
        busy={busy}
        onConfirm={() => discardAttempt({ restart: true })}
        onCancel={() => setConfirming("")}
      />
    </div>
  );
}

function ResultView({ view, run, busy, onClose, onAct }) {
  const { t } = useI18n();
  const { result, quizKind } = view;
  const passed = Boolean(result?.passed);
  const final = quizKind === "final";
  const title = final
    ? (passed ? t("paper.finalPassed") : t("paper.finalFailed"))
    : (passed ? t("paper.checkpointPassed", { part: Math.max(1, (run.completed_parts || []).slice(-1)[0] || run.current_part) }) : t("paper.checkpointFailed"));

  return (
    <div className={`paper-result-view${passed ? " is-passed" : ""}`}>
      <span className="paper-result-icon"><Icon name={passed ? "check" : "reset"} size={32} strokeWidth={2.2} /></span>
      <h2 id="paper-dialog-title" dir="auto">{title}</h2>
      {typeof result?.score === "number" && (
        <p className="paper-score">{result.score}{result.total ? <small> / {result.total}</small> : null}</p>
      )}
      {passed && result?.xp_awarded ? <p className="paper-chip is-gold">{t("paper.xpEarned", { xp: result.xp_awarded })}</p> : null}
      {!passed && <p className="paper-result-text" dir="auto">{final ? t("paper.finalFailedText") : t("paper.checkpointFailedText")}</p>}
      <div className="paper-result-actions">
        {passed && <button type="button" className="paper-primary is-compact" onClick={onClose}>{t("paper.continue")}</button>}
        {!passed && !final && (
          <>
            <button type="button" className="paper-ghost" disabled={busy} onClick={() => onAct("continue", { notice: t("paper.movedOn") })}>{t("paper.continueAnyway")}</button>
            <button type="button" className="paper-primary is-compact" disabled={busy} onClick={() => onAct("study-again", { notice: t("paper.studyAgainNotice") })}>{t("paper.studyAgain")}</button>
          </>
        )}
        {!passed && final && (
          <>
            <button type="button" className="paper-ghost" disabled={busy} onClick={onClose}>{t("paper.later")}</button>
            <button type="button" className="paper-primary is-compact" disabled={busy} onClick={() => onAct("retry-final", { reload: true })}>{t("paper.retryFinal")}</button>
          </>
        )}
      </div>
    </div>
  );
}
