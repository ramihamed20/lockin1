import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("production edge preserves trusted client identity without logging credentials", async () => {
  const [nginx, server, cloudflare, dockerfile] = await Promise.all([
    readFile(new URL("../nginx/nginx.conf", import.meta.url), "utf8"),
    readFile(new URL("../nginx/default.conf", import.meta.url), "utf8"),
    readFile(new URL("../nginx/cloudflare-real-ip.conf", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8")
  ]);

  assert.match(nginx, /\$request_method \$uri \$server_protocol/);
  assert.doesNotMatch(nginx, /"\$request"/);
  assert.doesNotMatch(nginx, /\$http_x_forwarded_for/);
  assert.match(cloudflare, /real_ip_header CF-Connecting-IP;/);
  assert.match(cloudflare, /set_real_ip_from 173\.245\.48\.0\/20;/);
  assert.match(cloudflare, /set_real_ip_from 2a06:98c0::\/29;/);
  assert.match(dockerfile, /cloudflare-real-ip\.conf/);
  assert.match(server, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(server, /proxy_request_buffering off;/);
});

test("private file responses stream instead of buffering into the edge tmpfs", async () => {
  const server = await readFile(new URL("../nginx/default.conf", import.meta.url), "utf8");

  // Responses reach 50 MB for a PDF and 90 MB for audio. Buffering would spool
  // a whole response into proxy_temp_path, which is the container's small
  // in-memory /tmp, so a slow client could exhaust host memory outright.
  assert.match(server, /proxy_buffering off;/);
  // A large download must outlive the default 60s upstream read timeout.
  assert.match(server, /proxy_read_timeout 300s;/);
});

test("the deployment fits a 4 GB host and states its scanning decision", async () => {
  const [compose, environment] = await Promise.all([
    readFile(new URL("../../compose.production.yaml", import.meta.url), "utf8"),
    readFile(new URL("../../.env.production.example", import.meta.url), "utf8")
  ]);

  // Unbounded container logs are the fastest way to fill the deployment disk.
  assert.match(compose, /max-size: "10m"/);
  assert.match(compose, /max-file: "3"/);
  // PostgreSQL parallel workers fail on Docker's 64 MB default shared memory.
  assert.match(compose, /shm_size: 256mb/);
  // Explicit ceilings keep a runaway process from making the kernel choose the
  // OOM victim, which on this host is as likely to be PostgreSQL as the culprit.
  assert.match(compose, /mem_limit: 1536m/);
  // The scanner is intact but opt-in, so the launch shape never starts it.
  assert.match(compose, /profiles: \["file-scanning"\]/);
  // Whether scan evidence is required has no default: each deployment states it.
  assert.match(compose, /CONTENT_REQUIRE_CLEAN_SCAN:\s*\$\{CONTENT_REQUIRE_CLEAN_SCAN:\?/);
  assert.match(environment, /^CONTENT_REQUIRE_CLEAN_SCAN=false$/m);
  // Streamed downloads hold a thread for the whole transfer, so threads are
  // sized for concurrent readers rather than for CPU.
  assert.match(environment, /^GUNICORN_THREADS=8$/m);
});

test("production edge exposes minimal health and keeps uploads and admin fail closed", async () => {
  const [server, compose, scanner, environment, backup] = await Promise.all([
    readFile(new URL("../nginx/default.conf", import.meta.url), "utf8"),
    readFile(new URL("../../compose.production.yaml", import.meta.url), "utf8"),
    readFile(new URL("../../deploy/clamav/Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../../.env.production.example", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/production/backup-postgres.sh", import.meta.url), "utf8")
  ]);

  assert.match(server, /location = \/healthz/);
  assert.match(server, /\{"status":"alive"\}/);
  assert.match(server, /client_max_body_size 92m;/);
  assert.match(server, /location \^~ \/admin\/\s*\{\s*return 404;/);
  assert.match(compose, /CONTENT_MAX_AUDIO_BYTES:-94371840/);
  assert.match(compose, /context: \.\/deploy\/clamav/);
  assert.match(scanner, /StreamMaxLength 100M/);
  assert.match(scanner, /MaxFileSize 100M/);
  assert.match(environment, /LOCKIN_PUBLIC_HOST=lockin\.ly/);
  assert.match(environment, /BACKUP_RETENTION_DAYS=30/);
  assert.match(backup, /find "\$output_dir" -maxdepth 1 -type f -name 'lockin-\*\.dump'/);
});
