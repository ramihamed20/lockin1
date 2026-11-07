import { expect, test } from '@playwright/test';
import { studentSession, fulfillAccessContract } from './fixtures/productionApi.js';

const teamId = '00000000-0000-4000-8000-000000000001';
const imageId = '00000000-0000-4000-8000-000000000002';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLidAAAAABJRU5ErkJggg==', 'base64');
async function connect(page, { rejectFirstImage = false } = {}) {
  let team = null;
  const requests = { metrics: [], creates: 0, images: 0 };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (pathname === '/api/v1/auth/session') return json({ user: studentSession({ policy_version: '2026.10', policy_accepted_at: '2026-10-27T00:00:00Z' }) });
    if (pathname === '/api/v1/auth/csrf') return json({ csrf_token: 'ranking-csrf' });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === '/api/v1/focus/lock-in/availability') return json({ enabled: true });
    if (pathname === '/api/v1/focus/lock-in') return json({ active_session: null, materials: [], teams: team ? [team] : [], team_rankings: [] });
    if (pathname === '/api/v1/focus/lock-in/leaderboard') {
      const metric = searchParams.get('metric');
      requests.metrics.push([metric, searchParams.get('period')]);
      const row = { id: teamId, name: metric === 'sheets' ? 'Completion leaders' : 'Time leaders', active_seconds: 7200, completed_sheets: 4, accuracy_percent: 90, answered_count: 100, longest_focus_seconds: 5400 };
      return json({ teams: [row], solo: [{ ...row, name: 'Solo student' }], accuracy_min_answers: 20, metric });
    }
    if (pathname === '/api/v1/focus/lock-in/teams' && request.method() === 'POST') {
      requests.creates++;
      team = { id: teamId, name: request.postDataJSON().name, max_members: 8, member_count: 1, invite_code: '482731', role: 'owner', self_member_id: 'host', members: [{ member_id: 'host', user_id: 'student', name: 'Student', role: 'owner' }] };
      return json({ team }, 201);
    }
    if (pathname === `/api/v1/focus/lock-in/teams/${teamId}/image`) {
      requests.images++;
      expect(request.headers()['content-type']).toContain('multipart/form-data');
      if (rejectFirstImage && requests.images === 1) return json({ error: { code: 'invalid_request', message: 'Image failed' } }, 400);
      team = { ...team, image_url: `/api/v1/files/${imageId}/view` };
      return json({ team }, 201);
    }
    if (pathname === `/api/v1/focus/lock-in/teams/${teamId}`) return json({ team });
    if (pathname === `/api/v1/files/${imageId}/view`) return route.fulfill({ contentType: 'image/png', body: pixel });
    return json({ count: 0, results: [] });
  });
  return requests;
}

for (const width of [320, 820]) {
  test(`rank filters use server metrics and keep all details visible at ${width}px`, async ({ page }) => {
    const requests = await connect(page);
    await page.setViewportSize({ width, height: 1024 });
    await page.goto('/#/lock-in');
    await page.getByRole('tab', { name: 'Leaderboard', exact: true }).click();
    await expect(page.getByText('Time leaders', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Sheets', exact: true }).click();
    await expect(page.getByText('Completion leaders', { exact: true })).toBeVisible();
    await expect(page.locator('.lm-rank-score strong')).toHaveText('4');
    await expect(page.locator('.lm-rank-time')).toContainText('2h 0m');
    await page.getByRole('tab', { name: 'Accuracy', exact: true }).click();
    await expect(page.locator('.lm-rank-score strong')).toHaveText('90%');
    await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('all_time');
    await expect.poll(() => requests.metrics.at(-1)).toEqual(['accuracy', 'all_time']);
    await page.getByRole('tab', { name: 'Solo', exact: true }).click();
    await page.getByRole('tab', { name: 'Continuous', exact: true }).click();
    await expect(page.locator('.lm-rank-score strong')).toHaveText('1h 30m');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('failed team picture can be retried without creating another team', async ({ page }) => {
  const requests = await connect(page, { rejectFirstImage: true });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: /^Team/ }).click();
  await page.getByRole('button', { name: /Create team/ }).click();
  const upload = { name: 'team.png', mimeType: 'image/png', buffer: pixel };
  await page.getByLabel('Team picture', { exact: true }).setInputFiles(upload);
  await page.getByRole('textbox', { name: 'Team name' }).fill('My study team');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My study team', exact: true })).toBeVisible();
  await expect(page.locator('.lm-error')).toBeVisible();
  expect(requests.creates).toBe(1);
  await page.locator('.lm-team-settings > summary').click();
  await page.getByLabel('Team picture', { exact: true }).setInputFiles(upload);
  await expect(page.locator('.lm-team-identity img')).toHaveAttribute('src', `/api/v1/files/${imageId}/view`);
  expect(requests.images).toBe(2);
  expect(requests.creates).toBe(1);
});


test('failed rank fetch hides previous ranking until retry succeeds', async ({ page }) => {
  await connect(page);
  let fail = true;
  await page.route('**/api/v1/focus/lock-in/leaderboard*', route => {
    if (fail && new URL(route.request().url()).searchParams.get('metric') === 'accuracy') return route.fulfill({ status: 503, json: { error: { code: 'service_unavailable', message: 'Temporarily unavailable' } } });
    return route.fallback();
  });
  await page.goto('/#/lock-in');
  await page.getByRole('tab', { name: 'Leaderboard', exact: true }).click();
  await expect(page.getByText('Time leaders', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Accuracy', exact: true }).click();
  await expect(page.locator('.error-panel')).toBeVisible();
  await expect(page.locator('.lm-ranking-list')).toHaveCount(0);
  fail = false;
  await page.locator('.error-panel button').click();
  await expect(page.locator('.lm-rank-score strong')).toHaveText('90%');
});
