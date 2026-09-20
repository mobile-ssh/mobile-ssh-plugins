const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFile, execFileSync } = require('node:child_process');

const exported = { exports: {} };
vm.compileFunction(fs.readFileSync(require.resolve('../plugins/git/ui/git.js'), 'utf8'), ['module'])(exported);
const { Client, parseStatus, quote, maxOutputBytes } = exported.exports;

function fixture(t, name = 'repository') {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-git-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repository = path.join(temporary, name);
  fs.mkdirSync(repository, { recursive: true });
  const env = { ...process.env, XDG_CONFIG_HOME: temporary, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Git Plugin Test');
  git('config', 'user.email', 'git-test@example.invalid');
  const calls = [];
  const bridge = { ssh: { exec: (command, options) => {
    calls.push({ command, options });
    return new Promise((resolve, reject) => {
      execFile('/bin/sh', ['-c', command], { cwd: temporary, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > options.maxOutputBytes) return reject(new Error('OUTPUT_LIMIT_EXCEEDED: stdout and stderr exceed the requested budget'));
        resolve({ stdout, stderr, exitCode: error ? error.code : 0 });
      });
    });
  } } };
  const write = (file, text) => {
    const destination = path.join(repository, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  };
  const commit = (message = 'fixture commit') => { git('add', '--all'); git('commit', '-m', message); return git('rev-parse', 'HEAD').trim(); };
  return { temporary, repository, env, git, bridge, calls, write, commit, client: new Client(bridge) };
}

function selected(state, filename) {
  const entry = state.files.find(file => file.path === filename);
  assert.ok(entry, 'expected changed file ' + JSON.stringify(filename));
  return entry;
}

test('ordinary folders have a distinct discovery outcome without masking other failures', async t => {
  const f = fixture(t);
  await assert.rejects(f.client.open(f.temporary), error => error.code === 'NOT_REPOSITORY'
    && /not a git repository/.test(error.stderr));
  assert.equal(fs.existsSync(path.join(f.temporary, '.git')), false);
  await assert.rejects(f.client.open(path.join(f.temporary, 'missing')), error => error.code === 'COMMAND_FAILED');
  const client = new Client({ ssh: { exec: async () => ({ stdout: '', stderr: 'fatal: detected dubious ownership in repository', exitCode: 128 }) } });
  await assert.rejects(client.open('/restricted'), error => error.code === 'COMMAND_FAILED');
  assert.equal((await f.client.open(f.repository)).root, f.repository);
});

test('empty repositories and unborn stage/unstage preserve working files', async t => {
  const f = fixture(t);
  let state = await f.client.open(f.repository);
  assert.equal(state.root, f.repository);
  assert.equal(state.unborn, true);
  assert.deepEqual(await f.client.history(), []);
  f.write('new.txt', 'first\n');
  state = await f.client.status();
  assert.match(await f.client.diff(selected(state, 'new.txt'), 'unstaged'), /\+first/);
  state = await f.client.stage(selected(state, 'new.txt'));
  f.write('new.txt', 'second\n');
  state = await f.client.status();
  state = await f.client.unstage(selected(state, 'new.txt'));
  assert.equal(selected(state, 'new.txt').untracked, true);
  assert.equal(fs.readFileSync(path.join(f.repository, 'new.txt'), 'utf8'), 'second\n');
  assert.ok(f.calls.every(call => call.options.maxOutputBytes === maxOutputBytes));
});

test('HOME expansion only interpolates the existing remote HOME and quotes the remaining path', async () => {
  const commands = [];
  const client = new Client({ ssh: { exec: async command => {
    commands.push(command);
    return { stdout: command.includes("'rev-parse'") ? '/remote/repository\n' : '# branch.oid (initial)\0# branch.head main\0', stderr: '', exitCode: 0 };
  } } });
  await client.open("~/repo ' $(touch INJECTED)");
  assert.ok(commands[0].includes(' -C "$HOME"/' + quote("repo ' $(touch INJECTED)")));
  await client.open('~');
  assert.ok(commands[2].includes(' -C "$HOME" '));
});

test('status and per-file diffs retain staged + unstaged, renames, deletions and binary files', async t => {
  const f = fixture(t);
  f.write('mixed.txt', 'base\n');
  f.write('old name\n.txt', 'rename me\n');
  f.write('delete.txt', 'delete me\n');
  f.write('binary.bin', Buffer.from([0, 1, 2]));
  f.commit();
  f.write('mixed.txt', 'staged\n');
  f.git('add', 'mixed.txt');
  f.write('mixed.txt', 'unstaged\n');
  f.git('mv', 'old name\n.txt', 'new name\n.txt');
  fs.unlinkSync(path.join(f.repository, 'delete.txt'));
  f.write('binary.bin', Buffer.from([0, 1, 3]));
  let state = await f.client.open(f.repository);
  assert.equal(selected(state, 'mixed.txt').staged, true);
  assert.equal(selected(state, 'mixed.txt').unstaged, true);
  assert.match(await f.client.diff(selected(state, 'mixed.txt'), 'staged'), /-base\n\+staged/);
  assert.match(await f.client.diff(selected(state, 'mixed.txt'), 'unstaged'), /-staged\n\+unstaged/);
  assert.equal(selected(state, 'new name\n.txt').oldPath, 'old name\n.txt');
  assert.match(await f.client.diff(selected(state, 'new name\n.txt'), 'staged'), /rename from/);
  assert.match(await f.client.diff(selected(state, 'delete.txt'), 'unstaged'), /deleted file mode/);
  assert.match(await f.client.diff(selected(state, 'binary.bin'), 'unstaged'), /Binary files .* differ/);
  state = await f.client.unstage(selected(state, 'new name\n.txt'));
  assert.equal(selected(state, 'old name\n.txt').worktree, 'D');
  assert.equal(selected(state, 'new name\n.txt').untracked, true);
});

test('literal paths and shell quoting stage only the exact unusual UTF-8 filename', async t => {
  const f = fixture(t, "repo '$()\n");
  f.write('tracked.txt', 'base\n');
  f.commit();
  const names = ['-option.txt', ':(glob)*', "雪 ' $(touch INJECTED) `touch INJECTED`\t\n.txt", 'other.txt'];
  names.forEach(name => f.write(name, 'hello\n'));
  let state = await f.client.open(f.repository);
  assert.equal(state.root, f.repository);
  for (const name of names.slice(0, -1)) {
    assert.match(await f.client.diff(selected(state, name), 'unstaged'), /\+hello/);
    state = await f.client.stage(selected(state, name));
    assert.equal(selected(state, name).staged, true);
  }
  assert.equal(selected(state, 'other.txt').untracked, true);
  assert.equal(fs.existsSync(path.join(f.repository, 'INJECTED')), false);
  assert.equal(fs.existsSync(path.join(f.temporary, 'INJECTED')), false);
  for (const name of names.slice(0, -1)) state = await f.client.unstage(selected(state, name));
  assert.equal(state.files.filter(file => file.staged).length, 0);
});

test('invalid UTF-8 and literal replacement-character names cannot alias a staged file', async t => {
  const f = fixture(t);
  await f.client.open(f.repository);
  const invalid = Buffer.concat([Buffer.from(f.repository + path.sep + 'invalid-'), Buffer.from([0xff]), Buffer.from('.txt')]);
  fs.writeFileSync(invalid, 'invalid UTF-8 name\n');
  f.write('invalid-\uFFFD.txt', 'valid replacement-character name\n');
  f.write('safe.txt', 'ordinary file\n');
  await assert.rejects(f.client.status(), { code: 'INVALID_ENCODING' });
  await assert.rejects(f.client.stage('invalid-\uFFFD.txt'), { code: 'INVALID_ENCODING' });
  await assert.rejects(f.client.stage('safe.txt'), { code: 'INVALID_ENCODING' });
  assert.equal(f.git('diff', '--cached', '--name-only', '-z'), '');
  assert.throws(() => parseStatus('? replacement-\uFFFD\0'), { code: 'INVALID_ENCODING' });
  const rootAlias = new Client({ ssh: { exec: async () => ({ stdout: '/remote/repository-\uFFFD\n', stderr: '', exitCode: 0 }) } });
  await assert.rejects(rootAlias.open('/remote/repository-\uFFFD'), { code: 'INVALID_ENCODING' });
  assert.equal(rootAlias.root, '');
});

test('diff ignores configured external helpers, text conversion, colors and presentation settings', async t => {
  const f = fixture(t);
  f.write('.gitattributes', '*.txt diff=malicious\n');
  f.write('file.txt', 'before\n');
  f.commit();
  f.git('config', 'diff.external', 'touch SHOULD_NOT_RUN');
  f.git('config', 'diff.malicious.textconv', 'touch SHOULD_NOT_RUN');
  f.git('config', 'diff.malicious.command', 'touch SHOULD_NOT_RUN');
  f.git('config', 'color.ui', 'always');
  f.git('config', 'diff.noprefix', 'true');
  f.git('config', 'diff.mnemonicPrefix', 'true');
  f.git('config', 'diff.wordRegex', '.');
  f.git('config', 'diff.context', '0');
  f.write('file.txt', 'after\n');
  const state = await f.client.open(f.repository);
  const patch = await f.client.diff(selected(state, 'file.txt'), 'unstaged');
  assert.match(patch, /^diff --git a\/file.txt b\/file.txt/m);
  assert.match(patch, /-before\n\+after/);
  assert.doesNotMatch(patch, /\u001b|SHOULD_NOT_RUN/);
  assert.equal(fs.existsSync(path.join(f.repository, 'SHOULD_NOT_RUN')), false);
  assert.equal(f.git('config', 'diff.external').trim(), 'touch SHOULD_NOT_RUN');
});

test('commit sends the exact message through stdin and preserves hooks', async t => {
  const f = fixture(t);
  f.write('file.txt', 'contents\n');
  let state = await f.client.open(f.repository);
  state = await f.client.stage(selected(state, 'file.txt'));
  const message = "subject ' $(touch INJECTED)\n\nbody `touch INJECTED`\nnext line";
  state = await f.client.commit(message);
  assert.equal(state.files.length, 0);
  assert.equal(f.git('log', '-1', '--format=%B').trim(), message);
  assert.equal(fs.existsSync(path.join(f.repository, 'INJECTED')), false);
  f.write('file.txt', 'changed\n');
  state = await f.client.status();
  await f.client.stage(selected(state, 'file.txt'));
  fs.writeFileSync(path.join(f.repository, '.git/hooks/pre-commit'), '#!/bin/sh\nprintf "%s\\n" "hook rejected this commit" >&2\nexit 1\n', { mode: 0o755 });
  await assert.rejects(f.client.commit('rejected'), error => error.code === 'COMMAND_FAILED' && /hook rejected/.test(error.message) && error.status.files.length === 1);
  assert.equal(f.git('rev-list', '--count', 'HEAD').trim(), '1');
  assert.equal(f.client.busy, false);
});

test('history pages and root, regular, rename and merge diffs use the first parent', async t => {
  const f = fixture(t);
  f.write('root.txt', 'root\n');
  const root = f.commit('root subject');
  f.git('mv', 'root.txt', 'renamed.txt');
  const rename = f.commit('rename subject');
  f.git('checkout', '-b', 'side');
  f.write('side.txt', 'side branch\n');
  f.commit('side subject');
  f.git('checkout', 'main');
  f.write('main.txt', 'main branch\n');
  f.commit('main subject');
  f.git('merge', '--no-ff', 'side', '-m', 'merge subject');
  const merge = f.git('rev-parse', 'HEAD').trim();
  await f.client.open(f.repository);
  const first = await f.client.history({ limit: 2 });
  const rest = await f.client.history({ skip: 2, limit: 3 });
  assert.equal(first.length, 2);
  assert.equal(rest.length, 3);
  assert.equal(new Set(first.concat(rest).map(commit => commit.oid)).size, 5);
  assert.equal(first[0].parents.length, 2);
  const rootFiles = await f.client.commitFiles(root);
  assert.equal(rootFiles[0].path, 'root.txt');
  assert.match(await f.client.commitDiff(root, rootFiles[0]), /new file mode/);
  const renamed = (await f.client.commitFiles(rename))[0];
  assert.equal(renamed.path, 'renamed.txt');
  assert.equal(renamed.oldPath, 'root.txt');
  assert.match(await f.client.commitDiff(rename, renamed), /rename from root.txt/);
  const mergeFiles = await f.client.commitFiles(merge);
  assert.deepEqual(mergeFiles.map(file => file.path), ['side.txt']);
  assert.match(await f.client.commitDiff(merge, mergeFiles[0]), /\+side branch/);
});

test('changed status invalidates stale selection and conflict operations route to the terminal', async t => {
  const f = fixture(t);
  f.write('file.txt', 'base\n');
  f.commit();
  f.write('file.txt', 'working\n');
  const initial = await f.client.open(f.repository);
  f.git('add', 'file.txt');
  await assert.rejects(f.client.stage(selected(initial, 'file.txt')), { code: 'STALE_FILE' });
  f.git('reset', '--hard', 'HEAD');
  f.git('checkout', '-b', 'side');
  f.write('file.txt', 'side\n');
  f.commit();
  f.git('checkout', 'main');
  f.write('file.txt', 'main\n');
  f.commit();
  assert.throws(() => f.git('merge', 'side'));
  const state = await f.client.status();
  const conflict = selected(state, 'file.txt');
  assert.equal(conflict.conflicted, true);
  await assert.rejects(f.client.diff(conflict, 'unstaged'), { code: 'CONFLICT' });
  await assert.rejects(f.client.stage(conflict), { code: 'CONFLICT' });
  await assert.rejects(f.client.commit('do not commit conflict'), { code: 'CONFLICT' });
});

test('rejects path traversal and an untracked directory replaced by a symlink', async t => {
  const f = fixture(t);
  f.write('inside/file.txt', 'inside\n');
  let state = await f.client.open(f.repository);
  for (const name of ['../outside', '/etc/passwd', 'a/../../b', 'a\0b']) {
    await assert.rejects(f.client.diff(name, 'unstaged'), { code: 'INVALID_PATH' });
    await assert.rejects(f.client.stage(name), { code: 'INVALID_PATH' });
  }
  const oldFile = selected(state, 'inside/file.txt');
  fs.renameSync(path.join(f.repository, 'inside'), path.join(f.temporary, 'outside'));
  fs.symlinkSync(path.join(f.temporary, 'outside'), path.join(f.repository, 'inside'));
  await assert.rejects(f.client.diff(oldFile, 'unstaged'), { code: 'STALE_FILE' });
});

test('untracked preview rejects a parent swapped outside the repository after its status check', async t => {
  const f = fixture(t);
  f.write('inside/file.txt', 'inside\n');
  const state = await f.client.open(f.repository);
  const bridgeExec = f.bridge.ssh.exec;
  let swapped = false;
  f.bridge.ssh.exec = async (command, options) => {
    const result = await bridgeExec(command, options);
    if (!swapped && command.includes("'status'")) {
      swapped = true;
      fs.renameSync(path.join(f.repository, 'inside'), path.join(f.temporary, 'outside'));
      fs.symlinkSync(path.join(f.temporary, 'outside'), path.join(f.repository, 'inside'));
    }
    return result;
  };
  await assert.rejects(f.client.diff(selected(state, 'inside/file.txt'), 'unstaged'), error => error.code === 'STALE_FILE' && /outside/.test(error.message));
});

test('worktrees are discovered without assuming .git is a directory', async t => {
  const f = fixture(t);
  f.write('file.txt', 'initial\n');
  f.commit();
  const worktree = path.join(f.temporary, 'other-worktree');
  f.git('worktree', 'add', '-b', 'worktree-branch', worktree);
  fs.writeFileSync(path.join(worktree, 'file.txt'), 'worktree change\n');
  const state = await f.client.open(worktree);
  assert.equal(state.root, worktree);
  assert.equal(state.branch, 'worktree-branch');
  assert.match(await f.client.diff(selected(state, 'file.txt'), 'unstaged'), /\+worktree change/);
});

test('deleted files can be staged and unstaged; symlink previews show the target name only', async t => {
  const f = fixture(t);
  f.write('delete.txt', 'will be deleted\n');
  f.commit();
  fs.unlinkSync(path.join(f.repository, 'delete.txt'));
  const secret = path.join(f.temporary, 'outside.txt');
  fs.writeFileSync(secret, 'OUTSIDE FILE CONTENTS\n');
  fs.symlinkSync(secret, path.join(f.repository, 'link.txt'));
  let state = await f.client.open(f.repository);
  const linkPatch = await f.client.diff(selected(state, 'link.txt'), 'unstaged');
  assert.match(linkPatch, /new file mode 120000/);
  assert.ok(linkPatch.includes(secret));
  assert.doesNotMatch(linkPatch, /OUTSIDE FILE CONTENTS/);
  state = await f.client.stage(selected(state, 'delete.txt'));
  assert.equal(selected(state, 'delete.txt').index, 'D');
  assert.match(await f.client.diff(selected(state, 'delete.txt'), 'staged'), /deleted file mode/);
  state = await f.client.unstage(selected(state, 'delete.txt'));
  assert.equal(selected(state, 'delete.txt').worktree, 'D');
  assert.equal(fs.existsSync(path.join(f.repository, 'delete.txt')), false);
});

test('submodule changes are present even when repository configuration ignores them', async t => {
  const f = fixture(t);
  const sub = path.join(f.temporary, 'sub');
  fs.mkdirSync(sub);
  execFileSync('git', ['init', '--initial-branch=main', sub], { env: f.env, stdio: 'pipe' });
  execFileSync('git', ['-C', sub, '-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', 'commit', '--allow-empty', '-m', 'sub root'], { env: f.env, stdio: 'pipe' });
  f.git('-c', 'protocol.file.allow=always', 'submodule', 'add', sub, 'module');
  f.commit();
  f.git('config', 'submodule.module.ignore', 'all');
  f.write('module/untracked.txt', 'nested change\n');
  const state = await f.client.open(f.repository);
  const entry = selected(state, 'module');
  assert.match(entry.submodule, /^S/);
  assert.equal(entry.unstaged, true);
  assert.match(await f.client.diff(entry, 'unstaged'), /Subproject commit .*dirty/);
});

test('missing upstream and detached HEAD never fall back to an arbitrary push destination', async t => {
  const f = fixture(t);
  f.write('file.txt', 'base\n');
  f.commit();
  await f.client.open(f.repository);
  for (const action of ['fetch', 'pull', 'push']) await assert.rejects(f.client[action](), { code: 'NO_UPSTREAM' });
  f.git('checkout', '--detach');
  const state = await f.client.status();
  assert.equal(state.detached, true);
  await assert.rejects(f.client.push(), { code: 'NO_UPSTREAM' });
});

test('push targets only configured upstream despite push defaults, forced refspecs and mirror config', async t => {
  const f = fixture(t);
  const remote = path.join(f.temporary, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { env: f.env, stdio: 'pipe' });
  f.write('file.txt', 'base\n');
  f.commit();
  f.git('remote', 'add', 'origin', remote);
  f.git('push', '--set-upstream', 'origin', 'main');
  f.git('branch', 'unrelated');
  f.git('config', 'push.default', 'matching');
  f.git('config', 'remote.origin.push', '+refs/heads/*:refs/heads/*');
  f.git('config', 'remote.origin.mirror', 'true');
  f.git('config', 'remote.pushDefault', 'does-not-exist');
  f.git('config', 'branch.main.pushRemote', 'also-does-not-exist');
  f.write('file.txt', 'next\n');
  f.commit();
  await f.client.open(f.repository);
  await f.client.push();
  const remoteGit = (...args) => execFileSync('git', ['--git-dir=' + remote, ...args], { env: f.env, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(remoteGit('rev-parse', 'main').trim(), f.git('rev-parse', 'HEAD').trim());
  assert.equal(remoteGit('for-each-ref', '--format=%(refname)', 'refs/heads/').trim(), 'refs/heads/main');
  f.git('reset', '--hard', 'HEAD~1');
  await assert.rejects(f.client.push(), error => error.code === 'COMMAND_FAILED' && /non-fast-forward|fetch first|rejected/.test(error.message));
  assert.notEqual(remoteGit('rev-parse', 'main').trim(), f.git('rev-parse', 'HEAD').trim());
});

test('fetch and pull use upstream, and pull rejects divergence instead of rebasing or merging', async t => {
  const f = fixture(t);
  const remote = path.join(f.temporary, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { env: f.env, stdio: 'pipe' });
  f.write('file.txt', 'base\n');
  f.commit();
  f.git('remote', 'add', 'origin', remote);
  f.git('push', '--set-upstream', 'origin', 'main');
  f.write('file.txt', 'remote change\n');
  const remoteHead = f.commit();
  f.git('push', 'origin', 'main');
  f.git('reset', '--hard', 'HEAD~1');
  await f.client.open(f.repository);
  await f.client.fetch();
  await f.client.pull();
  assert.equal(f.git('rev-parse', 'HEAD').trim(), remoteHead);
  f.git('reset', '--hard', 'HEAD~1');
  f.write('local.txt', 'local divergence\n');
  const localHead = f.commit();
  f.git('config', 'pull.rebase', 'true');
  f.git('config', 'pull.ff', 'false');
  f.git('config', 'rebase.autoStash', 'true');
  await assert.rejects(f.client.pull(), error => error.code === 'COMMAND_FAILED' && /fast-forward/.test(error.message));
  assert.equal(f.git('rev-parse', 'HEAD').trim(), localHead);
});

test('bounded output rejects oversized diffs, status and truncated host responses', async t => {
  const f = fixture(t);
  f.write('large.txt', 'small\n');
  f.commit();
  f.write('large.txt', 'large line\n'.repeat(230000));
  const state = await f.client.open(f.repository);
  await assert.rejects(f.client.diff(selected(state, 'large.txt'), 'unstaged'), { code: 'OUTPUT_LIMIT' });
  const limited = new Client({ ssh: { exec: async () => { throw new Error('OUTPUT_LIMIT_EXCEEDED'); } } });
  await assert.rejects(limited.open('/repo'), { code: 'OUTPUT_LIMIT' });
  const truncated = new Client({ ssh: { exec: async () => ({ stdout: '/repo\n', stderr: '', exitCode: 0, truncated: true }) } });
  await assert.rejects(truncated.open('/repo'), { code: 'OUTPUT_LIMIT' });
  assert.throws(() => parseStatus('# branch.head main'), { code: 'INVALID_OUTPUT' });
});

test('write lock prevents overlap; disconnect refreshes once without repeating the write', async t => {
  const f = fixture(t);
  f.write('file.txt', 'base\n');
  f.commit();
  f.write('file.txt', 'next\n');
  let state = await f.client.open(f.repository);
  const bridgeExec = f.bridge.ssh.exec;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let writes = 0;
  f.bridge.ssh.exec = async (command, options) => {
    if (command.includes("'add' '-A'")) {
      writes++;
      await pending;
      await bridgeExec(command, options);
      throw new Error('SSH disconnected after sending command');
    }
    return bridgeExec(command, options);
  };
  const operation = f.client.stage(selected(state, 'file.txt'));
  await assert.rejects(f.client.stage(selected(state, 'file.txt')), { code: 'BUSY' });
  await assert.rejects(f.client.open(f.repository), { code: 'BUSY' });
  release();
  await assert.rejects(operation, error => /disconnected/.test(error.message) && selected(error.status, 'file.txt').staged);
  assert.equal(writes, 1);
  assert.equal(f.client.busy, false);
});

test('quoting and history input validation reject command separators as data', async t => {
  assert.equal(quote("a'b"), "'a'\\''b'");
  assert.throws(() => quote('x\0y'), { code: 'INVALID_ARGUMENT' });
  const f = fixture(t);
  await f.client.open(f.repository);
  await assert.rejects(f.client.history({ skip: '0; touch INJECTED' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.client.history({ limit: 0 }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.client.commitDiff('HEAD; touch INJECTED', 'file.txt'), { code: 'INVALID_COMMIT' });
});
