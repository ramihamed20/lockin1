import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { Icon } from "../lib/icons.jsx";
import { Page, LoadingPanel, ErrorPanel, ProgressLine } from "../components/ui/index.jsx";
import { assetPath } from "../lib/utils.js";

// ─── INK ENGINE UTILITIES ─────────────────────────────────────
// These pure functions are module-level so they don't get recreated on every
// render and can be shared between the live-preview path and the playback path.

/** Lerp between two values */
const lerp = (a, b, t) => a + (b - a) * t;

/** Clamp value to [min, max] */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** Distance between two points */
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Compute velocity-based width for a stroke point.
 * Slower drawing → thicker lines, fast flicks → thin tapered ends.
 */
const velocityWidth = (prev, curr, baseSize) => {
  if (!prev || !curr.t || !prev.t) return baseSize;
  const dt = Math.max(curr.t - prev.t, 1); // ms
  const d = dist(prev, curr);
  const velocity = d / dt; // px/ms
  const maxVel = 2.0; // px/ms — fast threshold
  const minW = baseSize * 0.3;
  const maxW = baseSize * 1.4;
  return lerp(maxW, minW, clamp(velocity / maxVel, 0, 1));
};

/**
 * Apply pressure to base width.  Pressure ranges 0–1; 0 means no pressure
 * data available (treated as 0.5 → neutral).
 */
const pressureWidth = (pressure, baseWidth) => {
  const p = pressure > 0 ? pressure : 0.5;
  return baseWidth * (0.3 + 0.7 * p);
};

/**
 * 3-point moving-average jitter filter.  Returns a smoothed copy of the
 * point array (does NOT mutate the input).
 */
const smoothPoints = (pts) => {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push({
      x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
      y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3,
      t: pts[i].t,
      p: pts[i].p,
      w: pts[i].w
    });
  }
  out.push(pts[pts.length - 1]);
  return out;
};

/**
 * Draw a single stroke with variable-width Bézier curves.
 * Each point can carry its own `w` (width) value; the renderer
 * interpolates between widths smoothly for a calligraphy effect.
 */
const drawVariableWidthStroke = (ctx, points, dpr, strokeColor, isHighlighter) => {
  if (!points || points.length === 0) return;

  const smoothed = smoothPoints(points);

  if (isHighlighter) {
    // Highlighter: flat-width, multiply blend
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = strokeColor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = (smoothed[0].w || 20) * dpr;
    ctx.beginPath();
    ctx.moveTo(smoothed[0].x * dpr, smoothed[0].y * dpr);
    for (let i = 1; i < smoothed.length - 1; i++) {
      const xc = (smoothed[i].x + smoothed[i + 1].x) / 2;
      const yc = (smoothed[i].y + smoothed[i + 1].y) / 2;
      ctx.quadraticCurveTo(smoothed[i].x * dpr, smoothed[i].y * dpr, xc * dpr, yc * dpr);
    }
    if (smoothed.length > 1) {
      ctx.lineTo(smoothed[smoothed.length - 1].x * dpr, smoothed[smoothed.length - 1].y * dpr);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  // For pen: draw variable-width segments using filled quads
  if (smoothed.length === 1) {
    const p = smoothed[0];
    const r = ((p.w || 4) * dpr) / 2;
    ctx.beginPath();
    ctx.arc(p.x * dpr, p.y * dpr, r, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();
    return;
  }

  if (smoothed.length === 2) {
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = ((smoothed[0].w || 4) * dpr);
    ctx.moveTo(smoothed[0].x * dpr, smoothed[0].y * dpr);
    ctx.lineTo(smoothed[1].x * dpr, smoothed[1].y * dpr);
    ctx.stroke();
    return;
  }

  // Variable-width rendering: draw each segment as its own short stroke
  // with the width interpolated between the two endpoints.  This gives
  // a natural taper and thickness variation along the line.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = strokeColor;

  for (let i = 0; i < smoothed.length - 1; i++) {
    const p0 = smoothed[i];
    const p1 = smoothed[i + 1];
    const w0 = (p0.w || 4) * dpr;
    const w1 = (p1.w || 4) * dpr;
    const midW = (w0 + w1) / 2;

    ctx.beginPath();
    ctx.lineWidth = midW;

    if (i === 0) {
      ctx.moveTo(p0.x * dpr, p0.y * dpr);
    } else {
      const prev = smoothed[i - 1];
      const mx = (prev.x + p0.x) / 2;
      const my = (prev.y + p0.y) / 2;
      ctx.moveTo(mx * dpr, my * dpr);
    }

    if (i < smoothed.length - 2) {
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x * dpr, p0.y * dpr, midX * dpr, midY * dpr);
    } else {
      ctx.lineTo(p1.x * dpr, p1.y * dpr);
    }
    ctx.stroke();
  }
};

/**
 * Master draw function: renders an array of strokes onto a canvas context.
 * Handles pen (variable-width Bézier), highlighter (multiply blend),
 * and eraser (destination-out) strokes.
 */
const drawAllStrokes = (ctx, strokeList, dpr) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!strokeList || strokeList.length === 0) return;
  const canvasWidth = ctx.canvas.width / dpr;
  const canvasHeight = ctx.canvas.height / dpr;
  const visualStrokes = strokeList.map((stroke) => stroke.normalized
    ? {
        ...stroke,
        points: stroke.points.map((point) => ({
          ...point,
          x: point.x * canvasWidth,
          y: point.y * canvasHeight
        }))
      }
    : stroke);

  // Separate highlighter strokes so they render behind pen strokes
  const highlighters = [];
  const others = [];
  visualStrokes.forEach(s => {
    if (s.tool === "highlighter") highlighters.push(s);
    else others.push(s);
  });

  // Draw highlighters first (behind everything)
  highlighters.forEach(stroke => {
    if (!stroke.points || stroke.points.length === 0) return;
    drawVariableWidthStroke(ctx, stroke.points, dpr, stroke.color, true);
  });

  // Draw pen and eraser strokes on top
  others.forEach(stroke => {
    if (!stroke.points || stroke.points.length === 0) return;

    if (stroke.tool === "eraser") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = stroke.size * dpr;
      ctx.beginPath();
      const pts = stroke.points;
      ctx.moveTo(pts[0].x * dpr, pts[0].y * dpr);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x * dpr, pts[i].y * dpr, xc * dpr, yc * dpr);
      }
      if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x * dpr, pts[pts.length - 1].y * dpr);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Pen with variable width
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    drawVariableWidthStroke(ctx, stroke.points, dpr, stroke.color, false);
    ctx.restore();
  });

  ctx.globalCompositeOperation = "source-over";
};

// ─── SHAPE RECOGNITION ────────────────────────────────────────

/** Ramer-Douglas-Peucker simplification */
const rdpSimplify = (points, epsilon) => {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], first, last);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, index + 1), epsilon);
    const right = rdpSimplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
};

const pointLineDistance = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
};

/** Detect shape from stroke points. Returns shape object or null. */
const detectShape = (points) => {
  if (!points || points.length < 5) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const straightDist = dist(first, last);
  let pathLen = 0;
  for (let i = 1; i < points.length; i++) pathLen += dist(points[i - 1], points[i]);
  if (pathLen === 0) return null;

  // LINE: path is nearly straight
  const straightRatio = straightDist / pathLen;
  if (straightRatio > 0.92 && pathLen > 20) {
    return { type: "line", points: [first, last] };
  }

  // CLOSED shape check: start≈end
  const closedThreshold = pathLen * 0.15;
  const isClosed = straightDist < closedThreshold;

  if (isClosed) {
    // Compute bounding box and center
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = maxX - minX;
    const h = maxY - minY;

    // CIRCLE / ELLIPSE: check radius variance
    const avgRadius = points.reduce((s, p) => s + dist(p, { x: cx, y: cy }), 0) / points.length;
    const radiusVariance = points.reduce((s, p) => {
      const r = dist(p, { x: cx, y: cy });
      return s + Math.abs(r - avgRadius);
    }, 0) / points.length;

    if (radiusVariance / avgRadius < 0.2) {
      return {
        type: "ellipse",
        cx, cy, rx: w / 2, ry: h / 2
      };
    }

    // POLYGON: simplify and count vertices
    const epsilon = pathLen * 0.04;
    const simplified = rdpSimplify(points, epsilon);
    const vertexCount = simplified.length - 1; // last ≈ first for closed

    if (vertexCount === 3) {
      return { type: "triangle", points: simplified.slice(0, 3) };
    }
    if (vertexCount === 4) {
      return {
        type: "rectangle",
        x: minX, y: minY, w, h
      };
    }
  }

  return null;
};

/** Convert a detected shape into canvas drawing points */
const shapeToStrokePoints = (shape, baseWidth) => {
  const w = baseWidth || 4;
  switch (shape.type) {
    case "line":
      return shape.points.map(p => ({ x: p.x, y: p.y, w, t: Date.now() }));
    case "ellipse": {
      const pts = [];
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        pts.push({
          x: shape.cx + shape.rx * Math.cos(angle),
          y: shape.cy + shape.ry * Math.sin(angle),
          w, t: Date.now()
        });
      }
      return pts;
    }
    case "triangle":
      return [...shape.points, shape.points[0]].map(p => ({ x: p.x, y: p.y, w, t: Date.now() }));
    case "rectangle":
      return [
        { x: shape.x, y: shape.y, w, t: Date.now() },
        { x: shape.x + shape.w, y: shape.y, w, t: Date.now() },
        { x: shape.x + shape.w, y: shape.y + shape.h, w, t: Date.now() },
        { x: shape.x, y: shape.y + shape.h, w, t: Date.now() },
        { x: shape.x, y: shape.y, w, t: Date.now() }
      ];
    default:
      return null;
  }
};

// ─── LASSO UTILITIES ──────────────────────────────────────────

/** Ray-casting point-in-polygon */
const pointInPolygon = (px, py, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

/** Check if a stroke is inside a lasso polygon (>=50% of points inside) */
const isStrokeInLasso = (stroke, lassoPoly) => {
  if (!stroke.points || stroke.points.length === 0) return false;
  let insideCount = 0;
  stroke.points.forEach(p => {
    if (pointInPolygon(p.x, p.y, lassoPoly)) insideCount++;
  });
  return insideCount / stroke.points.length >= 0.5;
};

/** Compute bounding box of selected strokes */
const getSelectionBounds = (strokes) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  strokes.forEach(s => {
    s.points.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

// ─── UNDO/REDO HOOK ──────────────────────────────────────────
const MAX_UNDO = 50;

function useUndoRedo(drawings, setDrawings) {
  const undoStackRef = useRef({}); // { [pageNum]: [state, state, ...] }
  const redoStackRef = useRef({}); // { [pageNum]: [state, state, ...] }

  const pushUndo = useCallback((pageNum, prevStrokes) => {
    if (!undoStackRef.current[pageNum]) undoStackRef.current[pageNum] = [];
    undoStackRef.current[pageNum].push(prevStrokes);
    if (undoStackRef.current[pageNum].length > MAX_UNDO) {
      undoStackRef.current[pageNum].shift();
    }
    // Clear redo on new action
    if (!redoStackRef.current[pageNum]) redoStackRef.current[pageNum] = [];
    redoStackRef.current[pageNum] = [];
  }, []);

  const undo = useCallback((pageNum) => {
    const stack = undoStackRef.current[pageNum];
    if (!stack || stack.length === 0) return;
    const current = drawings[pageNum] || [];
    if (!redoStackRef.current[pageNum]) redoStackRef.current[pageNum] = [];
    redoStackRef.current[pageNum].push(current);
    const prev = stack.pop();
    setDrawings(d => ({ ...d, [pageNum]: prev }));
  }, [drawings, setDrawings]);

  const redo = useCallback((pageNum) => {
    const stack = redoStackRef.current[pageNum];
    if (!stack || stack.length === 0) return;
    const current = drawings[pageNum] || [];
    if (!undoStackRef.current[pageNum]) undoStackRef.current[pageNum] = [];
    undoStackRef.current[pageNum].push(current);
    const next = stack.pop();
    setDrawings(d => ({ ...d, [pageNum]: next }));
  }, [drawings, setDrawings]);

  const canUndo = useCallback((pageNum) => {
    return (undoStackRef.current[pageNum]?.length || 0) > 0;
  }, []);

  const canRedo = useCallback((pageNum) => {
    return (redoStackRef.current[pageNum]?.length || 0) > 0;
  }, []);

  return { pushUndo, undo, redo, canUndo, canRedo };
}

export default function SheetStudy() {
  const { materialId, sheetId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [modeStep, setModeStep] = useState("choose");
  const [difficulty, setDifficulty] = useState("");
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [variant, setVariant] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fullscreenPdf, setFullscreenPdf] = useState(false);
  const [drawings, setDrawings] = useState({});

  async function startNormal() {
    await runAction(async () => {
      const data = await api(`/api/sheets/${sheetId}/start`, { method: "POST", body: JSON.stringify({ mode: "normal" }) });
      setSession(data);
      setModeStep("reader");
    });
  }

  async function startAdvanced(nextDifficulty) {
    await runAction(async () => {
      const data = await api(`/api/sheets/${sheetId}/start`, {
        method: "POST",
        body: JSON.stringify({ mode: "advanced", difficulty: nextDifficulty })
      });
      setDifficulty(nextDifficulty);
      setSession(data);
      setModeStep("advanced");
      setQuiz(null);
      setResult(null);
      setAnswers({});
    });
  }

  async function loadQuiz(isFinal = false, nextVariant = variant) {
    await runAction(async () => {
      const block = session.block || { pageStart: 1, pageEnd: session.sheet.totalPages };
      const data = await api(
        `/api/sheets/${sheetId}/quiz?difficulty=${difficulty}&pageStart=${block.pageStart}&pageEnd=${block.pageEnd}&variant=${nextVariant}${isFinal ? "&final=1" : ""}`
      );
      setQuiz(data);
      setResult(null);
      setAnswers({});
    });
  }

  async function submitQuiz() {
    await runAction(async () => {
      const data = await api(`/api/sheets/${sheetId}/quiz/submit`, {
        method: "POST",
        body: JSON.stringify({
          difficulty,
          pageStart: quiz.pageStart,
          pageEnd: quiz.pageEnd,
          isFinal: quiz.isFinal,
          variant: quiz.variant,
          answers: quiz.questions.map((question) => ({
            questionId: question.id,
            selectedAnswer: answers[question.id] || ""
          }))
        })
      });
      setResult(data);
      setQuiz(null);
    });
  }

  async function continueAfterReview() {
    await runAction(async () => {
      const data = await api(`/api/sheets/${sheetId}/advanced/continue`, {
        method: "POST",
        body: JSON.stringify({ difficulty, pageEnd: result.pageEnd })
      });
      setSession(data);
      setResult(null);
      setQuiz(null);
      setAnswers({});
    });
  }

  function retakeQuiz() {
    const nextVariant = variant + 1;
    setVariant(nextVariant);
    loadQuiz(result?.isFinal || false, nextVariant);
  }

  async function runAction(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (modeStep === "choose") {
    return (
      <Page title="Study Mode" subtitle="Select how you want to open this sheet. Advanced Study unlocks only 3 pages at a time.">
        <section className="study-mode-grid">
          <button className="study-mode-card" onClick={startNormal} disabled={busy}>
            <span className="stat-icon"><Icon name="book-open" /></span>
            <h2>Normal Study</h2>
            <p>Open the full sheet normally with no restrictions.</p>
          </button>
          <button className="study-mode-card featured" onClick={() => setModeStep("difficulty")} disabled={busy}>
            <span className="stat-icon"><Icon name="target" /></span>
            <h2>Advanced Study</h2>
            <p>Study 3 pages, pass a quiz, unlock the next 3 pages, and collect XP.</p>
          </button>
        </section>
        {error && <ErrorPanel message={error} />}
      </Page>
    );
  }

  if (modeStep === "difficulty") {
    return (
      <Page title="Advanced Study" subtitle="Choose the difficulty for this sheet. The Final Boss will use the same difficulty.">
        <section className="difficulty-grid">
          {["easy", "medium", "hard"].map((level) => (
            <button className={`difficulty-card ${level}`} key={level} onClick={() => startAdvanced(level)} disabled={busy}>
              <span>{level}</span>
              <h2>{level === "easy" ? "5 questions" : level === "medium" ? "7 questions" : "10 questions"}</h2>
              <p>{level === "easy" ? "+10 XP per correct answer" : level === "medium" ? "+15 XP per correct answer" : "+25 XP per correct answer"}</p>
            </button>
          ))}
        </section>
        {error && <ErrorPanel message={error} />}
      </Page>
    );
  }

  if (session?.mode === "normal") {
    return (
      <FocusPdfWorkspace 
        title={session.sheet.title} 
        subtitle="Normal Study Mode" 
        pdfUrl={session.sheet.pdfUrl} 
        drawings={drawings}
        setDrawings={setDrawings}
        onClose={() => navigate(`/materials/${materialId}`)} 
      />
    );
  }

  return (
    <Page title={session?.sheet?.title || "Sheet"} subtitle={session?.mode === "normal" ? "Normal Study mode" : "Advanced Study mode"}>
      {error && <ErrorPanel message={error} />}
      {session?.mode === "advanced" && (
        <>
          <AdvancedStudyPanel 
            session={session} 
            drawings={drawings}
            setDrawings={setDrawings}
            onQuiz={() => loadQuiz(false)} 
            onFinal={() => loadQuiz(true)} 
            onFullscreen={() => setFullscreenPdf(true)}
            busy={busy} 
          />
          {fullscreenPdf && (
            <FocusPdfWorkspace 
              title={session.sheet.title} 
              subtitle={`Advanced Study - Pages ${session.block.pageStart}-${session.block.pageEnd}`} 
              pdfUrl={session.sheet.pdfUrl} 
              drawings={drawings}
              setDrawings={setDrawings}
              onClose={() => setFullscreenPdf(false)} 
            />
          )}
          {quiz && <QuizPanel quiz={quiz} answers={answers} setAnswers={setAnswers} onSubmit={submitQuiz} busy={busy} />}
          {result && (
            <QuizResultPanel
              result={result}
              onNext={() => startAdvanced(difficulty)}
              onContinue={continueAfterReview}
              onRetake={retakeQuiz}
              busy={busy}
            />
          )}
        </>
      )}
      <div className="study-footer-actions">
        <Link className="btn btn-soft" to={`/materials/${materialId}`}>Back to sheets</Link>
      </div>
    </Page>
  );
}

function AdvancedStudyPanel({ session, drawings, setDrawings, onQuiz, onFinal, onFullscreen, busy }) {
  const { progress, block } = session;
  return (
    <section className="advanced-layout">
      <article className="advanced-status">
        <div>
          <p className="eyebrow">{session.difficulty} mode</p>
          <h2>Pages {block.pageStart}-{block.pageEnd}</h2>
          <p>Only 3 pages are unlocked. Finish this block, then take the checkpoint quiz.</p>
        </div>
        <div className="xp-card"><span>XP</span><strong>{progress.xp}</strong></div>
        <div className="advanced-progress">
          <span>{progress.masteryStatus}</span>
          <ProgressLine value={Math.round((progress.unlockedPages / progress.totalPages) * 100)} />
          <small>{progress.unlockedPages}/{progress.totalPages} pages unlocked</small>
        </div>
      </article>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 700 }}>Study Material</h3>
          <button className="btn btn-soft compact" onClick={onFullscreen} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Icon name="expand" size={14} /> Focus Mode
          </button>
        </div>
        <PdfCanvasViewer pdfUrl={session.sheet.pdfUrl} drawings={drawings} setDrawings={setDrawings} enableDrawing={false} />
      </div>
      <article className="advanced-actions">
        {session.weakPoints.length > 0 && (
          <div className="needs-review-list">
            <h2>Needs Review</h2>
            {session.weakPoints.map((item) => <span key={item.topic}>{item.topic} ({item.wrongCount})</span>)}
          </div>
        )}
        {session.finalAvailable ? (
          <button className="btn btn-primary" onClick={onFinal} disabled={busy}>Start Final Boss Quiz</button>
        ) : (
          <button className="btn btn-primary" onClick={onQuiz} disabled={busy || !session.quizRequired}>Take checkpoint quiz</button>
        )}
      </article>
    </section>
  );
}

function SheetPage({ page }) {
  return (
    <article className="sheet-page">
      <span className="pill">Page {page.page}</span>
      <h2>{page.title}</h2>
      {page.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    </article>
  );
}

function QuizPanel({ quiz, answers, setAnswers, onSubmit, busy }) {
  const answered = quiz.questions.filter((question) => answers[question.id]).length;
  return (
    <section className="quiz-panel">
      <div className="panel-title"><h2>{quiz.isFinal ? "Final Boss Quiz" : "Checkpoint Quiz"}</h2><span>{answered}/{quiz.questions.length}</span></div>
      {quiz.questions.map((question) => (
        <article className="quiz-question" key={question.id}>
          <span className="pill">{question.type.replace("_", " ")} - Page {question.page}</span>
          <h3>{question.prompt}</h3>
          <div className="choices">
            {question.choices.map((choice, index) => (
              <button
                key={choice}
                className={answers[question.id] === choice ? "selected" : ""}
                onClick={() => setAnswers((current) => ({ ...current, [question.id]: choice }))}
                aria-pressed={answers[question.id] === choice}
              >
                <span className="choice-prefix">{String.fromCharCode(65 + index)}</span>
                <span>{choice}</span>
              </button>
            ))}
          </div>
        </article>
      ))}
      <button className="btn btn-primary" onClick={onSubmit} disabled={busy || answered !== quiz.questions.length}>Submit quiz</button>
    </section>
  );
}

function QuizResultPanel({ result, onNext, onContinue, onRetake, busy }) {
  return (
    <section className="quiz-result">
      <article className="result-hero">
        <div><p className="eyebrow">Score</p><h2>{result.score}%</h2><p>{result.message}</p></div>
        <div className="xp-card"><span>XP earned</span><strong>{result.xpAwarded}</strong></div>
      </article>
      {result.weakPoints.length > 0 && (
        <article className="panel needs-review-list">
          <h2>Needs Review</h2>
          {result.weakPoints.map((topic) => <span key={topic}>{topic}</span>)}
        </article>
      )}
      <article className="panel mistake-review">
        <div className="panel-title"><h2>Review My Mistakes</h2><span>{result.wrongItems.length}</span></div>
        {result.wrongItems.length ? result.wrongItems.map((item) => (
          <div className="mistake-row" key={item.questionId}>
            <h3>{item.question}</h3>
            <p>Your answer: <strong>{item.userAnswer}</strong></p>
            <p>Correct answer: <strong>{item.correctAnswer}</strong></p>
            <small>{item.explanation}</small>
          </div>
        )) : <p className="muted">No mistakes in this quiz.</p>}
      </article>
      <div className="result-actions">
        {result.unlockedNext && <button className="btn btn-primary" onClick={onNext} disabled={busy}>Open next 3 pages</button>}
        {result.canContinue && <button className="btn btn-primary" onClick={onContinue} disabled={busy}>Continue to next 3 pages</button>}
        {(result.canContinue || result.mustRetake || result.isFinal) && <button className="btn btn-soft" onClick={onRetake} disabled={busy}>Retake with new placeholders</button>}
      </div>
    </section>
  );
}

export function FocusPdfWorkspace({
  title,
  subtitle,
  pdfUrl,
  drawings,
  setDrawings,
  onClose,
  initialWorkspace = null,
  session = null,
  onWorkspaceChange = () => {},
  onPauseResume = null,
  onComplete = null,
  onAbandon = null,
  onRetrySync = null,
  onPageReady = () => {},
  serverBacked = false,
  sessionBusy = false,
  sessionNotice = ""
}) {
  const restoredTool = ["pen", "pencil", "highlighter", "eraser"].includes(initialWorkspace?.active_tool)
    ? initialWorkspace.active_tool
    : "none";
  const [activeTool, setActiveTool] = useState(restoredTool); // "none", "pen", "highlighter", "eraser", "lasso"
  const [activeColor, setActiveColor] = useState("yellow");
  const [brushSize, setBrushSize] = useState("medium");
  const isPhoneViewport = () => typeof window !== "undefined" && window.innerWidth <= 768;
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isPhoneViewport() && initialWorkspace?.sidebar !== "closed");
  const [zoomScale, setZoomScale] = useState(Number(initialWorkspace?.zoom) || 1.2);
  const [stylusActive, setStylusActive] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 24, y: 120 });
  const [isMobile, setIsMobile] = useState(false);
  const [dockPosition, setDockPosition] = useState("left");
  const [eraserMode, setEraserMode] = useState("stroke"); // "stroke" or "pixel"
  const [shapeRecognition, setShapeRecognition] = useState(false);
  const [activePageForUndo, setActivePageForUndo] = useState(Number(initialWorkspace?.current_page) || 1);
  const [handedness, setHandedness] = useState("right"); // "right" or "left"
  const [magnifierEnabled, setMagnifierEnabled] = useState(false);
  const [magnifierRect, setMagnifierRect] = useState({ x: 100, y: 100, w: 220, h: 110, pageNum: 1 });

  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const sidebarRef = useRef(null);

  const { pushUndo, undo, redo, canUndo, canRedo } = useUndoRedo(drawings, setDrawings);

  useEffect(() => {
    if (!initialWorkspace) return;
    setActiveTool(["pen", "pencil", "highlighter", "eraser"].includes(initialWorkspace.active_tool) ? initialWorkspace.active_tool : "none");
    setIsSidebarOpen(!isPhoneViewport() && initialWorkspace.sidebar !== "closed");
    setZoomScale(Number(initialWorkspace.zoom) || 1.2);
    setActivePageForUndo(Number(initialWorkspace.current_page) || 1);
  }, [initialWorkspace?.revision]);

  useEffect(() => {
    const workspaceTool = ["pen", "pencil", "highlighter", "eraser"].includes(activeTool) ? activeTool : "";
    onWorkspaceChange({
      currentPage: activePageForUndo,
      zoom: zoomScale,
      sidebar: isSidebarOpen ? "thumbnails" : "closed",
      activeTool: workspaceTool,
      layout: { toolbar_collapsed: !isSidebarOpen, reading_direction: "vertical" }
    });
  }, [activePageForUndo, activeTool, isSidebarOpen, onWorkspaceChange, zoomScale]);

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= 768;
      setIsMobile(nextIsMobile);
      if (nextIsMobile) setIsSidebarOpen(false);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo(activePageForUndo);
        } else {
          undo(activePageForUndo);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, activePageForUndo]);

  const handleClearAll = () => {
    if (window.confirm("هل أنت متأكد من مسح جميع الرسومات في هذا المستند؟")) {
      setDrawings((existing) => Object.fromEntries(Object.keys(existing).map((page) => [page, []])));
    }
  };

  const handleDragStart = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    
    const sidebar = e.currentTarget.closest(".pdf-study-sidebar");
    if (!sidebar) return;
    
    const rect = sidebar.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    hasDragged.current = false;
    isDraggingRef.current = true;
    
    setDockPosition("floating");
    
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      hasDragged.current = true;
    }

    let newX = e.clientX - dragOffsetRef.current.x;
    let newY = e.clientY - dragOffsetRef.current.y;
    
    const sidebarWidth = isSidebarOpen ? 76 : 56;
    const sidebarHeight = isSidebarOpen ? 450 : 56;
    newX = Math.max(10, Math.min(window.innerWidth - sidebarWidth - 10, newX));
    newY = Math.max(80, Math.min(window.innerHeight - sidebarHeight - 10, newY));
    
    if (sidebarRef.current) {
      sidebarRef.current.style.left = `${newX}px`;
      sidebarRef.current.style.top = `${newY}px`;
    }
  };

  const handleDragEnd = (e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (!hasDragged.current) {
      setIsSidebarOpen(prev => !prev);
      return;
    }

    const finalX = e.clientX - dragOffsetRef.current.x;
    const finalY = e.clientY - dragOffsetRef.current.y;
    const sidebarWidth = isSidebarOpen ? (activeTool === "pen" || activeTool === "highlighter" ? 144 : 76) : 56;
    const sidebarHeight = isSidebarOpen ? 290 : 56;

    let newDock = "floating";

    if (finalX < 80) {
      newDock = "left";
    } else if (finalX > window.innerWidth - sidebarWidth - 80) {
      newDock = "right";
    } else if (finalY < 120) {
      newDock = "top";
    } else if (finalY > window.innerHeight - sidebarHeight - 80) {
      newDock = "bottom";
    }

    setDockPosition(newDock);
    setToolbarPosition({ x: finalX, y: finalY });
  };

  // Determine which shelf to show based on active tool
  const showColorSizeShelf = activeTool === "pen" || activeTool === "highlighter" || activeTool === "lasso";
  const showEraserShelf = activeTool === "eraser";

  return (
    <div className={`pdf-workspace-overlay ${magnifierEnabled ? "has-magnifier" : ""}`} role="dialog" aria-modal="true" aria-label="PDF Study Workspace">
      <header className="pdf-workspace-header">
        <button className="icon-btn" onClick={onClose} aria-label="Close PDF viewer">
          <Icon name="arrow-left" size={20} />
        </button>
        <div className="pdf-workspace-title">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="pdf-workspace-actions">
          <div className="pdf-workspace-utility-controls">
            {/* Undo/Redo */}
            <div className="undo-redo-controls" style={{ display: "flex", alignItems: "center", gap: "4px", marginRight: "8px" }}>
            <button 
              className="icon-btn" 
              onClick={() => undo(activePageForUndo)} 
              disabled={!canUndo(activePageForUndo)}
              title="تراجع (Ctrl+Z)"
              aria-label="Undo"
            >
              <Icon name="undo" size={18} />
            </button>
            <button 
              className="icon-btn" 
              onClick={() => redo(activePageForUndo)} 
              disabled={!canRedo(activePageForUndo)}
              title="إعادة (Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <Icon name="redo" size={18} />
            </button>
            </div>
            {/* Zoom controls */}
            <div className="zoom-controls" style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "16px", background: "var(--bg)", borderRadius: "8px", padding: "4px 8px", border: "1px solid var(--border)" }}>
            <button className="icon-btn" onClick={() => setZoomScale(z => Math.max(0.8, z - 0.1))} title="تصغير">
              <Icon name="minus" size={16} />
            </button>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, minWidth: "48px", textAlign: "center", color: "var(--text)" }}>
              {Math.round(zoomScale * 100)}%
            </span>
            <button className="icon-btn" onClick={() => setZoomScale(z => Math.min(3.0, z + 0.1))} title="تكبير">
              <Icon name="plus" size={16} />
            </button>
            </div>
          </div>
          <div className="pdf-workspace-session-controls">
            {session && <span className="pill">{session.status === "paused" ? "Paused" : "Focus session"}</span>}
            {onPauseResume && <button className="btn btn-soft" type="button" onClick={onPauseResume} disabled={sessionBusy}>{session?.status === "paused" ? "Resume" : "Pause"}</button>}
            {onAbandon && <button className="btn btn-soft" type="button" onClick={onAbandon} disabled={sessionBusy}>Leave session</button>}
            {onRetrySync && <button className="btn btn-soft" type="button" onClick={onRetrySync} disabled={sessionBusy}>Retry sync</button>}
          </div>
          <button className="btn btn-primary" type="button" onClick={onComplete || onClose} disabled={sessionBusy}>{sessionBusy ? "Savingâ€¦" : "Done Studying"}</button>
        </div>
      </header>
      {sessionNotice && <p className="save-hint" role="status">{sessionNotice}</p>}

      {/* Floating Toolbar Sidebar */}
      <aside 
        ref={sidebarRef}
        className={`pdf-study-sidebar ${isSidebarOpen ? "open" : "collapsed"} ${
          isDraggingRef.current ? "dock-floating" : `dock-${dockPosition}`
        }`}
        style={
          isDraggingRef.current || dockPosition === "floating" || isMobile
            ? { left: `${toolbarPosition.x}px`, top: `${toolbarPosition.y}px` }
            : {}
        }
      >
        {!isSidebarOpen && !isMobile ? (
          <button 
            className="sidebar-collapsed-trigger"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            title="انقر لتوسيع أدوات الدراسة (اضغط واسحب لتغيير المكان)"
            aria-label="Expand study tools"
          >
            <Icon 
              name={
                activeTool === "pen" ? "pencil" :
                activeTool === "highlighter" ? "highlighter" :
                activeTool === "eraser" ? "eraser" :
                activeTool === "lasso" ? "lasso" :
                "hand"
              } 
              size={20} 
            />
          </button>
        ) : (
          <div className="sidebar-columns-wrapper" style={{ display: "flex", gap: "0", height: "100%", width: "100%" }}>
            {/* Column 1: Main Tools */}
            <div className="sidebar-main-column">
              {!isMobile && (
                <div className="sidebar-header-controls" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "100%" }}>
                  <div 
                    className="sidebar-drag-handle"
                    onPointerDown={handleDragStart}
                    onPointerMove={handleDragMove}
                    onPointerUp={handleDragEnd}
                    title="اسحب لتغيير مكان الأدوات"
                  >
                    <Icon name="grip" size={16} />
                  </div>
                  <button 
                    className="sidebar-collapse-trigger"
                    onClick={() => setIsSidebarOpen(false)}
                    title="إخفاء الأدوات"
                    aria-label="Collapse toolbar"
                  >
                    <Icon name="chevron-up" size={14} />
                  </button>
                </div>
              )}

              {isMobile && (
                <button 
                  className="sidebar-toggle-tab" 
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  aria-label={isSidebarOpen ? "Collapse toolbar" : "Expand toolbar"}
                  title={isSidebarOpen ? "إخفاء شريط الأدوات" : "إظهار شريط الأدوات"}
                >
                  <Icon name={isSidebarOpen ? "chevron-left" : "chevron-right"} size={16} />
                </button>
              )}

              {stylusActive && (
                <div className="stylus-status-badge" role="status" title="تم اكتشاف القلم الرقمي - رفض راحة اليد مفعّل">
                  <Icon name="pencil" size={13} />
                  <span>القلم متصل</span>
                </div>
              )}
              
              <div className="sidebar-section">
                <span className="sidebar-section-title">الأدوات</span>
                <button 
                  className={`tool-button ${activeTool === "none" ? "active" : ""}`} 
                  onClick={() => setActiveTool("none")}
                  title="تصفح وتمرير الصفحة"
                >
                  <Icon name="hand" size={18} />
                  <span>تمرير</span>
                </button>
                <button 
                  className={`tool-button ${activeTool === "pen" ? "active" : ""}`} 
                  onClick={() => setActiveTool("pen")}
                  title="قلم كتابة ورسم"
                >
                  <Icon name="pencil" size={18} />
                  <span>قلم</span>
                </button>
                <button 
                  className={`tool-button ${activeTool === "highlighter" ? "active" : ""}`} 
                  onClick={() => setActiveTool("highlighter")}
                  title="تحديد وإضاءة نصوص"
                >
                  <Icon name="highlighter" size={18} />
                  <span>تحديد</span>
                </button>
                <button 
                  className={`tool-button ${activeTool === "eraser" ? "active" : ""}`} 
                  onClick={() => setActiveTool("eraser")}
                  title="ممحاة الرسومات"
                >
                  <Icon name="eraser" size={18} />
                  <span>ممحاة</span>
                </button>
                <button 
                  className={`tool-button ${activeTool === "lasso" ? "active" : ""}`} 
                  onClick={() => setActiveTool("lasso")}
                  title="أداة التحديد الحر"
                >
                  <Icon name="lasso" size={18} />
                  <span>تحديد حر</span>
                </button>
                <button 
                  className={`tool-button ${magnifierEnabled ? "active" : ""}`} 
                  onClick={() => setMagnifierEnabled(m => !m)}
                  title="عدسة الكتابة الدقيقة"
                >
                  <Icon name="zoom-in" size={18} />
                  <span>عدسة</span>
                </button>
              </div>

              {/* Shape recognition toggle */}
              <div className="sidebar-section" style={{ borderTop: "1px solid var(--border)", paddingTop: "8px", width: "100%" }}>
                <button 
                  className={`tool-button ${shapeRecognition ? "active" : ""}`} 
                  onClick={() => setShapeRecognition(s => !s)}
                  title="التعرف التلقائي على الأشكال"
                  style={{ width: "100%" }}
                >
                  <Icon name="shapes" size={16} />
                  <span>أشكال ذكية</span>
                </button>
              </div>

              {/* Handedness toggle */}
              <div className="sidebar-section" style={{ borderTop: "1px solid var(--border)", paddingTop: "8px", width: "100%" }}>
                <button 
                  className="tool-button" 
                  onClick={() => {
                    const nextHand = handedness === "right" ? "left" : "right";
                    setHandedness(nextHand);
                    setDockPosition(nextHand === "left" ? "right" : "left");
                  }}
                  title={handedness === "right" ? "تبديل لوضع اليد اليسرى (الأعسر)" : "تبديل لوضع اليد اليمنى"}
                  style={{ width: "100%" }}
                >
                  <Icon name="user" size={16} />
                  <span>{handedness === "right" ? "يمين" : "يسار"}</span>
                </button>
              </div>

              <div className="sidebar-section" style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "12px", width: "100%" }}>
                <button className="tool-button danger" onClick={handleClearAll} title="مسح الكل" style={{ width: "100%" }}>
                  <Icon name="trash" size={18} />
                  <span>مسح الكل</span>
                </button>
                {serverBacked && <small className="muted">Only saved pen, pencil, and highlighter marks loaded here can be cleared at once.</small>}
              </div>
            </div>

            {/* Column 2: Options Shelf */}
            {showColorSizeShelf && (
              <div className="sidebar-shelf-column">
                <div className="sidebar-section">
                  <span className="sidebar-section-title">الألوان</span>
                  <div className="color-palette">
                    {["yellow", "green", "pink", "blue", "red"].map((color) => (
                      <button
                        key={color}
                        className={`color-dot ${activeColor === color ? "active" : ""}`}
                        onClick={() => setActiveColor(color)}
                        title={color}
                        aria-label={color}
                        aria-pressed={activeColor === color}
                      >
                        <span className={`color-dot-swatch ${color}`} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sidebar-section">
                  <span className="sidebar-section-title">الحجم</span>
                  <div className="size-selector">
                    {["small", "medium", "large"].map((size) => (
                      <button
                        key={size}
                        className={`size-button ${brushSize === size ? "active" : ""}`}
                        onClick={() => setBrushSize(size)}
                        title={size === "small" ? "صغير" : size === "medium" ? "وسط" : "كبير"}
                      >
                        <span className={`size-dot-indicator ${size}`} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Eraser mode shelf */}
            {showEraserShelf && (
              <div className="sidebar-shelf-column">
                <div className="sidebar-section">
                  <span className="sidebar-section-title">نوع الممحاة</span>
                  <button 
                    className={`tool-button ${eraserMode === "stroke" ? "active" : ""}`}
                    onClick={() => setEraserMode("stroke")}
                    title="مسح الخط بالكامل"
                  >
                    <Icon name="scissors" size={16} />
                    <span>خط كامل</span>
                  </button>
                  <button 
                    className={`tool-button ${eraserMode === "pixel" ? "active" : ""}`}
                    onClick={() => setEraserMode("pixel")}
                    disabled={serverBacked}
                    title="مسح جزء من الخط"
                  >
                    <Icon name="eraser" size={16} />
                    <span>جزئي</span>
                  </button>
                </div>
                <div className="sidebar-section">
                  <span className="sidebar-section-title">الحجم</span>
                  <div className="size-selector">
                    {["small", "medium", "large"].map((size) => (
                      <button
                        key={size}
                        className={`size-button ${brushSize === size ? "active" : ""}`}
                        onClick={() => setBrushSize(size)}
                        title={size === "small" ? "صغير" : size === "medium" ? "وسط" : "كبير"}
                      >
                        <span className={`size-dot-indicator ${size}`} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      <PdfCanvasViewer 
        pdfUrl={pdfUrl} 
        drawings={drawings} 
        setDrawings={setDrawings}
        activeTool={activeTool}
        activeColor={activeColor}
        brushSize={brushSize}
        enableDrawing={true}
        zoomScale={zoomScale}
        setZoomScale={setZoomScale}
        onStylusChange={setStylusActive}
        eraserMode={eraserMode}
        shapeRecognition={shapeRecognition}
        pushUndo={pushUndo}
        onActivePageChange={setActivePageForUndo}
        magnifierEnabled={magnifierEnabled}
        magnifierRect={magnifierRect}
        setMagnifierRect={setMagnifierRect}
        onPageReady={onPageReady}
      />
    </div>
  );
}

function usePdfJs() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (window.pdfjsLib) {
      setLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = assetPath("/pdf.min.js");
    script.async = true;
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = assetPath("/pdf.worker.min.js");
        if (isMounted) setLoaded(true);
      }
    };
    document.body.appendChild(script);
    return () => {
      isMounted = false;
    };
  }, []);

  return loaded;
}

// Stable empty-array reference so pages with no strokes yet don't get a fresh
// [] identity every render (keeps React.memo on PdfPageRenderer effective).
const EMPTY_STROKES = [];

// ─── PRECISION SMART MAGNIFIER PANEL ──────────────────────────

function MagnifierPanel({
  pdf,
  magnifierRect,
  setMagnifierRect,
  strokes,
  onSaveStrokes,
  activeTool,
  activeColor,
  brushSize,
  pushUndo,
  dprValue
}) {
  const magnifierCanvasRef = useRef(null);
  const magnifierDrawCanvasRef = useRef(null);
  const [rendering, setRendering] = useState(false);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef([]);

  const pageNum = magnifierRect.pageNum;
  const scale = 2.5; // 2.5x zoom magnification

  const getPenColor = (color) => {
    const map = {
      yellow: "#f59e0b",
      green: "#10b981",
      pink: "#ec4899",
      blue: "#3b82f6",
      red: "#ef4444"
    };
    return map[color] || "#f59e0b";
  };

  const getHighlighterColor = (color) => {
    const map = {
      yellow: "rgba(253, 224, 71, 0.45)",
      green: "rgba(110, 231, 183, 0.45)",
      pink: "rgba(244, 114, 182, 0.45)",
      blue: "rgba(147, 197, 253, 0.45)",
      red: "rgba(252, 165, 165, 0.45)"
    };
    return map[color] || "rgba(253, 224, 71, 0.45)";
  };

  const getToolSize = (tool, size) => {
    if (tool === "highlighter") {
      const sizes = { small: 12, medium: 20, large: 32 };
      return sizes[size] || 20;
    } else if (tool === "eraser") {
      const sizes = { small: 12, medium: 24, large: 44 };
      return sizes[size] || 24;
    } else {
      const sizes = { small: 2.5, medium: 4.5, large: 8 };
      return sizes[size] || 4.5;
    }
  };

  // Render PDF page snippet inside Magnifier Canvas by copying from the main canvas
  useEffect(() => {
    const mainPageWrapper = document.querySelectorAll(".pdf-page-wrapper")[pageNum - 1];
    const mainCanvas = mainPageWrapper?.querySelector("canvas");
    const canvas = magnifierCanvasRef.current;
    const drawCanvas = magnifierDrawCanvasRef.current;
    
    console.log("Magnifier Panel Copy Effect: " + JSON.stringify({
      pageNum,
      mainPageWrapperFound: !!mainPageWrapper,
      mainCanvasFound: !!mainCanvas,
      canvasFound: !!canvas,
      drawCanvasFound: !!drawCanvas,
      magnifierRect
    }));

    if (!mainCanvas || !canvas || !drawCanvas) return;

    const ctx = canvas.getContext("2d");
    const panelW = canvas.parentElement.clientWidth || window.innerWidth;
    const panelH = canvas.parentElement.clientHeight || 212;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = panelW * dpr;
    canvas.height = panelH * dpr;
    canvas.style.width = `${panelW}px`;
    canvas.style.height = `${panelH}px`;

    drawCanvas.width = panelW * dpr;
    drawCanvas.height = panelH * dpr;
    drawCanvas.style.width = `${panelW}px`;
    drawCanvas.style.height = `${panelH}px`;

    // Clear background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Crop parameters from main page canvas
    const sx = magnifierRect.x * dpr;
    const sy = magnifierRect.y * dpr;
    const sw = magnifierRect.w * dpr;
    const sh = magnifierRect.h * dpr;

    console.log("Magnifier Panel DrawImage parameters: " + JSON.stringify({
      sx, sy, sw, sh,
      dw: magnifierRect.w * scale,
      dh: magnifierRect.h * scale,
      mainCanvasWidth: mainCanvas.width,
      mainCanvasHeight: mainCanvas.height
    }));

    // Draw the zoomed crop onto the magnifier viewport canvas
    // It will be drawn scaled by 2.5x
    ctx.drawImage(
      mainCanvas,
      sx, sy, sw, sh,
      0, 0, magnifierRect.w * scale, magnifierRect.h * scale
    );
    ctx.restore();
  }, [pageNum, magnifierRect.x, magnifierRect.y, magnifierRect.w, magnifierRect.h]);

  // Redraw strokes inside magnifier
  useEffect(() => {
    const canvas = magnifierDrawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.scale(scale, scale);
    ctx.translate(-magnifierRect.x, -magnifierRect.y);
    
    drawAllStrokes(ctx, strokes, 1);
    ctx.restore();
  }, [strokes, magnifierRect.x, magnifierRect.y]);

  // Coordinate conversion helper
  const getMainCoordinates = (clientX, clientY) => {
    const rect = magnifierDrawCanvasRef.current.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: localX / scale + magnifierRect.x,
      y: localY / scale + magnifierRect.y
    };
  };

  const handlePointerDown = (e) => {
    if (activeTool === "none") return;
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);

    const point = getMainCoordinates(e.clientX, e.clientY);
    isDrawingRef.current = true;
    
    pushUndo(pageNum, [...strokes]);
    currentPointsRef.current = [{
      x: point.x,
      y: point.y,
      t: Date.now(),
      p: e.pressure || 0.5,
      w: getToolSize(activeTool, brushSize)
    }];

    // Live preview
    const canvas = magnifierDrawCanvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    ctx.scale(scale, scale);
    ctx.translate(-magnifierRect.x, -magnifierRect.y);
    
    const activeStroke = {
      tool: activeTool,
      color: activeTool === "highlighter" ? getHighlighterColor(activeColor) : getPenColor(activeColor),
      size: getToolSize(activeTool, brushSize),
      points: currentPointsRef.current
    };
    drawAllStrokes(ctx, [...strokes, activeStroke], 1);
    ctx.restore();
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();

    const point = getMainCoordinates(e.clientX, e.clientY);
    const lastPt = currentPointsRef.current[currentPointsRef.current.length - 1];
    
    const baseSize = getToolSize(activeTool, brushSize);
    const pt = {
      x: point.x,
      y: point.y,
      t: Date.now(),
      p: e.pressure || 0.5,
      w: activeTool === "pen" ? velocityWidth(lastPt, point, baseSize) : baseSize
    };
    currentPointsRef.current.push(pt);

    // Live preview
    const canvas = magnifierDrawCanvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    ctx.scale(scale, scale);
    ctx.translate(-magnifierRect.x, -magnifierRect.y);
    
    const activeStroke = {
      tool: activeTool,
      color: activeTool === "highlighter" ? getHighlighterColor(activeColor) : getPenColor(activeColor),
      size: baseSize,
      points: currentPointsRef.current
    };
    drawAllStrokes(ctx, [...strokes, activeStroke], 1);
    ctx.restore();
  };

  const handlePointerUp = (e) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    e.preventDefault();
    e.target.releasePointerCapture(e.pointerId);

    const baseSize = getToolSize(activeTool, brushSize);
    const color = activeTool === "highlighter" ? getHighlighterColor(activeColor) : getPenColor(activeColor);
    
    const finalStroke = {
      tool: activeTool,
      color,
      size: baseSize,
      points: [...currentPointsRef.current]
    };

    onSaveStrokes(pageNum, [...strokes, finalStroke]);
    currentPointsRef.current = [];
  };

  return (
    <div className="pdf-magnifier-panel">
      <div className="pdf-magnifier-header">
        <span className="magnifier-title">عدسة الكتابة الدقيقة (تغطية 2.5x) - الصفحة {pageNum}</span>
        <div className="magnifier-actions">
          <button 
            className="btn btn-soft compact" 
            onClick={() => setMagnifierRect(prev => ({ ...prev, x: Math.max(0, prev.x - 50) }))}
          >
            ← يسار
          </button>
          <button 
            className="btn btn-soft compact" 
            onClick={() => setMagnifierRect(prev => ({ ...prev, x: prev.x + 50 }))}
          >
            يمين →
          </button>
        </div>
      </div>
      <div className="pdf-magnifier-viewport">
        <canvas ref={magnifierCanvasRef} style={{ position: "absolute", inset: 0 }} />
        <canvas 
          ref={magnifierDrawCanvasRef} 
          style={{ position: "absolute", inset: 0, zIndex: 5, cursor: "crosshair" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
    </div>
  );
}

function PdfCanvasViewer({ 
  pdfUrl, 
  drawings, 
  setDrawings, 
  activeTool = "none", 
  activeColor = "yellow", 
  brushSize = "medium",
  enableDrawing = true,
  zoomScale = 1,
  setZoomScale = () => {},
  onStylusChange = () => {},
  eraserMode = "stroke",
  shapeRecognition = false,
  pushUndo = () => {},
  onActivePageChange = () => {},
  undo = () => {},
  magnifierEnabled = false,
  magnifierRect = null,
  setMagnifierRect = () => {},
  onPageReady = () => {}
}) {
  const isPdfJsLoaded = usePdfJs();
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stylusEngaged, setStylusEngaged] = useState(false);
  
  const containerRef = useRef(null);

  // Shared mutable gesture state, read/written by the container-level pointer
  // listeners below and by every PdfPageRenderer's own pointer handlers.
  const gestureRef = useRef({
    touchPointers: new Map(),
    stylusEngaged: false,
    activeCancelDraw: null,
    isTwoFingerTapCandidate: false,
    twoFingerTapStartTime: 0
  });

  const panZoomRef = useRef({ active: false, startDistance: 0, startZoom: 1, midX: 0, midY: 0 });
  const rafIdRef = useRef(null);
  const pendingUpdateRef = useRef(null);

  const zoomScaleRef = useRef(zoomScale);
  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

  const flushPanZoomUpdate = () => {
    rafIdRef.current = null;
    const pending = pendingUpdateRef.current;
    if (!pending) return;
    pendingUpdateRef.current = null;

    if (pending.zoom !== undefined) setZoomScale(pending.zoom);
    const container = containerRef.current;
    if (container && (pending.dx || pending.dy)) {
      container.scrollLeft -= pending.dx;
      container.scrollTop -= pending.dy;
    }
  };

  const queuePanZoomUpdate = (zoom, dx, dy) => {
    const prev = pendingUpdateRef.current;
    pendingUpdateRef.current = {
      zoom,
      dx: (prev?.dx || 0) + dx,
      dy: (prev?.dy || 0) + dy
    };
    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(flushPanZoomUpdate);
    }
  };

  // Unified Pointer Events gesture layer
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enableDrawing) return;
    const gesture = gestureRef.current;

    const onPointerDown = (e) => {
      if (e.pointerType === "pen") {
        if (!gesture.stylusEngaged) {
          gesture.stylusEngaged = true;
          setStylusEngaged(true);
          onStylusChange(true);
        }
        if (gesture.activeCancelDraw) {
          gesture.activeCancelDraw();
          gesture.activeCancelDraw = null;
        }
        return;
      }

      if (e.pointerType !== "touch") return;

      gesture.touchPointers.set(e.pointerId, { 
        startX: e.clientX, 
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        time: Date.now() 
      });

      if (gesture.touchPointers.size === 2) {
        if (gesture.activeCancelDraw) {
          gesture.activeCancelDraw();
          gesture.activeCancelDraw = null;
        }
        
        gesture.isTwoFingerTapCandidate = true;
        gesture.twoFingerTapStartTime = Date.now();
        
        const pts = [...gesture.touchPointers.values()];
        const dx = pts[0].currentX - pts[1].currentX;
        const dy = pts[0].currentY - pts[1].currentY;
        panZoomRef.current = {
          active: true,
          startDistance: Math.hypot(dx, dy) || 1,
          startZoom: zoomScaleRef.current,
          midX: (pts[0].currentX + pts[1].currentX) / 2,
          midY: (pts[0].currentY + pts[1].currentY) / 2
        };
      } else if (gesture.touchPointers.size > 2) {
        gesture.isTwoFingerTapCandidate = false;
      }
    };

    const onPointerMove = (e) => {
      if (e.pointerType !== "touch") return;
      if (!gesture.touchPointers.has(e.pointerId)) return;
      const pt = gesture.touchPointers.get(e.pointerId);
      pt.currentX = e.clientX;
      pt.currentY = e.clientY;

      if (gesture.isTwoFingerTapCandidate) {
        const dx = e.clientX - pt.startX;
        const dy = e.clientY - pt.startY;
        if (Math.hypot(dx, dy) > 10) {
          gesture.isTwoFingerTapCandidate = false;
        }
      }

      if (gesture.touchPointers.size === 2 && panZoomRef.current.active) {
        e.preventDefault();
        const pts = [...gesture.touchPointers.values()];
        const dx = pts[0].currentX - pts[1].currentX;
        const dy = pts[0].currentY - pts[1].currentY;
        const distance = Math.hypot(dx, dy);
        const factor = distance / panZoomRef.current.startDistance;
        let newZoom = panZoomRef.current.startZoom * factor;
        newZoom = Math.max(0.8, Math.min(3.0, newZoom));

        const midX = (pts[0].currentX + pts[1].currentX) / 2;
        const midY = (pts[0].currentY + pts[1].currentY) / 2;
        const deltaX = midX - panZoomRef.current.midX;
        const deltaY = midY - panZoomRef.current.midY;
        panZoomRef.current.midX = midX;
        panZoomRef.current.midY = midY;

        queuePanZoomUpdate(newZoom, deltaX, deltaY);
      }
    };

    const endTouchPointer = (e) => {
      if (e.pointerType !== "touch") return;
      
      if (gesture.isTwoFingerTapCandidate && gesture.touchPointers.size === 2) {
        const duration = Date.now() - gesture.twoFingerTapStartTime;
        if (duration < 300) {
          // Trigger undo for the active page
          if (magnifierEnabled) {
            undo(magnifierRect.pageNum);
          } else {
            // Find currently active page or fallback to 1
            undo(1);
          }
        }
        gesture.isTwoFingerTapCandidate = false;
      }

      gesture.touchPointers.delete(e.pointerId);
      if (gesture.touchPointers.size < 2) {
        panZoomRef.current.active = false;
      }
    };

    container.addEventListener("pointerdown", onPointerDown, { passive: true });
    container.addEventListener("pointermove", onPointerMove, { passive: false });
    container.addEventListener("pointerup", endTouchPointer, { passive: true });
    container.addEventListener("pointercancel", endTouchPointer, { passive: true });

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", endTouchPointer);
      container.removeEventListener("pointercancel", endTouchPointer);
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enableDrawing, onStylusChange, magnifierEnabled, magnifierRect?.pageNum, undo]);

  const handleSaveStrokes = useCallback((pageNum, newStrokes) => {
    setDrawings((prev) => ({ ...prev, [pageNum]: newStrokes }));
  }, [setDrawings]);

  useEffect(() => {
    if (!isPdfJsLoaded) return;
    setLoading(true);
    setError("");

    const loadingTask = window.pdfjsLib.getDocument(pdfUrl);
    loadingTask.promise.then(
      (loadedPdf) => {
        setPdf(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError("فشل تحميل ملف الـ PDF. يرجى التأكد من اتصال الإنترنت ووجود الملف.");
        setLoading(false);
      }
    );
  }, [pdfUrl, isPdfJsLoaded]);

  return (
    <div className="pdf-canvas-viewer-container" ref={containerRef}>
      {loading && <div className="pdf-viewer-loading">جاري تحميل ملف الـ PDF...</div>}
      {error && <div className="pdf-viewer-error">{error}</div>}
      {!loading && !error && pdf && (
        <div className="pdf-canvas-pages-list" style={{ zoom: zoomScale }}>
          {Array.from({ length: numPages }, (_, index) => {
            const pageNum = index + 1;
            return (
              <PdfPageRenderer 
                key={pageNum} 
                pdf={pdf} 
                pageNumber={pageNum} 
                strokes={drawings[pageNum] || EMPTY_STROKES}
                onSaveStrokes={handleSaveStrokes}
                activeTool={activeTool}
                activeColor={activeColor}
                brushSize={brushSize}
                enableDrawing={enableDrawing}
                gesture={gestureRef.current}
                stylusEngaged={stylusEngaged}
                eraserMode={eraserMode}
                shapeRecognition={shapeRecognition}
                pushUndo={pushUndo}
                onActivePageChange={onActivePageChange}
                magnifierEnabled={magnifierEnabled}
                magnifierRect={magnifierRect}
                setMagnifierRect={setMagnifierRect}
                onPageReady={onPageReady}
              />
            );
          })}
        </div>
      )}
      
      {/* Precision Magnifier Split-Screen bottom window */}
      {magnifierEnabled && pdf && (
        <MagnifierPanel
          pdf={pdf}
          magnifierRect={magnifierRect}
          setMagnifierRect={setMagnifierRect}
          strokes={drawings[magnifierRect.pageNum] || EMPTY_STROKES}
          onSaveStrokes={handleSaveStrokes}
          activeTool={activeTool}
          activeColor={activeColor}
          brushSize={brushSize}
          pushUndo={pushUndo}
          dprValue={window.devicePixelRatio || 1}
        />
      )}
    </div>
  );
}

const PdfPageRenderer = memo(function PdfPageRenderer({ 
  pdf, 
  pageNumber, 
  strokes, 
  onSaveStrokes, 
  activeTool, 
  activeColor, 
  brushSize,
  enableDrawing = true,
  gesture = null,
  stylusEngaged = false,
  eraserMode = "stroke",
  shapeRecognition = false,
  pushUndo = () => {},
  onActivePageChange = () => {},
  magnifierEnabled = false,
  magnifierRect = null,
  setMagnifierRect = () => {},
  onPageReady = () => {}
}) {
  const canvasRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const lassoCanvasRef = useRef(null);
  const [rendering, setRendering] = useState(true);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef([]);
  const [dprValue, setDprValue] = useState(1);

  // Shape recognition: long-press detection
  const shapeTimerRef = useRef(null);
  const lastPointerPosRef = useRef(null);

  // Lasso state
  const [lassoSelection, setLassoSelection] = useState(null); // { indices: [...], bounds: {x,y,w,h} }
  const lassoPointsRef = useRef([]);
  const isDraggingSelectionRef = useRef(false);
  const isResizingSelectionRef = useRef(false);
  const resizeCornerRef = useRef(null);
  const initialSelectionBoundsRef = useRef(null);
  const initialSelectedStrokesRef = useRef([]);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Stroke eraser: track which strokes the eraser touches
  const eraserHitsRef = useRef(new Set());

  const getPenColor = (color) => {
    const map = {
      yellow: "#f59e0b",
      green: "#10b981",
      pink: "#ec4899",
      blue: "#3b82f6",
      red: "#ef4444"
    };
    return map[color] || "#f59e0b";
  };

  const getHighlighterColor = (color) => {
    const map = {
      yellow: "rgba(253, 224, 71, 0.45)",
      green: "rgba(110, 231, 183, 0.45)",
      pink: "rgba(244, 114, 182, 0.45)",
      blue: "rgba(147, 197, 253, 0.45)",
      red: "rgba(252, 165, 165, 0.45)"
    };
    return map[color] || "rgba(253, 224, 71, 0.45)";
  };

  const getToolSize = (tool, size) => {
    if (tool === "highlighter") {
      const sizes = { small: 12, medium: 20, large: 32 };
      return sizes[size] || 20;
    } else if (tool === "eraser") {
      const sizes = { small: 12, medium: 24, large: 44 };
      return sizes[size] || 24;
    } else {
      const sizes = { small: 2.5, medium: 4.5, large: 8 };
      return sizes[size] || 4.5;
    }
  };

  const getCoordinates = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Get all pointer events including coalesced ones for lower latency */
  const getCoalescedPoints = (e, canvas) => {
    const points = [];
    const coalesced = e.getCoalescedEvents?.() || [];
    if (coalesced.length > 0) {
      coalesced.forEach(ce => {
        const coord = getCoordinates(ce, canvas);
        points.push({
          x: coord.x,
          y: coord.y,
          t: ce.timeStamp || Date.now(),
          p: ce.pressure || 0,
          w: null // computed below
        });
      });
    } else {
      const coord = getCoordinates(e, canvas);
      points.push({
        x: coord.x,
        y: coord.y,
        t: e.timeStamp || Date.now(),
        p: e.pressure || 0,
        w: null
      });
    }
    return points;
  };

  useEffect(() => {
    let isCancelled = false;
    let renderTask = null;

    pdf.getPage(pageNumber).then((page) => {
      if (isCancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext("2d");
      const scale = 1.5;
      const viewport = page.getViewport({ scale });

      const dpr = window.devicePixelRatio || 1;
      setDprValue(dpr);

      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      onPageReady(pageNumber, viewport.width, viewport.height);

      context.scale(dpr, dpr);

      const drawCanvas = drawCanvasRef.current;
      if (drawCanvas) {
        drawCanvas.width = viewport.width * dpr;
        drawCanvas.height = viewport.height * dpr;
        drawCanvas.style.width = `${viewport.width}px`;
        drawCanvas.style.height = `${viewport.height}px`;
      }

      // Lasso overlay canvas
      const lassoCanvas = lassoCanvasRef.current;
      if (lassoCanvas) {
        lassoCanvas.width = viewport.width * dpr;
        lassoCanvas.height = viewport.height * dpr;
        lassoCanvas.style.width = `${viewport.width}px`;
        lassoCanvas.style.height = `${viewport.height}px`;
      }

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      renderTask = page.render(renderContext);
      renderTask.promise.then(() => {
        if (!isCancelled) {
          setRendering(false);
        }
      }).catch(() => {});
    });

    return () => {
      isCancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [onPageReady, pageNumber, pdf]);

  // Redraw strokes when they change
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    drawAllStrokes(context, strokes, dprValue);
  }, [strokes, dprValue]);

  // Draw lasso selection overlay
  useEffect(() => {
    const canvas = lassoCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = dprValue;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (lassoSelection && lassoSelection.bounds) {
      const b = lassoSelection.bounds;
      ctx.save();
      ctx.strokeStyle = "#f0be3c";
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect(b.x * dpr, b.y * dpr, b.w * dpr, b.h * dpr);

      // Corner handles
      const handleSize = 8 * dpr;
      ctx.fillStyle = "#f0be3c";
      ctx.setLineDash([]);
      const corners = [
        [b.x, b.y], [b.x + b.w, b.y],
        [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]
      ];
      corners.forEach(([cx, cy]) => {
        ctx.fillRect(cx * dpr - handleSize / 2, cy * dpr - handleSize / 2, handleSize, handleSize);
      });
      ctx.restore();
    }
  }, [lassoSelection, dprValue]);

  // Apply color and size changes to Lasso selection
  useEffect(() => {
    if (activeTool === "lasso" && lassoSelection && lassoSelection.indices.length > 0) {
      pushUndo(pageNumber, [...strokes]);
      const newStrokes = strokes.map((s, idx) => {
        if (!lassoSelection.indices.includes(idx)) return s;
        
        const isHighlighter = s.tool === "highlighter";
        const colorValue = isHighlighter ? getHighlighterColor(activeColor) : getPenColor(activeColor);
        const sizeValue = getToolSize(s.tool, brushSize);
        
        return {
          ...s,
          color: colorValue,
          size: sizeValue,
          points: s.points.map(p => ({
            ...p,
            w: isHighlighter ? sizeValue : p.w ? (p.w * (sizeValue / s.size)) : sizeValue
          }))
        };
      });
      onSaveStrokes(pageNumber, newStrokes);
    }
  }, [activeColor, brushSize]);

  // Abort helper
  const abortActiveStroke = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    currentPointsRef.current = [];
    if (shapeTimerRef.current) {
      clearTimeout(shapeTimerRef.current);
      shapeTimerRef.current = null;
    }
    const canvas = drawCanvasRef.current;
    if (canvas) {
      drawAllStrokes(canvas.getContext("2d"), strokes, dprValue);
    }
  };

  // Check if eraser point hits any existing stroke (for stroke-eraser mode)
  const findStrokeAtPoint = (px, py, eraserSize) => {
    const threshold = eraserSize / 2;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.tool === "eraser") continue;
      for (const pt of s.points) {
        if (dist(pt, { x: px, y: py }) < threshold) {
          return i;
        }
      }
    }
    return -1;
  };

  const handlePointerDown = (e) => {
    onActivePageChange(pageNumber);

    // Magnifier selector teleportation on click outside box
    if (magnifierEnabled) {
      const canvas = drawCanvasRef.current;
      const point = getCoordinates(e, canvas);
      const b = magnifierRect;
      const isInside = b.pageNum === pageNumber && 
        point.x >= b.x && point.x <= b.x + b.w && 
        point.y >= b.y && point.y <= b.y + b.h;
        
      if (!isInside) {
        // Teleport magnifier selector box to this click location (centered)
        const pageW = canvasRef.current ? canvasRef.current.width / dprValue : 600;
        const pageH = canvasRef.current ? canvasRef.current.height / dprValue : 800;
        const nextX = Math.max(0, Math.min(pageW - b.w, point.x - b.w / 2));
        const nextY = Math.max(0, Math.min(pageH - b.h, point.y - b.h / 2));
        setMagnifierRect(prev => ({
          ...prev,
          pageNum: pageNumber,
          x: nextX,
          y: nextY
        }));
        return; // Don't start normal drawing if teleporting selector box
      }
    }

    // Lasso tool: handle selection and resize interactions
    if (activeTool === "lasso") {
      e.preventDefault();
      const canvas = drawCanvasRef.current;
      const point = getCoordinates(e, canvas);

      // Check if we are clicking close to a corner handle to resize selection
      if (lassoSelection && lassoSelection.bounds) {
        const b = lassoSelection.bounds;
        const handleSize = 15; // Hit target width around handle

        let corner = null;
        if (dist(point, { x: b.x, y: b.y }) < handleSize) corner = "top-left";
        else if (dist(point, { x: b.x + b.w, y: b.y }) < handleSize) corner = "top-right";
        else if (dist(point, { x: b.x, y: b.y + b.h }) < handleSize) corner = "bottom-left";
        else if (dist(point, { x: b.x + b.w, y: b.y + b.h }) < handleSize) corner = "bottom-right";

        if (corner) {
          e.preventDefault();
          e.stopPropagation();
          isResizingSelectionRef.current = true;
          resizeCornerRef.current = corner;
          dragStartRef.current = { x: point.x, y: point.y };
          initialSelectionBoundsRef.current = { ...b };
          
          const selectedIndices = lassoSelection.indices;
          initialSelectedStrokesRef.current = selectedIndices.map(idx => JSON.parse(JSON.stringify(strokes[idx])));
          
          pushUndo(pageNumber, [...strokes]);
          e.target.setPointerCapture(e.pointerId);
          return;
        }

        // Check if we're clicking inside it to drag
        if (point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) {
          isDraggingSelectionRef.current = true;
          dragStartRef.current = { x: point.x, y: point.y };
          
          pushUndo(pageNumber, [...strokes]); // PUSH UNDO ONCE AT DRAG START
          
          e.target.setPointerCapture(e.pointerId);
          return;
        } else {
          // Clicked outside selection — deselect
          setLassoSelection(null);
        }
      }

      // Start drawing lasso
      e.target.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      lassoPointsRef.current = [point];
      return;
    }

    if (activeTool === "none") return;

    if (e.pointerType === "pen") {
      if (gesture) gesture.stylusEngaged = true;
    } else if (e.pointerType === "touch") {
      if (stylusEngaged || gesture?.stylusEngaged) return;
      if (gesture && gesture.touchPointers.size >= 2) return;
    }

    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);

    const canvas = drawCanvasRef.current;
    const baseSize = getToolSize(activeTool, brushSize);

    // For stroke eraser mode, we don't draw — we detect hits
    if (activeTool === "eraser" && eraserMode === "stroke") {
      const point = getCoordinates(e, canvas);
      isDrawingRef.current = true;
      eraserHitsRef.current = new Set();
      const hitIdx = findStrokeAtPoint(point.x, point.y, baseSize);
      if (hitIdx >= 0) eraserHitsRef.current.add(hitIdx);

      if (e.pointerType === "touch" && gesture) {
        gesture.activeCancelDraw = abortActiveStroke;
      }
      return;
    }

    // Get coalesced events for lower latency
    const newPoints = getCoalescedPoints(e, canvas);

    // Compute width for each point
    const color = activeTool === "highlighter" ? getHighlighterColor(activeColor) : getPenColor(activeColor);
    newPoints.forEach((pt, idx) => {
      const prev = idx > 0 ? newPoints[idx - 1] : null;
      let w = baseSize;
      if (activeTool === "pen") {
        w = velocityWidth(prev, pt, baseSize);
        w = pressureWidth(pt.p, w);
      } else if (activeTool === "highlighter") {
        w = baseSize; // highlighter uses flat width
      }
      pt.w = w;
    });

    isDrawingRef.current = true;
    currentPointsRef.current = newPoints;

    if (e.pointerType === "touch" && gesture) {
      gesture.activeCancelDraw = abortActiveStroke;
    }

    // Live preview
    const context = canvas.getContext("2d");
    const activeStroke = {
      tool: activeTool,
      color,
      size: baseSize,
      points: currentPointsRef.current
    };
    drawAllStrokes(context, [...strokes, activeStroke], dprValue);

    // Shape recognition: start watching for long-press hold
    if (shapeRecognition && (activeTool === "pen" || activeTool === "highlighter")) {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerMove = (e) => {
    // Lasso drawing
    if (activeTool === "lasso" && isDrawingRef.current) {
      e.preventDefault();
      const canvas = drawCanvasRef.current;
      const point = getCoordinates(e, canvas);
      lassoPointsRef.current.push(point);

      // Draw dashed lasso boundary on lasso canvas
      const lCtx = lassoCanvasRef.current?.getContext("2d");
      if (lCtx) {
        const dpr = dprValue;
        lCtx.clearRect(0, 0, lCtx.canvas.width, lCtx.canvas.height);
        lCtx.save();
        lCtx.strokeStyle = "#f0be3c";
        lCtx.lineWidth = 2 * dpr;
        lCtx.setLineDash([6 * dpr, 4 * dpr]);
        lCtx.beginPath();
        const pts = lassoPointsRef.current;
        lCtx.moveTo(pts[0].x * dpr, pts[0].y * dpr);
        for (let i = 1; i < pts.length; i++) {
          lCtx.lineTo(pts[i].x * dpr, pts[i].y * dpr);
        }
        lCtx.closePath();
        lCtx.stroke();
        lCtx.fillStyle = "rgba(240, 190, 60, 0.08)";
        lCtx.fill();
        lCtx.restore();
      }
      return;
    }

    // Lasso drag-move selection
    if (activeTool === "lasso" && isDraggingSelectionRef.current && lassoSelection) {
      e.preventDefault();
      const canvas = drawCanvasRef.current;
      const point = getCoordinates(e, canvas);
      const dx = point.x - dragStartRef.current.x;
      const dy = point.y - dragStartRef.current.y;
      dragStartRef.current = { x: point.x, y: point.y };

      // Move selected strokes
      const prevStrokes = [...strokes];
      pushUndo(pageNumber, prevStrokes);

      const newStrokes = strokes.map((s, idx) => {
        if (!lassoSelection.indices.includes(idx)) return s;
        return {
          ...s,
          points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }))
        };
      });
      onSaveStrokes(pageNumber, newStrokes);

      // Update bounds
      const selectedStrokes = newStrokes.filter((_, idx) => lassoSelection.indices.includes(idx));
      setLassoSelection(prev => ({
        ...prev,
        bounds: getSelectionBounds(selectedStrokes)
      }));
      return;
    }

    if (!isDrawingRef.current) return;
    e.preventDefault();

    const canvas = drawCanvasRef.current;
    const baseSize = getToolSize(activeTool, brushSize);

    // Stroke eraser: check for hits along the move path
    if (activeTool === "eraser" && eraserMode === "stroke") {
      const point = getCoordinates(e, canvas);
      const hitIdx = findStrokeAtPoint(point.x, point.y, baseSize);
      if (hitIdx >= 0) eraserHitsRef.current.add(hitIdx);
      return;
    }

    // Get coalesced points for smoother input
    const newPoints = getCoalescedPoints(e, canvas);
    const prevPoints = currentPointsRef.current;
    const lastPrev = prevPoints.length > 0 ? prevPoints[prevPoints.length - 1] : null;

    newPoints.forEach((pt, idx) => {
      const prev = idx === 0 ? lastPrev : newPoints[idx - 1];
      let w = baseSize;
      if (activeTool === "pen") {
        w = velocityWidth(prev, pt, baseSize);
        w = pressureWidth(pt.p, w);
      } else if (activeTool === "highlighter") {
        w = baseSize;
      }
      pt.w = w;
      currentPointsRef.current.push(pt);
    });

    // Live preview
    const context = canvas.getContext("2d");
    const color = activeTool === "highlighter" ? getHighlighterColor(activeColor) : getPenColor(activeColor);
    const activeStroke = {
      tool: activeTool,
      color,
      size: baseSize,
      points: currentPointsRef.current
    };
    drawAllStrokes(context, [...strokes, activeStroke], dprValue);

    // Shape recognition: update last pointer position
    if (shapeRecognition && (activeTool === "pen" || activeTool === "highlighter")) {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      // Reset the long-press timer on every move
      if (shapeTimerRef.current) clearTimeout(shapeTimerRef.current);
    }
  };

  const handlePointerUp = (e) => {
    if (gesture && gesture.activeCancelDraw === abortActiveStroke) {
      gesture.activeCancelDraw = null;
    }

    // Lasso: finalize selection
    if (activeTool === "lasso" && isDrawingRef.current) {
      isDrawingRef.current = false;
      e.preventDefault();
      if (e.target.hasPointerCapture?.(e.pointerId)) {
        e.target.releasePointerCapture(e.pointerId);
      }

      const lassoPoly = lassoPointsRef.current;
      if (lassoPoly.length >= 3) {
        const selectedIndices = [];
        strokes.forEach((s, idx) => {
          if (s.tool === "eraser") return;
          if (isStrokeInLasso(s, lassoPoly)) selectedIndices.push(idx);
        });

        if (selectedIndices.length > 0) {
          const selectedStrokes = selectedIndices.map(i => strokes[i]);
          setLassoSelection({
            indices: selectedIndices,
            bounds: getSelectionBounds(selectedStrokes)
          });
        } else {
          setLassoSelection(null);
        }
      }

      // Clear lasso drawing
      const lCtx = lassoCanvasRef.current?.getContext("2d");
      if (lCtx) lCtx.clearRect(0, 0, lCtx.canvas.width, lCtx.canvas.height);
      lassoPointsRef.current = [];
      return;
    }

    // Lasso: end drag-move
    if (activeTool === "lasso" && isDraggingSelectionRef.current) {
      isDraggingSelectionRef.current = false;
      if (e.target.hasPointerCapture?.(e.pointerId)) {
        e.target.releasePointerCapture(e.pointerId);
      }
      return;
    }

    if (!isDrawingRef.current) return;
    
    e.preventDefault();
    if (e.target.hasPointerCapture?.(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }

    isDrawingRef.current = false;

    // Stroke eraser: remove hit strokes
    if (activeTool === "eraser" && eraserMode === "stroke") {
      if (eraserHitsRef.current.size > 0) {
        pushUndo(pageNumber, [...strokes]);
        const newStrokes = strokes.filter((_, idx) => !eraserHitsRef.current.has(idx));
        onSaveStrokes(pageNumber, newStrokes);
      }
      eraserHitsRef.current = new Set();
      currentPointsRef.current = [];
      return;
    }

    // Push undo state before adding new stroke
    pushUndo(pageNumber, [...strokes]);

    const baseSize = getToolSize(activeTool, brushSize);
    const color = activeTool === "highlighter" ? getHighlighterColor(activeColor) : getPenColor(activeColor);
    let finalPoints = [...currentPointsRef.current];

    // Shape recognition: check if we should snap to a shape
    if (shapeRecognition && (activeTool === "pen" || activeTool === "highlighter") && finalPoints.length >= 5) {
      const detected = detectShape(finalPoints);
      if (detected) {
        const shapePts = shapeToStrokePoints(detected, baseSize);
        if (shapePts) finalPoints = shapePts;
      }
    }

    const finalStroke = {
      tool: activeTool,
      color,
      size: baseSize,
      canvasWidth: drawCanvasRef.current?.getBoundingClientRect().width || 612,
      canvasHeight: drawCanvasRef.current?.getBoundingClientRect().height || 792,
      points: finalPoints
    };
    
    onSaveStrokes(pageNumber, [...strokes, finalStroke]);
    currentPointsRef.current = [];

    if (shapeTimerRef.current) {
      clearTimeout(shapeTimerRef.current);
      shapeTimerRef.current = null;
    }
  };

  const handlePointerCancel = (e) => {
    if (gesture && gesture.activeCancelDraw === abortActiveStroke) {
      gesture.activeCancelDraw = null;
    }
    abortActiveStroke();
    isDraggingSelectionRef.current = false;
  };

  // Clear lasso selection when switching tools
  useEffect(() => {
    if (activeTool !== "lasso") {
      setLassoSelection(null);
      const lCtx = lassoCanvasRef.current?.getContext("2d");
      if (lCtx) lCtx.clearRect(0, 0, lCtx.canvas.width, lCtx.canvas.height);
    }
  }, [activeTool]);

  const cursorStyle = activeTool === "none" ? "default" 
    : activeTool === "lasso" ? "crosshair"
    : activeTool === "eraser" ? "cell"
    : "crosshair";

  return (
    <div className="pdf-page-wrapper">
      <span className="pdf-page-number">الصفحة {pageNumber}</span>
      <div className="pdf-canvas-container" style={{ position: "relative" }}>
        <canvas ref={canvasRef} />
        {enableDrawing && (
          <>
            <canvas 
              ref={drawCanvasRef} 
              className="pdf-draw-canvas"
              style={{ 
                position: "absolute", 
                inset: 0, 
                zIndex: 5, 
                cursor: cursorStyle,
                touchAction: activeTool === "none" || stylusEngaged ? "auto" : "none"
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
            {/* Lasso overlay canvas */}
            <canvas 
              ref={lassoCanvasRef}
              className="pdf-lasso-canvas"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 6,
                pointerEvents: "none"
              }}
            />
            
            {/* Lasso Floating Delete selection button overlay */}
            {lassoSelection && (
              <button
                className="btn btn-primary compact"
                style={{
                  position: "absolute",
                  left: `${lassoSelection.bounds.x + lassoSelection.bounds.w / 2}px`,
                  top: `${lassoSelection.bounds.y - 32}px`,
                  zIndex: 20,
                  transform: "translateX(-50%)",
                  padding: "4px 10px",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "#ef4444",
                  border: "none",
                  color: "#ffffff",
                  boxShadow: "0 4px 10px rgba(0,0,0,0.3)"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  pushUndo(pageNumber, [...strokes]);
                  const newStrokes = strokes.filter((_, idx) => !lassoSelection.indices.includes(idx));
                  onSaveStrokes(pageNumber, newStrokes);
                  setLassoSelection(null);
                }}
              >
                <Icon name="trash" size={12} />
                حذف المحدد
              </button>
            )}

            {/* Draggable Magnifier Selector Box Overlay */}
            {magnifierEnabled && magnifierRect.pageNum === pageNumber && (
              <div 
                className="pdf-magnifier-selector"
                style={{
                  position: "absolute",
                  left: `${magnifierRect.x}px`,
                  top: `${magnifierRect.y}px`,
                  width: `${magnifierRect.w}px`,
                  height: `${magnifierRect.h}px`,
                  border: "2px solid #7c6fff",
                  background: "rgba(124, 111, 255, 0.15)",
                  boxShadow: "0 0 10px rgba(0, 0, 0, 0.2)",
                  cursor: "move",
                  zIndex: 20
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startRectX = magnifierRect.x;
                  const startRectY = magnifierRect.y;
                  e.target.setPointerCapture(e.pointerId);
                  
                  const onPointerMove = (moveEvent) => {
                    const dx = moveEvent.clientX - startX;
                    const dy = moveEvent.clientY - startY;
                    const pageW = canvasRef.current ? canvasRef.current.width / dprValue : 600;
                    const pageH = canvasRef.current ? canvasRef.current.height / dprValue : 800;
                    const nextX = Math.max(0, Math.min(pageW - magnifierRect.w, startRectX + dx));
                    const nextY = Math.max(0, Math.min(pageH - magnifierRect.h, startRectY + dy));
                    setMagnifierRect(prev => ({ ...prev, x: nextX, y: nextY }));
                  };
                  
                  const onPointerUp = (upEvent) => {
                    e.target.releasePointerCapture(e.pointerId);
                    e.target.removeEventListener("pointermove", onPointerMove);
                    e.target.removeEventListener("pointerup", onPointerUp);
                  };
                  
                  e.target.addEventListener("pointermove", onPointerMove);
                  e.target.addEventListener("pointerup", onPointerUp);
                }}
              />
            )}
          </>
        )}
      </div>
      {rendering && <div className="pdf-page-spinner" />}
    </div>
  );
});
