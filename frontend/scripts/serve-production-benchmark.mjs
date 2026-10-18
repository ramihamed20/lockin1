import { build } from 'vite';

// A separate ordinary production build: no compile-time E2E catalogue.
delete process.env.LOCKIN_E2E_CATALOG;
process.env.VITE_WORKSPACE_BENCHMARK = '0';
await build({ build: { outDir: 'output/performance/production-dist', emptyOutDir: true } });
process.env.LOCKIN_TEST_DIST = 'output/performance/production-dist';
process.env.LOCKIN_PERFORMANCE_GZIP = '1';
process.env.LOCKIN_PERFORMANCE_API = '1';
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.PORT || '4174';
await import('./serve-dist.mjs');
