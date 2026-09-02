# Phase 1 hosting decision

Last updated: 2026-09-02

> **Superseded for the initial launch.** This analysis assumes malware scanning
> is mandatory, which is what makes ClamAV — and therefore 8 GB — load-bearing in
> everything below. The launch runs with `CONTENT_REQUIRE_CLEAN_SCAN=false` and
> no scanner, because managed-file uploads are restricted to trusted
> administrators; see "Malware scanning" in `docs/DEPLOYMENT.md`. Without ClamAV
> the whole deployment fits a **2 vCPU / 4 GB / 40 GB VPS**.
>
> Everything below stays the reference for the day scanning is enabled, which is
> the day the memory budget changes and the hosting question reopens.

## Recommendation

**Deploy Phase 1 on the VPS directly**, keeping Supabase for PostgreSQL and
Cloudflare R2 for files if you want managed data services at the start.

**If a managed container host is required, choose Fly.io.** It is the only one of
the three that runs the complete architecture at a cost comparable to the VPS.

This reverses the earlier working assumption that a managed container host would
be cheaper and simpler for Phase 1. The reason is ClamAV, which the security
requirements keep mandatory. It is the largest memory consumer in the whole
system — larger than the application — and it must run continuously, privately,
with a persistent volume. Once it is priced in, managed hosting costs more than
the VPS and delivers less control, while adding a migration you would have to do
later anyway.

## What actually constrains the choice

Most requirements are satisfied by all four options and therefore do not
discriminate: a single same-origin image (SPA + Django + nginx), session cookies,
Supabase over TLS, R2 over HTTPS, and streamed private file delivery all work
anywhere that runs a Docker image. The constraints that separate the options are:

| Constraint | Why it is hard | Source |
| --- | --- | --- |
| ClamAV needs ~1.6 GB resident, ~2.4 GB during the daily reload; upstream recommends 3–4 GiB | It is a paid 4 GB instance on any managed host | [ClamAV docs](https://docs.clamav.net/) |
| ClamAV must be private with a persistent volume | clamd has no authentication at all; anything that reaches TCP 3310 can submit files and read verdicts | this repo, `deploy/clamav` |
| StatsD is UDP | Rules out any private network that is HTTP-only | `platform_core/observability/providers.py` |
| Two always-on worker processes | Each is a separately billed service on a managed host | `compose.production.yaml` |
| 50 MB PDF and 90 MB audio uploads, streamed downloads with byte ranges | Rules out serverless request/response limits | `apps/files` |
| The deployment must move to a VPS later without code changes | Favours whatever is closest to plain Docker Compose | your Phase 2 requirement |

Note the shape of that list: four of the six constraints are ClamAV or its
consequences.

## Assessment

### VPS directly — recommended

Runs the complete architecture exactly as designed, from a
`compose.production.yaml` that is already written, reviewed, and validated in CI.
ClamAV is a Compose service on an `internal: true` network with no published
port. StatsD is a container on the same network. The workers are two more
services. Nothing is exposed except 80 and 443, and those are restricted to
Cloudflare ranges by the host firewall.

Cost is one flat machine price, and the Phase 2 migration cost is zero, because
you are already there.

**The one thing to watch:** on 8 GB, a 4 GB ClamAV limit alongside a self-hosted
PostgreSQL, Gunicorn, two workers and nginx is tight. Two ways to resolve it, and
either is fine:

- Keep PostgreSQL on Supabase for now (drop `COMPOSE_PROFILES=bundled-db`), which
  leaves ClamAV comfortable on 8 GB; or
- self-host PostgreSQL and build ClamAV with `CLAMAV_CONCURRENT_RELOAD=false`,
  which halves its peak at the cost of blocking scans during the daily reload.

### Fly.io — recommended if a managed host is required

Runs the full architecture. Machines run your Docker image directly; 6PN private
networking carries both the TCP that ClamAV needs and the
[UDP that StatsD needs](https://fly.io/docs/networking/udp-and-tcp/); a Machine
with no public IP is genuinely private; volumes cover the signature database.

Approximate monthly cost, from
[Fly's pricing](https://fly.io/docs/about/pricing/) (shared CPU, Amsterdam,
September 2026): web 1–2 GB ≈ $5.70–10.70, ClamAV 4 GB ≈ $21.40, two workers at
512 MB–1 GB ≈ $6–11, a 2 GB volume ≈ $0.30. **Roughly $40–45/month.**

The trade-off is that Fly's model is Machines and `fly.toml`, not Compose, so the
Phase 2 migration means re-expressing the deployment. The image and the entry
point carry over unchanged; the orchestration does not.

One caveat if you later self-host the StatsD collector on Fly: a service that
*receives* UDP must bind to `fly-global-services`, not `0.0.0.0`. This does not
affect the application, which only sends.

### Render — works, but roughly three times the price

Technically capable. Private services are reachable only from inside the
workspace, and Render's private network explicitly supports
[any protocol on almost any port](https://render.com/docs/private-network), so
both ClamAV's TCP and StatsD's UDP are fine. Background workers and persistent
disks exist. Developer experience is the best of the three.

The problem is per-service billing against ClamAV's memory. From current
[pricing summaries](https://kuberns.com/blogs/render-pricing/) (September 2026),
Standard is $25/month for 2 GB and Pro is $80/month for 4 GB, per service, plus
disks and a workspace fee. ClamAV needs the Pro tier; add the web service and two
workers and the realistic total is **$120–160/month** — three to four times Fly,
for the same architecture.

Running ClamAV on Render's 2 GB Standard tier to save money is not a real option:
it sits under the reload peak, so the scanner would be killed during the daily
signature update, and file delivery would close until it recovered.

### Railway — not recommended for this shape

Railway can run containers with private networking, but its usage-based pricing
is worst-suited to exactly what this architecture needs: a memory-heavy service
that is idle almost all the time and must never stop. It is also the most
proprietary of the three in how services and networking are described, which
makes it the furthest from the Compose deployment you are migrating toward. If
you want managed hosting, Fly.io dominates it on every criterion that matters
here.

## Against your stated priorities

| Priority | VPS | Fly.io | Render | Railway |
| --- | --- | --- | --- | --- |
| 1. Security | Full control; nothing published but 80/443, restricted to Cloudflare | Private Machines, no public IP | Private services | Private networking, least mature |
| 2. Runs the complete architecture | Yes, as designed | Yes | Yes | Yes, awkwardly |
| 3. Low cost | One flat machine | ~$40–45/mo | ~$120–160/mo | Usage-based, poor fit |
| 4. Easy migration to VPS later | Already there | Re-express as Compose | Re-express as Compose | Largest rewrite |
| 5. Minimal change to the Docker architecture | None | Same image, new orchestration | Same image, new orchestration | Same image, new orchestration |

## What to verify before committing

Provider capabilities and prices change, and the figures above were gathered in
September 2026. Before you commit money, confirm:

1. The current price of a 4 GB always-on instance with a persistent disk on your
   chosen host.
2. That a private service really is unreachable from the public internet — test
   it, do not infer it from the dashboard.
3. That UDP reaches your StatsD collector from the application service.
4. That an upload of your largest real file (90 MB audio) survives the host's
   proxy, on top of Cloudflare's 100 MB request ceiling on the Free plan.

## Sources

- [ClamAV documentation](https://docs.clamav.net/) — memory requirements and
  concurrent database reload.
- [Render private network](https://render.com/docs/private-network) — protocol
  and port support between services.
- [Render private services](https://render.com/docs/private-services) — private
  services are not reachable from the public internet.
- [Render pricing summary](https://kuberns.com/blogs/render-pricing/) — instance
  tiers and per-service billing.
- [Fly.io pricing](https://fly.io/docs/about/pricing/) — Machine and volume
  pricing.
- [Fly.io UDP and TCP](https://fly.io/docs/networking/udp-and-tcp/) — UDP over
  private networking and the `fly-global-services` binding requirement.
- [Fly.io private networking](https://fly.io/docs/networking/private-networking/)
  — 6PN organisation-scoped addressing.
