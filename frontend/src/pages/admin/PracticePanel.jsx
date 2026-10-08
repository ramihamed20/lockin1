import { useCallback, useEffect, useRef, useState } from "react";
import { adminPracticeApi, buildFillInList, parseAnswersJson, parseFillInList, PRACTICE_ANSWER_MAX_LENGTH, PRACTICE_IMAGE_MAX_BYTES, PRACTICE_IMAGE_TYPES, PRACTICE_TITLE_MAX_LENGTH } from "../../api/practice.js";
import { PracticeMark } from "../../components/learning/PracticeMark.jsx";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.jsx";
import { EmptyState, ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { copyTextToClipboard } from "../../lib/clipboard.js";
import { normalizeUserError } from "../../lib/errors.js";
import { Icon } from "../../lib/icons.jsx";
import "./admin-practice.css";

const UPLOAD_BATCH = 50;
const ARCHIVE_MAX_BYTES = 80 * 1024 * 1024;
const isZip = (file) => /\.zip$/i.test(file.name);
const JSON_ERRORS = {
  empty: "Paste the JSON first.",
  syntax: "That is not valid JSON. Copy the whole reply, from the first { to the last }.",
  shape: "Expected {\"answers\": [\"Name 1\", \"Name 2\", ...]} or a plain list of names.",
  item: "Every entry must be a name in quotes.",
  long: "One of the names is far too long for a slide name.",
  nolines: "No line started with a slide's file name. Paste the fill-in list back, with a name after each dash."
};

function Notice({ error = null, message = "" }) {
  if (!error && !message) return null;
  const text = error ? (typeof error === "string" ? error : normalizeUserError(error, "Something went wrong. Try again.")) : message;
  return <div className={`form-alert ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{text}</div>;
}

function Back({ onClick, children }) {
  return <button className="admin-content-crumb" type="button" onClick={onClick}><Icon name="chevron-left" size={16} />{children}</button>;
}

function plural(count, one, other = `${one}s`) {
  return `${count} ${count === 1 ? one : other}`;
}

/** The prompt an administrator hands to an AI together with the slide images. */
export function buildPracticePrompt(count) {
  return [
    `I am attaching ${count} slide image${count === 1 ? "" : "s"} in order (slide 1 first). Each one shows a single structure, specimen or item that a student has to name by typing.`,
    "",
    "For every slide, in the same order, give the one exact name a student must type. Use the standard textbook spelling, with no abbreviations, numbering or extra words.",
    "",
    "Reply with JSON only, no commentary and no code fences, in exactly this shape:",
    "{\"answers\": [\"Name of slide 1\", \"Name of slide 2\"]}",
    "",
    `Rules: exactly ${count} string${count === 1 ? "" : "s"} in "answers", one per slide, in slide order. If you cannot identify a slide, use an empty string "" for it instead of guessing.`
  ].join("\n");
}

function naturalCompare(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export function PracticeSetList({ subjectId, canManage, onBack, onOpen }) {
  const data = useAsyncData((signal) => adminPracticeApi.list(subjectId, { signal }), [subjectId]);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function create(event) {
    event.preventDefault();
    if (pending || !title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const detail = await adminPracticeApi.create(subjectId, title.trim());
      setTitle("");
      onOpen(detail.set);
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }

  const subjectTitle = data.data?.subject.title || "Subject";
  return <section className="admin-content-section admin-practice">
    <Back onClick={onBack}>All subjects</Back>
    <div className="admin-content-toolbar"><div><h2>{subjectTitle} · Practice sets</h2><p>Typing practice: students see a slide and type its name. Capital letters and spaces are forgiven; spelling is not.</p></div></div>
    {canManage && <form className="admin-practice-create" onSubmit={create}>
      <label className="field"><span>New set name</span><input value={title} maxLength={PRACTICE_TITLE_MAX_LENGTH} onChange={(event) => setTitle(event.target.value)} placeholder="Lab practical 1" /></label>
      <button className="btn btn-primary" type="submit" disabled={pending || !title.trim()}><Icon name="plus" size={17} />{pending ? "Creating…" : "Create set"}</button>
    </form>}
    <Notice error={error} />
    {data.loading ? <LoadingPanel variant="admin-list" /> : data.error ? <ErrorPanel message={data.error} onRetry={data.reload} /> : (
      <div className="admin-subject-list">
        {data.data.sets.length ? data.data.sets.map((set) => <button type="button" key={set.id} onClick={() => onOpen(set)}>
          <span className="stat-icon"><Icon name="brain" /></span>
          <span><strong>{set.title}</strong><small>{plural(set.slideCount, "slide")} · {set.answeredCount}/{set.slideCount} named</small></span>
          <span className={`pill ${set.isPublished ? "status-published" : "status-draft"}`}>{set.isPublished ? "Published" : "Draft"}</span>
          <Icon name="chevron-right" size={18} />
        </button>) : <EmptyState title="No practice sets yet" text={canManage ? "Create a set, add its images in order, then type or import the names." : "Nothing has been created for this subject."} />}
      </div>
    )}
  </section>;
}

export function PracticeSetEditor({ setId, canManage, onBack, onOpenSet = null }) {
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [rejected, setRejected] = useState([]);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [sortByName, setSortByName] = useState(true);
  const [title, setTitle] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async (signal) => {
    try {
      const next = await adminPracticeApi.get(setId, { signal });
      setDetail(next);
      setTitle(next.set.title);
      setLoadError("");
    } catch (failure) {
      if (!signal?.aborted) setLoadError(normalizeUserError(failure, "The set could not be loaded."));
    }
  }, [setId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function apply(next) {
    setDetail(next);
    setTitle(next.set.title);
  }

  /**
   * Run one change against the server; the reply is the new truth for the whole page.
   * @param {string} name
   * @param {() => Promise<any>} work
   * @param {string | ((next: any) => string)} [done]
   */
  async function act(name, work, done = "") {
    if (busy) return null;
    setBusy(name);
    setError(null);
    setMessage("");
    try {
      const next = await work();
      apply(next);
      if (done) setMessage(typeof done === "function" ? done(next) : done);
      return next;
    } catch (failure) {
      setError(failure);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function upload(fileList) {
    if (!detail || busy) return;
    const all = [...fileList];
    if (!all.length) return;
    const skipped = [];
    const archives = [];
    const picked = [];
    for (const file of all) {
      if (!isZip(file)) picked.push(file);
      else if (file.size > ARCHIVE_MAX_BYTES) skipped.push({ name: file.name, message: `Larger than ${ARCHIVE_MAX_BYTES / 1024 / 1024} MB.` });
      else archives.push(file);
    }
    let valid = [];
    for (const file of picked) {
      if (!PRACTICE_IMAGE_TYPES.includes(file.type)) skipped.push({ name: file.name, message: "Only JPEG, PNG or WebP images are accepted." });
      else if (file.size > PRACTICE_IMAGE_MAX_BYTES) skipped.push({ name: file.name, message: `Larger than ${PRACTICE_IMAGE_MAX_BYTES / 1024 / 1024} MB.` });
      else valid.push(file);
    }
    if (sortByName) valid = [...valid].sort(naturalCompare);
    const room = Math.max(0, detail.maxSlides - detail.slides.length);
    for (const file of valid.slice(room)) skipped.push({ name: file.name, message: `A set holds up to ${detail.maxSlides} slides.` });
    valid = valid.slice(0, room);

    setBusy("upload");
    setError(null);
    setMessage("");
    setRejected(skipped);
    setProgress(0);
    let added = 0;
    const refused = [...skipped];
    try {
      for (let start = 0; start < valid.length; start += UPLOAD_BATCH) {
        const batch = valid.slice(start, start + UPLOAD_BATCH);
        const next = await adminPracticeApi.addImages(setId, batch, {
          onProgress: (fraction) => setProgress((start + fraction * batch.length) / valid.length)
        });
        apply(next);
        added += next.added;
        refused.push(...next.rejected);
        setRejected([...refused]);
      }
      for (const archive of archives) {
        const next = await adminPracticeApi.addArchive(setId, archive, { onProgress: (fraction) => setProgress(fraction) });
        apply(next);
        added += next.added;
        refused.push(...next.rejected);
        setRejected([...refused]);
      }
      setProgress(1);
      if (added) setMessage(`${plural(added, "image")} added at the end, in order. Copy the fill-in list under “Add names” to name them.`);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function duplicate() {
    if (busy) return;
    setBusy("duplicate");
    setError(null);
    setMessage("");
    try {
      const copy = await adminPracticeApi.duplicate(setId);
      onOpenSet?.(copy.set);
    } catch (failure) {
      setError(failure);
      setBusy("");
    }
  }

  if (loadError) return <section className="admin-content-section admin-practice"><Back onClick={onBack}>Practice sets</Back><ErrorPanel message={loadError} onRetry={() => load()} /></section>;
  if (!detail) return <section className="admin-content-section admin-practice"><Back onClick={onBack}>Practice sets</Back><LoadingPanel variant="admin-list" /></section>;

  const { set, slides } = detail;
  const missing = set.slideCount - set.answeredCount;
  const publishable = set.slideCount > 0 && missing === 0;
  const working = Boolean(busy);

  function move(from, to) {
    if (to < 0 || to >= slides.length) return;
    const ids = slides.map((slide) => slide.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    act("order", () => adminPracticeApi.reorder(setId, ids));
  }

  return <section className="admin-content-section admin-practice">
    <Back onClick={onBack}>{detail.subject.title || "Practice sets"}</Back>
    <div className="admin-content-toolbar">
      <div>
        <h2>{set.title}</h2>
        <p>{plural(set.slideCount, "slide")} · {set.answeredCount} named{missing > 0 ? ` · ${missing} still need a name` : ""}</p>
      </div>
      <span className={`pill ${set.isPublished ? "status-published" : "status-draft"}`}>{set.isPublished ? "Published" : "Draft"}</span>
      {detail.subject.slug && set.slideCount > 0 && <a
        className="btn btn-soft"
        href={`/#/questions/categories/practice/subjects/${encodeURIComponent(detail.subject.slug)}/sheets/${set.id}`}
        target="_blank"
        rel="noopener noreferrer"
      ><Icon name="eye" size={16} />Preview as student</a>}
      {canManage && onOpenSet && <button className="btn btn-soft" type="button" disabled={working} onClick={duplicate}><Icon name="layers" size={16} />{busy === "duplicate" ? "Duplicating…" : "Duplicate"}</button>}
      {canManage && <button
        className={`btn ${set.isPublished ? "btn-soft" : "btn-primary"}`}
        type="button"
        disabled={working || (!set.isPublished && !publishable)}
        onClick={() => act("publish", () => adminPracticeApi.update(setId, { is_published: !set.isPublished }), (next) => (next.set.isPublished ? "Published. Students in this cohort can practise it now." : "Unpublished. Students no longer see it."))}
      >{set.isPublished ? "Unpublish" : "Publish"}</button>}
    </div>
    {canManage && !set.isPublished && !publishable && <p className="admin-practice-hint">{set.slideCount === 0 ? "Add at least one image, then name every slide to publish." : `Name the remaining ${plural(missing, "slide")} to publish.`}</p>}
    <Notice error={error} message={message} />

    {canManage && <>
      <form className="admin-practice-rename" onSubmit={(event) => { event.preventDefault(); if (title.trim() && title.trim() !== set.title) act("rename", () => adminPracticeApi.update(setId, { title: title.trim() }), "Renamed."); }}>
        <label className="field"><span>Set name</span><input value={title} maxLength={PRACTICE_TITLE_MAX_LENGTH} onChange={(event) => setTitle(event.target.value)} /></label>
        <button className="btn btn-soft" type="submit" disabled={working || !title.trim() || title.trim() === set.title}>Rename</button>
      </form>

      <div
        className={`admin-practice-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files); }}
      >
        <Icon name="upload" size={22} aria-hidden="true" />
        <div>
          <strong>Add images</strong>
          <p>JPEG, PNG or WebP, up to {PRACTICE_IMAGE_MAX_BYTES / 1024 / 1024} MB each, or one ZIP of images (up to {ARCHIVE_MAX_BYTES / 1024 / 1024} MB) named Image1, Image2 … New images join the end of the set in the order below.</p>
        </div>
        <input ref={fileInput} id="practice-files" className="admin-practice-file" type="file" multiple accept={`${PRACTICE_IMAGE_TYPES.join(",")},.zip,application/zip`} disabled={working} onChange={(event) => upload(event.target.files)} />
        <label className="btn btn-primary" htmlFor="practice-files" aria-disabled={working}>{busy === "upload" ? `Uploading ${Math.round(progress * 100)}%` : "Choose images or ZIP"}</label>
        <label className="check-row"><input type="checkbox" checked={sortByName} onChange={(event) => setSortByName(event.target.checked)} /> Order by file name (1, 2, 10 …)</label>
      </div>
      {busy === "upload" && <div className="admin-practice-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ transform: `scaleX(${progress})` }} /></div>}
      {rejected.length > 0 && <div className="form-alert error" role="alert">
        <strong>{plural(rejected.length, "image")} not added</strong>
        <ul>{rejected.map((item, index) => <li key={`${item.name}-${index}`}><b>{item.name}</b> — {item.message}</li>)}</ul>
      </div>}
    </>}

    {slides.length > 0 && <ol className="admin-practice-slides" aria-label="Slides in order">
      {slides.map((slide, index) => <PracticeSlideRow
        key={slide.id}
        slide={slide}
        index={index}
        last={index === slides.length - 1}
        canManage={canManage}
        disabled={working}
        total={slides.length}
        onAnswer={(answer) => act("answer", () => adminPracticeApi.setAnswer(setId, slide.id, answer))}
        onHotspot={(hotspot) => act("hotspot", () => adminPracticeApi.setHotspot(setId, slide.id, hotspot), hotspot ? "Mark saved. Students see it over this slide." : "Mark removed.")}
        onReplace={(file) => act("image", () => adminPracticeApi.replaceImage(setId, slide.id, file), "Image replaced. The name, position and mark stayed.")}
        onMoveTo={(position) => act("order", () => adminPracticeApi.moveSlide(setId, slide.id, position), `Slide moved to position ${position}.`)}
        onMove={(to) => move(index, to)}
        onDelete={() => setConfirm({ type: "slide", slide, index })}
      />)}
    </ol>}
    {!slides.length && <EmptyState title="No slides yet" text={canManage ? "Choose several images at once; they are stored in the order shown above." : "This set has no images."} />}

    {canManage && slides.length > 0 && <AnswersImport slides={slides} disabled={working} onApply={(answers) => act("answers", () => adminPracticeApi.setAnswers(setId, answers), (next) => `${plural(next.changed, "name")} updated.`)} />}

    {canManage && <div className="admin-practice-danger"><button className="btn btn-danger compact" type="button" disabled={working} onClick={() => setConfirm({ type: "set" })}><Icon name="trash" size={15} />Delete set</button></div>}

    <ConfirmDialog
      busy={working}
      open={Boolean(confirm)}
      title={confirm?.type === "set" ? `Delete “${set.title}”?` : `Delete slide ${(confirm?.index ?? 0) + 1}?`}
      message={confirm?.type === "set" ? "The set and all of its images are removed for good. Students lose it immediately." : "The image is removed for good and the slides after it move up one place."}
      confirmLabel={working ? "Deleting…" : "Delete"}
      onCancel={() => setConfirm(null)}
      onConfirm={async () => {
        if (confirm?.type === "set") {
          setBusy("delete");
          try { await adminPracticeApi.remove(setId); onBack(); } catch (failure) { setError(failure); setConfirm(null); setBusy(""); }
          return;
        }
        const target = confirm?.slide;
        setConfirm(null);
        if (target) await act("delete", () => adminPracticeApi.removeSlide(setId, target.id), "Slide deleted.");
      }}
    />
  </section>;
}

function PracticeSlideRow({ slide, index, last, total, canManage, disabled, onAnswer, onHotspot, onReplace, onMoveTo, onMove, onDelete }) {
  const [draft, setDraft] = useState(slide.answer);
  const [marking, setMarking] = useState(false);
  const [target, setTarget] = useState(String(index + 1));
  const replaceInput = useRef(null);
  useEffect(() => { setDraft(slide.answer); }, [slide.answer]);
  useEffect(() => { setTarget(String(index + 1)); }, [index]);
  const dirty = draft.trim() !== slide.answer;
  const commit = () => { if (dirty) onAnswer(draft); };
  const destination = Number(target);
  const canGo = Number.isInteger(destination) && destination >= 1 && destination <= total && destination !== index + 1;
  return <li className={`admin-practice-slide${slide.answer ? "" : " is-missing"}`}>
    <span className="admin-practice-number" aria-hidden="true">{index + 1}</span>
    <a className="admin-practice-thumb" href={slide.imageUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open slide ${index + 1} image`}>
      <img src={slide.imageUrl} alt={`Slide ${index + 1}`} loading="lazy" draggable={false} />
    </a>
    <div className="admin-practice-slide-body">
      <label className="field">
        <span>Name for slide {index + 1}{slide.answer ? "" : " (missing)"}</span>
        <input
          value={draft}
          maxLength={PRACTICE_ANSWER_MAX_LENGTH}
          dir="auto"
          autoComplete="off"
          spellCheck={false}
          readOnly={!canManage}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}
        />
      </label>
      <small className="admin-practice-file-name">{slide.fileName}</small>
      {canManage && <div className="admin-practice-tools">
        <button className="btn btn-soft compact" type="button" aria-expanded={marking} disabled={disabled} onClick={() => setMarking((value) => !value)}>
          <Icon name="target" size={15} />{slide.hotspot ? `Mark: ${slide.hotspot.shape}` : "Add mark"}
        </button>
        <input ref={replaceInput} className="admin-practice-file" type="file" accept={PRACTICE_IMAGE_TYPES.join(",")} tabIndex={-1} aria-label={`New image for slide ${index + 1}`} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onReplace(file); }} />
        <button className="btn btn-soft compact" type="button" disabled={disabled} onClick={() => replaceInput.current?.click()}><Icon name="image" size={15} />Replace image</button>
        <form className="admin-practice-moveto" onSubmit={(event) => { event.preventDefault(); if (canGo) onMoveTo(destination); }}>
          <label><span>Move to</span><input type="number" inputMode="numeric" min={1} max={total} value={target} disabled={disabled} onChange={(event) => setTarget(event.target.value)} /></label>
          <button className="btn btn-soft compact" type="submit" disabled={disabled || !canGo}>Go</button>
        </form>
      </div>}
    </div>
    {canManage && <div className="admin-practice-row-actions">
      <button className="btn btn-soft compact" type="button" disabled={disabled || index === 0} onClick={() => onMove(index - 1)} aria-label={`Move slide ${index + 1} up`}><Icon name="chevron-up" size={16} /></button>
      <button className="btn btn-soft compact" type="button" disabled={disabled || last} onClick={() => onMove(index + 1)} aria-label={`Move slide ${index + 1} down`}><Icon name="chevron-down" size={16} /></button>
      <button className="btn btn-danger compact" type="button" disabled={disabled} onClick={onDelete} aria-label={`Delete slide ${index + 1}`}><Icon name="trash" size={15} /></button>
    </div>}
    {marking && <HotspotEditor
      key={`${slide.id}:${slide.imageUrl}`}
      slide={slide}
      index={index}
      disabled={disabled}
      onSave={async (hotspot) => { await onHotspot(hotspot); setMarking(false); }}
      onClose={() => setMarking(false)}
    />}
  </li>;
}

const clampUnit = (value) => Math.min(1, Math.max(0, value));

/** Click the picture where the arrow or circle should appear; the numbers are the keyboard route. */
function HotspotEditor({ slide, index, disabled, onSave, onClose }) {
  const [shape, setShape] = useState(slide.hotspot?.shape || "circle");
  const [point, setPoint] = useState(slide.hotspot ? { x: slide.hotspot.x, y: slide.hotspot.y } : null);
  const frame = useRef(null);

  function place(event) {
    if (event.detail === 0) return;
    const rect = frame.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    setPoint({ x: clampUnit((event.clientX - rect.left) / rect.width), y: clampUnit((event.clientY - rect.top) / rect.height) });
  }

  const percent = (value) => String(Math.round(value * 1000) / 10);
  function nudge(axis, text) {
    const value = Number(text);
    if (text === "" || !Number.isFinite(value)) return;
    setPoint((current) => ({ x: current?.x ?? 0.5, y: current?.y ?? 0.5, [axis]: clampUnit(value / 100) }));
  }

  return <div className="admin-practice-hotspot">
    <p>Click the picture where students should look. They see the mark over slide {index + 1} while they type its name.</p>
    <div className="admin-practice-hotspot-stage">
      <button type="button" className="practice-frame admin-practice-frame" ref={frame} onClick={place} aria-label={`Click slide ${index + 1} to place the mark, or type the position below`}>
        <img src={slide.imageUrl} alt="" draggable={false} />
        {point && <PracticeMark mark={{ ...point, shape }} />}
      </button>
    </div>
    <div className="admin-practice-hotspot-controls">
      <fieldset>
        <legend>Shape</legend>
        {["circle", "arrow"].map((value) => <label key={value}><input type="radio" name={`shape-${slide.id}`} checked={shape === value} onChange={() => setShape(value)} />{value === "circle" ? "Circle" : "Arrow"}</label>)}
      </fieldset>
      <label className="field"><span>Across %</span><input type="number" min={0} max={100} step={0.5} value={point ? percent(point.x) : ""} onChange={(event) => nudge("x", event.target.value)} /></label>
      <label className="field"><span>Down %</span><input type="number" min={0} max={100} step={0.5} value={point ? percent(point.y) : ""} onChange={(event) => nudge("y", event.target.value)} /></label>
    </div>
    <div className="admin-practice-hotspot-actions">
      <button className="btn btn-primary compact" type="button" disabled={disabled || !point} onClick={() => onSave({ x: point.x, y: point.y, shape })}>Save mark</button>
      {slide.hotspot && <button className="btn btn-danger compact" type="button" disabled={disabled} onClick={() => onSave(null)}>Remove mark</button>}
      <button className="btn btn-soft compact" type="button" onClick={onClose}>Cancel</button>
    </div>
  </div>;
}

function AnswersImport({ slides, disabled, onApply }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState("");
  const asJson = /^\s*(```|[{[])/.test(text);
  const parsed = text.trim() ? (asJson ? parseAnswersJson(text) : parseFillInList(text, slides)) : null;
  const unmatched = /** @type {string[]} */ (parsed && "unmatched" in parsed ? parsed.unmatched : []);
  const prompt = buildPracticePrompt(slides.length);
  const answers = parsed && "answers" in parsed ? parsed.answers : null;
  const tooMany = answers ? answers.length > slides.length : false;
  const blanks = answers ? answers.filter((answer) => !answer.trim()).length : 0;

  async function copy(value, label) {
    setCopied((await copyTextToClipboard(value)) ? `${label} copied.` : "Copy failed — select the text and copy it by hand.");
  }

  return <section className="admin-practice-import">
    <button className="admin-practice-import-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />Add names
    </button>
    {open && <div className="admin-practice-import-body">
      <p>Copy the fill-in list, write each name after its dash (or give the list and the images to an AI), then paste it back below. Lines match slides by file name, so the order of the lines does not matter. A name left as (name) is skipped.</p>
      <div className="admin-practice-import-actions">
        <button className="btn btn-primary compact" type="button" onClick={() => copy(buildFillInList(slides), "Fill-in list")}>Copy fill-in list</button>
        <button className="btn btn-soft compact" type="button" onClick={() => copy(prompt, "Prompt")}>Copy prompt for {plural(slides.length, "slide")}</button>
        <button className="btn btn-soft compact" type="button" onClick={() => copy(JSON.stringify({ answers: slides.map((slide) => slide.answer) }, null, 2), "Current names")}>Copy current names</button>
      </div>
      {copied && <p className="admin-practice-hint" role="status">{copied}</p>}
      <details><summary>Show fill-in list</summary><textarea readOnly rows={Math.min(slides.length, 12) + 1} dir="ltr" value={buildFillInList(slides)} onFocus={(event) => event.target.select()} /></details>
      <details><summary>Show AI prompt</summary><textarea readOnly rows={9} value={prompt} onFocus={(event) => event.target.select()} /></details>
      <label className="field"><span>Paste the completed list or a JSON reply</span><textarea rows={7} dir="auto" spellCheck={false} value={text} placeholder={"Image1 - Femur\nImage2 - Tibia\nImage3 - Fibula"} onChange={(event) => setText(event.target.value)} /></label>
      {parsed && "error" in parsed && <div className="form-alert error" role="alert">{JSON_ERRORS[parsed.error] || "That could not be read."}</div>}
      {unmatched.length > 0 && <div className="form-alert error" role="alert">{plural(unmatched.length, "line")} did not start with a slide's file name and will be ignored: <b dir="auto">{unmatched.slice(0, 3).join(" · ")}</b>{unmatched.length > 3 ? " …" : ""}</div>}
      {answers && <div className="admin-practice-preview">
        <p><strong>{plural(answers.length, "name")}</strong> for {plural(slides.length, "slide")}{blanks ? ` · ${plural(blanks, "blank")} will be skipped` : ""}{answers.length < slides.length ? ` · the last ${plural(slides.length - answers.length, "slide")} stay as they are` : ""}</p>
        {tooMany && <div className="form-alert error" role="alert">The list has {answers.length} names but the set has only {slides.length} slides. Remove the extras, or add the missing images first.</div>}
        <ol>{answers.slice(0, slides.length).map((answer, index) => <li key={index} className={answer.trim() ? "" : "is-blank"}><span>{index + 1}</span><b dir="auto">{answer.trim() || "—"}</b>{answer.trim() && slides[index].answer && slides[index].answer !== answer.trim() ? <small dir="auto">replaces “{slides[index].answer}”</small> : null}</li>)}</ol>
      </div>}
      <button className="btn btn-primary" type="button" disabled={disabled || !answers || tooMany || answers.every((answer) => !answer.trim())} onClick={() => { onApply(answers); setText(""); }}>Apply names</button>
    </div>}
  </section>;
}
