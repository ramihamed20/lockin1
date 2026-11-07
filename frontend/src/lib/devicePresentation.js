/** Best-effort display only. This never grants trust or access to a session. */
export function sessionDeviceType(session, currentNavigator = null) {
  // iPadOS may use a desktop Mac user agent. Touch capability is available only
  // for this browser; never apply it to another session belonging to the user.
  if (session.is_current && currentNavigator) {
    const ua = currentNavigator.userAgent || "";
    if (/ipad/i.test(ua) || (/mac/i.test(currentNavigator.platform || ua) && currentNavigator.maxTouchPoints > 1)) return "tablet";
    if (/iphone|ipod|android.*mobile/i.test(ua)) return "phone";
    if (/android/i.test(ua)) return "tablet";
  }
  const label = session.device_label || "";
  if (/ipad|tablet/i.test(label)) return "tablet";
  if (/iphone|ipod|mobile|phone/i.test(label)) return "phone";
  if (/computer|mac|windows|linux|laptop|chromebook/i.test(label)) return "computer";
  return "unknown";
}
