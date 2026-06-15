#!/usr/bin/env node
/*
 * Generates catalog/plugins.json from the manifests in plugins/*. The host fetches this
 * index to render its install/enable list. (template-plugin is intentionally excluded.)
 *
 * Pure fs — no child_process.
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** All files under `dir`, as { path (relative, posix), sha256 }, sorted for stable output. */
function fileList(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = relative(dir, full).split(sep).join('/');
        out.push({ path: rel, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
      }
    }
  };
  walk(dir);
  return out;
}

const plugins = [];
const pluginsRoot = join(ROOT, 'plugins');
if (existsSync(pluginsRoot)) {
  for (const name of readdirSync(pluginsRoot).sort()) {
    const dir = join('plugins', name);
    const manifestPath = join(ROOT, dir, 'manifest.json');
    if (!statSync(join(ROOT, dir)).isDirectory() || !existsSync(manifestPath)) continue;
    const m = read(manifestPath);
    plugins.push({
      id: m.id,
      name: m.name,
      description: m.description,
      version: m.version,
      minBridgeVersion: m.minBridgeVersion,
      role: m.category || 'other',
      icon: m.icon ? join(dir, m.icon) : undefined,
      capabilities: m.capabilities,
      sessionRequirement: m.sessionRequirement,
      path: dir,
      files: fileList(join(ROOT, dir)),
    });
  }
}

// Stable order: connectivity → terminal → ide → llm → notebook → push → other, then by id.
const order = ['connectivity', 'terminal', 'ide', 'llm', 'notebook', 'push', 'other'];
plugins.sort((a, b) => (order.indexOf(a.role) - order.indexOf(b.role)) || a.id.localeCompare(b.id));

const catalog = {
  schema: 1,
  // CI overwrites `updated` with the real build time; kept stable here for reproducible local diffs.
  updated: process.env.CATALOG_UPDATED || '1970-01-01T00:00:00Z',
  plugins,
};

mkdirSync(join(ROOT, 'catalog'), { recursive: true });
writeFileSync(join(ROOT, 'catalog/plugins.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(`✓ wrote catalog/plugins.json (${plugins.length} plugin(s))`);
