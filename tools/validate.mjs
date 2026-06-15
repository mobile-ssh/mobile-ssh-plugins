#!/usr/bin/env node
/*
 * Validates every plugin manifest + recipe against the JSON Schemas, checks that referenced
 * files exist, and validates catalog/plugins.json. Exits non-zero on any problem.
 *
 * No shell commands are run here (no child_process) — pure fs + ajv, so it is safe in CI.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const vManifest = ajv.compile(read(join(ROOT, 'schema/plugin.schema.json')));
const vRecipe = ajv.compile(read(join(ROOT, 'schema/recipe.schema.json')));
const vCatalog = ajv.compile(read(join(ROOT, 'schema/catalog.schema.json')));

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

/** Directories that should contain a plugin manifest. */
function pluginDirs() {
  const dirs = [];
  if (existsSync(join(ROOT, 'template-plugin/manifest.json'))) dirs.push('template-plugin');
  const pluginsRoot = join(ROOT, 'plugins');
  if (existsSync(pluginsRoot)) {
    for (const name of readdirSync(pluginsRoot)) {
      const d = join('plugins', name);
      if (statSync(join(ROOT, d)).isDirectory() && existsSync(join(ROOT, d, 'manifest.json'))) dirs.push(d);
    }
  }
  return dirs;
}

const seenIds = new Set();
for (const dir of pluginDirs()) {
  const base = join(ROOT, dir);
  let manifest;
  try {
    manifest = read(join(base, 'manifest.json'));
  } catch (e) {
    fail(dir, `manifest.json unreadable: ${e.message}`);
    continue;
  }
  if (!vManifest(manifest)) {
    for (const e of vManifest.errors) fail(`${dir}/manifest.json`, `${e.instancePath || '/'} ${e.message}`);
    continue;
  }
  if (seenIds.has(manifest.id)) fail(dir, `duplicate plugin id ${manifest.id}`);
  seenIds.add(manifest.id);

  if (!existsSync(join(base, manifest.ui.entry))) fail(dir, `ui.entry not found: ${manifest.ui.entry}`);
  if (manifest.icon && !existsSync(join(base, manifest.icon))) fail(dir, `icon not found: ${manifest.icon}`);

  // HTTP_INTERNET is a sensitive capability — require it to be intentional.
  if ((manifest.capabilities || []).includes('HTTP_INTERNET') &&
      !(manifest.capabilities || []).includes('HTTP_LOOPBACK')) {
    // allowed, but worth surfacing during review (warning, not error)
    console.warn(`[warn] ${dir}: declares HTTP_INTERNET without HTTP_LOOPBACK (egress beyond the tunnel).`);
  }

  if (manifest.recipe) {
    const rp = join(base, manifest.recipe);
    if (!existsSync(rp)) { fail(dir, `recipe not found: ${manifest.recipe}`); continue; }
    let recipe;
    try { recipe = read(rp); } catch (e) { fail(`${dir}/${manifest.recipe}`, `unreadable: ${e.message}`); continue; }
    if (!vRecipe(recipe)) {
      for (const e of vRecipe.errors) fail(`${dir}/${manifest.recipe}`, `${e.instancePath || '/'} ${e.message}`);
    }
  }
}

// Catalog (if present)
const catalogPath = join(ROOT, 'catalog/plugins.json');
if (existsSync(catalogPath)) {
  let catalog;
  try { catalog = read(catalogPath); } catch (e) { fail('catalog/plugins.json', `unreadable: ${e.message}`); }
  if (catalog) {
    if (!vCatalog(catalog)) {
      for (const e of vCatalog.errors) fail('catalog/plugins.json', `${e.instancePath || '/'} ${e.message}`);
    } else {
      for (const entry of catalog.plugins) {
        if (!existsSync(join(ROOT, entry.path, 'manifest.json'))) fail('catalog', `entry ${entry.id} path missing manifest: ${entry.path}`);
        if (!Array.isArray(entry.files) || entry.files.length === 0) {
          fail('catalog', `entry ${entry.id} has no files (run build-catalog)`);
        } else {
          for (const f of entry.files) {
            if (!existsSync(join(ROOT, entry.path, f.path))) fail('catalog', `entry ${entry.id} lists missing file: ${f.path}`);
          }
        }
      }
    }
  }
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} validation error(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ validated ${seenIds.size} plugin(s); catalog OK`);
