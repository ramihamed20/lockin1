import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Exercise the exact transitive generator consumed by the CSS build toolchain.
const require = createRequire(import.meta.url);
const postcssRequire = createRequire(require.resolve("postcss/package.json"));
const { customRandom } = postcssRequire("nanoid");

for (const defaultSize of [0, 21]) {
  test(`a custom build ID of length zero finishes (default ${defaultSize})`, () => {
    let calls = 0;
    const generate = customRandom("abcd", defaultSize, (size) => {
      // Bound the vulnerable implementation instead of allowing the test to hang.
      assert.ok(++calls <= 64, "Zero-length ID generation stopped making progress");
      return new Uint8Array(size);
    });
    assert.equal(defaultSize === 0 ? generate() : generate(0), "");
  });
}

test("custom build IDs retain their requested size and alphabet", () => {
  const generate = customRandom("abcd", 21, (size) => new Uint8Array(size));
  assert.equal(generate(), "a".repeat(21));
  assert.equal(generate(7), "a".repeat(7));
});
