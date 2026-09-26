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
 * Creator Studio control for the Paper Workspace player's background.
 *
 * One upload serves every screen: the player fills its frame and crops around
 * the focal point chosen here, so the admin never prepares per-device files.
 * The frames below mirror the player's real shapes at each breakpoint.
 */

const ACCEPT = "video/mp4,video/webm,image/jpeg,image/png,image/webp,image/gif";
const ACCEPTED_TYPES = new Set(ACCEPT.split(","));
// The player's shape always lies between these two (see paper-workspace.css).
const PREVIEW_FRAMES = [
  { key: "standard", label: "Phone · iPad · smaller laptops", ratio: "16 / 9" },
  { key: "wide", label: "Wide desktop screens (widest crop)", ratio: "21 / 9" }
];

function megabytes(bytes) {
  return `${Math.round((Number(bytes) || 0) / (1024 * 1024))} MB`;
}

/** Width and height of a local file, read before anything is uploaded. */
function readDimensions(url, isVideo) {
  return new Promise((resolve) => {
    if (isVideo) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
      video.onerror = () => resolve(null);
      video.src = url;
    } else {
      const image = new window.Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    }
  });
}

function sizeAdvice(dimensions) {
  if (!dimensions?.width || !dimensions?.height) return "";
  const ratio = dimensions.width / dimensions.height;
  const notes = [];
  if (Math.abs(ratio - 16 / 9) > 0.06) notes.push("It is not 16:9, so more of its edges will be cropped. Set the focal point on the part that matters.");
  if (dimensions.width < 1280) notes.push("It is smaller than 1280 px wide and may look soft on large screens.");
  return notes.join(" ");
}

export default function PaperWorkspaceMediaPanel({ canManage }) {
  const data = useAsyncData(() => adminControlApi.paperWorkspaceMedia(), []);
  // A refresh after saving keeps the editor (and its confirmation) on screen.
  if (!data.data) return data.error ? <ErrorPanel message={data.error} onRetry={data.reload} /> : <LoadingPanel />;
  return <MediaEditor state={data.data} canManage={canManage} onSaved={data.reload} />;
}

function MediaEditor({ state, canManage, onSaved }) {
  const [draftFile, setDraftFile] = useState(/** @type {File|null} */ (null));
  const [draftUrl, setDraftUrl] = useState("");
  const [dimensions, setDimensions] = useState(null);
  const [focal, setFocal] = useState({ x: state.focal_x, y: state.focal_y });
  const [enabled, setEnabled] = useState(Boolean(state.enabled));
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setFocal({ x: state.focal_x, y: state.focal_y });
    setEnabled(Boolean(state.enabled));
  }, [state.revision, state.focal_x, state.focal_y, state.enabled]);

  // The object URL lives only as long as the draft does.
  useEffect(() => () => { if (draftUrl) URL.revokeObjectURL(draftUrl); }, [draftUrl]);

  // Saved media: read its size too, so the focal-point frame matches it.
  useEffect(() => {
    if (draftFile || !state.file) return undefined;
    let cancelled = false;
    readDimensions(state.file.url, state.file.media_type === "video").then((size) => { if (!cancelled) setDimensions(size); });
    return () => { cancelled = true; };
  }, [draftFile, state.file]);

  const previewMedia = useMemo(() => {
    if (draftFile && draftUrl) return { url: draftUrl, media_type: draftFile.type.startsWith("video/") ? "video" : "image", focal_x: focal.x, focal_y: focal.y };
    if (state.file) return { url: state.file.url, media_type: state.file.media_type, focal_x: focal.x, focal_y: focal.y };
    return null;
  }, [draftFile, draftUrl, focal, state.file]);

  const dirty = Boolean(draftFile) || enabled !== Boolean(state.enabled) || focal.x !== state.focal_x || focal.y !== state.focal_y;
  const status = !state.file ? "Built-in lofi scene" : state.enabled ? (state.deliverable ? "Shown to students" : "Waiting for file checks") : "Uploaded, not shown";

  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError(""); setMessage("");
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) { setError("Choose an MP4 or WebM video, or a JPEG, PNG, WebP or GIF image."); return; }
    if (file.size > state.max_bytes) { setError(`This file is larger than ${megabytes(state.max_bytes)}.`); return; }
    const url = URL.createObjectURL(file);
    setDraftFile(file);
    setDraftUrl(url);
    setFocal({ x: 50, y: 50 });
    setEnabled(true);
    setDimensions(await readDimensions(url, file.type.startsWith("video/")));
  }

  function discard() {
    setDraftFile(null); setDraftUrl(""); setDimensions(null);
    setFocal({ x: state.focal_x, y: state.focal_y }); setEnabled(Boolean(state.enabled)); setError("");
  }

  function pickFocal(event) {
    if (!canManage) return;
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
    if (!move || !canManage) return;
    event.preventDefault();
    setFocal((current) => ({ x: Math.min(100, Math.max(0, current.x + move[0])), y: Math.min(100, Math.max(0, current.y + move[1])) }));
  }

  async function save() {
    setPending("save"); setError(""); setMessage("");
    try {
      let fileId = null;
      if (draftFile) {
        const uploaded = await managementApi.uploadFile({ kind: "workspace_media", file: draftFile });
        fileId = uploaded.id;
      }
      await adminControlApi.savePaperWorkspaceMedia({ expectedRevision: state.revision, fileId, enabled, focalX: focal.x, focalY: focal.y });
      discard();
      setMessage(enabled ? "Saved. Students see it the next time they open Paper Workspace." : "Saved. Students keep the built-in lofi scene.");
      onSaved();
    } catch (requestError) {
      setError(requestError?.message || "The media could not be saved.");
    } finally {
      setPending("");
    }
  }

  async function remove() {
    setPending("remove"); setError(""); setMessage("");
    try {
      await adminControlApi.removePaperWorkspaceMedia(state.revision);
      setConfirmRemove(false);
      discard();
      setMessage("Removed. Students see the built-in lofi scene.");
      onSaved();
    } catch (requestError) {
      setError(requestError?.message || "The media could not be removed.");
    } finally {
      setPending("");
    }
  }

  const advice = sizeAdvice(dimensions);

  return (
    <section className="panel paper-media-admin" aria-labelledby="paper-media-admin-title">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Paper Workspace</p>
          <h2 id="paper-media-admin-title">Default player media</h2>
        </div>
        <span className={`pill${state.enabled && state.file ? " is-live" : ""}`}>{status}</span>
      </div>

      <p className="paper-media-admin-spec">
        <Icon name="image" size={16} />
        <span>Recommended <strong>16:9</strong>, <strong>{state.recommended.width}×{state.recommended.height}</strong> or <strong>{state.recommended.alternative}</strong>. MP4 or WebM video (it loops, muted), or JPEG, PNG, WebP or GIF. Up to {megabytes(state.max_bytes)}. One file covers every screen: it is cropped around the focal point.</span>
      </p>

      {previewMedia ? (
        <div className="paper-media-admin-grid">
          <div className="paper-media-admin-main">
            <div
              className="paper-media-admin-source"
              role="slider"
              tabIndex={canManage ? 0 : -1}
              aria-label="Focal point"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={focal.x}
              aria-valuetext={`${focal.x}% across, ${focal.y}% down`}
              style={cssVars({ "--source-ratio": dimensions?.width && dimensions?.height ? `${dimensions.width} / ${dimensions.height}` : "16 / 9" })}
              onClick={pickFocal}
              onKeyDown={nudgeFocal}
            >
              <WorkspaceMedia media={{ ...previewMedia, focal_x: 50, focal_y: 50 }} label="Full media" className="is-contain" preview />
              <span className="paper-media-admin-focal" style={cssVars({ "--focal-x": `${focal.x}%`, "--focal-y": `${focal.y}%` })} aria-hidden="true" />
            </div>
            <p className="paper-media-admin-hint">{canManage ? "Click or use the arrow keys to set what must stay in frame." : "Focal point"} · {focal.x}% × {focal.y}%{dimensions ? ` · ${dimensions.width}×${dimensions.height}` : ""}</p>
            {advice && <p className="form-alert">{advice}</p>}
          </div>
          <div className="paper-media-admin-frames" aria-label="How students will see it">
            {PREVIEW_FRAMES.map((frame) => (
              <figure key={frame.key}>
                <div className="paper-media-admin-frame" style={cssVars({ "--frame-ratio": frame.ratio })}>
                  <WorkspaceMedia media={previewMedia} label={`${frame.label} preview`} preview />
                </div>
                <figcaption>{frame.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : (
        <div className="paper-media-admin-empty">
          <Icon name="image" size={22} />
          <p>No media uploaded. Students see the built-in lofi scene.</p>
        </div>
      )}

      {error && <p className="form-alert error" role="alert">{error}</p>}
      {message && <p className="form-alert success" role="status">{message}</p>}

      {canManage && (
        <div className="paper-media-admin-actions">
          <input ref={inputRef} className="visually-hidden" type="file" accept={ACCEPT} onChange={choose} tabIndex={-1} aria-hidden="true" />
          <button type="button" className="btn btn-soft compact" onClick={() => inputRef.current?.click()} disabled={Boolean(pending)}>
            <Icon name="plus" size={16} />{state.file || draftFile ? "Replace media" : "Upload media"}
          </button>
          {previewMedia && (
            <label className="check-row">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={Boolean(pending)} /> Show to students
            </label>
          )}
          <span className="paper-media-admin-spacer" />
          {draftFile && <button type="button" className="btn btn-outline compact" onClick={discard} disabled={Boolean(pending)}>Discard</button>}
          {state.file && !draftFile && <button type="button" className="btn btn-outline compact" onClick={() => setConfirmRemove(true)} disabled={Boolean(pending)}><Icon name="trash" size={16} />Remove</button>}
          <button type="button" className="btn btn-primary compact" onClick={save} disabled={!dirty || Boolean(pending)}>
            {pending === "save" ? (draftFile ? "Uploading…" : "Saving…") : "Save"}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove the player media?"
        message="Students will see the built-in lofi scene again. The uploaded file stays in storage for the audit record."
        confirmLabel={pending === "remove" ? "Removing…" : "Remove"}
        busy={pending === "remove"}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      />
    </section>
  );
}
