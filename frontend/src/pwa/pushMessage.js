/** No navigation or private notice from a different/expired account binding. */
export function notificationFromPush(payload, binding, now = Date.now()) {
  if (!payload || !binding || payload.binding !== binding.binding ||
      !/^[0-9a-f-]{36}$/i.test(String(payload.id || "")) ||
      !(Date.parse(payload.expires_at) > now) || typeof payload.title !== "string" || typeof payload.body !== "string") return null;
  return {
    title: payload.title.slice(0, 160),
    options: {
      body: payload.body.slice(0, 320), tag: `lock-in:${payload.id}`,
      icon: "/icons/lockin-gold-192-v3.png",
      data: { binding: binding.binding, id: payload.id }
    }
  };
}
