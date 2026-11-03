import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fulfillAccessContract, studentSession } from './fixtures/productionApi.js';

async function connect(page, language = 'en', { rejectBob = false, manyFriends = false, teamOverrides = {}, teamCount = 2, closedLast = false } = {}) {
  const amy = { id: 'amy', request_id: 'fa', name: 'Amy', username: 'amy_student', online: true };
  const bob = { id: 'bob', request_id: 'fb', name: 'Bob', username: 'bob_student', online: false };
  const charlie = { id: 'charlie', request_id: 'fc', name: 'Charlie', username: 'charlie_student' };
  const newcomer = { id: 'new', request_id: 'fn', name: 'New Student', username: 'new_student' };
  if (language === 'ar') { amy.name = 'أحمد'; amy.username = 'ahmed_student'; bob.name = 'سارة'; bob.username = 'sara_student'; }
  const owned = Array.from({ length: teamCount }, (_, index) => index + 1).map(n => ({ id: `team${n}`, name: language === "ar" ? (n === 1 ? "فريق التشريح" : "فريق المراجعة") : `Study team ${n}`, role: 'owner', max_members: 8, member_count: 1, invite_code: '482731', self_member_id: 'self', members: [{ member_id: 'self', user_id: 'e2e-student', name: 'Student', role: 'owner' }], ...teamOverrides }));
  if (closedLast) owned.at(-1).closed_at = '2026-11-01T00:00:00Z';
  const joined = { ...owned[0], id: 'club', name: 'Study club', role: 'member' };
  const friends = { friends: [amy, bob], incoming: [charlie], outgoing: [] };
  const invitations = { incoming: [{ id: 'inv1', team_id: 'club', team_name: 'Study club', sender: { name: 'Dan' } }], sent: [] };
  if (manyFriends) friends.friends.push(...Array.from({ length: 3 }, (_, n) => ({ id: `extra${n}`, request_id: `fe${n}`, name: `Friend ${n}`, username: `friend_${n}` })));
  const calls = { invites: [], creates: 0, removes: 0 };
  let bobFailed = false;
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), { pathname } = new URL(req.url());
    const json = body => route.fulfill({ json: body });
    if (pathname === '/api/v1/auth/session') return json({ user: studentSession({ preferred_language: language, policy_version: '2026.10', policy_accepted_at: '2026-10-27T00:00:00Z' }) });
    if (pathname === '/api/v1/auth/csrf') return json({ csrf_token: 'friend-csrf' });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === '/api/v1/focus/lock-in/availability') return json({ enabled: true });
    if (pathname === '/api/v1/focus/lock-in') return json({ teams: owned, materials: [], team_rankings: [] });
    if (pathname === '/api/v1/focus/lock-in/teams' && req.method() === 'POST') { calls.creates++; const team = { ...owned[0], ...req.postDataJSON(), id: 'team3' }; owned.push(team); return json({ team }); }
    if (pathname === '/api/v1/account/friends') return json(friends);
    if (pathname === '/api/v1/account/friends/search') return json({ users: [newcomer] });
    if (pathname === '/api/v1/account/friends/requests') { friends.outgoing = [newcomer]; return json(friends); }
    if (pathname.endsWith('/fc/accept')) { friends.incoming = []; friends.friends.push(charlie); return json(friends); }
    if (pathname.endsWith('/fb/remove')) { calls.removes++; friends.friends = friends.friends.filter(p => p.id !== 'bob'); return json(friends); }
    if (pathname === '/api/v1/focus/lock-in/invitations') return json(invitations);
    if (/teams\/team[123]\/invitations$/.test(pathname)) {
      const teamId = pathname.split('/').at(-2), userId = req.postDataJSON().user_id;
      calls.invites.push([teamId, userId]);
      if (rejectBob && userId === 'bob' && !bobFailed) { bobFailed = true; return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Try again' } } }); }
      invitations.sent.push({ team_id: teamId, user_id: userId }); return json(invitations);
    }
    if (pathname === '/api/v1/focus/lock-in/invitations/inv1/accept') { invitations.incoming = []; return json({ team: joined }); }
    if (pathname === '/api/v1/focus/lock-in/teams/club') return json({ team: joined });
    const team = owned.find(item => pathname === `/api/v1/focus/lock-in/teams/${item.id}`);
    if (team) { if (req.method() === 'PATCH') Object.assign(team, req.postDataJSON()); return json({ team }); }
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
    expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().width)}`))).toEqual([]);
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

test('invite within a team without leaving the lobby; reopened panel keeps sent status', async ({ page }) => {
  const calls = await connect(page);
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: /Study team 2/ }).click();
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Team invitations', exact: true });
  await panel.getByRole('searchbox', { name: 'Search friends' }).fill('@bob_student');
  await panel.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Invited', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Study team 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Invited', exact: true })).toBeDisabled();
  expect(calls.invites).toEqual([['team2', 'bob']]);
});

test('Arabic home keeps friend actions compact', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await connect(page, 'ar');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/#/lock-in');
  await expect(page.getByRole('region', { name: 'الأصدقاء', exact: true }).getByText('أحمد', { exact: true })).toBeVisible();
  await page.locator('.lm-social-inbox > summary').click();
  await expect(page.getByRole('heading', { name: 'طلبات الصداقة', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'دعوات الفريق', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.offline-indicator')).toBeHidden({ timeout: 8000 });
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/lockin-friends-home-phone.png', fullPage: true });
});


for (const width of [320, 1180]) {
  test(`select friends while creating a team at ${width}px`, async ({ page }) => {
    const calls = await connect(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/lock-in');
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    await page.getByRole('button', { name: 'Create team', exact: true }).click();
    await page.getByRole('textbox', { name: 'Team name', exact: true }).fill('New study team');
    const picker = page.getByRole('group', { name: /Invite friends/ });
    await picker.getByRole('checkbox', { name: 'Amy', exact: true }).check();
    await picker.getByRole('checkbox', { name: 'Bob', exact: true }).check();
    expect(calls.invites).toEqual([]);
    await page.getByRole('spinbutton', { name: 'Maximum members' }).fill('2');
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
    await picker.getByRole('checkbox', { name: 'Bob', exact: true }).uncheck();
    await expect(picker.getByRole('checkbox', { name: 'Bob', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New study team', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Invitations sent: 1' })).toBeVisible();
    expect(calls.creates).toBe(1);
    expect(calls.invites).toEqual([['team3', 'amy']]);
    expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().width)}`))).toEqual([]);
  });
}

test('retry failed invitations without repeating successful invitations or team creation', async ({ page }) => {
  const calls = await connect(page, 'en', { rejectBob: true });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await page.getByRole('textbox', { name: 'Team name', exact: true }).fill('My team');
  await page.getByRole('checkbox', { name: 'Amy', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Bob', exact: true }).check();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Could not invite: Bob', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Invitations sent: 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Could not invite: Bob', { exact: true })).toHaveCount(0);
  expect(calls.creates).toBe(1);
  expect(calls.invites.filter(([, id]) => id === 'amy')).toHaveLength(1);
  expect(calls.invites.filter(([, id]) => id === 'bob')).toHaveLength(2);
});

test('filter friends and confirm before removal; cancelling sends no request', async ({ page }) => {
  const calls = await connect(page, 'en', { manyFriends: true });
  await page.goto('/#/lock-in');
  const section = page.getByRole('region', { name: 'Friends', exact: true });
  await section.getByRole('searchbox', { name: 'Search friends', exact: true }).fill('bob_student');
  await expect(section.locator('.lm-friend-list .lm-friend-row')).toHaveCount(1);
  await section.getByRole('button', { name: 'Options for Bob', exact: true }).click();
  await section.getByRole('menuitem', { name: 'Remove friend', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Remove Bob');
  expect(calls.removes).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(calls.removes).toBe(0);
  await section.getByRole('button', { name: 'Options for Bob', exact: true }).click();
  await section.getByRole('menuitem', { name: 'Remove friend', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove friend', exact: true }).click();
  await expect(section.locator('.lm-friend-list .lm-friend-row')).toHaveCount(0);
  expect(calls.removes).toBe(1);
  await section.getByRole('searchbox', { name: 'Search friends', exact: true }).fill('');
  await expect(section.locator('.lm-friend-list .lm-friend-row')).toHaveCount(4);
});


test('photo failure does not cancel selected invitations', async ({ page }) => {
  const calls = await connect(page);
  let images = 0;
  await page.route('**/focus/lock-in/teams/team3/image', route => { images++; return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Photo unavailable' } } }); });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await page.getByRole('textbox', { name: 'Team name', exact: true }).fill('Team with photo');
  await page.getByRole('checkbox', { name: 'Amy', exact: true }).check();
  await page.getByLabel('Team picture', { exact: true }).setInputFiles({ name: 'team.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Invitations sent: 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(images).toBe(1);
  expect(calls.invites).toEqual([['team3', 'amy']]);
  expect(calls.creates).toBe(1);
});

test('Arabic create flow keeps keyboard selection and filtering on a narrow phone', async ({ page }) => {
  await connect(page, 'ar');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: 'فريق', exact: true }).click();
  await page.getByRole('button', { name: 'إنشاء فريق', exact: true }).click();
  await page.getByRole('textbox', { name: 'اسم الفريق', exact: true }).fill('مجموعة التشريح');
  const first = page.getByRole('checkbox', { name: 'أحمد', exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  await page.getByRole('searchbox', { name: 'بحث في الأصدقاء' }).fill('sara_student');
  await expect(first).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'بحث في الأصدقاء' }).fill('');
  await expect(first).toBeChecked();
  expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().width)}`))).toEqual([]);
  await expect(page.locator('.offline-indicator')).toBeHidden({ timeout: 8000 });
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/lockin-create-friends-phone-ar.png', fullPage: true });
});


for (const state of ['locked', 'full']) {
  test(`team invitation buttons respect ${state} teams on a narrow phone`, async ({ page }) => {
    const calls = await connect(page, 'en', { teamOverrides: state === 'locked' ? { joining_locked: true } : { member_count: 8 } });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/#/lock-in');
    await page.getByRole('button', { name: /Study team 1/ }).click();
    await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Team invitations', exact: true });
    await expect(panel.getByText(state === 'locked' ? 'Joining is closed' : 'Team is full', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Invite', exact: true }).first()).toBeDisabled();
    expect(calls.invites).toEqual([]);
    expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().width)}`))).toEqual([]);
  });
}

test('only public membership identifies a friend as joined', async ({ page }) => {
  const calls = await connect(page, 'en', { teamOverrides: { member_count: 3, members: [
    { member_id: 'self', user_id: 'e2e-student', name: 'Student', role: 'owner' },
    { member_id: 'bob-member', user_id: 'bob', name: 'Bob', role: 'member' },
    { member_id: 'anonymous-member', user_id: 'amy', name: 'Anonymous 01', anonymous: true, role: 'member' }
  ] } });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: /Study team 1/ }).click();
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Team invitations', exact: true });
  await expect(panel.locator('.lm-friend-row').filter({ hasText: 'Bob' }).getByRole('button', { name: 'Joined' })).toBeDisabled();
  await expect(panel.locator('.lm-friend-row').filter({ hasText: 'Amy' }).getByRole('button', { name: 'Invite', exact: true })).toBeEnabled();
  expect(calls.invites).toEqual([]);
});

test('inline invitation failure stays retryable and never displays sent before confirmation', async ({ page }) => {
  const calls = await connect(page, 'en', { rejectBob: true });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: /Study team 1/ }).click();
  await page.getByRole('button', { name: 'Invite friends', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Team invitations', exact: true });
  const bob = panel.locator('.lm-friend-row').filter({ hasText: 'Bob' });
  await bob.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Invite', exact: true })).toBeEnabled();
  await bob.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(bob.getByRole('button', { name: 'Invited', exact: true })).toBeDisabled();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(calls.invites).toEqual([['team1', 'bob'], ['team1', 'bob']]);
});


test('Arabic inline invitations stay inside the team at 320px', async ({ page }) => {
  const calls = await connect(page, 'ar');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: /فريق التشريح/ }).click();
  const toggle = page.getByRole('button', { name: 'دعوة أصحابك', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: 'دعوات الفريق', exact: true });
  await panel.getByRole('searchbox', { name: 'بحث في الأصدقاء' }).fill('sara_student');
  await panel.getByRole('button', { name: 'دعوة', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'تمت الدعوة', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'فريق التشريح', exact: true })).toBeVisible();
  expect(calls.invites).toEqual([['team1', 'bob']]);
  expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().width)}`))).toEqual([]);
});


for (const width of [320, 820]) {
  test(`team settings open on demand and save from the keyboard at ${width}px`, async ({ page }) => {
    await connect(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/lock-in');
    await page.getByRole('button', { name: /Study team 1/ }).click();
    const settings = page.locator('.lm-team-settings');
    await expect(settings).not.toHaveAttribute('open');
    await expect(settings.getByRole('textbox', { name: 'Team name' })).toBeHidden();
    await settings.locator('summary').focus();
    await page.keyboard.press('Enter');
    await settings.getByRole('textbox', { name: 'Team name' }).fill('Updated team');
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Updated team', exact: true })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await settings.locator('summary').click();
    await expect(settings.getByRole('textbox', { name: 'Team name' })).toBeHidden();
    expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().width)}`))).toEqual([]);
  });
}

test('Arabic team design keeps administration collapsed', async ({ page }) => {
  await connect(page, 'ar');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: /فريق التشريح/ }).click();
  await expect(page.locator('.lm-team-settings')).not.toHaveAttribute('open');
  await expect(page.getByRole('button', { name: 'ابدأ الجلسة', exact: true })).toBeVisible();
  await expect(page.locator('.offline-indicator')).toBeHidden({ timeout: 8000 });
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/lockin-team-design-phone-ar.png', fullPage: true });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({ path: 'output/playwright/lockin-team-design-ipad-ar.png', fullPage: true });
});


for (const language of ['en', 'ar']) {
  test(`three teams blocks adding a fourth, with rectangular request actions in ${language}`, async ({ page }) => {
    const calls = await connect(page, language, { teamCount: 3 });
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto('/#/lock-in');
    const section = page.getByRole('region', { name: language === 'ar' ? 'الأصدقاء' : 'Friends', exact: true });
    await section.locator('.lm-social-inbox > summary').click();
    const requests = section.locator('.lm-social-inbox');
    await expect(requests.getByRole('button', { name: language === 'ar' ? 'انضمام' : 'Join', exact: true })).toBeDisabled();
    await expect(requests.getByRole('button', { name: language === 'ar' ? 'قبول' : 'Accept', exact: true })).toBeEnabled();
    const decline = requests.getByRole('button', { name: language === 'ar' ? 'رفض' : 'Decline', exact: true }).first();
    await expect(decline).toBeEnabled();
    for (const button of await requests.locator('.lm-request-action').all()) {
      const shape = await button.evaluate(node => { const r = node.getBoundingClientRect(); return { radius: parseFloat(getComputedStyle(node).borderTopLeftRadius), height: r.height, width: r.width }; });
      expect(shape.radius).toBeLessThan(shape.height / 2);
      expect(shape.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: language === 'ar' ? 'فريق' : 'Team', exact: true }).click();
    await expect(page.getByRole('button', { name: language === 'ar' ? 'إنشاء فريق' : 'Create team', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: language === 'ar' ? 'الانضمام لفريق' : 'Join team', exact: true })).toBeDisabled();
    expect(calls.creates).toBe(0);
  });
}

test('closed team history does not prevent joining a third open team', async ({ page }) => {
  await connect(page, 'en', { teamCount: 3, closedLast: true });
  await page.goto('/#/lock-in');
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create team', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Join team', exact: true })).toBeEnabled();
});
