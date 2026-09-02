import { assetPath } from "../../lib/utils.js";
import "./user-avatar.css";

export const DEFAULT_AVATARS = Object.freeze([
  { id: "cat-male-grayblue", src: "/avatars/cat-male-grayblue.webp" },
  { id: "cat-female-calico", src: "/avatars/cat-female-calico.webp" },
  { id: "cat-male-orange", src: "/avatars/cat-male-orange.webp" },
  { id: "cat-male-tuxedo", src: "/avatars/cat-male-tuxedo.webp" },
  { id: "cat-female-lavender", src: "/avatars/cat-female-lavender.webp" },
  { id: "cat-female-pink", src: "/avatars/cat-female-pink.webp" }
]);

const avatarById = new Map(DEFAULT_AVATARS.map((avatar) => [avatar.id, avatar]));

export function fallbackAvatarId(userId = "") {
  let value = 0;
  for (let index = 0; index < userId.length; index += 1) {
    value = ((value << 5) - value + userId.charCodeAt(index)) | 0;
  }
  return DEFAULT_AVATARS[Math.abs(value) % DEFAULT_AVATARS.length].id;
}

export function avatarImageSource(avatar, userId = "") {
  if (avatar?.source === "custom" && typeof avatar.url === "string" && avatar.url) return avatar.url;
  const id = avatarById.has(avatar?.default_id) ? avatar.default_id : fallbackAvatarId(userId);
  return assetPath(avatarById.get(id).src);
}

export function UserAvatar({ user, avatar = user?.avatar, alt = "", className = "", loading = "lazy", ...props }) {
  const fallback = avatarImageSource({ default_id: avatar?.default_id }, user?.id || "");
  return (
    <img
      {...props}
      className={`user-avatar ${className}`.trim()}
      src={avatarImageSource(avatar, user?.id || "")}
      alt={alt}
      loading={loading === "eager" ? "eager" : "lazy"}
      decoding="async"
      onError={(event) => {
        if (event.currentTarget.src !== fallback) event.currentTarget.src = fallback;
      }}
    />
  );
}
