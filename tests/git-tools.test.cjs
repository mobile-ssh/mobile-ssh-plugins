const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFile } = require('node:child_process');

const exported = { exports: {} };
vm.compileFunction(fs.readFileSync(require.resolve('../plugins/git/ui/tools.js'), 'utf8'), ['module'])(exported);
const { check } = exported.exports;
const IDS = ['git', 'lazygit', 'delta'];
const START = '\0MOBILE_SSH_GIT_TOOLS_V1\0';
const END = 'MOBILE_SSH_GIT_TOOLS_END\0';
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

function fixture(t, binaries, options = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-git-tools-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  for (const [id, script] of Object.entries(binaries)) fs.writeFileSync(path.join(temporary, id), '#!/bin/sh\n' + script, { mode: 0o755 });
  // Resolve only test executables even when the user's ~/.local/bin has real
  // lazygit/delta binaries. The production command itself still runs under sh,
  // and HOME remains untouched.
  const resolver = 'command() { case "$2" in ' + IDS.map(id => id + ') ' +
    (binaries[id] ? 'printf \'%s\\n\' ' + quote(path.join(temporary, id)) : 'return 1') + ' ;;').join(' ') + ' *) return 1 ;; esac; }; ';
  const calls = [];
  const bridge = { ssh: { exec: (command, commandOptions) => {
    calls.push({ command, options: commandOptions });
    return new Promise((resolve, reject) => {
      execFile('/bin/sh', ['-c', (options.before || '') + resolver + command + (options.after || '')], { cwd: temporary, encoding: 'utf8', timeout: commandOptions.timeoutMs, maxBuffer: commandOptions.maxOutputBytes }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > commandOptions.maxOutputBytes) return reject(Object.assign(new Error('OUTPUT_LIMIT_EXCEEDED'), { code: 'OUTPUT_LIMIT_EXCEEDED' }));
        resolve({ stdout, stderr, exitCode: error ? error.code : 0 });
      });
    });
  } } };
  return { bridge, calls, temporary };
}

const installed = {
  git: "printf 'git version 2.43.0\\n'",
  lazygit: "printf 'commit=17cb09fa, build date=2026-09-13T05:42:30Z, build source=binaryRelease, version=0.65.1, os=linux, arch=amd64, git version=2.43.0\\n'",
  delta: "printf 'delta 0.19.2\\n'"
};

function framed(records = IDS.map((id, index) => [id, '1', ['git version 2.43.0\n', 'version=0.65.1\n', 'delta 0.19.2\n'][index], '0'])) {
  return START + records.flat().join('\0') + '\0' + END;
}

function response(stdout, extra = {}) {
  return { ssh: { exec: async () => ({ stdout, stderr: '', exitCode: 0, ...extra }) } };
}

test('installed versions use one bounded command and keep verbose output in details', async t => {
  const f = fixture(t, installed);
  const result = await check(f.bridge);
  assert.deepEqual(result.tools.map(tool => [tool.id, tool.state, tool.version]), [
    ['git', 'installed', '2.43.0'], ['lazygit', 'installed', '0.65.1'], ['delta', 'installed', '0.19.2']
  ]);
  assert.match(result.tools[1].details, /commit=17cb09fa/);
  assert.match(result.details, /lazygit --version \(exit 0\)/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].options, { timeoutMs: 15000, maxOutputBytes: 32768 });
  assert.match(f.calls[0].command, /PATH="\$HOME\/\.local\/bin:\$PATH"/);
  assert.deepEqual(fs.readdirSync(f.temporary).sort(), IDS.slice().sort());
});

test('missing executables are separate from broken executables without executing real tools', async t => {
  const f = fixture(t, { git: installed.git });
  const result = await check(f.bridge);
  assert.deepEqual(result.tools.map(tool => tool.state), ['installed', 'missing', 'missing']);
  assert.equal(result.tools[1].version, '');
});

test('a nonzero version exit cannot be hidden by successful output formatting', async t => {
  const f = fixture(t, { ...installed, lazygit: installed.lazygit + "; printf 'loader failed\\n' >&2; exit 23" });
  const result = await check(f.bridge);
  assert.equal(result.tools[1].state, 'failed');
  assert.equal(result.tools[1].version, '');
  assert.match(result.tools[1].details, /loader failed/);
  assert.match(result.details, /lazygit --version \(exit 23\)/);
  assert.equal(result.tools[2].state, 'installed');
});

test('startup banners, stderr warnings, multiple lines, CRLF and no final newline are retained', async t => {
  const f = fixture(t, {
    git: "printf 'git version 2.43.0.windows.1\\r\\n'",
    lazygit: "printf 'warning: local config\\n' >&2; printf 'commit=abc,\\nversion=0.65.1, os=linux\\n'",
    delta: "printf 'delta 0.19.2'"
  }, { before: "printf 'Welcome to the server\\n'; printf 'Shell warning\\n' >&2; ", after: "; printf '\\nGoodbye\\n'" });
  const result = await check(f.bridge);
  assert.deepEqual(result.tools.map(tool => tool.version), ['2.43.0.windows.1', '0.65.1', '0.19.2']);
  assert.match(result.details, /Welcome to the server/);
  assert.match(result.details, /Goodbye/);
  assert.match(result.details, /Shell warning/);
  assert.match(result.tools[1].details, /warning: local config\n/);
  assert.equal(result.tools[2].details, 'delta 0.19.2');
});

test('unknown or ambiguous version text is a failed check and never displayed as a version', async t => {
  const f = fixture(t, {
    git: "printf '<script>unexpected output</script>\\n'",
    lazygit: "printf 'version=0.65.1, version=9.9.9\\n'",
    delta: "printf 'delta 0.19.2\\ndelta 0.20.0\\n'"
  });
  const result = await check(f.bridge);
  assert.ok(result.tools.every(tool => tool.state === 'failed' && tool.version === ''));
  assert.equal(result.tools[0].details, '<script>unexpected output</script>\n');
});

test('NUL bytes in a tool response invalidate framing instead of silently changing output', async t => {
  const f = fixture(t, { ...installed, delta: "printf 'delta 0.19.2\\000extra\\n'" });
  await assert.rejects(check(f.bridge), error => error.code === 'INVALID_OUTPUT' && error.details.includes('\\x00extra'));
});

test('truncated, duplicated, reordered and malformed frames are rejected', async () => {
  const valid = framed();
  const malformed = [
    valid.slice(0, -1), valid.slice(START.length), valid + valid,
    valid.replace('lazygit\0', 'git\0'), valid.replace('git\x001\0', 'git\x002\0'),
    valid.replace('git version 2.43.0\n\x000\0', 'git version 2.43.0\n\x00999\0'),
    framed([['lazygit', '1', 'version=0.65.1', '0'], ['git', '1', 'git version 2.43.0', '0'], ['delta', '1', 'delta 0.19.2', '0']]),
    framed([['git', '0', 'unexpected', '127'], ['lazygit', '0', '', '127'], ['delta', '0', '', '127']]),
    'banner\0' + valid, valid + 'trailing\0'
  ];
  for (const output of malformed) await assert.rejects(check(response(output)), { code: 'INVALID_OUTPUT' });
  assert.equal((await check(response(valid))).tools[0].state, 'installed');
});

test('overall command failure and incomplete bridge results reject even if a valid frame exists', async () => {
  await assert.rejects(check(response(framed(), { exitCode: 1, stderr: 'Connection terminated' })), error => error.code === 'TOOLS_CHECK_FAILED' && error.details.includes('Connection terminated'));
  await assert.rejects(check(response(framed(), { exitCode: undefined })), { code: 'INVALID_OUTPUT' });
  await assert.rejects(check(response(framed(), { stderr: undefined })), { code: 'INVALID_OUTPUT' });
  await assert.rejects(check({}), { code: 'NO_BRIDGE' });
});

test('transport timeout and output-limit failures propagate without a retry', async () => {
  for (const code of ['OUTPUT_LIMIT_EXCEEDED', 'TIMEOUT']) {
    let calls = 0;
    const expected = Object.assign(new Error(code), { code });
    await assert.rejects(check({ ssh: { exec: async () => { calls++; throw expected; } } }), error => error === expected);
    assert.equal(calls, 1);
  }
});

test('bridge truncation and output-limit flags reject otherwise complete successful frames', async () => {
  for (const flag of ['truncated', 'outputLimitExceeded']) {
    await assert.rejects(check(response(framed(), { [flag]: true })), error =>
      error.code === 'OUTPUT_LIMIT' && error.details.includes('32 KiB'));
    assert.equal((await check(response(framed(), { [flag]: false }))).tools[0].state, 'installed');
  }
});
