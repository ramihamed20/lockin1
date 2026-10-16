import { strokeCenterlinePath } from "../ink/strokeModel.js";

export function downloadKnowledge(records, workspaceState = {}) {
  const blob = new Blob([JSON.stringify({ schema: "lockin-knowledge-v1", records, workspace_state: workspaceState }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "my-knowledge.json"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printNotebook(records, title, existingPopup = null, labels = {}) {
  const popup = existingPopup || window.open("", "_blank", "popup");
  if (!popup) return false;
  popup.opener = null;
  const doc = popup.document;
  doc.title = title;
  const style = doc.createElement("style");
  style.textContent = "@page{size:A4;margin:15mm}body{font:14px system-ui;color:#222}article{break-before:page}article:first-of-type{break-before:auto}p{white-space:pre-wrap;overflow-wrap:anywhere}svg{width:100%;max-height:240mm;break-inside:avoid}h2{font-size:20px}";
  doc.head.append(style);
  for (const record of records.filter((item) => item.kind === "summary" && !item.deleted)) {
    const article = doc.createElement("article");
    const heading = doc.createElement("h2"); heading.textContent = record.title;
    const source = doc.createElement("p"); source.textContent = [record.source_title || title, labels[record.source_edition] || "", record.source_version_number ? `${labels.version || "Version"} ${record.source_version_number}` : "", `${record.page_start}–${record.page_end}`].filter(Boolean).join(" · ");
    const text = doc.createElement("p"); text.textContent = record.content.text; text.dir = "auto";
    article.append(heading, source, text);
    if (record.content.strokes?.length) {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 1000 1400");
      for (const stroke of record.content.strokes) {
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", strokeCenterlinePath(stroke.points.map(([x, y]) => ({ x, y }))));
        path.setAttribute("fill", "none"); path.setAttribute("stroke", stroke.color);
        path.setAttribute("stroke-width", String(stroke.width)); path.setAttribute("stroke-linecap", "round");
        path.setAttribute("opacity", stroke.tool === "highlighter" ? ".35" : "1");
        svg.append(path);
      }
      article.append(svg);
    }
    for (const suggestion of record.content.suggestions || []) {
      const block = doc.createElement("blockquote"); block.textContent = suggestion; block.dir = "auto"; article.append(block);
    }
    doc.body.append(article);
  }
  popup.focus(); popup.print();
  return true;
}
