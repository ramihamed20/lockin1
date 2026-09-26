import { strokeRenderGeometry } from "../ink/strokeModel.js";
import { paintInkErasures } from "../ink/inkErasures.js";

function colorWithOpacity(color, opacity = 1) {
  const value = String(color || "#27364d");
  if (!/^#[0-9a-f]{6}$/i.test(value)) return value;
  const components = [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  return `rgba(${components.join(",")},${Math.min(1, Math.max(0, opacity))})`;
}

function drawWorkspaceBackground(context, width, height, background) {
  if (background === "blank") return;
  context.save();
  context.scale(width / 595, height / 842);
  context.strokeStyle = background === "lined" ? "#dbe5ef" : "#e5ebf1";
  context.fillStyle = "#becbd8";
  context.lineWidth = 1.4;
  if (background === "lined" || background === "grid") {
    for (let y = 40; y < 842; y += 40) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(595, y); context.stroke();
    }
  }
  if (background === "grid") {
    for (let x = 40; x < 595; x += 40) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 842); context.stroke();
    }
  }
  if (background === "dot") {
    for (let y = 32; y < 842; y += 32) for (let x = 32; x < 595; x += 32) {
      context.beginPath(); context.arc(x, y, 1.6, 0, Math.PI * 2); context.fill();
    }
  }
  context.restore();
}

function drawShape(context, item) {
  const { start, end } = item;
  context.beginPath();
  context.strokeStyle = item.color;
  context.lineWidth = item.width;
  context.setLineDash(item.dashed ? [18, 11] : []);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (["line", "arrow"].includes(item.shape)) {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    if (item.shape === "arrow") {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      for (const offset of [-.48, .48]) {
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - Math.cos(angle + offset) * 25, end.y - Math.sin(angle + offset) * 25);
      }
    }
  } else if (["circle", "ellipse"].includes(item.shape)) {
    context.ellipse(x + width / 2, y + height / 2, Math.max(1, width / 2), Math.max(1, height / 2), 0, 0, Math.PI * 2);
  } else if (["triangle", "polygon"].includes(item.shape)) {
    const sides = item.shape === "triangle" ? 3 : 6;
    for (let index = 0; index < sides; index += 1) {
      const angle = item.shape === "triangle" ? -Math.PI / 2 + index * Math.PI * 2 / sides : index * Math.PI * 2 / sides;
      const px = x + width / 2 + Math.cos(angle) * width / 2;
      const py = y + height / 2 + Math.sin(angle) * height / 2;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
  } else {
    context.roundRect(x, y, width, height, item.shape === "rounded" ? 28 : 6);
  }
  if (item.fill && !["line", "arrow"].includes(item.shape)) {
    context.fillStyle = item.fillColor || item.color;
    context.fill();
  }
  context.stroke();
  context.setLineDash([]);
}

async function drawImage(context, item) {
  const image = new window.Image();
  image.src = item.src;
  await image.decode();
  context.drawImage(image, item.x, item.y, item.width, item.height);
}

function drawCard(context, item) {
  const colors = { sticky: "#fff3a8", note: "#edf2ff", lined: "#ffffff", revision: "#ffe8ed" };
  context.fillStyle = colors[item.cardKind] || colors.note;
  context.strokeStyle = "#b8c4d6";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(item.x, item.y, item.width, item.height, 16);
  context.fill();
  context.stroke();
  context.fillStyle = "#1d3152";
  context.font = "700 21px system-ui";
  context.fillText(({ sticky: "Sticky Note", note: "Note Card", lined: "Lined Card", revision: "Revision Card" })[item.cardKind] || "Note Card", item.x + 18, item.y + 34);
  if (item.cardKind === "lined") {
    context.strokeStyle = "#bed4ed";
    for (let y = item.y + 70; y < item.y + item.height - 10; y += 35) {
      context.beginPath();
      context.moveTo(item.x + 14, y);
      context.lineTo(item.x + item.width - 14, y);
      context.stroke();
    }
  }
  context.fillStyle = "#26344e";
  context.font = "20px system-ui";
  const words = String(item.text || "").split(/\s+/);
  let line = "";
  let y = item.y + 70;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > item.width - 36 && line) {
      context.fillText(line, item.x + 18, y);
      y += 28;
      line = word;
    } else line = next;
    if (y > item.y + item.height - 12) break;
  }
  if (line && y <= item.y + item.height - 12) context.fillText(line, item.x + 18, y);
}

export async function renderWorkspacePage({ pdf, pageNumber, background = "blank", annotations = [], includeAnnotations = true, scale = 1.6 }) {
  const page = pdf ? await pdf.getPage(pageNumber) : null;
  const viewport = page?.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport?.width || 1190);
  canvas.height = Math.round(viewport?.height || 1684);
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (page) await page.render({ canvasContext: context, viewport }).promise;
  else drawWorkspaceBackground(context, canvas.width, canvas.height, background);
  if (!includeAnnotations) return canvas;
  context.save();
  context.scale(canvas.width / 1000, canvas.height / 1000);
  // Erasure radii are measured along the page's longer side (see paintInkErasures).
  const pageAspect = canvas.height / Math.max(1, canvas.width);
  const ordered = [...annotations].sort((a, b) => (a.zOrder || 0) - (b.zOrder || 0));
  const highlightGroups = new Map();
  for (const item of ordered) if (item.type === "highlighter") {
    const key = `${item.color}|${item.opacity ?? .34}`;
    if (!highlightGroups.has(key)) highlightGroups.set(key, []);
    highlightGroups.get(key).push(item);
  }
  for (const items of highlightGroups.values()) {
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    const layerContext = layer.getContext("2d");
    const strokeCanvas = document.createElement("canvas");
    strokeCanvas.width = canvas.width;
    strokeCanvas.height = canvas.height;
    const strokeContext = strokeCanvas.getContext("2d");
    for (const item of items) {
      strokeContext.setTransform(1, 0, 0, 1, 0, 0);
      strokeContext.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
      strokeContext.setTransform(strokeCanvas.width / 1000, 0, 0, strokeCanvas.height / 1000, 0, 0);
      const geometry = strokeRenderGeometry(item);
      strokeContext.fillStyle = item.color;
      strokeContext.strokeStyle = item.color;
      strokeContext.lineWidth = geometry.width || 1;
      strokeContext.lineCap = "round";
      strokeContext.lineJoin = "round";
      if (geometry.kind === "dot") {
        strokeContext.beginPath(); strokeContext.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2); strokeContext.fill();
      } else if (geometry.kind === "centerline") strokeContext.stroke(new window.Path2D(geometry.path));
      else if (geometry.kind === "outline") strokeContext.fill(new window.Path2D(geometry.path));
      paintInkErasures(strokeContext, item.erasures, pageAspect);
      layerContext.drawImage(strokeCanvas, 0, 0);
    }
    context.save();
    context.globalAlpha = items[0].opacity ?? .34;
    context.globalCompositeOperation = "multiply";
    context.drawImage(layer, 0, 0, 1000, 1000);
    context.restore();
  }
  for (const item of ordered.filter((annotation) => annotation.type !== "highlighter")) {
    context.save();
    context.globalAlpha = item.opacity ?? 1;
    if (["pen", "pencil", "highlighter"].includes(item.type)) {
      const masked = Boolean(item.erasures?.length);
      const inkCanvas = masked ? document.createElement("canvas") : null;
      if (inkCanvas) { inkCanvas.width = canvas.width; inkCanvas.height = canvas.height; }
      const inkContext = inkCanvas ? inkCanvas.getContext("2d") : context;
      if (inkCanvas) inkContext.scale(inkCanvas.width / 1000, inkCanvas.height / 1000);
      const geometry = strokeRenderGeometry(item);
      inkContext.fillStyle = colorWithOpacity(item.color);
      inkContext.strokeStyle = colorWithOpacity(item.color);
      if (geometry.kind === "dot") {
        inkContext.beginPath();
        inkContext.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
        inkContext.fill();
      } else if (geometry.kind === "centerline") {
        inkContext.lineWidth = geometry.width;
        inkContext.lineCap = "round";
        inkContext.lineJoin = "round";
        inkContext.stroke(new window.Path2D(geometry.path));
      } else if (geometry.kind === "outline") inkContext.fill(new window.Path2D(geometry.path));
      if (masked) {
        paintInkErasures(inkContext, item.erasures, pageAspect);
        context.drawImage(inkCanvas, 0, 0, 1000, 1000);
      }
    } else if (item.type === "shape") drawShape(context, item);
    else if (item.type === "text") {
      context.fillStyle = item.color;
      const fontSize = Math.max(18, item.width * 5);
      context.font = `${item.bold ? "700 " : ""}${fontSize}px system-ui`;
      context.textAlign = item.align || "left";
      for (const [index, line] of String(item.text).split("\n").entries()) context.fillText(line, item.x, item.y + index * fontSize * 1.3);
    } else if (item.type === "image") {
      try { await drawImage(context, item); } catch { /* Corrupt local image does not hide the rest of the page. */ }
    } else if (item.type === "card") drawCard(context, item);
    context.restore();
  }
  context.restore();
  return canvas;
}

function bytes(value) { return new window.TextEncoder().encode(value); }

export function exportPageDimensions(canvas) {
  const width = 595;
  const height = Math.round((width * canvas.height / Math.max(1, canvas.width)) * 100) / 100;
  return { width, height };
}

export async function canvasesToPdf(canvases) {
  const chunks = [];
  const offsets = [0];
  let size = 0;
  const append = (part) => { chunks.push(part); size += part.length; };
  append(bytes("%PDF-1.4\n"));
  const pageRefs = [];
  let objectId = 3;
  for await (const canvas of canvases) {
    const pageSize = exportPageDimensions(canvas);
    const jpeg = new Uint8Array(await (await fetch(canvas.toDataURL("image/jpeg", .85))).arrayBuffer());
    const imageId = objectId++;
    const contentId = objectId++;
    const pageId = objectId++;
    pageRefs.push(pageId);
    offsets[imageId] = size;
    append(bytes(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`));
    append(jpeg);
    append(bytes("\nendstream\nendobj\n"));
    const commands = bytes(`q\n${pageSize.width} 0 0 ${pageSize.height} 0 0 cm\n/Im0 Do\nQ\n`);
    offsets[contentId] = size;
    append(bytes(`${contentId} 0 obj\n<< /Length ${commands.length} >>\nstream\n`));
    append(commands);
    append(bytes("endstream\nendobj\n"));
    offsets[pageId] = size;
    append(bytes(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`));
  }
  offsets[1] = size;
  append(bytes("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
  offsets[2] = size;
  append(bytes(`2 0 obj\n<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`));
  const xref = size;
  append(bytes(`xref\n0 ${objectId}\n0000000000 65535 f \n`));
  for (let id = 1; id < objectId; id += 1) append(bytes(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`));
  append(bytes(`trailer\n<< /Size ${objectId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new Blob(chunks, { type: "application/pdf" });
}

export function downloadWorkspaceBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  // iPadOS Safari may display a blob in the current tab despite download.
  // Keeping that fallback in a separate tab preserves the live workspace.
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
