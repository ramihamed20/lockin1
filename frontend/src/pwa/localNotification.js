/** iOS/Android show persistent notifications through the service worker. */
export async function showLocalNotification(title, options) {
  if (!globalThis.Notification || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) await registration.showNotification(title, options);
  else new Notification(title, options);
}
