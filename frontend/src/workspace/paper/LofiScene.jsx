import { useEffect, useRef } from "react";

/**
 * Lock-in's default study scene: a cat asleep on a desk by a night window.
 *
 * Drawn on a canvas instead of shipped as a video so the always-open Paper
 * Workspace costs no media bandwidth. The loop stops while `playing` is false,
 * while the tab is hidden, and entirely under reduced motion (one still frame).
 */

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

function buildScene() {
  const random = seeded(7);
  const stars = Array.from({ length: 70 }, () => ({ x: random(), y: random() * 0.55, r: random() * 1.2 + 0.3, phase: random() * 6 }));
  const buildings = [];
  for (let x = 0; x < 1;) {
    const width = 0.035 + random() * 0.05;
    buildings.push({ x, width, height: 0.18 + random() * 0.42, windows: Array.from({ length: 40 }, () => ({ on: random() > 0.55, phase: random() * 20 })) });
    x += width + 0.004;
  }
  const drops = Array.from({ length: 90 }, () => ({ x: random(), y: random(), speed: 0.25 + random() * 0.35, length: 0.02 + random() * 0.03 }));
  return { stars, buildings, drops };
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

function drawFrame(ctx, width, height, time, scene, still) {
  // Props are drawn in pixels at a ~760px-wide stage and scaled from there,
  // so the cat stays whole on a phone and does not shrink to a dot on a TV.
  const scale = Math.min(1.25, Math.max(0.5, width / 760));
  ctx.clearRect(0, 0, width, height);
  const room = ctx.createLinearGradient(0, 0, 0, height);
  room.addColorStop(0, "#120f18");
  room.addColorStop(1, "#1a1310");
  ctx.fillStyle = room;
  ctx.fillRect(0, 0, width, height);

  // Window, sky, moon, city and rain.
  const wx = width * 0.2;
  const wy = height * 0.07;
  const ww = width * 0.6;
  const wh = height * 0.58;
  ctx.save();
  roundedRect(ctx, wx, wy, ww, wh, 14);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, "#0b1330");
  sky.addColorStop(1, "#2a2250");
  ctx.fillStyle = sky;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = "#fff";
  for (const star of scene.stars) {
    ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(time * 0.6 + star.phase));
    ctx.beginPath();
    ctx.arc(wx + star.x * ww, wy + star.y * wh, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const mx = wx + ww * 0.72;
  const my = wy + wh * 0.22;
  const mr = Math.min(ww, wh) * 0.07;
  const halo = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 4);
  halo.addColorStop(0, "rgba(255,236,190,.35)");
  halo.addColorStop(1, "rgba(255,236,190,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  ctx.fillStyle = "#ffe9b8";
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0e1634";
  ctx.beginPath();
  ctx.arc(mx + mr * 0.45, my - mr * 0.25, mr * 0.9, 0, Math.PI * 2);
  ctx.fill();
  for (const building of scene.buildings) {
    const bx = wx + building.x * ww;
    const bw = building.width * ww;
    const bh = building.height * wh;
    const by = wy + wh - bh;
    ctx.fillStyle = "#0a0e1e";
    ctx.fillRect(bx, by, bw, bh);
    const columns = Math.max(2, Math.floor(bw / 9));
    const rows = Math.floor(bh / 12);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const light = building.windows[(row * columns + column) % 40];
        if (!light.on) continue;
        ctx.fillStyle = Math.sin(time * 0.25 + light.phase + row) > -0.85 ? "rgba(255,196,110,.85)" : "rgba(255,196,110,.15)";
        ctx.fillRect(bx + 3 + column * (bw - 6) / columns, by + 6 + row * 12, 3, 4);
      }
    }
  }
  if (!still) {
    ctx.strokeStyle = "rgba(190,210,255,.22)";
    ctx.lineWidth = 1;
    for (const drop of scene.drops) {
      const y = (drop.y + time * drop.speed) % 1;
      ctx.beginPath();
      ctx.moveTo(wx + drop.x * ww, wy + y * wh);
      ctx.lineTo(wx + drop.x * ww - 2, wy + y * wh + drop.length * wh);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = "#2a2230";
  ctx.lineWidth = 8;
  roundedRect(ctx, wx, wy, ww, wh, 14);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.stroke();

  // Lamp light.
  const lx = width * 0.14;
  const ly = height * 0.5;
  const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, width * 0.45);
  glow.addColorStop(0, `rgba(255,176,80,${0.5 + 0.03 * Math.sin(time * 7) * Math.sin(time * 3.1)})`);
  glow.addColorStop(1, "rgba(255,176,80,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Desk.
  const dy = height * 0.72;
  const desk = ctx.createLinearGradient(0, dy, 0, height);
  desk.addColorStop(0, "#4a2f1e");
  desk.addColorStop(1, "#1d130d");
  ctx.fillStyle = desk;
  ctx.fillRect(0, dy, width, height - dy);
  ctx.fillStyle = "rgba(255,190,110,.18)";
  ctx.fillRect(0, dy, width, 2);

  // Lamp.
  ctx.fillStyle = "#1a1512";
  ctx.fillRect(lx - 3, ly, 6, dy - ly);
  roundedRect(ctx, lx - 26, dy - 8, 52, 10, 5);
  ctx.fill();
  ctx.save();
  ctx.translate(lx, ly);
  ctx.scale(scale, scale);
  ctx.translate(-lx, -ly);
  ctx.fillStyle = "#2b2420";
  ctx.beginPath();
  ctx.moveTo(lx - 44, ly + 6);
  ctx.lineTo(lx + 30, ly - 30);
  ctx.lineTo(lx + 46, ly + 2);
  ctx.lineTo(lx - 20, ly + 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,210,140,.9)";
  ctx.beginPath();
  ctx.ellipse(lx + 2, ly + 16, 30, 7, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Books and the printed sheet.
  ["#6b3b2e", "#2f4a5a", "#5c5132", "#3e2f4d"].forEach((color, index) => {
    ctx.fillStyle = color;
    roundedRect(ctx, width * 0.06 + index * 3, dy - 14 - index * 14, width * 0.16, 13, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,230,180,.35)";
    ctx.fillRect(width * 0.06 + index * 3 + 10, dy - 9 - index * 14, width * 0.07, 2);
  });
  ctx.save();
  ctx.translate(width * 0.42, dy + height * 0.06);
  ctx.rotate(-0.06);
  ctx.fillStyle = "#e9dcc3";
  roundedRect(ctx, -width * 0.13, -height * 0.05, width * 0.26, height * 0.13, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(90,70,50,.35)";
  for (let line = 0; line < 6; line += 1) ctx.fillRect(-width * 0.11, -height * 0.03 + line * height * 0.017, width * (0.14 + (line % 3) * 0.03), 1.5);
  ctx.restore();

  // Mug and steam.
  const mugX = width * 0.8;
  const mugY = dy - 6;
  ctx.save();
  ctx.translate(mugX, mugY);
  ctx.scale(scale, scale);
  ctx.translate(-mugX, -mugY);
  ctx.fillStyle = "#2c3346";
  roundedRect(ctx, mugX - 18, mugY - 34, 36, 36, 6);
  ctx.fill();
  ctx.strokeStyle = "#2c3346";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(mugX + 20, mugY - 17, 8, -1.3, 1.3);
  ctx.stroke();
  if (!still) {
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 2;
    for (let wisp = 0; wisp < 2; wisp += 1) {
      ctx.beginPath();
      for (let step = 0; step < 30; step += 1) {
        const x = mugX - 5 + wisp * 10 + Math.sin(step * 0.25 + time * 1.5 + wisp) * 4;
        const y = mugY - 40 - step * 1.6;
        if (step) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  // The cat, breathing.
  const cx = width * 0.6;
  const cy = dy - 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 1 + 0.03 * Math.sin(time * 1.4));
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 78, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#16161c";
  ctx.beginPath();
  ctx.ellipse(0, -28, 72, 32, 0, Math.PI, 0);
  ctx.lineTo(72, 0);
  ctx.lineTo(-72, 0);
  ctx.fill();
  ctx.strokeStyle = "#16161c";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(62, -6);
  ctx.quadraticCurveTo(84, -2, 70, 6);
  ctx.lineTo(-10, 6);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(cx - 52, cy - 22);
  ctx.fillStyle = "#16161c";
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-24, -10);
  ctx.lineTo(-20, -36);
  ctx.lineTo(-6, -20);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -20);
  ctx.lineTo(20, -34);
  ctx.lineTo(24, -8);
  ctx.fill();
  ctx.fillStyle = "#f2efe9";
  ctx.beginPath();
  ctx.ellipse(-2, 10, 14, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8f8a86";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(-11, -2, 5, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(7, -2, 5, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.fillStyle = "#e39aa6";
  ctx.beginPath();
  ctx.arc(-2, 6, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,180,90,.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 28, Math.PI * 0.9, Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
  if (!still) {
    ctx.fillStyle = "#e8dcff";
    for (let index = 0; index < 3; index += 1) {
      const progress = (time * 0.25 + index / 3) % 1;
      ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.7;
      ctx.font = `600 ${10 + progress * 8}px system-ui, sans-serif`;
      ctx.fillText("z", cx - 40 + progress * 30, cy - 60 - progress * 50);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export function LofiScene({ playing = true, label }) {
  const canvasRef = useRef(null);
  const playingRef = useRef(playing);
  const wakeRef = useRef(() => {});
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;
    const scene = buildScene();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frame = 0;
    // Scene time only advances while playing, so pausing freezes the frame.
    let elapsed = 0;
    let last = window.performance.now();

    const still = () => Boolean(reducedMotion?.matches);
    const paint = () => { if (width && height) drawFrame(ctx, width, height, elapsed / 1000, scene, still()); };
    const running = () => playingRef.current && !still() && document.visibilityState === "visible";

    function tick(now) {
      elapsed += Math.min(now - last, 100);
      last = now;
      paint();
      frame = running() ? requestAnimationFrame(tick) : 0;
    }
    function wake() {
      if (frame || !running()) return;
      last = window.performance.now();
      frame = requestAnimationFrame(tick);
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint();
    }
    wakeRef.current = wake;
    const observer = new window.ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", wake);
    reducedMotion?.addEventListener?.("change", paint);
    resize();
    wake();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", wake);
      reducedMotion?.removeEventListener?.("change", paint);
      wakeRef.current = () => {};
    };
  }, []);

  useEffect(() => { if (playing) wakeRef.current(); }, [playing]);

  return <canvas ref={canvasRef} className="paper-lofi-canvas" role="img" aria-label={label} />;
}
