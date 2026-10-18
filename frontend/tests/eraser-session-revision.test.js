import test from "node:test";
import assert from "node:assert/strict";
import { createEraserSession } from "../src/workspace/ink/eraserSession.js";
const mark = { id: "pen", type: "pen", page: 1, width: 4, profile: "ball", points: [{ x: 20, y: 50, p: .5, pointer: "pen" }, { x: 100, y: 50, p: .5, pointer: "pen" }] };
const point = { x: 60, y: 50 };
const options = { candidates: [mark], radius: 2, mode: "precision" };

test("stationary eraser updates retain the rendered replacement and one atomic command", () => {
  const session = createEraserSession();
  session.begin(point, 1);
  assert.equal(session.append(point, options).previewChanged, true);
  const preview = session.getPreview().annotations[0];
  for (let i = 0; i < 20; i++) {
    const update = session.append({ ...point }, options);
    assert.equal(update.changed, true);
    assert.equal(update.previewChanged, false);
    assert.equal(session.getPreview().annotations[0], preview);
  }
  const { command } = session.finish();
  assert.deepEqual(command.before, [mark]);
  assert.deepEqual(command.after, [preview]);
});

test("eraser revisions still include path, radius, mode, scale and newly touched ink", () => {
  const session = createEraserSession();
  session.begin(point, 1); session.append(point, options);
  const preview = session.getPreview().annotations[0];
  assert.equal(session.append(point, { ...options, radius: 3 }).previewChanged, true);
  assert.equal(session.getPreview().annotations[0].erasures.at(-1).radius, 3);
  assert.equal(session.append(point, { ...options, mode: "stroke" }).previewChanged, true);
  assert.deepEqual(session.getPreview().annotations, []);
  assert.equal(session.append(point, { ...options, scale: { x: .707, y: 1 } }).previewChanged, true);
  assert.notEqual(session.getPreview().annotations[0], preview);
  assert.equal(session.append({ x: 80, y: 50 }, { ...options, scale: { x: .707, y: 1 } }).previewChanged, true);
  const newMark = { ...mark, id: "second" };
  assert.equal(session.append({ x: 80, y: 50 }, { ...options, scale: { x: .707, y: 1 }, candidates: [newMark] }).previewChanged, true);
  assert.equal(session.getPreview().annotations.length, 2);
  assert.deepEqual(session.finish().command.before, [mark, newMark]);
});

test("cancel and a new drag cannot reuse the previous preview", () => {
  const session = createEraserSession();
  session.begin(point, 1); session.append(point, options);
  const first = session.getPreview().annotations[0];
  session.cancel(); session.begin(point, 2);
  assert.equal(session.append(point, { ...options, annotationPage: 2 }).previewChanged, true);
  assert.notEqual(session.getPreview().annotations[0], first);
});
