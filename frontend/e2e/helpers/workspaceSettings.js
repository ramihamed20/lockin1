/** Keep raw ink in tests about persistence and sync; shape recognition has its own coverage. */
export async function keepRawInk(page) {
  await page.addInitScript(() => {
    const key = "lock-in.catalog-workspace.settings.v1";
    try {
      const current = JSON.parse(window.localStorage.getItem(key) || "{}");
      window.localStorage.setItem(key, JSON.stringify({ ...current, drawAndHold: false }));
    } catch {
      window.localStorage.setItem(key, JSON.stringify({ drawAndHold: false }));
    }
  });
}
