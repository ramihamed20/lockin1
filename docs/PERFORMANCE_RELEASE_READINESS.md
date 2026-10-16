# Performance release readiness

Verdict: **NOT READY — STOPPED AT OWNER REQUEST**. Final Arabic handoff: [PERFORMANCE_HANDOFF_AR.md](PERFORMANCE_HANDOFF_AR.md). Updated 2026-10-12 after attribution of DevTools response-body retention. The earlier delivery was a checkpoint, not completion of the original objective.

Latest checkpoint: **source26 materials-scope isolation +source25 read cancellation +source24 reader-memory diagnostics**. Latest evidence:631/631 Node cases, full lint/types/ordinary build PASS; ordinary browser12/12 per engine, direct scope6/6 per engine and5 adjacent reader cases PASS. Historical source22 evidence: Chromium full545 PASS/35 existing SKIP/4 FAIL followed by unchanged quiet12/12 PASS; WebKit affected family11/11 PASS; PostgreSQL reference1052 PASS/1 missing-template harness FAIL followed by1/1 PASS,86.27% coverage. The original backend remains1026 PASS/27 FAIL due pre-existing unreadable commands. Source24 attributes the previous large native-buffer growth to DevTools response-body copies. Live PDF/Canvas counters stay stable through eight corrected heavy cycles, while total private commitment still rises 16.94-18.31MiB; long-session memory remains unqualified. Dense software-renderer stalls remain far above the intended budget. CI/physical-device release gates remain unverified.

Branch: `codex/lockin0.1.3`; HEAD: `7f2b984627507e0d487b80ba74ca65e9daa85329`. All work is local and uncommitted;83 task files are staged for final review,with a saved binary patch and digest manifest under ignored output/performance/. No push, merge, deployment, production load, private student content or live payment changes. Pre-existing `.claude/launch.json`, unreadable/missing payment commands and SQLite backup are preserved.

Current source22 contains16 previously accepted local changes plus the source21 mask-scope correction and a small startup-import deferral with a cold-replay adoption guard. Source22 functional validation is recorded with first-run failures and passing follow-ups disclosed below. Source24 corrects response-body retention in native measurement; eight-cycle live-buffer stability is observed, but total commitment and physical-device release certification remain pending. The new event-driven scroll-lock correction passes direct and adjacent native validation. Rejected per-stroke Canvas isolation (source17–17.3) was surgically removed after its dense performance regressed; its implementation and tests are archived in ignored `frontend/output/performance/delivery-accepted14/`. The feature-level mask-scope regression remains enabled. Frozen source20 fails it; current source21 passes the affected Chromium workflows, direct WebKit cases, final hidden-tab lifetime/history checks and quiet ABBA12 timing qualification, with regressions disclosed below. The candidate uses temporary SVG defs/attributes without moving React-owned nodes, with isolated raster fallback for fragmentation.

Detailed chronological evidence: [PERFORMANCE_OVERHAUL.md](PERFORMANCE_OVERHAUL.md). Raw synthetic reports, traces, frozen builds and rejected experiments are under ignored `frontend/output/performance/` and `.tools/`.

## Source26 material-directory ownership at React commits

Confirmed component defect: useCatalogMaterials kept the previously resolved list when its user/cohort props changed, until a passive effect started the next request. An actual React/hook harness records every commit and holds the new-scope request. Both account and cohort transitions reproduce previous-scope material exposure on source25: **2/2 regression cases FAIL** at the isolation assertion. This is a component reproduction, not a claimed backend permission bypass or full real-user session-transition measurement.

The hook now tags state with the existing owner/cohort cache key and derives its returned result from the current key during render. If the new key is pending it returns an empty pending list; if that key is already warm it returns the correct cached list immediately. Loading/resolution/error updates carry the requested key. Shared caching, manual reload, stale-result key guards, REST/error envelopes, fixture separation, document permissions and offline lease rules are preserved. No stored-key, schema or server mutation is introduced.

Both scenarios repeated3 times per engine: **6/6 Chromium and6/6 WebKit PASS**, with no previous-scope materials at any recorded commit. The return trip makes exactly2 material requests for2 distinct scopes; returning to the first scope causes **0 loading commits and0 extra requests**. This removes incorrect data/loading frames without an aggregate latency claim. Native harness bundles the current real source with React using the existing Vite API, uses only localhost and synthetic directories, and is maintained as production-e2e/catalog-scope.spec.js.

Current validation: **631/631 Node**,38 selected catalog/sync/offline cases, full lint and both TypeScript projects PASS. Both frozen ordinary/E2E builds and unchanged entry budgets PASS: JS227.6KiB/CSS87.4KiB gzip. Ordinary suite **12/12 per engine PASS**, including scope, directory failure/Retry, bootstrap/privileged-request guards, Dashboard cancellation, Arabic phone keyboard/RTL and tablet overflow. Five adjacent Chromium reader cases PASS: protected PDF opens, cross-device ink, reconnect under the original key, summary/edition separation and tab state. These are functional runs, not timing benchmarks. Broader first-run failures and unavailable physical/CI/original-backend gates remain as previously disclosed.

Frozen ordinary index SHA `17ff2003409ff8fb7f63ec41759e7db5843ac77d3a0bae3bebc640e596c37506`, artifact catalog-scope-dist on local4238. E2E index SHA `69f47294823d82911a058630c3b24a6aa392483ccb7dbd805ce715d4409c076f`, artifact catalog-scope-e2e-dist on local4239; the latter compiles synthetic catalog/lease fixtures and must never deploy. Raw logs and source26-materials-scope-summary.json remain under ignored output/performance/. Earlier native-memory evidence belongs to the source22 artifact, not these new builds.

Delivery now has **20 accepted product changes in81 task files**. Dense-ink investigation stays deferred at the owner's request. Release remains NOT READY while device/long-session memory, dense-ink budgets, Linux CI and the original unreadable backend directory remain outstanding. Rollback this stage by restoring only useCatalogMaterials.js from the preceding source25 review patch; keep regression coverage, unrelated user edits and stored student work intact.

## Source25 navigation improvement — cancel abandoned Dashboard reads

Dashboard discarded results on unmount but did not pass the existing AbortSignal to its five private read adapters: account dashboard, learning dashboard, review queue, Review Bank and XP. On the frozen source22 ordinary artifact the new regression observes **0/5 cancellations** after navigating to Materials. The corrected Dashboard passes the signal through optional, backwards-compatible adapter options. Its streak request retains the existing shared lifetime with the live shell. HTTP methods, URLs, response/error shapes, credentials and lease fallback rules stay unchanged; writes are outside this change.

On the new ordinary artifact, the same workflow observes **5/5 aborted signals and5/5 native cancelled HTTP transports**, then returns through the actual SPA navigation and renders fresh XP/Bank/review values. This removes abandoned client transfers; it does not guarantee that server processing already started is cancelled. No whole-site or navigation latency percentage is claimed.

Validation: **631/631 Node cases**,0 failures/skips; full ESLint max-warnings0, both TypeScript projects, ordinary build and unchanged bundle budgets PASS. Ordinary browser cases **10/10 per engine**: Chromium7 Dashboard +3 adjacent bootstrap/catalog cases; WebKit10 total. Pending data, truthful errors/Retry, keyboard navigation, Arabic phone RTL and English tablet overflow checks pass. The unit regression also verifies all five adapters return the existing aborted error rather than an offline fallback.

Ordinary index SHA: `aec37d533e316fa1b94438452740a890d8d853b7bd9b413678c8a4ab4418308c`; artifact frontend/output/performance/dashboard-cancel-dist, local port4237. Prior source22 E2E/native-memory/full-browser/backend evidence remains historical at its recorded hashes; those expensive suites were not repeated for this bounded read-lifetime change, and their previously disclosed failures remain outstanding. Raw logs and machine-readable source25-dashboard-cancellation-summary.json are saved under ignored output/performance/.

At the owner's request, dense-ink investigation is deferred. The bounded headless Direct3D11 probe chose Microsoft Basic Render Driver and could not enable hardware WebGL in either full Chromium145 or installed Chrome156; default stays SwiftShader. No system/driver settings changed. The subsequent dense profiler was stopped after one sample and is not a qualified timing comparison. Its partial log and the source25-headless-hardware-probe.json evidence are retained.

Historical source25 delivery: **19 accepted product changes,80 task files prepared for review**. No commit/push/merge/deploy occurred. Release remains NOT READY while supported-device/long-session memory, dense-ink budgets, Linux CI and original backend filesystem gates are outstanding. Rollback this stage by restoring Dashboard and the four read-adapter modules to the preceding review patch; no stored-state or schema migration is involved.

## Source24 memory attribution and current delivery

The large source23 native-buffer increase is primarily instrumentation retention. A direct-CDP isolated PDF control uses the same Chromium145 executable, synthetic PDF files, worker and final Canvas pixels. Three fresh browsers without Network capture keep allocated-object buffers approximately5.11-5.15MiB across two cycles; three with default Network.enable grow approximately19.69-19.73 ->34.18-34.35MiB. Installed Playwright1.58.2 enables Network capture on its own sessions by default. HTTP range-request counts vary slightly; these controls establish attribution, not a product timing or physical-device result.

The actual frozen source22 product then completes **3 fresh browsers x8 heavy close/reopen cycles**, with the original scenario and **108 exact stroke ID/path preservation checks**, zero page errors. Only diagnostic DevTools response-body copies are capped to1byte per Network agent. Native allocated-object counters remain8.32-8.39MiB; Canvas stays35.85MiB across all24 dumps, with one document/worker/font face,475 DOM nodes and289 listeners. Total private commitment still grows **17.30/16.94/18.31MiB** from first to eighth close. Main-thread heap warms from about8.9 to10.2MiB. This establishes stable live-buffer counters for this chosen workload, **not** a complete commitment plateau, long-session or iOS memory gate PASS.

The maintained benchmark applies this control only with --processMemory=1, uses an explicit inspected Playwright1.58.2 version guard, fails if no Network agents were configured, and records the policy in report metadata. No installed SDK file or product code was changed. Default timing mode is unchanged. Runtime validation:3 fresh browsers x2 heavy cycles,18 preservation checks,30 configured agents,zero errors,correct frozen build digest; Node syntax and targeted ESLint max-warnings0 PASS. Earlier source23 growth/pressure artifacts remain preserved as measurements with uncapped DevTools retention, superseded for application-live-buffer attribution.

Artifacts under ignored frontend/output/performance/: source24-direct-cdp.json, source24-product-memory-bounded-network.json, source24-product-memory-summary.json, source24-maintained-memory-sampler.json and their native traces/logs. Native allocation sampling returned empty samples in all3 runs, so it provides no allocation-stack proof. Three abandoned raw-CDP application-harness attempts failed label/scope/protocol handling before qualification; they are preserved and are not product failures. Detailed tracing/subprocess overhead is not latency evidence.

Historical source24 delivery contains **18 accepted product changes in75 staged files**, including the source21 mask-scope correction and source22 startup-import/cold-replay guard. Product artifacts remain frozen and previous functional results remain valid. Release verdict stays NOT READY: dense ink still exceeds the software-renderer budget; supported-device/long-session evidence, owner-authorized Linux CI publication and original backend filesystem recovery remain outstanding.

## Accepted local changes

| # | Change | Evidence and limits |
| --- | --- | --- |
| 1 | Suspend hidden PDF raster work and release backing buffers | Five-tab proxy bytes 187,934,400 → 37,586,880 (−80%); hidden backing pixels zero; PDF state retained. This is a canvas pixel proxy, not process/GPU memory. |
| 2 | Correct ordinary-build catalog fixture detection | Defined/non-null guard prevents compiled `null` from selecting test catalog; ordinary 503 → error → Retry passes. |
| 3 | Stop confirmed student bootstrap waiting for Ops capabilities | Held response passes; pending/denied privileged routes fail closed with zero privileged requests. No stable ordinary startup gain claimed. |
| 4 | Release hidden live-ink backing buffers | Five written tabs 77,666,080 → 37,586,880 proxy bytes (−51.6%); unfinished stroke restore/commit once, IDs/paths and Undo preserved. No stable return speedup. |
| 5 | Restore WebKit active and virtual page visibility | Painted canvas with zero CSS box reproduced and fixed; 48 selected WebKit cases pass. Synthetic pan input timing is explicitly 60Hz, separate from actual frame measurements. |
| 6 | Gzip public hashed JS/CSS/worker assets in both Nginx configurations | Actual Nginx negotiation, MIME, cache and decoded SHA proofs; JS/CSS transfer bytes 1,373,783 → 334,364. Private API/PDF cache policy unchanged. Linux image/Cloudflare behavior still needs validation. |
| 7 | Preserve coordinate rounding while reducing formatting work | 4M numeric and 1,500 geometry comparisons; matched 12-run dense cold usability p75 8,240 → 7,453ms (−9.6%). Drawing frame median unchanged. |
| 8 | Isolate recent/continue history by authenticated owner | Native account-switch scenarios in both engines and direct tests pass. Unowned legacy metadata preserved without automatic adoption. |
| 9 | Render Dashboard local study links independently of remote sections | Truthful pending/error/Retry states; native cases pass. Local return p75 959.6 → 416.3ms (−56.6%), warm study link 2,017 → 1,661ms. Cold no gain; pooled fully-resolved return 961 → 1,204.5ms (+25.3%) is a disclosed regression. |
| 10 | Gate editing until the current saved workspace hydrates | Deterministic accepted handwriting loss 1 → 0 on old source; native delayed-open/durable-reopen/Arabic controls pass after fix. PDF can paint in parallel; editing remains inert until restoration. |
| 11 | Cancel discarded hydration after Exit/scope change | Old source performs stale read/open after Exit; corrected native storage family 18/18 per engine and ordinary 4/4 per engine pass. |
| 12 | Cache immutable width profiles within one eraser drag | Frozen-reference mask/command oracle and direct invalidation tests pass; cache reset at finish/cancel. Combined timing evidence with change13 below. |
| 13 | Reuse preview geometry and Path2D within one gesture | Exact reference/model history preserved. Matched ABBA12 frame p95 1,416.6 → 1,033.4ms (−27.1%); handler p95 220.8 → 93.5ms (−57.7%); gesture p75 −30.7%. Dense stalls remain far above target. |
| 14 | Rearm circle-erase hold after the closure anchor exists | Deterministic paused-circle failure on both engines; original + paused cases ×3 pass 6/6 per engine. Existing 500ms/28px/classifier/one-Undo semantics preserved. |
| 15 | Avoid per-pointer forced scroll reads during drawing | Actual scroll listener still clamps the lock. Enabled both-axis getter/scripted-scroll/coordinates/exact Undo/Redo test passes each engine; three targeted cases and25 adjacent touch/orientation/control cases pass per engine. No isolated speedup percentage is claimed. |
| 16 | Keep the stationary eraser preview without recomputing or repainting | Native previous source clears20 times for20 identical-coordinate inputs in both engines; corrected source clears0, retains exact pixels and commits one Undo/Redo step. Four direct/adjacent cases repeated3 times pass12/12 per engine;629 unit cases and lint/types pass. Movement, radius, mode, scale and new hits still invalidate. No moving-frame speedup claimed. |
| 17 | Scope temporary SVG eraser masks without moving React-owned nodes; bounded raster fallback for fragmentation | Exact history/preview regression and54 canonical RGBA scenes per engine pass. ABBA12 frame p95 improves2199.9 ->983.3ms; handler p95 regresses10.4%, and prior committed-SVG antialiasing differences are disclosed below. |
| 18 | Defer startup API imports while registering cold Active Study adoption before replay acknowledgement | New cold-replay regression and630 Node cases pass; canonical entry gzip saves6165 bytes (2.6%). Observed startup changes are modest and variable, with warm median/cold-tail regressions disclosed below. |
| 19 | Cancel five abandoned Dashboard read transports when navigating away | Frozen before0/5 cancelled; current5/5 native cancellations and fresh SPA-return values per engine. Shared shell streak lifetime preserved;631 Node cases and10 ordinary cases per engine pass. No aggregate speedup claimed. |
| 20 | Return material-directory state for the current owner/cohort during render | Before both account/cohort cases expose previous materials; after6/6 direct cases per engine and12/12 ordinary cases per engine pass. Warm return has0 loading commits and0 extra material requests. |

## Comparable delivery/PDF measurements

Identical frozen ordinary builds and actual local HTTP PDFs; synthetic Pixel5/mobile network (1.6Mbps download, 150ms latency), Chromium CPU4, six contexts per variant, quiet machine with no overlapping builds/tests.

- Cold Dashboard content p75: 10,803 → 5,258ms (−51.3%); warm p75 1,984 → 1,954ms has no stable gain. Startup-logo LCP is not usable-content time or actual INP.
- First usable PDF page p75: ranged 24-page 27,662 → 17,759ms (−35.8%); long 240-page 19,222 → 9,829ms (−48.9%); scanned 24-page 21,764 → 12,276ms (−43.6%). 36 contexts total, zero page errors. These demonstrate the delivery change, not a PDF geometry algorithm change.
- Rejected geometry proof gives no overall useful first-page improvement (+0.4% p75). Demand-range experiment remains unshipped and incompletely qualified.

## Current validation

| Gate | Authoritative result |
| --- | --- |
| Latest source26 Node suite | **631 passed, 0 failed/skipped**. |
| Latest source26 lint/types | Full ESLint max-warnings0 and both TypeScript projects **PASS**. |
| Latest source26 builds/browser | Ordinary/E2E build/bundle **PASS**, JS227.6KiB/CSS87.4KiB gzip; ordinary index SHA `17ff2003409ff8fb7f63ec41759e7db5843ac77d3a0bae3bebc640e596c37506`; ordinary12/12 per engine, direct scope6/6 per engine and5 adjacent Chromium reader cases **PASS**. |
| Frozen current source21 builds/bundle | Ordinary/E2E **PASS**, unchanged JS233.6KiB/CSS87.4KiB gzip. Ordinary index SHA `d1256d7a71c1e95fb48f18a8fef71edb25bd68f1b738e871bacb6068a35abe0f`; E2E `ace2ca132b9d9912c95026f8b158c9b46053bfdc82fa5788464d6265ee8226b0`. |
| Latest full Chromium suite | Final source22 **545 pass /35 existing skips /4 fail**,584 cases,20.5min with2 workers. Failed: nine-location pinch,834px search PDF readiness,and2 Lo-Fi cases. Artifacts retained; unchanged four cases repeated3 times quietly:12/12 PASS. The initial full gate remains disclosed as failed. |
| Source21 direct Chromium regressions | **7/7 PASS**: mask scope, both-axis scroll reads, stationary preview, exact fractional PNG, mask-cap31/32/33 transitions with exact Undo/Redo and cleanup. |
| Source21 affected Chromium workflows | **87/87 PASS**,13.6min: all18 ink cases, tab lifetime, pinch/touch, controls and selection/export. |
| Source21 WebKit ink family | First run **15 pass /2 failures**,17 cases,6.9min. Scope case reaches Redo but whole-case30s expires; scroll case click timeout. It overlapped Chromium workflows. Failed cases plus cancellation repeated3×: **9/9 PASS**,1.9min, unchanged assertions. First six repeat cases ran with no other browser suite; ordinary Chromium suite started near the end of the rerun. The original failures remain disclosed. |
| Source21 fallback pixels | **54/54 exact RGBA scenes per engine PASS**, canonical full-surface reference, fractional sizes/aspects/tools/translucency/edge/off-page masks. |
| Source21 committed SVG visual reference | Native SVG rasterization72 scenes/engine: WebKit72 exact; Chromium28 exact/44 differ, max alpha15/255, max premultiplied color13.06/255, max changed-pixel fraction0.003873. Transparent RGB max255 is not visible color difference. These are observed antialiasing differences, not literal pixel equality with old full-page mask bounds. Preview/commit fractional PNG equality remains strict and passes. |
| Source21 ordinary browser regressions | Chromium9/9 and WebKit9/9 PASS. Ordinary hashed JS/CSS/PDF-worker cache checks12/12 per engine PASS, compressed/uncompressed install and actual origin disconnect, exact decoded bytes/digests. |
| Public PWA/static delivery | Frozen ordinary source10: real origin-disconnection byte/digest probe12 checks per engine PASS; actual Nginx48 negotiation samples and9 checks per configuration PASS. Final source21 ordinary public-origin-disconnect rerun12/12 per engine PASS. The previous actual Nginx negotiation evidence remains configuration-level source10 evidence; no Linux/edge claim is added. |
| Backend original PostgreSQL suite | **RED**:1,026 passed/27 failed of1,053;86.24% coverage with unchanged85% gate. Failures relate to four pre-existing missing/unreadable payment commands. |
| Backend reference diagnosis | Digest-verified indexed-source mirror:28 targeted cases PASS, including original27 failures. This does not make the original checkout full suite green and does not restore user files. |
| Backend/static lab | Accessible511 files formatting/mypy, Django check/migration drift PASS; recursive format exits2 on unreadable directory. Bounded240 synthetic HTTP requests at concurrency1/4:zero status/byte/digest/cache/SQL-capture errors;catalog17 SQL statements for18/180 documents, no proved N+1. |
| CI/containers/physical devices | Not verified. Windows local emulation is not Linux image/TLS/Cloudflare, iOS Safari/PWA/Apple Pencil or physical Android evidence. |

## Latest local gate status

Local verification is complete for this checkpoint. Final ordinary/E2E builds,630 Node tests,full lint/types,bundle budgets,ordinary bootstrap9 cases per engine,WebKit native11 cases,and disconnected-origin public-cache20 checks per engine pass. CI shell/Python tool syntax and final git diff whitespace checks pass.

Full Chromium: **545 PASS/35 existing SKIP/4 FAIL**,584 cases,20.5min. Same4 cases ×3 unchanged repeats,one worker and no other test/build/profile load: **12/12 PASS**,1.7min. The first full-run failures remain recorded; this is follow-up evidence, not a rewritten clean first run. No product or assertion change was made between those runs.

Independent PostgreSQL backend reference: **1052 PASS/1 harness FAIL**,1053 cases,24m59.5s,**86.27%** coverage vs85% gate. Missing repository-root example template was copied from digest-verified unchanged HEAD only into the reference; the same failed case then **1/1 PASS**. Original checkout still has Windows1392/missing-command failures and is not certified by this independent result.

The release verdict remains **NOT READY — CONTINUE WORK**: dense software-renderer stalls remain, physical iPad/Android and memory evidence is incomplete, Linux/container CI has not run on this patch,and the original backend directory is unreadable. No push/merge/deployment/production mutation occurred. Final source and artifacts are ready for local review; external verification needs owner-authorized publishing and available supported devices.

## Current source22 startup candidate — qualification in progress

Two startup imports are deferred without changing REST bodies or authorization. Focus API code loads when document replay needs it. The coordinator imports Active Study adoption handlers before acknowledging any persisted `active_study_*` operations, including a cold start without an open reader.

The naive deferral failed the new cold-replay regression (saved source22-cold-replay-before.log); the corrected coordinator passed all50 selected offline/security/document-sync tests. Full Node suite: **630 passed,0 failed/skipped**. ESLint max-warnings0 and both TypeScript projects completed successfully. Browser and user-perceived startup qualification are pending; source22 is not yet an accepted measured optimization.

Same-config ordinary module audits: source21 entry829834 raw/237972 gzip bytes; source22 entry806565 raw/231682 gzip bytes (**-23269 raw/-6290 gzip, about2.6%**). Initial static closure no longer contains Focus API or Active Study modules. This is a transfer-size measurement, not a claimed startup speedup. Source22 audit index SHA `1b6ff77027c068f439bd699b90fb38fb3f6ceece2aec5bcba85341b03f8f1b46`; source21 audit index SHA `94b91e8c47e83f61086935a12a3d4cc8b48b4bbb3e85a9c4cfedcc07fb2e517b`. Compare these audit builds directly; do not mix their digest with the earlier source21 frozen build.

Readiness remains **NOT READY — CONTINUE WORK**. No deployment, push, merge, account reset, or repair of the pre-existing corrupt backend directory occurred. A transient automatic command-review quota rejection was resolved by retrying the same guarded review after fresh account usage showed ordinary execution available.

## Current source21 performance comparison

Final quiet ABBA12:6 fresh browser processes per frozen ordinary variant; actual HTTP index SHA/gzip verified; Chromium/software graphics, CPU4, identical1000 stored40-point strokes and eraser path. Maintained independent-browser option runtime smoke3 zero-ink PDF cases PASS. Each timing sample has241 masks, exact Undo/Redo PASS, zero page errors, zero newly gesture-created detached Canvas buffers in the ordinary SVG workload. This is a Canvas pixel proxy, not total process/GPU memory and does not cover the capped fallback.

| Metric | Source20 | Source21 | Change |
| --- | ---: | ---: | ---: |
| Frame interval p95 | 2199.9ms | 983.3ms | −55.3% |
| Whole gesture p75 | 45030.2ms | 26963.5ms | −40.1% |
| Event handler p95 | 118.4ms | 130.7ms | +10.4% |
| Two-rAF commit observation p75 | 2899.3ms | 2959.3ms | +2.1% |
| Cold usable reader p75 | 14079ms | 13105ms | −6.9% observed; no isolated startup-cause claim |

Current samples supersede earlier SVG-proof timings for this candidate. Gesture/frame gains coexist with a modest handler regression and no stable commit improvement. Dense stalls remain far above supported-device targets. Synthetic timing is not physical Pencil/INP or production readiness. All12 sample reports and summary remain under ignored output/performance/source21-abba-*.

Final SVG/raster hidden-tab lifetime checks **PASS**: Chromium7 related cases after exact-key helper correction, plus final2 lifetime cases with completed-PDF readiness; WebKit6 related cases PASS/1 early full-PNG failure, then final2 lifetime cases repeated3x **6/6 PASS**. SVG owns0 detached Canvas; capped fallback owns1 reused surface, released to0x0 while hidden; original preview compositor PNG, exact stored annotations and single Undo/Redo all preserved.

Test diagnostics remain disclosed: initial Chromium2 failures were an imprecise owner-prefix storage lookup after opening a second sheet; helper now uses the exact existing owner/material/sheet key. WebKit's initial raster-return PNG was captured before PDF repaint completed: identical ink dimensions1190x1684 and display rect;11535 differing pixels, **zero colored-ink differences**, all grayscale PDF background. The final test waits for PDF.js's completed visible back-buffer swap before comparing the same entire PNG; pixel/history/allocation criteria unchanged. Failure artifacts retained. No product source changed after the frozen source21 build.

Final full lint, test-file syntax and git diff whitespace check **PASS**. Source21 remains a local review checkpoint with a handler regression, antialiasing differences and supported-device/CI/original-checkout gates outstanding. It is not a claim that the original release objective is complete.

## Current accepted checkpoint and rejected work

Source20 contains16 accepted changes. Frozen ordinary index SHA `527bebb8ac09052846b354b685a18aa30b6209af7a19a02a96b09d1d5b6a4fd2`; E2E `ad1035477bcad3cdbbdcde06e7f14a521fec87d13d7aca96fcf18bcca0c0e933` at local4228. Both builds and unchanged initial bundle budgets PASS (JS233.6KiB/CSS87.4KiB gzip). Stationary-erasure before test specifically fails20 repaints in both engines; after four relevant cases repeated3× pass12/12 per engine, exact pixels/history retained. Source18 scroll-lock adjacent25/25 per engine and final both-axis getter case pass; source20 relevant scroll case passes again.

Rejected experiments remain outside product, with full evidence in the chronological report:

- Per-stroke full/bounded Canvas isolation preserves scope but dense frame p95 worsens roughly983→7,216ms or1,283→6,366ms.
- Translated/cropped/partitioned raster and newer original-origin clipping fail strict image comparisons. Latest actual-rendered-path crop46/54 identical/max85 channel per engine; original input-point crop36/54/max60. Criteria and failing artifacts retained.
- SVG shared-path/event-driven-scroll proof passes scope/fractional/history checks but ABBA12 frame p95 improves1,599.9→816.7ms while handler89.2→108.2ms and two-rAF commit p752,030.8→2,760.9ms regress. That proof is superseded by source21; the old timings are not current-source evidence.
- Additional materialization-width-cache candidate:4,860 exact reference results/627 units/native checks pass, but ABBA8 frame p95 +8.3%, handler +3.8%, gesture p75 +2.0%. Reverted completely; accepted source20 does not include it.

Local source21 delivery checks are complete. Next: Candidate performance and native visual evidence are now recorded; retain the handler regression and antialiasing differences. Complete physical-device/CI verification and resolve the original corrupt backend-command directory before release certification. Prior failed cache/crop experiments remain rejected.

## Remaining release requirements

Dense ink/eraser stalls; total private commitment and long-session memory despite stable corrected live-buffer counters; supported-device performance; Linux/CI/static-delivery verification; owner resolution of original backend missing/unreadable commands. Source22 mask-scope, affected browser, sync/account and public-cache validation are already recorded. Lease-dependent WebKit offline cases remain unsupported by the Windows Ed25519 runtime; preserve signature verification. Final staging review is refreshed after source24 diagnostics. Existing skips are disclosed and retain their original conditions; no test was disabled to obtain a pass.

Environment: Node24.18.1, pnpm11.25 (lockfile unchanged), Vite6.4.3, React18, PDF.js6.3.289, Chromium145.0.7632.6/WebKit26.0 on Windows/software graphics. Python3.11/PG17.11 differ from CI3.13/PG18.4. Local WSGI timings are not production Gunicorn capacity; no blanket pool/infrastructure changes are justified.

## Rollout and rollback

No deployment is authorized. Once local gates pass, build ordinary prebuilt images through the prescribed pipeline; never deploy E2E catalogs or lab servers. Validate synthetic staging workloads, private full/range bytes, account/lease isolation and supported physical devices. Follow `DEPLOYMENT.md` and obtain explicit production approval.

Accepted changes introduce no schema or stored-format migration. Revert individual changes in a dedicated patch preserving unrelated user edits, rebuild the ordinary image, and validate reading/ink/offline/access. Student content must remain intact. Experimental artifacts are never release inputs.


## Concrete external inputs still missing

- Physical iPad Safari/PWA with Pencil and physical Android for supported-device ink/reader/frame/long-session evidence. No ADB or Docker command is available locally; WSL is only a stub. Windows software-browser emulation was exhausted as an alternative and is explicitly qualified above.
- Healthy Linux/CI/container staging to verify prebuilt-image/runtime/edge behavior on the intended Python3.13/PostgreSQL18.4 stack; no push/deploy is authorized by this goal.
- Recover a readable original backend/apps/payments/management/commands directory (Windows1392), or confirm owner intent for the four pre-existing missing commands. Original source remains1026 pass/27 fail; the independent digest-verified mirror28 command cases PASS proves the local source/filesystem issue, not original checkout release readiness. No user deletion, directory recovery or production payment mutation was performed.

Dense synthetic stalls remain visible even after the40.1% gesture gain, and broader release certification remains NOT READY. Physical-device evidence is missing. The owner subsequently requested an end to goal work; see the final handoff below. The original objective is not certified complete.

### Source22 browser qualification checkpoint

- Frozen candidate E2E build PASS; ordinary bundle budget PASS: JS227.6KiB/CSS87.4KiB gzip.
- Chromium offline/download/cold reload/Active Study/reconnect/document-sync family: **13/13 PASS**,1.1min.
- Ordinary production bootstrap/catalog/dashboard/Arabic phone/English tablet: **9/9 PASS per Chromium and WebKit**,11.9s/16.1s.
- Selected WebKit native sync/account family: **3 PASS**, including server ink reaching a second device, reconnect under its original key, and account-scoped recent study.
- WebKit CSP/offline PDF cases: **2 FAIL** at signed offline-access verification. The same two cases fail on frozen source21 control. A direct secure-context `crypto.subtle.importKey(...,'Ed25519',...)` capability probe reports `NotSupportedError` on this Windows WebKit runtime. Security remains fail-closed; no signature bypass, fallback key, timeout increase, or skipped-failure claim. Current failures and control logs are preserved; physical Safari capability remains unverified.
- Source22 user-perceived startup ABBA comparison is running serially, after native tests/builds finished, with6 fresh contexts per variant, CPU4/mobile network/gzip and actual index digest checks. No speedup is claimed before results.

### Source22 repeated startup measurements — modest observed differences

Quiet ordinary-build ABBA4 batches,3 fresh contexts/batch,6 per variant,CPU4/mobile150ms/1.6Mbps,SW blocked,actual gzip and digest verified. Same measurement definitions/fixtures; no tests, builds, or profiling overlapped timing.

| Metric p50/p75/p95 ms | Source21 audit control | Source22 audited candidate |
| --- | --- | --- |
| Cold complete dashboard |4166/4450/5128|4168/4204/5120|
| Cold usable continuation |3901/4155/4843|3889/3918/4950|
| Warm complete dashboard |1385/1966/2424|1426/1870/2095|
| Warm usable continuation |1119/1576/2255|1112/1535/1702|
| Route click to complete content |295.5/524.9/1111.8|282.9/498.2/1063.3|
| LCP observer |1552/1676/1692|1552/1576/1840|

Cold p75 observed -5.5%; warm p75 -4.9%; route p75 -5.1%. These are small observations, not a robust claim of felt/causal speedup: calibration p95 varied70.4ms control vs16.4ms after, warm median regressed41ms, cold continuation p95 regressed107ms, and LCP is the **startup logo**, not dashboard content. CLS remains within .1; all12 contexts report zero page errors. Deterministic transfer improvement remains6290 gzip bytes (~2.6%). Saved source22-navigation-summary.json and all per-context artifacts.

Final diff review removed an additional, unnecessary Focus API dynamic import from `forgetFocusDocuments`; its storage/deletion behavior remains unchanged. The audited benchmark precedes this tiny cleanup. Final ordinary/E2E builds and full quality gates are being rerun; do not silently present the audited digest as the final cleaned artifact. No further product optimization is added during final validation.

A full backend suite is running against the digest-verified independent working reference, with the four missing commands copied from inspected HEAD only in that reference. Settings refuse any database except the local synthetic PostgreSQL lab and create a uniquely named test DB/media root. This run preserves the85% coverage gate. It cannot certify or repair the original Windows1392 directory; that remains external to a safe performance patch.

### Source22 final frozen artifacts and code-cache checks

Final product cleanup rebuilt successfully. Ordinary index SHA `dfea78da777c1cdd0ae358ec4d9a971b6334f4f1765925a5c60952b004fc5f67`; E2E `515fe1db40f00815fca43a082c08bc55aacc9f1251bf2335f263f82f94b59b45`. Ordinary bundle budget PASS: JS227.6KiB/CSS87.4KiB gzip. Final Node **630/630 PASS**,full lint/types PASS. Final ordinary bootstrap/catalog/dashboard **9/9 per engine PASS**; these are correctness runs overlapping the full functional suite/backend reference, not performance samples.

The maintained public-cache script now accepts explicit frozen root+required digest and optional additional public asset filenames; existing Nginx-lab default remains. Final ordinary source22 **20/20 byte+digest checks per engine PASS**, covering entryJS/CSS/PDFworker and both deferred Focus/ActiveStudy modules with gzip/identity and actual origin disconnected. A deliberately wrong artifact digest is rejected before browser launch; syntax/targeted ESLint PASS. Repeated workflow metadata is normalized under .agents/workflow-forger/ledger.json. No private data, key or API was cached for this proof.

Full final Chromium: **584 cases started, result pending**. Independent full PostgreSQL backend reference with85% coverage gate: running. These gates are not claimed green before their actual completion. Performance observations remain the preceding audited candidate comparison with its explicit calibration/logo caveats; cleanup builds have distinct digests above.

### Source22 full-gate outcomes and harness diagnostics

Final Chromium full run: **545 PASS/35 existing SKIP/4 FAIL**,584 cases,20.5min,2 workers. Four failures remain preserved: nine-location pinch focal geometry,834px search awaiting PDF paint,and2 Lo-Fi cases (one whole-case30s timeout; one5s missing-player wait). Product stayed frozen. These are not counted green or silently skipped; unchanged4 cases ×3 quiet repeats are now running after all other functional/build/profile activity finished.

Independent PostgreSQL full reference: **1052 PASS/1 FAIL**,1053 cases,1499.50s,coverage **86.27%** against unchanged85% gate. The single failure was a missing repository-root `.env.production.example` in my reference-copy harness, not a domain assertion. Original template matched inspected HEAD blob `805e34feb8aae558d1c3627a76c29c1ba747d0fb`; a digest-identical copy was added only to the independent reference. Same failed test,without assertion changes: **1/1 PASS**,0.14s. Full original-checkout1026/27 result and Windows1392 directory remain unchanged; this reference evidence does not repair or certify that original filesystem. Targeted `--no-cov` follow-up preserves the full86.27% coverage evidence rather than substituting a narrow coverage result.

My initial extra WebKit config incorrectly blocked service workers. For ink cases this triggered the PWA preparation/install overlay above the existing Normal Study dialog; retained context shows both dialogs. That harness attempt was interrupted and preserved. Restored the original service-worker default,without product or test-assertion edits: final **11/11 PASS**,1.4min,including scope/fractional pixels/caps31-32-33/cancel/hidden lifetime and server sync/account isolation. Separate lease-dependent offline WebKit failures remain disclosed as unsupported Ed25519 in the Windows runtime; no signature check was bypassed.

### Source22 local verification closure

Unchanged quiet follow-up: **12/12 PASS** for4 failed full-run cases repeated3 times,one Chromium worker,after all other tests/builds/profiles finished. First full **545/35skip/4fail** result remains preserved; no passing first-full-run claim. Final WebKit **11/11 PASS**; backend reference **1052pass/1 missing-template harness fail +1/1 unchanged follow-up PASS**,coverage86.27%. Shell syntax for both modified CI scripts and Python compilation for3 delivery/performance tools PASS. Final diff whitespace check PASS. CI/physical-device/original-filesystem readiness remains outstanding.

For final reporting, compressed bytes are recomputed from actual frozen files with the same Node `gzipSync(level:6)`: source21 audit entry829834 raw/**239201 gzip**; source22 audited entry806565 raw/**233037 gzip** (6164-byte reduction); cleaned final entry806504 raw/**233036 gzip** (6165 bytes,about2.6%). At level5 the final reduction is6228 bytes; at level9 it is6179 bytes. Earlier calculator values237972/231682 and6290-byte difference are retained as historical calculations, not the canonical same-Node final comparison. Compression level/library affects absolute bytes; compare matching methods. Startup timing observations remain modest,with calibration variability and logo-only LCP explicitly disclosed.

No product code changed after final artifact freeze. All raw results,failed attempts and frozen builds remain under ignored output/performance/. Local review scope excludes the pre-existing launch configuration,payment-command deletions/corruption and SQLite backup.


### Source23 native process-memory investigation (2026-10-12)

The final source22 ordinary product artifact stays frozen at index SHA `dfea78da777c1cdd0ae358ec4d9a971b6334f4f1765925a5c60952b004fc5f67`. Three independent Windows Chromium145 processes per workload, CPU1, tablet viewport834x1194/DPR2, each complete eight close/reopen cycles with one retained pen stroke per document. The standard and heavy workloads each pass108 exact stroke ID/path preservation checks (216 total), with no page errors. After each close, one document/worker/font face,474-475 DOM nodes,289 listeners and37,586,880 allocated Canvas proxy bytes remain stable. The retained main-thread JS heap settles near10.1-10.3MiB; this does **not** establish native-process memory stability.

Private committed browser-process memory rises from259.6-261.2MiB after the first standard-text close to280.9-282.1MiB after the eighth (19.69-22.05MiB per run). With the heavy long/mixed/scanned fixture group, it rises from283.1-290.4MiB to383.5-396.8MiB (96.01-106.39MiB per run). Most additional commitment is in the renderer; browser/network/GPU process commitment stays approximately stable. These are workload comparisons, not matched before/after product timings. Rising commitment over eight cycles warrants native-allocation investigation; it does not by itself distinguish a leak from bounded cache/allocator retention, and no plateau or memory gate PASS is claimed.

Windows detects Intel UHD620 and NVIDIA MX110 hardware, but installed Chrome156, Edge155 and Playwright Chromium145 report SwiftShader/software graphics in isolated headless sessions. No explicit software-forcing launch argument was found. Physical hardware/Pencil/iOS evidence remains missing; no driver or system setting was changed.

The maintained benchmark now offers optional Windows-only `--processMemory=1` with Chromium and at least two close cycles. It reads only validated numeric CDP-owned process IDs using PowerShell7 `Get-Process`; reports private committed bytes and summed working set with shared-page and GPU-VRAM limitations. Sampling is off by default. Its revision metadata now includes staged plus unstaged changes against HEAD. JavaScript syntax, targeted ESLint with max-warnings0 and native runtime checks PASS. Bounded native allocation and reclaimability diagnostics are complete with the retention concern recorded below. A first legacy PowerShell sampler timed out and was retained, then replaced with the working PowerShell7 invocation. Product code was not changed for this diagnostic.

Evidence: ignored `source23-current-standard-memory.json`, `source23-current-heavy-memory-pwsh.json`, `source23-memory-comparison-summary.json` and native-GPU capability/argument reports. Native memory-infra investigation and reclaimability checks are recorded below; release remains NOT READY.


The bounded native allocation probe completes3 fresh browsers x2 close cycles with18 exact reopen checks plus no page errors. All3 renderer snapshots retain **35.85MiB Canvas**. The buffer partition grows **18.33/17.11/17.75MiB**, while its allocated-object counter grows **17.44/17.44/17.42MiB**. Parent/child counters overlap and must not be summed. The PDF reader already destroys its loading task; installed PDF.js clears bitmap objects and destroys the owned worker. These facts narrow the investigation but do not identify an application retention owner. The completed reclaimability probe is recorded below; no product change is justified solely by these counters.

The first unfiltered native trace passed8 dump requests but failed artifact serialization with Node RangeError (string-size limit); the partial report and error log are retained and are not counted as a completed memory measurement. The corrected trace excludes default categories, retains only bounded numeric allocator attributes and adds a30s trace-completion deadline; native artifacts are about4.8MB per run. It includes a tracing-service process and is not pooled with the earlier untraced cycle measurements. See ignored source23-native-allocation-summary.json.


Final source23 reclaimability probe completes3 fresh browsers x2 close cycles:18 exact reopen checks and3 additional exact current-ink checks after pressure, no page errors. A critical notification is sent only to each synthetic Chromium process, followed by2s settling and main-thread GC; no OS pressure/settings or application state is modified. Renderer allocated-object buffers remain unchanged after pressure: **46.81 -> 46.81; 46.77 -> 46.77; 46.78 -> 46.78MiB**. Canvas stays35.85MiB in all9 dumps. Total private commitment changes **326.86 -> 329.2; 334.86 -> 334.94; 335.32 -> 325.01MiB**. This strengthens the retention concern for those buffers but does not identify their owner or prove an unbounded leak. Do not claim a plateau, memory PASS, physical-device readiness or a product fix from this diagnostic.

The source23 investigation is locally delivered with syntax/targeted ESLint PASS, the original six untraced8-cycle runs, bounded native allocation probes and preserved failed trace attempts. No product code changed after the source22 frozen builds. The75-file review scope is refreshed with the optional measurement tool and accurate current documentation; no unrelated user file is staged. Linux CI/PR publishing authorization and supported physical devices remain pending, as does owner resolution of the original unreadable payment commands. Next engineering work should attribute native buffer retention and validate dense ink on supported graphics before making another performance patch. Artifacts: ignored source23-native-pressure-summary.json and associated3 bounded native-counter traces.


## Owner-requested final handoff (2026-10-12)

The owner requested final tests, a complete report and an end to autonomous goal work. No further performance candidates were implemented. Final current checks:631 Node cases/0 failures/skips, full lint/types, fresh ordinary build and explicit bundle budgets PASS; ordinary12/12 per engine on both source26 and fresh final artifacts; critical PDF/ink/hydration/tab cases10/10 per engine PASS. Three Python and two shell tool syntax checks PASS. The React hook test-helper extraction was exercised by the real scope tests. Final delivery:20 accepted product changes,83 review files. Complete Arabic handoff:PERFORMANCE_HANDOFF_AR.md; patch/evidence manifest:ignored output/performance/final-handoff-*. The full original release objective remains unachieved. Work is stopped at the owner request, with goal paused rather than falsely certified complete. Dense ink/device/long-session/CI/original-backend gates remain outstanding. No commit/push/merge/deploy.
