#!/usr/bin/env node
/*
 * Parses every plugin / template / SDK JavaScript file to catch syntax errors before they
 * ship — e.g. an unescaped apostrophe inside a single-quoted i18n string, which silently
 * breaks the whole plugin UI (the script fails to parse, so `window.t` is never defined).
 *
 * Pure node, no child_process: uses the `vm` module to COMPILE (parse) each file without
 * executing it, so browser globals (window, document, navigator) are irrelevant. This is the
 * same gate CI enforces; running it in `npm run check` lets authors catch it locally first.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['plugins', 'template-plugin', 'sdk'];

function jsFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) jsFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => jsFiles(join(ROOT, r)));
const errors = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  try {
    // Compiling parses the entire source (including nested function bodies) but runs nothing.
    new vm.Script(readFileSync(f, 'utf8'), { filename: rel });
  } catch (e) {
    const loc = (e.stack || '').split('\n').find((l) => l.includes(rel));
    errors.push(`${rel}: ${e.message}${loc ? ` (at ${loc.trim()})` : ''}`);
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} JavaScript syntax error(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ syntax-checked ${files.length} JavaScript file(s)`);
