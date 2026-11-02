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
