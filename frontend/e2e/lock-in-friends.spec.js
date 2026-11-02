import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fulfillAccessContract, studentSession } from './fixtures/productionApi.js';

async function connect(page, language = 'en') {
  const amy = { id: 'amy', request_id: 'fa', name: 'Amy', username: 'amy_student', online: true };
  const bob = { id: 'bob', request_id: 'fb', name: 'Bob', username: 'bob_student', online: false };
  const charlie = { id: 'charlie', request_id: 'fc', name: 'Charlie', username: 'charlie_student' };
  const newcomer = { id: 'new', request_id: 'fn', name: 'New Student', username: 'new_student' };
  if (language === 'ar') { amy.name = 'أحمد'; amy.username = 'ahmed_student'; bob.name = 'سارة'; bob.username = 'sara_student'; }
  const owned = [1, 2].map(n => ({ id: `team${n}`, name: language === "ar" ? (n === 1 ? "فريق التشريح" : "فريق المراجعة") : `Study team ${n}`, role: 'owner', max_members: 8, member_count: 1, invite_code: '482731', self_member_id: 'self', members: [{ member_id: 'self', user_id: 'e2e-student', name: 'Student', role: 'owner' }] }));
  const joined = { ...owned[0], id: 'club', name: 'Study club', role: 'member' };
  const friends = { friends: [amy, bob], incoming: [charlie], outgoing: [] };
  const invitations = { incoming: [{ id: 'inv1', team_id: 'club', team_name: 'Study club', sender: { name: 'Dan' } }], sent: [] };
  const calls = { invites: [] };
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), { pathname } = new URL(req.url());
    const json = body => route.fulfill({ json: body });
    if (pathname === '/api/v1/auth/session') return json({ user: studentSession({ preferred_language: language, policy_version: '2026.10', policy_accepted_at: '2026-10-27T00:00:00Z' }) });
    if (pathname === '/api/v1/auth/csrf') return json({ csrf_token: 'friend-csrf' });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === '/api/v1/focus/lock-in/availability') return json({ enabled: true });
    if (pathname === '/api/v1/focus/lock-in') return json({ teams: owned, materials: [], team_rankings: [] });
    if (pathname === '/api/v1/account/friends') return json(friends);
    if (pathname === '/api/v1/account/friends/search') return json({ users: [newcomer] });
    if (pathname === '/api/v1/account/friends/requests') { friends.outgoing = [newcomer]; return json(friends); }
    if (pathname.endsWith('/fc/accept')) { friends.incoming = []; friends.friends.push(charlie); return json(friends); }
    if (pathname.endsWith('/fb/remove')) { friends.friends = friends.friends.filter(p => p.id !== 'bob'); return json(friends); }
    if (pathname === '/api/v1/focus/lock-in/invitations') return json(invitations);
    if (/teams\/team[12]\/invitations$/.test(pathname)) {
      const teamId = pathname.split('/').at(-2), userId = req.postDataJSON().user_id;
      calls.invites.push([teamId, userId]); invitations.sent.push({ team_id: teamId, user_id: userId }); return json(invitations);
    }
    if (pathname === '/api/v1/focus/lock-in/invitations/inv1/accept') { invitations.incoming = []; return json({ team: joined }); }
    if (pathname === '/api/v1/focus/lock-in/teams/club') return json({ team: joined });
    const team = owned.find(item => pathname === `/api/v1/focus/lock-in/teams/${item.id}`);
    if (team) return json({ team });
    return json({ count: 0, results: [] });
  });
  if (language === 'ar') await page.addInitScript(() => localStorage.setItem('lock-in.locale', 'ar'));
  return calls;
}

for (const width of [320, 1180]) {
  test(`find and add a friend, then explicitly invite to the selected team at ${width}px`, async ({ page }) => {
    const calls = await connect(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/lock-in');
    const section = page.getByRole('region', { name: 'Friends', exact: true });
    await expect(section.getByText('Bob', { exact: true })).toBeVisible();
    expect(calls.invites).toEqual([]);
    await section.getByRole('button', { name: 'Add friend', exact: true }).click();
    await section.getByRole('textbox', { name: 'Username', exact: true }).fill('new_student');
    await section.getByRole('button', { name: 'Find friend', exact: true }).click();
    await section.locator('.lm-friend-search').getByRole('button', { name: 'Add friend', exact: true }).click();
    await expect(section.locator('.lm-friend-search')).toContainText('Pending');
    await section.getByRole('combobox', { name: 'Invite to team' }).selectOption('team2');
    const bob = section.locator('.lm-friend-row').filter({ hasText: 'Bob' });
    await bob.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(bob.getByRole('button', { name: 'Invited', exact: true })).toBeDisabled();
    expect(calls.invites).toEqual([['team2', 'bob']]);
    await section.getByRole('combobox', { name: 'Invite to team' }).selectOption('team1');
    await expect(bob.getByRole('button', { name: 'Invite', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('accept requests and direct invitations without auto-joining on receipt', async ({ page }) => {
  await connect(page);
  await page.goto('/#/lock-in');
  const section = page.getByRole('region', { name: 'Friends', exact: true });
  await expect(section.locator('.lm-social-inbox')).toBeVisible();
  await section.locator('summary').click();
  await section.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(section.locator('.lm-friend-list').getByText('Charlie', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study club', exact: true })).toBeVisible();
});

test('team invite action selects that team without preventing a later selection', async ({ page }) => {
  await connect(page);
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: /Study team 2/ }).click();
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Invite to team' });
  await expect(picker).toHaveValue('team2');
  await picker.selectOption('team1');
  await expect(picker).toHaveValue('team1');
});

test('Arabic home keeps friend actions compact', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await connect(page, 'ar');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/#/lock-in');
  await expect(page.getByRole('region', { name: 'الأصدقاء', exact: true }).getByText('أحمد', { exact: true })).toBeVisible();
  await expect(page.locator('.offline-indicator')).toBeHidden({ timeout: 8000 });
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/lockin-friends-home-phone.png', fullPage: true });
});
