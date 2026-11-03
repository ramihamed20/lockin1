# Lockin friends and direct invitations

The home screen lists accepted friends, friend requests and personal team invitations.
Search uses an exact public username (3–30 characters). It never searches or returns
email addresses, phone numbers, session/device data, or another user's friend list.

- Account friendship requests require acceptance by the recipient. Canonical account
  ordering and a unique pair constraint prevent duplicate/reverse requests. Only the
  recipient accepts/declines, only the sender cancels, and either accepted friend may
  remove the relationship. Suspended/deleted accounts are excluded.
- At most 200 open/accepted links per account and 20 request changes per ten minutes.
  A declined request cannot be renewed for one day.
- Presence is a **recent activity hint**, not a live socket connection: an accepted
  friend's unexpired account session was seen within six minutes. Only a boolean is
  returned, never an exact last-seen time. Home refreshes every 30 seconds while visible.
- Only the current host of an open team can invite an accepted friend. Invitations expire
  after 24 hours, are deduplicated, respect notification preferences, and do not enroll
  anyone until acceptance. Team capacity, joining lock, cohort rules, current host and
  current friendship are checked again under locks at acceptance.
- A personal invitation has its own expiry. It does not renew a public invite code or
  weaken expiry checks for the existing public-code endpoint.
- Notifications use the existing in-app/push delivery service and link to `/lock-in`.
  Friend-request and invitation actions remain authoritative even when notifications are off.

Account endpoints: `GET /account/friends`, `GET /account/friends/search?username=...`,
`POST /account/friends/requests {user_id}` and
`POST /account/friends/requests/:id/{accept|decline|cancel|remove}`.

Focus endpoints: `GET /focus/lock-in/invitations`,
`POST /focus/lock-in/teams/:id/invitations {user_id}` and
`POST /focus/lock-in/invitations/:id/{accept|decline}`.

Schema additions: `accounts.0013_friendship` and `focus.0026_focusteaminvitation`.
The frontend does not send invitations when loading a friend list: the user explicitly
selects their team and presses Invite for the intended friend.

## Phase 2 — create with friends

The create-team screen can select accepted friends and filter them by public name or
username. Selection is a local draft: selecting friends sends no invitations. The host
occupies one seat; selection above the remaining capacity disables creation until the
user removes selections or increases capacity. The existing backend is still authoritative.

After creation, invitations use the existing consent-based endpoints. Each delivery is
independent of the photo upload. The lobby reports sent invitations and names for failed
deliveries; Retry sends only those failures and never creates another team. Invitations
do not reserve seats and recipients must still accept under the normal joining rules.

Home lists recently active friends first and adds a local filter for lists over four.
Removing a friend requires the shared confirmation dialog; cancellation sends no request.
No new backend endpoints, migrations, or private browser persistence are introduced.

## In-team invitations

Hosts can expand Invite friends inside the lobby without navigating away. The panel
loads accepted friends and existing sent invitations only while open, refreshes every
30 seconds while visible, and supports public name/username filtering. It shows Joined
only for an explicitly public matching member identity; anonymous members are never
matched to a friend. Pending invitations show Invited after a server response, including
when the panel is reopened. Failed sends remain retryable without a success label.

Joining-locked or full teams show a short state and disable sends; server checks remain
authoritative if capacity, ownership or membership changes during a request. Members
who are not hosts do not receive this panel. Incoming invitations can display the
existing authenticated team image. No API or schema changes are required.

## Lobby design

The lobby prioritizes team identity, member count, joining state and the session action.
Team cards reuse the team image, with a simple group icon when none is set. Code sharing
and the member list remain visible. Host administration, including photo editing, is
inside a native keyboard-operable Team settings disclosure. Incoming friend requests,
sent friend requests and team invitations have short headings inside the existing inbox.
The photo picker uses one preview tile and a plain text label.

## Three open teams per account

An account may belong to at most three open teams in total, including teams it owns.
Create, public-code join and personal-invitation acceptance use the same server check.
Leaving, being removed, or a team ending releases a slot; ended team history remains.
An already accepted invitation stays idempotent, and declining is always permitted.
Existing accounts above the limit keep their memberships but cannot add another until
below three. Pending invitations do not reserve slots.

Every membership addition locks the existing account row inside its transaction before
counting open memberships. Existing-team paths retain the established team-then-account
lock order. The API returns `focus_team_limit_reached` (400), translated in English and
Arabic; frontend controls provide early feedback but cannot bypass this server rule.
PostgreSQL concurrency tests cover two joins, create plus join, and two creates competing
for the final slot. SQLite checks business rules only, not row locking.

Accept and decline controls use rectangular buttons with 9px corners and 44px targets;
decline has an explicit text label instead of an icon-only action.
