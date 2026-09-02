import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const avatarComponent = readFileSync(fileURLToPath(new URL("../src/components/shared/UserAvatar.jsx", import.meta.url)), "utf8");
const editor = readFileSync(fileURLToPath(new URL("../src/components/account/ProfilePictureEditor.jsx", import.meta.url)), "utf8");
const editorStyles = readFileSync(fileURLToPath(new URL("../src/components/account/profile-picture-editor.css", import.meta.url)), "utf8");
const profile = readFileSync(fileURLToPath(new URL("../src/pages/Profile.jsx", import.meta.url)), "utf8");
const layout = readFileSync(fileURLToPath(new URL("../src/components/layout/index.jsx", import.meta.url)), "utf8");
const responsive = readFileSync(fileURLToPath(new URL("../src/responsive.css", import.meta.url)), "utf8");
const avatarStyles = readFileSync(fileURLToPath(new URL("../src/components/shared/user-avatar.css", import.meta.url)), "utf8");
const avatarIds = [
  "cat-male-grayblue",
  "cat-female-calico",
  "cat-male-orange",
  "cat-male-tuxedo",
  "cat-female-lavender",
  "cat-female-pink"
];

test("the six supplied cat avatars are shipped as exact public assets and exposed by the shared resolver", () => {
  for (const id of avatarIds) {
    const source = fileURLToPath(new URL(`../public/avatars/${id}.webp`, import.meta.url));
    assert.ok(existsSync(source), `missing supplied avatar: ${id}`);
    assert.ok(statSync(source).size < 100_000, `avatar should be web-optimized: ${id}`);
    assert.equal(readFileSync(source).subarray(0, 4).toString("ascii"), "RIFF", `avatar should be WebP: ${id}`);
    assert.match(avatarComponent, new RegExp(`id: "${id}"`));
  }
  assert.match(avatarComponent, /avatar\?\.source === "custom"/);
  assert.match(avatarComponent, /fallbackAvatarId/);
});

test("the profile editor presents both default-avatar selection and validated custom uploads", () => {
  assert.match(editor, /DEFAULT_AVATARS\.map/);
  assert.match(editor, /image\/jpeg/);
  assert.match(editor, /image\/png/);
  assert.match(editor, /image\/webp/);
  assert.match(editor, /MAX_AVATAR_BYTES/);
  assert.match(editor, /URL\.createObjectURL/);
  assert.match(editor, /accountsApi\.uploadProfileAvatar/);
  assert.match(editor, /accountsApi\.updateProfile\(\{ avatarDefault/);
});

test("the profile card keeps its existing frame while using an inset avatar image", () => {
  assert.match(profile, /className="profile-avatar-image"/);
  assert.match(editorStyles, /\.profile-academy-id \.profile-avatar-wrap \.profile-avatar-image/);
  assert.match(editorStyles, /inline-size: 70px/);
  assert.match(editorStyles, /block-size: 70px/);
});

test("the account menu uses the same resolved profile avatar as the header and profile page", () => {
  assert.match(layout, /account-menu-identity[\s\S]*<UserAvatar user=\{user\} className="account-menu-avatar"/);
  assert.doesNotMatch(layout, /account-menu-identity[\s\S]{0,300}assets\.mascot/);
  assert.match(responsive, /\.account-menu-identity \.account-menu-avatar \{\s+width: 32px;\s+height: 32px;\s+flex: 0 0 32px;/);
  assert.match(responsive, /\.account-menu-identity \.account-menu-avatar \{\s+width: 34px;\s+height: 34px;\s+flex-basis: 34px;/);
  assert.match(avatarStyles, /@layer primitives/);
});
