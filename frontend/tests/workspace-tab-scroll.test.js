import assert from "node:assert/strict";
import test from "node:test";
import { revealWorkspaceTab } from "../src/workspace/catalog/workspaceTabScroll.js";

// Browser rectangles, rather than scrollLeft, are the input: RTL browsers use
// negative scroll offsets, while the same physical edge correction still works.
for (const [name, selected, expected] of [
  ["fourth sheet clipped on the right", { left: 260, right: 410 }, 110],
  ["fifth sheet entirely off the right edge", { left: 420, right: 570 }, 270],
  ["RTL sheet clipped on the left", { left: -60, right: 90 }, -80],
  ["close button clipped on the right", { left: 160, right: 330 }, 30],
  ["return to an earlier sheet on the left", { left: -170, right: -20 }, -190],
  ["selected tab already visible", { left: 40, right: 190 }, 0]
]) {
  test(name, () => {
    const calls = [];
    const scroller = { getBoundingClientRect: () => ({ left: 20, right: 300, width: 280 }), scrollBy: (options) => calls.push(options) };
    revealWorkspaceTab(scroller, { getBoundingClientRect: () => selected });
    assert.deepEqual(calls, expected ? [{ left: expected, behavior: "instant" }] : []);
  });
}

test("hidden kept readers do not change their strip position", () => {
  revealWorkspaceTab({ getBoundingClientRect: () => ({ width: 0 }), scrollBy: () => assert.fail("hidden strip scrolled") }, { getBoundingClientRect: () => assert.fail("hidden tab measured") });
});
