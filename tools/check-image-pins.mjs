#!/usr/bin/env node
/*
 * VPN Setup installs wg-easy from one digest-pinned image. worker.js (bootstrap and update
 * arguments) and server/vpn.py (which refuses any other image) must name the identical
 * reference, ui/app.js must name its release, and the plugin README must document it. Never a floating tag: `latest` is the
 * legacy v14 line. `--version` prints the pinned x.y.z for .github/workflows/upstream.yml.
 *
 * Offline and deterministic: pure fs, no network, no child_process.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins/vpnsetup');
const PINNED = /^ghcr\.io\/wg-easy\/wg-easy:(\d+\.\d+\.\d+)@sha256:[0-9a-f]{64}$/;
const errors = [];

function pin(file, pattern) {
  const found = [...readFileSync(join(PLUGIN, file), 'utf8').matchAll(pattern)].map((match) => match[1]);
  if (found.length !== 1) errors.push(`plugins/vpnsetup/${file}: expected one pin assignment, found ${found.length}`);
  return found[0];
}

const worker = pin('worker.js', /^\s*const IMAGE = '([^']*)';$/gm);
const installer = pin('server/vpn.py', /^IMAGE = "([^"]*)"$/gm);
if (worker !== undefined && !PINNED.test(worker)) errors.push(`worker.js IMAGE is not a digest-pinned wg-easy x.y.z reference: ${worker}`);
if (worker !== undefined && installer !== undefined && worker !== installer)
  errors.push(`worker.js and server/vpn.py pin different images:\n      ${worker}\n      ${installer}`);
if (worker !== undefined && !readFileSync(join(PLUGIN, 'README.md'), 'utf8').includes(worker))
  errors.push('plugins/vpnsetup/README.md does not name the pinned image');
// The UI says "up to date" only for a check that found this release; it cannot read worker.js.
const ui = pin('ui/app.js', /^\s*const RELEASE = '([^']*)';$/gm);
if (worker !== undefined && ui !== undefined && PINNED.test(worker) && ui !== PINNED.exec(worker)[1])
  errors.push(`ui/app.js RELEASE ${ui} is not the pinned release ${PINNED.exec(worker)[1]}`);

if (errors.length) {
  console.error(`\n✗ ${errors.length} wg-easy pin error(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
const version = PINNED.exec(worker)[1];
console.log(process.argv.includes('--version') ? version : `✓ VPN Setup pins wg-easy ${version} by digest in worker.js, server/vpn.py and ui/app.js`);
