import { readdir, readFile } from "node:fs/promises";

/**
 * The Focus workspace page together with the pieces split out of it into
 * src/pages/focus-workspace/, as one text. Source assertions describe the
 * workspace's behaviour, not which file a piece of it lives in.
 */
export async function readWorkspaceSource() {
  const page = new URL("../../src/pages/CatalogFocusWorkspace.jsx", import.meta.url);
  const folder = new URL("../../src/pages/focus-workspace/", import.meta.url);
  const parts = [await readFile(page, "utf8")];
  let names = [];
  try {
    names = (await readdir(folder)).filter((name) => /\.(jsx|js)$/.test(name)).sort();
  } catch {
    names = [];
  }
  for (const name of names) parts.push(await readFile(new URL(name, folder), "utf8"));
  return parts.join("\n");
}
