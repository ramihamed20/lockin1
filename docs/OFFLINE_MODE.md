# Offline Mode implementation and release contract

Offline access is a browser capability backed by a server issued Ed25519 lease.
The app verifies the signature against the public key embedded in its release
bundle. The private seed lives only on the Django host. A lease expires at the
earlier of 24 hours after verification or the effective `content.premium`
entitlement end. Founder or unbounded manual access receives a 24 hour lease.
An expired lease locks cached study routes without deleting saved data.

## Release configuration

- `OFFLINE_LEASE_ED25519_PRIVATE_KEY_FILE` points to a file containing the
  base64 encoding of a 32 byte private Ed25519 seed. Django also accepts
  `OFFLINE_LEASE_ED25519_PRIVATE_KEY` directly. Production requires exactly one.
- `LOCKIN_OFFLINE_LEASE_PUBLIC_KEY` is the matching base64 raw 32 byte public
  key. Put it in GitHub Actions repository variables for the prebuilt edge
  image and in the production Compose environment for contract validation.
  The frontend build argument is `VITE_OFFLINE_LEASE_PUBLIC_KEY`.
- Keep the same key across frontend and backend releases. A key change makes
  existing offline leases unusable until the app verifies online again.

Generate a pair on a trusted operator machine with Python and `cryptography`:

```python
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

private = Ed25519PrivateKey.generate()
seed = private.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
print("OFFLINE_LEASE_ED25519_PRIVATE_KEY:", base64.b64encode(seed).decode())
print("LOCKIN_OFFLINE_LEASE_PUBLIC_KEY:", base64.b64encode(public).decode())
```

Store the first output in the private file and never commit it. The second is
public build metadata. Local development may use the deterministic development
seed derived from `DJANGO_SECRET_KEY`; production refuses a missing seed.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/offline/lease/` | Authenticated lease renewal. 403 when the subscription has ended. |
| `GET /api/v1/offline/manifest/` | Cohort and publication scoped metadata: versions, sizes, checksums, dependencies and protected download paths. Never file bodies. |
| `GET /api/v1/offline/questions/<sheet_id>/?source=exam\|ai-sheet` | One question bank with its answer keys. |
| `GET /api/v1/offline/active-study/<sheet_id>/?edition=university\|lockin` | One edition's complete Active Study: plan, page ranges, every checkpoint question set, the Final Exam, answer keys, pass marks and the student's current server progress. Requires `content.premium` and `focus.workspace`. |
| `GET /api/v1/offline/review/` | The student's own Review Bank, Weekly Recall session, recent mistakes and the answer keys those items already revealed. |
| `POST /api/v1/offline/sync/` | Up to 100 queued operations with the account's signed `lease_token`. |

The offline app is deliberately outside the app-wide subscription gate so a
student whose subscription lapsed can still upload work done under a valid
lease. Each read endpoint therefore applies its own entitlement checks. An
expired lease is accepted for sync for 30 days after it ended; no new lease or
protected content is issued without an active subscription.

### Manifest items

Every item carries `id`, `type`, `subject_id`, `sheet_id`, `edition` (where
relevant), `version`, `updated_at`, `size`, `checksum`, `dependencies`,
`download_url` and `available`. Types:

- `sheet` / `summary`: a PDF in Cache Storage, verified by SHA-256 and size.
- `questions`: a question bank in IndexedDB.
- `active_study`: an Active Study bundle in IndexedDB. It depends on the
  edition's `sheet` item. Its version is a digest of the sheet's published
  version, its Active Study settings (both editions, including page exclusions
  and page counts), its question-bank revisions and the pass marks. Student
  progress is not part of the version, so studying never makes a bundle look
  outdated.

The manifest filter for `active_study` is cheap (enabled settings and at least
one question bank). The bundle endpoint decides real readiness and returns 404
when no difficulty is ready, so such an item never becomes "Available Offline".

### Sync operations

| `operation_type` | Replayed through | Idempotency |
| --- | --- | --- |
| `question_answer` | `apps.questions.answering.answer_question` | receipt + one answer per question |
| `active_study_attempt` | `apps.focus.managed_active_study.replay_offline_attempt` | receipt + the device's attempt ID is the server attempt's primary key |
| `active_study_continue` | `replay_offline_continue` | receipt + part number |
| `active_study_restart` | `replay_offline_restart` | receipt |
| `review_answer` | `apps.review.services.answer_review_item` | receipt + the Review `idempotency_key` |

Receipts are unique per `(user, operation_id)` and store the response. An ID
replayed with different evidence is rejected. Client scores, stages, XP,
timestamps and other claims in a payload are never read.

Each rejection carries `code` (`rejected`, `out_of_order`, `unavailable`,
`invalid`) and `retryable`. A business-rule refusal is permanent; throttling and
temporary unavailability are retryable. Whole-request failures (network, 5xx,
403 for a stale lease) keep every operation.

Active Study replay drives the managed runtime: it starts the run when the
first checkpoint arrives, brings the run to the checkpoint or final stage the
event was recorded at (`study-again`, `complete-reading`, `retry-final`),
replays the answers through `answer()` and submits through `submit()`. Grading,
unlocking, Review Bank events, the `ActiveStudyExamPassed` event (streaks,
achievements) and the once-only completion XP are therefore exactly the online
code paths. An event for a part the server has already completed is accepted
as `superseded`; an event for a later part than the server's is
`out_of_order`.

## Client architecture

All offline data is per account: IndexedDB database `lock-in-offline-v1-<userId>`
and Cache Storage `lock-in-private-offline-v1-<userId>`. Keys:

| Prefix | Content |
| --- | --- |
| `lease`, `profile`, `manifest`, `preferences`, `lastSync`, `syncCursor` | account state |
| `materials`, `question-directory:*`, `review:*`, `review-snapshot` | directories and Review data |
| `download:<item>`, `content:<item>:<checksum>` | download metadata and JSON bundles (one version kept) |
| `operation:<id>`, `queue:sequence` | the durable queue |
| `as-run:<sheet>:<edition>:<difficulty>`, `as-runid:<id>`, `as-completed:*` | Active Study progress |
| `answer:<question>`, `review-answer:<key>` | local answer outcomes awaiting sync |

### Content resolution

`src/offline/resolver.js` is the single online/offline decision point. Every
read goes to the server first; only a network failure (status 0, not an
abort), and only under a valid lease, falls back to the device. 401/403/404
never fall back. `resolveSheet`, `resolveSummary`, `resolveQuestions`,
`resolveActiveStudy`, `resolveCheckpoint`, `resolveFinalExam` and
`resolveReviewData` return the server's response shape either way.

### Active Study

The workspace keeps calling the same `focusApi` managed Active Study methods.
`src/offline/activeStudy.js` sits behind them:

- Online, each response is mirrored into the device's run for downloaded
  sheets, including the open attempt and answers already given, so a
  connection lost mid-checkpoint continues the server's own attempt.
- Offline, it answers from the bundle with the same response shapes and the
  same rules: part ranges, checkpoint/final pass marks, stage transitions,
  answer locking, retake, continue anyway, retry final, discard, restart.
- A run that has unsynced work, or that the server has not seen yet, stays
  local until the queue delivers it, so events never reach the server out of
  order.
- Each submitted checkpoint or Final Exam becomes one immutable
  `active_study_attempt` operation with every answer. Results show
  `xp_awarded: 0` and `pending_sync: true`; the workspace says the result and
  XP are confirmed on reconnect.
- After sync the server's run is adopted. The workspace keeps its run ID; an ID
  map routes later calls to the server's run, and an open workspace refreshes
  its run without moving the reader.

Page ranges come only from the bundle's plan, so inserted workspace pages never
affect Part boundaries, checkpoints or Final Exam unlocking. Reading position,
annotations (sheet + edition + view) and summary state keep their existing
owners.

### Queue

`src/offline/queue.js` holds every durable operation: `operation_id`,
`operation_type`, `entity_type`, `entity_id`, `ordering_key`, `payload`,
`local_created_at`, `client_sequence`, `retry_count`, `sync_status`,
`schema_version`, `next_attempt_at`. Lifecycle: `pending` → `syncing` →
removed on acknowledgement; `retry` with exponential backoff (5 s to 5 min)
for connectivity or retryable refusals; `failed_permanent` for business-rule
refusals, kept with its reason in Settings until dismissed. A retryable failure
holds back later work with the same ordering key. Operation records and the
local state they change are written in one IndexedDB transaction.

### Review

Review Bank and Weekly Recall answers try the server first. On a network
failure they are graded against the snapshot's answer keys, applied to the
snapshot (a correct answer leaves the active bank; Weekly Recall progress and
completion update) and queued with the idempotency key the online request used.
Starting a new Weekly Recall set needs a connection because the server chooses
it. Weekly Recall answers are accepted only for the session already started.

### Focus Workspace

Focus persistence is unchanged: the device store is authoritative and
`createCatalogServerSync` mirrors it with its three-way merge. Each local save
records one `focus_document_sync` operation per document (identifiers only).
A successful push acknowledges it. On reconnect the coordinator replays any
document that is not open by reading the Focus store, merging with the server
exactly as the workspace does, writing merged changes back and pushing. An open
workspace keeps ownership of its own document. Device-only content (inserted
images, pre-UUID marks) remains device-only as before, so there is no binary
upload queue.

### Synchronisation order

`synchronizeOffline` runs in the foreground on app open, resume, focus,
regained connectivity, new queued work and "Sync now":

1. renew the lease (validates session and entitlement);
2. flush the queue (Focus documents, answers, Active Study, Review);
3. adopt authoritative Active Study runs for acknowledged work;
4. stop here if the lease could not be renewed: pending work has uploaded with
   the last lease, and no protected content is refreshed;
5. refresh directories, the Review snapshot (only when no Review answer is
   pending) and the manifest;
6. with Automatic Downloads on, download new or changed opted-in content;
   unchanged items are skipped by version and checksum and a changed bundle
   refetches only its changed parts;
7. record `lastSync` and `syncCursor`, publish `synced` or `partial`.

Automatic triggers are throttled to one run per minute, with 15 s / 60 s / 5 min
backoff after failures. A regained connection, new queued work or "Sync now"
always runs.

### Downloads and Settings

`downloadOfflineItem` resolves an item's dependency graph and downloads
dependencies first. Each part is verified and stored on its own, so a retry
fetches only what is missing. `offlineItemState` reports `downloaded`, `update`
(an older version is stored and still usable), `incomplete` (part of the graph
is stored; not offline ready) or `download`. "Available Offline" appears only
for `downloaded`.

Settings shows offline access, last verified, remaining lease, last sync,
pending changes, refused changes with reasons, storage used, Automatic
Downloads and its content types (Sheets, Summaries, Active Study, Questions),
and Manage Downloads grouped Subject → Sheet → Edition. Actions: download a
subject, a University or Lockin edition (PDF, Active Study, summary and question
banks), questions, summary or Active Study alone, remove an item, sheet or
subject, and clear all. Removing downloads never deletes progress or pending
work on the device or anything on the server.

## Security

- Every protected offline read checks the lease: route guard, PDF blobs,
  question banks, Active Study bundle and every local Active Study and Review
  action. `ProtectedRoute` re-checks on every navigation (deep links, history),
  on resume and visibility, every 30 s, and exactly at lease expiry.
- Clock handling: the device records its own time at verification and the
  amount its clock trails the server; that offset is charged against expiry,
  so a slow clock gains no hours but still works. A backwards jump of more than
  five minutes against the device's own last reading locks protected content
  (`clock_rollback`) until online verification. Within one page lifetime a
  monotonic timer prevents winding the clock back.
- Isolation: each account has its own database and cache. Signing out or
  switching accounts removes that account's lease, profile, manifest,
  directories, Review snapshot and every protected download immediately. Its
  unsynced operations and the progress they belong to stay in its own
  database and sync the next time that account signs in; no other account ever
  opens it.
- The service worker precaches build-hashed app code and public assets only,
  never caches `/api/` responses, never touches the private download caches,
  and uses `cleanupOutdatedCaches` plus the prompt-based `SKIP_WAITING` update.
  Old chunks stay precached until the new worker activates, so an update
  cannot strand the reader on missing chunks.

## PostgreSQL

This continuation adds no models or migrations. The existing
`offline.0001_initial` (receipt table with a unique `(user, operation_id)`
constraint and a `(user, -created_at)` index) is standard SQL. Replay relies on
PostgreSQL row locks that SQLite ignores:

- `User.objects.select_for_update()` serialises one account's sync batches;
- `ActiveStudyAttempt ... select_for_update(of=("self",))` locks only the
  attempt row (the join to its run must not be locked);
- the partial unique index on active runs decides concurrent starts.

Local runs used SQLite (`LOCKIN_TEST_USE_SQLITE=1`); the local PostgreSQL
service does not accept the repository credentials, so PostgreSQL was **not**
run locally. Validate in CI's PostgreSQL job (or a production-like database):

- `apps/offline/tests/test_active_study_offline.py::test_concurrent_uploads_of_one_offline_attempt_grade_and_reward_once`
- `apps/offline/tests/test_active_study_offline.py::test_offline_attempt_lookup_locks_only_the_attempt_row`
- the whole `apps/offline`, `apps/focus` and `apps/review` suites.

## iOS and PWA

iOS does not run a closed PWA in the background. Every sync is foreground:
open, resume, focus, reconnect. Browsers without Ed25519 in WebCrypto (older
iOS) cannot verify a lease and therefore cannot unlock offline content; online
study is unaffected. Automated tests cover the logic with an in-memory
IndexedDB/Cache Storage and the Chromium Playwright suite; **no real iPhone was
tested for this release.** Run this checklist on a physical iPhone (and an iPad)
before announcing Offline Mode:

1. In Safari, open Lock-in, sign in, Share → Add to Home Screen; launch the PWA.
2. Settings → Offline Mode shows "Offline access available" and a remaining
   time under 24 h (or the subscription end if sooner).
3. Materials → a sheet → tap "Download for Offline" for the University edition.
   It shows a percentage, then "✓ Available Offline". Repeat for the Lockin
   edition if it has Active Study.
4. Force-close the PWA; reopen it. Downloads still show as available.
5. Enable Airplane Mode. Reopen the PWA from the Home Screen.
6. Open the downloaded sheet: the PDF renders; Normal Study works.
7. Choose Active Study → a difficulty. It starts at page 1 (first time) and the
   quiz does not open by itself.
8. Read to the end of Part 1, use the dock button, answer the checkpoint with
   Previous/Next, see explanations, submit, pass. Part 2 unlocks, earlier pages
   remain, the reader does not jump to page 1, later parts stay locked.
9. Lock the phone for a minute and unlock; force-close and reopen offline.
   Active Study resumes at the same Part with the same progress.
10. Fail a checkpoint once; try both Retake and Continue anyway on different
    parts. Finish all parts and the Final Exam (fail once, retry, pass).
11. Answer downloaded normal Questions; draw, highlight, add text, a sticky
    note, an inserted page and an image in Focus; answer a Review Bank item.
12. Force-close and reopen offline: all of the above is still present.
    Settings shows pending changes.
13. Disable Airplane Mode and bring the PWA to the foreground. Without tapping
    anything, pending changes drop to 0 and "Last content check" updates.
14. Online, the Active Study progress, completion, XP (once), Review Bank and
    Focus marks match on another device. Syncing again changes nothing.
15. Settings → remaining time renewed to about 24 h.
16. Lease expiry: stay offline past the remaining time (or set it short on a
    staging key); protected pages show "Offline access expired" and data is
    kept. Reconnect and verify: access returns.
17. Clock rollback: offline, set the device clock back a day; protected pages
    lock with the clock message. Restore the clock and reconnect: they unlock.
18. Sign out while offline, sign in as another account: none of the first
    account's downloads appear. Sign back in as the first account online: its
    pending work syncs.
19. Deploy a new build: the update prompt appears; after updating, the app
    boots offline with the new version and downloads are intact.

## Known limitations

- Starting a new Weekly Recall set, abandoning a run, admin screens, payments
  and account changes need a connection.
- Inserted Focus images remain device-only (unchanged product behavior).
- A run restarted on another device while this device worked offline makes the
  offline events arrive `out_of_order`; they are kept in Settings as refused
  changes and the server's progress is shown.
- Background sync while the PWA is fully closed is not possible on iOS.
