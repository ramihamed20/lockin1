import { useEffect, useRef, useState } from "react";
import { createOriginalCompanionPlayer } from "../../lib/originalCompanion.js";

export const companionCharacters = {
  boy: { still: new URL("../../assets/study-companion/boy.png", import.meta.url).href },
  girl: { still: new URL("../../assets/study-companion/girl.png", import.meta.url).href }
};

/** One articulated puppet; mouth, eyes, arms, head and tail share a blended timeline. */
export function CompanionCharacter({ character = "boy", state = "idle", sequenceKey = "", motion = true }) {
  const asset = companionCharacters[character] || companionCharacters.boy;
  const [loaded, setLoaded] = useState({ url: "", image: null });
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const canvasRef = useRef(null), playerRef = useRef(null);
  const animated = motion && visible && loaded.url === asset.still;
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!motion) return undefined;
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => { if (!cancelled) setLoaded({ url: asset.still, image }); };
    image.src = asset.still;
    return () => { cancelled = true; image.onload = null; };
  }, [asset.still, motion]);
  useEffect(() => {
    if (!animated || !canvasRef.current) return undefined;
    const canvas = canvasRef.current;
    const player = createOriginalCompanionPlayer(canvas, loaded.image, character);
    playerRef.current = player;
    function gaze(event) {
      const r = canvas.getBoundingClientRect();
      player?.setGaze((event.clientX - r.left - r.width / 2) / Math.max(1, r.width), (event.clientY - r.top - r.height * .4) / Math.max(1, r.height));
    }
    document.addEventListener("pointermove", gaze, { passive: true });
    return () => { document.removeEventListener("pointermove", gaze); player?.destroy(); playerRef.current = null; };
  }, [animated, character, loaded]);
  useEffect(() => { playerRef.current?.setState(state); }, [state, sequenceKey, animated, character, loaded]);
  return <span className={"study-companion-character" + (animated ? " is-animated is-rigged" : "")} data-state={animated ? state : "idle"} aria-hidden="true">
    <img className="study-companion-still" src={asset.still} alt="" draggable={false} />
    {animated && <canvas ref={canvasRef} className="study-companion-rig" width="512" height="512" />}
  </span>;
}
