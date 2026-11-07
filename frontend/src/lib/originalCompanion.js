import motionData from "../assets/study-companion/original-motion.js";
import { expressionPose, blendExpression } from "./companionExpression.js";

const order = ["tail", "body", "head", "left hand", "right hand"];
const radians = Math.PI / 180;

function drawSymbols(ctx, pose, time) {
  ctx.save();
  if (pose.spark > 0) {
    ctx.globalAlpha = pose.spark;
    ctx.fillStyle = "#ffdf83";
    for (const [x, y, r] of [[99, 153, 6], [310, 179, 5], [277, 68, 4]]) {
      ctx.save(); ctx.translate(x, y - pose.spark * 5); ctx.rotate(time * .6);
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .3, -r * .3); ctx.lineTo(r, 0); ctx.lineTo(r * .3, r * .3); ctx.lineTo(0, r); ctx.lineTo(-r * .3, r * .3); ctx.lineTo(-r, 0); ctx.lineTo(-r * .3, -r * .3); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
  ctx.restore();
}

/** Animate masked parts of the approved original PNG. Never repaint its face.
 * One local RAF; caller owns visibility and reduced motion. */
export function createOriginalCompanionPlayer(canvas, image, character = "boy") {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const pieces = [...motionData[character === "girl" ? "girl" : "boy"]].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).map(piece => {
    const path = new window.Path2D();
    piece.polygon.split(" ").forEach((point, i) => {
      const [x, y] = point.split(",").map(Number);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    path.closePath();
    return { ...piece, path };
  });
  ctx.imageSmoothingEnabled = false;
  let frame = 0, last = null, clock = 0, elapsed = 0, state = "idle", destroyed = false;
  let pose = expressionPose(state, 0, 0, character), from = pose;
  function draw(now) {
    if (destroyed) return;
    if (last !== null && now - last < 1000 / 30) { frame = requestAnimationFrame(draw); return; }
    const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000);
    last = now; clock += dt; elapsed += dt;
    const next = expressionPose(state, elapsed, clock, character);
    pose = elapsed < .28 ? blendExpression(from, next, elapsed / .28) : next;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(canvas.width / 400, canvas.height / 400);
    ctx.translate(195, 330 + pose.y); ctx.rotate(pose.tilt * radians); ctx.scale(pose.sx, pose.sy); ctx.translate(-195, -330);
    const at = clock * 24 % 96, a = Math.floor(at), b = (a + 1) % 96, mix = at - a;
    for (const piece of pieces) {
      const p = piece.poses[a], q = piece.poses[b];
      const rotation = p.rotation + (q.rotation - p.rotation) * mix + (piece.name === "head" ? pose.head : piece.name === "left hand" ? pose.armL : piece.name === "right hand" ? pose.armR : piece.name === "tail" ? pose.tail : 0);
      ctx.save();
      ctx.translate(195 + (piece.pivot[0] - 625) * .315, 382 + (piece.pivot[1] - 1175 + p.y + (q.y - p.y) * mix) * .315);
      ctx.rotate(rotation * radians); ctx.scale(.315, .315); ctx.translate(-piece.pivot[0], -piece.pivot[1]);
      ctx.clip(piece.path); ctx.drawImage(image, 0, 0);
      ctx.restore();
    }
    drawSymbols(ctx, pose, clock);
    ctx.restore();
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  return {
    setState(next) { from = { ...pose }; state = next; elapsed = 0; },
    destroy() { destroyed = true; cancelAnimationFrame(frame); }
  };
}
