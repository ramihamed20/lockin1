import { build } from 'vite';
import { existsSync } from 'node:fs';
import { E2E_OFFLINE_LEASE_PUBLIC_KEY } from '../e2e/fixtures/offlineLease.js';
const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const outDir = options.out;
if (!outDir?.startsWith('output/performance/') || outDir.includes('..') || existsSync(outDir)) throw new Error('Choose a new output/performance directory');
delete process.env.LOCKIN_E2E_CATALOG;
process.env.VITE_WORKSPACE_BENCHMARK = '0';
if (options.e2e === '1') { process.env.LOCKIN_E2E_CATALOG = '1'; process.env.VITE_OFFLINE_LEASE_PUBLIC_KEY = E2E_OFFLINE_LEASE_PUBLIC_KEY; }
await build({ build: { outDir, emptyOutDir: false } });
