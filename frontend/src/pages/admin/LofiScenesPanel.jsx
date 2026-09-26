import { useEffect, useMemo, useRef, useState } from "react";
import { adminControlApi } from "../../api/adminControl.js";
import { managementApi } from "../../api/management.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.jsx";
import { ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { Icon } from "../../lib/icons.jsx";
import { cssVars } from "../../lib/utils.js";
import { WorkspaceMedia } from "../../workspace/paper/WorkspaceMedia.jsx";
import "./paper-workspace-media.css";

/**
 * Creator Studio: the Lo-Fi scenes of the Paper Workspace player.
 *
 * Upload once, store once, loop on the client. An administrator uploads a
 * short clip (seconds, not an hour); the server keeps exactly that file and the
 * player repeats it for the whole study session. Several scenes can exist
 * (cat at a desk, rainy night, library…); students pick one, in the order set
 * here. One upload serves every screen: the player crops around the focal point.
 */

const VIDEO_ACCEPT = "video/mp4,video/webm";
const COVER_ACCEPT = "image/jpeg,image/png,image/webp";
// The player's shape always lies between these two (see paper-workspace.css).
const PREVIEW_FRAMES = [
  { key: "standard", label: "Phone · iPad · smaller laptops", ratio: "16 / 9" },
  { key: "wide", label: "Wide desktop screens (widest crop)", ratio: "21 / 9" }
];

function megabytes(bytes) {
  if ((Number(bytes) || 0) < 1024 * 1024) return `${Math.max(1, Math.round((Number(bytes) || 0) / 1024))} KB`;
  const value = (Number(bytes) || 0) / (1024 * 1024);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} MB`;
}

export function formatClipLength(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Width, height and length of a local file, read before anything is uploaded. */
function readLocalMedia(url, isVideo) {
  return new Promise((resolve) => {
    if (!isVideo) {
      const image = new window.Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, duration: 0 });
      image.onerror = () => resolve(null);
      image.src = url;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 });
    video.onerror = () => resolve(null);
    video.src = url;
  });
}

/**
 * Checks a chosen clip against the server's limits, so a problem is explained
 * before a long upload. The server repeats every check; this only saves time.
 */
export function clipProblem(file, local, limits) {
  if (!["video/mp4", "video/webm"].includes(file.type)) return "Choose an MP4 or WebM video.";
  if (file.size > limits.max_bytes) return `This video is ${megabytes(file.size)}; the limit is ${megabytes(limits.max_bytes)}. Upload a short clip: the player loops it.`;
  if (!local) return "This video can't be played in the browser. Re-export it as MP4 (H.264) or WebM.";
  if (!local.duration) return "This video doesn't state its length. Re-export it as MP4 or WebM.";
  if (local.duration < limits.min_seconds) return `This video is ${local.duration.toFixed(1)} s long; a loop must be at least ${limits.min_seconds} s.`;
  if (local.duration > limits.max_seconds) return `This video is ${(local.duration / 60).toFixed(1)} min long; the limit is ${Math.floor(limits.max_seconds / 60)} min. Upload a short clip: the player repeats it for the whole session.`;
  return "";
}

function sizeAdvice(local) {
  if (!local?.width || !local?.height) return "";
  const notes = [];
  if (Math.abs(local.width / local.height - 16 / 9) > 0.06) notes.push("It is not 16:9, so more of its edges will be cropped. Set the focal point on the part that matters.");
  if (local.width < 1280) notes.push("It is smaller than 1280 px wide and may look soft on large screens.");
  return notes.join(" ");
}

export default function LofiScenesPanel({ canManage }) {
  const data = useAsyncData(() => adminControlApi.lofiScenes(), []);
  if (!data.data) return data.error ? <ErrorPanel message={data.error} onRetry={data.reload} /> : <LoadingPanel />;
  return <ScenesManager state={data.data} canManage={canManage} onChanged={data.reload} />;
}

function ScenesManager({ state, canManage, onChanged }) {
  const [editing, setEditing] = useState(/** @type {"" | "new" | string} */ (""));
  const [confirmDelete, setConfirmDelete] = useState(/** @type {any} */ (null));
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const scenes = state.scenes || [];
  const editingScene = scenes.find((scene) => scene.id === editing) || null;

  async function run(key, action, success) {
    setPending(key); setError(""); setMessage("");
    try {
      await action();
      if (success) setMessage(success);
      onChanged();
    } catch (requestError) {
      setError(requestError?.message || "The change could not be saved.");
    } finally {
      setPending("");
    }
  }

  function move(index, delta) {
    const order = scenes.map((scene) => scene.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved);
    void run(`move-${moved}`, () => adminControlApi.reorderLofiScenes(order), "Order saved. Students see the first enabled scene by default.");
  }

  return (
    <section className="panel paper-media-admin" aria-labelledby="lofi-admin-title">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Paper Workspace</p>
          <h2 id="lofi-admin-title">Lo-Fi scenes</h2>
        </div>
        {canManage && !editing && scenes.length < state.max_scenes && (
          <button type="button" className="btn btn-primary compact" onClick={() => { setEditing("new"); setMessage(""); setError(""); }}>
            <Icon name="plus" size={16} />Add scene
          </button>
        )}
      </div>

      <p className="paper-media-admin-spec">
        <Icon name="image" size={16} />
        <span>Upload a <strong>short loop</strong> ({state.min_seconds} s to {Math.floor(state.max_seconds / 60)} min), MP4 or WebM, up to {megabytes(state.max_bytes)}; <strong>16:9</strong>, {state.recommended.width}×{state.recommended.height} or {state.recommended.alternative}. Only that clip is stored; the player repeats it seamlessly for the whole study session. Make the last frame flow into the first for an invisible loop.</span>
      </p>

      {error && <p className="form-alert error" role="alert">{error}</p>}
      {message && <p className="form-alert success" role="status">{message}</p>}

      {editing && (
        <SceneEditor
          key={editing === "new" ? "new" : `${editing}-${editingScene?.revision}`}
          scene={editingScene}
          limits={state}
          onCancel={() => setEditing("")}
          onSaved={(text) => { setEditing(""); setMessage(text); onChanged(); }}
        />
      )}

      {scenes.length ? (
        <ol className="lofi-admin-list" aria-label="Scenes, in the order students see them">
          {scenes.map((scene, index) => (
            <li key={scene.id} className={`lofi-admin-row${scene.enabled ? "" : " is-hidden"}`}>
              <span className="lofi-admin-thumb">
                {scene.cover
                  ? <img src={scene.cover.url} alt="" loading="lazy" />
                  : <WorkspaceMedia media={{ url: scene.media.url, media_type: scene.media.media_type, focal_x: scene.focal_x, focal_y: scene.focal_y }} label={`${scene.title} preview`} preview />}
              </span>
              <span className="lofi-admin-meta">
                <strong dir="auto">{scene.title}</strong>
                <small>
                  {scene.media.media_type === "video" && scene.media.duration_ms ? `${formatClipLength(scene.media.duration_ms)} loop · ` : ""}
                  {megabytes(scene.media.size_bytes)} · {scene.media.content_type === "video/webm" ? "WebM" : scene.media.content_type === "video/mp4" ? "MP4" : "Image"}
                </small>
              </span>
              <span className={`pill${scene.enabled && scene.deliverable ? " is-live" : ""}`}>
                {!scene.enabled ? "Hidden" : scene.deliverable ? "Shown to students" : "Waiting for file checks"}
              </span>
              {canManage && (
                <span className="lofi-admin-row-actions">
                  <label className="check-row">
                    <input type="checkbox" checked={scene.enabled} disabled={Boolean(pending)} onChange={(event) => void run(`toggle-${scene.id}`, () => adminControlApi.updateLofiScene(scene.id, scene.revision, { enabled: event.target.checked }), event.target.checked ? `“${scene.title}” is shown to students.` : `“${scene.title}” is hidden from students.`)} />
                    <span className="visually-hidden">Show “{scene.title}” to students</span>
                    <span aria-hidden="true">Show</span>
                  </label>
                  <button type="button" className="btn btn-outline compact icon-only" aria-label={`Move “${scene.title}” up`} disabled={index === 0 || Boolean(pending)} onClick={() => move(index, -1)}><Icon name="chevron-up" size={16} /></button>
                  <button type="button" className="btn btn-outline compact icon-only" aria-label={`Move “${scene.title}” down`} disabled={index === scenes.length - 1 || Boolean(pending)} onClick={() => move(index, 1)}><Icon name="chevron-down" size={16} /></button>
                  <button type="button" className="btn btn-soft compact" disabled={Boolean(pending) || Boolean(editing)} onClick={() => { setEditing(scene.id); setMessage(""); setError(""); }}>Edit</button>
                  <button type="button" className="btn btn-outline compact icon-only" aria-label={`Delete “${scene.title}”`} disabled={Boolean(pending)} onClick={() => setConfirmDelete(scene)}><Icon name="trash" size={16} /></button>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : !editing && (
        <div className="paper-media-admin-empty">
          <Icon name="image" size={22} />
          <p>No scenes yet. Students see the built-in lofi scene.</p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`Delete “${confirmDelete?.title || ""}”?`}
        message="Students will no longer see this scene, and its video and cover are removed from storage."
        confirmLabel={pending === "delete" ? "Deleting…" : "Delete"}
        busy={pending === "delete"}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const scene = confirmDelete;
          void run("delete", () => adminControlApi.deleteLofiScene(scene.id, scene.revision), `“${scene.title}” was deleted.`).then(() => setConfirmDelete(null));
        }}
      />
    </section>
  );
}

function SceneEditor({ scene, limits, onCancel, onSaved }) {
  const [title, setTitle] = useState(scene?.title || "");
  const [video, setVideo] = useState(/** @type {{ file: File, url: string } | null} */ (null));
  const [cover, setCover] = useState(/** @type {{ file: File, url: string } | null} */ (null));
  const [removeCover, setRemoveCover] = useState(false);
  const [local, setLocal] = useState(null);
  const [focal, setFocal] = useState({ x: scene?.focal_x ?? 50, y: scene?.focal_y ?? 50 });
  const [enabled, setEnabled] = useState(scene ? Boolean(scene.enabled) : true);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const videoInput = useRef(null);
  const coverInput = useRef(null);

  // Object URLs live only as long as their draft.
  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url); }, [video]);
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);

  useEffect(() => {
    if (video || !scene) return undefined;
    let cancelled = false;
    readLocalMedia(scene.media.url, scene.media.media_type === "video").then((size) => { if (!cancelled) setLocal(size); });
    return () => { cancelled = true; };
  }, [video, scene]);

  const media = useMemo(() => {
    if (video) return { url: video.url, media_type: "video", focal_x: focal.x, focal_y: focal.y };
    if (scene) return { url: scene.media.url, media_type: scene.media.media_type, focal_x: focal.x, focal_y: focal.y };
    return null;
  }, [video, scene, focal]);
  const coverUrl = cover?.url || (!removeCover && scene?.cover?.url) || "";

  async function chooseVideo(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError("");
    if (!file) return;
    const url = URL.createObjectURL(file);
    const info = await readLocalMedia(url, true);
    const problem = clipProblem(file, info, limits);
    if (problem) { URL.revokeObjectURL(url); setError(problem); return; }
    setVideo({ file, url });
    setLocal(info);
    setFocal({ x: 50, y: 50 });
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 80));
  }

  function chooseCover(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError("");
    if (!file) return;
    if (!COVER_ACCEPT.split(",").includes(file.type)) { setError("The cover must be a JPEG, PNG or WebP image."); return; }
    if (file.size > limits.max_bytes) { setError(`The cover is larger than ${megabytes(limits.max_bytes)}.`); return; }
    setCover({ file, url: URL.createObjectURL(file) });
    setRemoveCover(false);
  }

  function pickFocal(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setFocal({
      x: Math.round(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))),
      y: Math.round(Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)))
    });
  }

  function nudgeFocal(event) {
    const step = event.shiftKey ? 10 : 2;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setFocal((current) => ({ x: Math.min(100, Math.max(0, current.x + move[0])), y: Math.min(100, Math.max(0, current.y + move[1])) }));
  }

  async function save(event) {
    event.preventDefault();
    if (!title.trim()) { setError("Give the scene a title."); return; }
    if (!scene && !video) { setError("Choose a video for the scene."); return; }
    setError("");
    try {
      setPending(video ? "video" : cover ? "cover" : "save");
      const mediaFileId = video ? (await managementApi.uploadFile({ kind: "workspace_media", file: video.file })).id : null;
      if (cover) setPending("cover");
      const coverFileId = cover ? (await managementApi.uploadFile({ kind: "workspace_media", file: cover.file })).id : null;
      setPending("save");
      if (scene) {
        const changes = { title, enabled, focalX: focal.x, focalY: focal.y };
        if (mediaFileId) changes.mediaFileId = mediaFileId;
        if (coverFileId) changes.coverFileId = coverFileId;
        else if (removeCover) changes.coverFileId = null;
        await adminControlApi.updateLofiScene(scene.id, scene.revision, changes);
        onSaved(`“${title.trim()}” was saved.`);
      } else {
        await adminControlApi.createLofiScene({ title, mediaFileId, coverFileId, enabled, focalX: focal.x, focalY: focal.y });
        onSaved(enabled ? `“${title.trim()}” was added. Students can pick it the next time they open Paper Workspace.` : `“${title.trim()}” was added, hidden from students.`);
      }
    } catch (requestError) {
      setError(requestError?.message || "The scene could not be saved.");
      setPending("");
    }
  }

  const advice = sizeAdvice(local);
  const busyLabel = pending === "video" ? "Uploading video…" : pending === "cover" ? "Uploading cover…" : "Saving…";

  return (
    <form className="lofi-admin-editor" onSubmit={save} aria-label={scene ? `Edit “${scene.title}”` : "New scene"}>
      <div className="lofi-admin-fields">
        <label className="field">
          <span>Title</span>
          <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Rainy night" dir="auto" />
        </label>
        <div className="lofi-admin-files">
          <input ref={videoInput} className="visually-hidden" type="file" accept={VIDEO_ACCEPT} onChange={chooseVideo} tabIndex={-1} aria-hidden="true" data-testid="lofi-video-input" />
          <button type="button" className="btn btn-soft compact" onClick={() => videoInput.current?.click()} disabled={Boolean(pending)}>
            <Icon name="plus" size={16} />{scene || video ? "Replace video" : "Choose video"}
          </button>
          <input ref={coverInput} className="visually-hidden" type="file" accept={COVER_ACCEPT} onChange={chooseCover} tabIndex={-1} aria-hidden="true" data-testid="lofi-cover-input" />
          <button type="button" className="btn btn-soft compact" onClick={() => coverInput.current?.click()} disabled={Boolean(pending)}>
            <Icon name="image" size={16} />{coverUrl ? "Replace cover" : "Add cover (optional)"}
          </button>
          {coverUrl && <button type="button" className="btn btn-outline compact" onClick={() => { setCover(null); setRemoveCover(true); }} disabled={Boolean(pending)}>Remove cover</button>}
          {video && <span className="lofi-admin-file-note">{video.file.name} · {megabytes(video.file.size)}{local?.duration ? ` · ${formatClipLength(local.duration * 1000)} loop` : ""}</span>}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={Boolean(pending)} /> Show to students
        </label>
      </div>

      {media ? (
        <div className="paper-media-admin-grid">
          <div className="paper-media-admin-main">
            <div
              className="paper-media-admin-source"
              role="slider"
              tabIndex={0}
              aria-label="Focal point"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={focal.x}
              aria-valuetext={`${focal.x}% across, ${focal.y}% down`}
              style={cssVars({ "--source-ratio": local?.width && local?.height ? `${local.width} / ${local.height}` : "16 / 9" })}
              onClick={pickFocal}
              onKeyDown={nudgeFocal}
            >
              <WorkspaceMedia media={{ ...media, focal_x: 50, focal_y: 50 }} label="Preview of the loop" className="is-contain" preview />
              <span className="paper-media-admin-focal" style={cssVars({ "--focal-x": `${focal.x}%`, "--focal-y": `${focal.y}%` })} aria-hidden="true" />
            </div>
            <p className="paper-media-admin-hint">Click or use the arrow keys to set what must stay in frame · {focal.x}% × {focal.y}%{local?.width ? ` · ${local.width}×${local.height}` : ""}</p>
            {advice && <p className="form-alert">{advice}</p>}
          </div>
          <div className="paper-media-admin-frames" aria-label="How students will see it">
            {PREVIEW_FRAMES.map((frame) => (
              <figure key={frame.key}>
                <div className="paper-media-admin-frame" style={cssVars({ "--frame-ratio": frame.ratio })}>
                  <WorkspaceMedia media={media} label={`${frame.label} preview`} preview />
                </div>
                <figcaption>{frame.label}</figcaption>
              </figure>
            ))}
            {coverUrl && (
              <figure>
                <div className="paper-media-admin-frame lofi-admin-cover" style={cssVars({ "--frame-ratio": "16 / 9" })}><img src={coverUrl} alt="Cover" /></div>
                <figcaption>Cover (scene picker)</figcaption>
              </figure>
            )}
          </div>
        </div>
      ) : (
        <div className="paper-media-admin-empty">
          <Icon name="image" size={22} />
          <p>Choose a short MP4 or WebM loop to preview it here.</p>
        </div>
      )}

      {error && <p className="form-alert error" role="alert">{error}</p>}
      <div className="paper-media-admin-actions">
        <span className="paper-media-admin-spacer" />
        <button type="button" className="btn btn-outline compact" onClick={onCancel} disabled={Boolean(pending)}>Cancel</button>
        <button type="submit" className="btn btn-primary compact" disabled={Boolean(pending)}>{pending ? busyLabel : scene ? "Save" : "Add scene"}</button>
      </div>
    </form>
  );
}
