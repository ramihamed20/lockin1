# Local Demo Data

`seed_demo` is a development/testing-only Django command. It refuses to run when
`ENVIRONMENT=production` or `DEBUG=False`; it does not alter production settings, security,
or application authorization rules.

## Create or refresh data

After migrations, from `backend/` run:

```powershell
python manage.py seed_demo
```

The command is idempotent: rerunning it updates the same local accounts and records instead of
creating duplicates. It seeds a learning hierarchy, published PDF learning objects, question bank,
quizzes, progress/review queues, Focus data, contextual community/moderation examples, motivation,
notifications, and a demo product/subscription/entitlement.

## Credentials

| Account | Email | Password |
| --- | --- | --- |
| Super Admin | `admin@lockin.local` | `Admin123!` |
| Developer staff | `developer@lockin.local` | `Dev123!` |
| Content Creator | `creator@lockin.local` | `Creator123!` |
| Primary Student | `student@lockin.local` | `Student123!` |
| Additional students | `student1@lockin.local` through `student5@lockin.local` | `Student123!` |

The administrator is a Django superuser plus Lock-in administrator. The developer is staff but is
not granted an operational administrator role; no separate debug/log page currently exists. The
creator has only creator scope in the demo dentistry hierarchy and is not staff.

## Reset a dedicated local database

This is destructive and must only be used against an isolated local database:

```powershell
python manage.py flush --noinput
python manage.py migrate
python manage.py seed_demo
```

There is no flashcard domain or reaction model in the current implementation. The seeded question
review queue provides the implemented spaced-review experience; this command does not invent
unimplemented production features.
