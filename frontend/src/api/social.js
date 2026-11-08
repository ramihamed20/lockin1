import { request } from './client.js';
import { objectPayload } from './payloads.js';

const payload = (value) => objectPayload(value, 'Friends could not be loaded.');
export const friendsApi = {
  async list() { return payload(await request('/account/friends')); },
  async search(username) { return payload(await request(`/account/friends/search?username=${encodeURIComponent(username)}`)); },
  async add(userId) { return payload(await request('/account/friends/requests', { method: 'POST', body: { user_id: userId } })); },
  async respond(requestId, action) { return payload(await request(`/account/friends/requests/${requestId}/${action}`, { method: 'POST', body: {} })); }
};
export const teamInvitesApi = {
  async list() { return payload(await request('/focus/lock-in/invitations')); },
  async send(teamId, userId) { return payload(await request(`/focus/lock-in/teams/${teamId}/invitations`, { method: 'POST', body: { user_id: userId } })); },
  async respond(invitationId, action) { return payload(await request(`/focus/lock-in/invitations/${invitationId}/${action}`, { method: 'POST', body: {} })); }
};
