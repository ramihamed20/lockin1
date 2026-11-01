import motionData from "../assets/study-companion/original-motion.js";
import { expressionPose, blendExpression } from "./companionExpression.js";

const order = ["tail", "body", "head", "left hand", "right hand"];
const radians = Math.PI / 180;

/** Reuses the supplied artwork, including its original pupils and highlights. */
function prepareEyes(image, character) {
  const source = document.createElement("canvas");
  source.width = source.height = 1254;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0);
  const regions = character === "girl" ? [[365, 490, 205, 210], [660, 490, 205, 210]] : [[335, 450, 235, 240], [665, 450, 235, 240]];
  return regions.map(([x, y, w, h]) => {
    const pixels = ctx.getImageData(x, y, w, h).data;
    const mask = new window.Path2D();
    let pupilLeft = w, pupilTop = h, pupilRight = 0, pupilBottom = 0;
    // The white silhouette encloses each pupil. Scanline filling retains its
    // pixel contour while allowing the original eye texture to look around.
    for (let row = 0; row < h; row++) {
      let first = -1, last = -1;
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200 && pixels[i + 3] > 200) {
          if (first < 0) first = col;
          last = col;
        }
      }
      if (first >= 0) {
        mask.rect(x + first, y + row, last - first + 1, 1);
        for (let col = first + 5; col < last - 5; col++) {
          const i = (row * w + col) * 4;
          if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 120) {
            pupilLeft = Math.min(pupilLeft, col); pupilTop = Math.min(pupilTop, row);
            pupilRight = Math.max(pupilRight, col); pupilBottom = Math.max(pupilBottom, row);
          }
        }
      }
    }
    return { x, y, w, h, mask, pupil: pupilRight > pupilLeft ? [x + pupilLeft, y + pupilTop, pupilRight - pupilLeft + 1, pupilBottom - pupilTop + 1] : null };
  });
}

function drawEyes(ctx, image, eyes, pose) {
  for (const eye of eyes) {
    const { x, y, w, h, mask } = eye;
    ctx.save();
    ctx.clip(mask);
    ctx.fillStyle = "#100926";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.save();
    ctx.translate(0, y + h / 2);
    ctx.scale(1, pose.eyeOpen);
    ctx.translate(0, -y - h / 2);
    ctx.clip(mask);
    ctx.fillStyle = "#fffdfd";
    ctx.fillRect(x, y, w, h);
    if (eye.pupil) {
      const [px, py, pw, ph] = eye.pupil;
      ctx.drawImage(image, px, py, pw, ph, px + pose.gazeX, py + pose.gazeY, pw, ph);
    }
    ctx.restore();
  }
}

function drawMouth(ctx, pose, character) {
  if (character === "girl") {
    // Preserve her existing mouth; a small lower-lip movement adds articulation.
    if (pose.mouth < .03) return;
    ctx.save();
    ctx.translate(613, 720);
    ctx.scale(1, .45 + pose.mouth * .55);
    ctx.fillStyle = "#520c72";
    ctx.fillRect(-24, -7, 48, 21);
    ctx.fillStyle = "#ef65b7";
    ctx.fillRect(-11, 8, 22, 12);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(615, 725);
    ctx.fillStyle = "#1a0743";
    if (pose.mouth > .08) {
      const h = 6 + pose.mouth * 26;
      ctx.fillRect(-16, -h / 2, 32, h);
      ctx.fillStyle = "#ee6ab5";
      ctx.fillRect(-8, h / 2 - 8, 16, 8);
    } else {
      ctx.fillRect(-17, -4, 8, 5);
      ctx.fillRect(-9, 1, 18, 5);
      ctx.fillRect(9, -4, 8, 5);
    }
    ctx.restore();
  }
}

function drawSymbols(ctx, pose, time) {
  ctx.save();
  if (pose.thought > 0) {
    ctx.globalAlpha = pose.thought;
    ctx.fillStyle = "#e4ceff";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(291 + i * 12, 96 - i * 8 + Math.sin(time * 3 - i) * 2, 2.3 + i * .4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = "bold 27px system-ui";
    ctx.fillText("?", 316, 69 + Math.sin(time * 2) * 2);
  }
  if (pose.idea > 0) {
    ctx.globalAlpha = pose.idea;
    ctx.strokeStyle = "#ffdc83";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(308, 91, 8, 0, Math.PI * 2);
    ctx.moveTo(304, 100); ctx.lineTo(312, 100);
    ctx.moveTo(305, 105); ctx.lineTo(311, 105);
    for (let i = 0; i < 5; i++) {
      const a = (i * 60 - 210) * radians;
      ctx.moveTo(308 + Math.cos(a) * 13, 91 + Math.sin(a) * 13);
      ctx.lineTo(308 + Math.cos(a) * 17, 91 + Math.sin(a) * 17);
    }
    ctx.stroke();
  }
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

/** One local RAF, no React rerenders per frame; caller owns visibility/reduced motion. */
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
  const eyes = prepareEyes(image, character);
  let frame = 0, last = null, clock = 0, elapsed = 0, state = "idle", destroyed = false;
  let gaze = { x: 0, y: 0 }, targetGaze = { x: 0, y: 0 };
  let pose = expressionPose(state, 0, 0, character), from = pose;
  function draw(now) {
    if (destroyed) return;
    if (last !== null && now - last < 1000 / 30) { frame = requestAnimationFrame(draw); return; }
    const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000);
    last = now; clock += dt; elapsed += dt;
    const follow = 1 - Math.exp(-dt * 7);
    gaze = { x: gaze.x + (targetGaze.x - gaze.x) * follow, y: gaze.y + (targetGaze.y - gaze.y) * follow };
    const next = expressionPose(state, elapsed, clock, character, gaze);
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
      if (piece.name === "head") { drawEyes(ctx, image, eyes, pose); drawMouth(ctx, pose, character); }
      ctx.restore();
    }
    drawSymbols(ctx, pose, clock);
    ctx.restore();
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  return {
    setState(next) { from = { ...pose }; state = next; elapsed = 0; },
    setGaze(x, y) { targetGaze = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }; },
    destroy() { destroyed = true; cancelAnimationFrame(frame); }
  };
}
