import { useEffect, useMemo, useRef, useState } from "react";
import { writingDuration, writingGraphemes } from "../../lib/studyAssistance.js";

/** One text node preserves Arabic joining; a new identity cancels all old frames. */
export function TypedExplanation({ text, animate, onComplete = () => {} }) {
  const graphemes = useMemo(() => writingGraphemes(text), [text]);
  const [progress, setProgress] = useState({ text, count: animate ? 0 : graphemes.length });
  const complete = useRef(onComplete);
  const completedText = useRef(null);
  complete.current = onComplete;
  const count = progress.text === text ? progress.count : 0;
  useEffect(() => {
    let frame = 0, stopped = false, started = null;
    const finish = () => { if (!stopped) { completedText.current = text; setProgress({ text, count: graphemes.length }); complete.current(); } };
    if (!animate || !graphemes.length || completedText.current === text) { finish(); return undefined; }
    const duration = writingDuration(graphemes.length);
    const tick = (time) => {
      if (stopped) return;
      if (started === null) started = time;
      const next = Math.min(graphemes.length, Math.floor((time - started) / duration * graphemes.length));
      setProgress({ text, count: next });
      if (next >= graphemes.length) finish();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [animate, graphemes, text]);
  const writing = animate && count < graphemes.length;
  return <p className="study-companion-text" dir="auto" aria-busy={writing}>
    {graphemes.slice(0, count).join("")}{writing && <span className="study-companion-caret" aria-hidden="true" />}
  </p>;
}
