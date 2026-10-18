# Local performance reproduction

These scripts use synthetic accounts/catalogs/annotations and actual local HTTP PDF fixtures. They reject non-loopback benchmark URLs. Run from `frontend/`. Preserve reports and frozen build directories; never point a lab server at production.

## Freeze and serve an ordinary artifact

Choose a new output directory, verify it does not exist, and clear `LOCKIN_E2E_CATALOG`. Build with Vite `--outDir=output/performance/<new-name> --emptyOutDir=false`. Ordinary builds must never use `scripts/build-e2e.mjs` or its catalog/offline test key.

PowerShell serving example for the accepted source20 artifact:

```powershell
$env:HOST='127.0.0.1'
$env:PORT='4229'
$env:LOCKIN_TEST_DIST='output/performance/stationary-eraser-fixed-dist'
$env:LOCKIN_PERFORMANCE_GZIP='1'
$env:LOCKIN_PERFORMANCE_API='1'
node scripts/serve-dist.mjs
```

The final two flags enable local synthetic API responses and production-like public asset gzip/cache behavior. They are lab flags only. `serve-production-benchmark.mjs` builds a mutable scratch artifact; freeze a separate copy before using it as a retained baseline.

## Measure complete scenarios

From another terminal, after builds and browser suites finish:

```powershell
node scripts/performance-overhaul.mjs --url=http://127.0.0.1:4229 --artifactRoot=output/performance/stationary-eraser-fixed-dist --build=ordinary-frozen-source20 --scenario=eraser --strokes=1000 --cpu=4 --runs=6 --isolateBrowsers=1 --scratch=1 --output=output/performance/source20-eraser-independent.json
node scripts/performance-summary.mjs output/performance/source20-eraser-independent.json
```

`--isolateBrowsers=1` starts each cold sample in a new browser process. Warm route/tab/cycle steps within that sample stay in its browser. The default keeps historical behavior; the option is explicitly recorded in report metadata. Minimum3/maximum20 runs and existing model/history/preservation assertions remain unchanged. Runtime validation PASS: source21 ordinary PDF smoke3 independent browser samples. Current source20/source21 ABBA12 also passes all original model/history assertions; no heavy tests/builds/profiles overlapped timing. See the release-readiness report for observed gains and regressions.

Other existing options: `--scenario=tabs --tabSet=heavy --drawTabs=1 --cycles=3 --heapSample=1`; `--scenario=pdf --pdf=long-probe --network=mobile`; `--engine=webkit` without CDP mobile/heap flags. Use a unique report filename per workload and variant. The script prints its actual fixture, engine, viewport, CPU/network policy and index SHA. Inspect errors and preservation checks before summarizing speed.

## Compare fairly

Use identical fixtures, device/CPU/network settings, transport content encoding/cache headers and workload counts. Verify HTTP build SHA against each frozen artifact. Interleave variants as ABBA repeated3× for six independent samples each. Do not overlap builds, tests, profiles or other benchmarks. Keep partial/failed attempts; do not silently pool mismatched transport or environment samples.

Raw outputs under ignored `output/performance/` are local evidence, not product assets. Existing scripts `performance-navigation.mjs`, `performance-delivery.mjs`, `performance-public-cache.mjs` and `performance-summary.mjs` cover routes, asset delivery, public origin/offline behavior and summaries. Preserve their workload assertions. Native regressions cover scope/pixels, storage owners, history and workflow behavior separately from timings.

Synthetic per-rAF pen events are not physical Pencil latency or INP. Canvas pixel bytes are not process/GPU memory. Two-rAF commit observation is not first-pixel paint or durable-save time. Windows software Chromium/WebKit does not establish physical iOS/Android performance or Linux container/Cloudflare behavior. Current release verdict and accepted/rejected evidence are in `PERFORMANCE_RELEASE_READINESS.md` and `PERFORMANCE_OVERHAUL.md`.

## Validate public PWA bytes on a frozen ordinary build

The public-cache tool now accepts a frozen `--artifactRoot` only together with its exact `--indexSha256`. Default invocation still uses the original Nginx-lab metadata. Optional `--extraAssets` contains public asset filenames, never paths, private records or leases. This removes repeated ignored copies that changed only the artifact root/digest.

```powershell
node scripts/performance-public-cache.mjs --engine=chromium --artifactRoot=output/performance/startup-sync-final-dist --indexSha256=dfea78da777c1cdd0ae358ec4d9a971b6334f4f1765925a5c60952b004fc5f67 --extraAssets=activeStudy-CAFgug1L.js,focus-C4uG8_HC.js --output=output/performance/source22-final-public-cache-chromium.json
node scripts/performance-public-cache.mjs --engine=webkit --artifactRoot=output/performance/startup-sync-final-dist --indexSha256=dfea78da777c1cdd0ae358ec4d9a971b6334f4f1765925a5c60952b004fc5f67 --extraAssets=activeStudy-CAFgug1L.js,focus-C4uG8_HC.js --output=output/performance/source22-final-public-cache-webkit.json
```

Use the chosen build's real digest/filenames and unique outputs. Source22 final validation: **20/20 exact public-asset checks per engine**, compressed/uncompressed and connected/disconnected, including both deferred modules. Incorrect index digest is rejected before launching a browser. Tool syntax and targeted ESLint pass. This proves public code cache integrity on local Node HTTP, not lease availability, private API cache safety, physical Safari or new Nginx timing.

## Measure owned Windows browser processes

PowerShell7 (`pwsh.exe`) must be available on PATH. The optional sampler requires Windows Chromium and at least two tab close cycles; it stays disabled by default. For the frozen source22 ordinary artifact served on4236:

```powershell
node scripts/performance-overhaul.mjs --url=http://127.0.0.1:4236 --artifactRoot=output/performance/startup-sync-final-dist --build=ordinary-frozen-source22 --scenario=tabs --tabSet=heavy --drawTabs=1 --cycles=8 --heapSample=1 --processMemory=1 --cpu=1 --runs=3 --isolateBrowsers=1 --output=output/performance/heavy-native-memory.json
```

Use a unique output, and repeat with `--tabSet=standard` for text fixtures. The script reads only validated numeric process IDs from that browser's CDP process inventory. Private bytes measure commitment, not live JavaScript or GPU VRAM; summed working set can double count shared pages. Close-cycle heap samples follow explicit main-thread GC and4.5s settling; worker/native GC is not forced. These diagnostic measurements incur collection/subprocess overhead and must not be pooled with latency benchmarks. Preserve each PID/type, all cycle observations, frozen artifact SHA and exact annotation checks. Rising commitment requires attribution before claiming leak or stability; stable Canvas/DOM counts alone do not pass the memory gate. Report dirtyFiles includes staged plus unstaged changes against HEAD.

### Control DevTools response-body copies during native sampling

With --processMemory=1 the maintained script now caps DevTools Network response-body capture to1byte on every owned Playwright Network agent, including its optional mobile CDP session. Actual HTTP/PDF bytes, request interception, application caches, rendering quality and preservation assertions remain unchanged. The benchmark does not retrieve response.body() through DevTools; that diagnostic body retrieval is unavailable under this policy. Timing mode without native sampling keeps the original capture behavior.

The correction resolves the installed transitive Playwright adapter through package-relative resolution, requires the inspected version1.58.2, changes only the running diagnostic process, and refuses to sample if no agents were configured. A dependency upgrade requires re-inspecting the adapter and rerunning the controls before accepting memory results; no installed SDK files are edited. The report records nativeMemoryNetworkCapture with SDK version,1byte budget and agent count.

Current maintained runtime proof: source24-maintained-memory-sampler.json,3 fresh browsers x2 heavy cycles,18 exact preservation checks,30 configured agents,zero errors and the final ordinary index SHA. Full source24 product diagnostic:3 x8 cycles/108 preservation checks,all24 Canvas counters35.85MiB and allocated-object counters8.32-8.39MiB; total private commitment still warms16.94-18.31MiB. Stable live counters do not establish a long-session commitment plateau or physical-device memory gate. Uncapped source23 reports remain historical instrumentation-retention evidence; do not compare them as a product leak fix or latency improvement.

## Reproduce Dashboard request cancellation

Serve the ordinary source25 dashboard-cancel-dist artifact with the same loopback/synthetic API flags above, on4237. Set PLAYWRIGHT_EXTERNAL_SERVER=1 and PLAYWRIGHT_BASE_URL=http://127.0.0.1:4237. Run pnpm exec playwright test --config=playwright.production.config.js production-e2e/dashboard-pending.spec.js --grep "leaving Dashboard" --workers=1. Repeat with PLAYWRIGHT_PRODUCTION_WEBKIT=1, then clear that flag for Chromium. The case holds five private reads, navigates away, checks both signal aborts and native transport cancellations, then navigates back and checks fresh values. On frozen source22 it fails0/5 cancellations; on source25 both engines pass5/5. This is a deterministic wasted-work regression, not a latency benchmark.

## Reproduce material-directory scope transitions

The maintained production-e2e/catalog-scope.spec.js uses actual React and the current real hook in a synthetic component harness compiled with the existing Vite build API. It does not change student accounts or depend on an E2E catalog artifact. Serve a loopback ordinary artifact, set PLAYWRIGHT_EXTERNAL_SERVER=1 and PLAYWRIGHT_BASE_URL to that server, then run pnpm exec playwright test --config=playwright.production.config.js production-e2e/catalog-scope.spec.js --workers=1 --repeat-each=3. Repeat with PLAYWRIGHT_PRODUCTION_WEBKIT=1. It holds the second directory response, records committed hook outputs through useLayoutEffect, and checks both isolation and an immediately resolved cached return without a third request. This proves component state ownership, not physical-device paint latency or an entire authenticated-session transition.
