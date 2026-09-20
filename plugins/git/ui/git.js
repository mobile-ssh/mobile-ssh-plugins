/* Remote Git operations. No source text is interpreted as shell or HTML. MIT. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MobileGit = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  var OUTPUT_LIMIT = 2 * 1024 * 1024;
  var ENV = 'unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX GIT_NAMESPACE GIT_GLOB_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_ICASE_PATHSPECS; ' +
    'export PATH="$HOME/.local/bin:$PATH" GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never GIT_ASKPASS=false SSH_ASKPASS=false GIT_PAGER=cat GIT_OPTIONAL_LOCKS=0; ';
  var DIFF_OPTIONS = ['--no-ext-diff', '--no-textconv', '--no-color', '--word-diff=none',
    '--no-relative', '--src-prefix=a/', '--dst-prefix=b/', '--line-prefix=', '--unified=3',
    '--inter-hunk-context=0', '--no-function-context', '--output-indicator-new=+',
    '--output-indicator-old=-', '--output-indicator-context= ', '--submodule=short', '--ignore-submodules=none'];

  function failure(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function quote(value) {
    if (typeof value !== 'string' || value.indexOf('\0') !== -1) throw failure('INVALID_ARGUMENT', 'Git arguments must be text without NUL characters.');
    return "'" + value.replace(/'/g, "'\\''") + "'";
  }

  function pathArgument(value) {
    if (value === '~') return '"$HOME"';
    if (value.indexOf('~/') === 0) return '"$HOME"/' + quote(value.slice(2));
    return quote(value);
  }

  function filePath(value) {
    if (typeof value === 'string' && value.indexOf('\uFFFD') !== -1) {
      throw failure('INVALID_ENCODING', 'This filename cannot be represented reliably by the SSH text bridge. Use the terminal for this repository.');
    }
    if (typeof value !== 'string' || !value || value.indexOf('\0') !== -1 || value[0] === '/' || value.split('/').some(function (part) { return !part || part === '.' || part === '..'; })) {
      throw failure('INVALID_PATH', 'Select a file inside this repository.');
    }
    return value;
  }

  function oid(value) {
    if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) throw failure('INVALID_COMMIT', 'Select a commit from the history.');
    return value;
  }

  // Only the fixed metadata fields are separated on spaces. The final field is
  // an unquoted filename and can contain spaces, tabs, newlines and UTF-8 text.
  function fields(record, count) {
    var result = [], start = 0;
    for (var i = 0; i < count; i++) {
      var end = record.indexOf(' ', start);
      if (end < 0) throw failure('INVALID_OUTPUT', 'Incomplete Git status output.');
      result.push(record.slice(start, end));
      start = end + 1;
    }
    result.push(record.slice(start));
    return result;
  }

  function parseStatus(output) {
    if (output && output[output.length - 1] !== '\0') throw failure('INVALID_OUTPUT', 'Incomplete Git status output.');
    var state = { branch: '', oid: '', upstream: '', ahead: 0, behind: 0, unborn: false, detached: false, files: [] };
    var records = output.split('\0');
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record) continue;
      if (record.indexOf('# branch.') === 0) {
        var space = record.indexOf(' ', 2), key = record.slice(2, space), value = record.slice(space + 1);
        if (key === 'branch.oid') { state.oid = value === '(initial)' ? '' : value; state.unborn = value === '(initial)'; }
        if (key === 'branch.head') { state.branch = value === '(detached)' ? '' : value; state.detached = value === '(detached)'; }
        if (key === 'branch.upstream') state.upstream = value;
        if (key === 'branch.ab') {
          var counts = /^\+(\d+) -(\d+)$/.exec(value);
          if (counts) { state.ahead = Number(counts[1]); state.behind = Number(counts[2]); }
        }
        continue;
      }
      if (record[0] === '#') continue;
      var entry, data;
      if (record[0] === '?') {
        entry = { path: filePath(record.slice(2)), index: '?', worktree: '?', kind: 'untracked', submodule: 'N...', untracked: true };
      } else if (record[0] === '1' || record[0] === '2') {
        data = fields(record, record[0] === '2' ? 9 : 8);
        entry = { path: filePath(data[data.length - 1]), index: data[1][0], worktree: data[1][1], submodule: data[2], kind: record[0] === '2' ? 'rename' : 'ordinary' };
        if (record[0] === '2') {
          if (!records[i + 1]) throw failure('INVALID_OUTPUT', 'Incomplete rename in Git status output.');
          entry.oldPath = filePath(records[++i]);
        }
      } else if (record[0] === 'u') {
        data = fields(record, 10);
        entry = { path: filePath(data[10]), index: data[1][0], worktree: data[1][1], submodule: data[2], kind: 'conflict', conflicted: true };
      } else {
        throw failure('INVALID_OUTPUT', 'Unrecognized Git status output.');
      }
      entry.untracked = !!entry.untracked;
      entry.conflicted = !!entry.conflicted;
      entry.staged = !entry.untracked && entry.index !== '.';
      entry.unstaged = entry.untracked || entry.worktree !== '.';
      entry.fingerprint = record + '\0' + (entry.oldPath || '');
      state.files.push(entry);
    }
    return state;
  }

  function parseNames(output) {
    if (output && output[output.length - 1] !== '\0') throw failure('INVALID_OUTPUT', 'Incomplete Git file list.');
    var tokens = output.split('\0'), result = [];
    for (var i = 0; i < tokens.length - 1; i++) {
      var kind = tokens[i], first = filePath(tokens[++i]);
      var entry = { path: first, kind: kind, index: '', worktree: '' };
      if (kind[0] === 'R' || kind[0] === 'C') { entry.oldPath = first; entry.path = filePath(tokens[++i]); }
      result.push(entry);
    }
    return result;
  }

  function Client(bridge) {
    if (!bridge || !bridge.ssh || typeof bridge.ssh.exec !== 'function') throw failure('NO_BRIDGE', 'The Mobile SSH bridge is unavailable.');
    this.bridge = bridge;
    this.root = '';
    this.busy = false;
    this.lastStatus = null;
  }

  Client.prototype._exec = async function (command, accepted, timeoutMs) {
    var result;
    try {
      result = await this.bridge.ssh.exec(ENV + command, { timeoutMs: timeoutMs || 30000, maxOutputBytes: OUTPUT_LIMIT });
    } catch (error) {
      if (/OUTPUT_LIMIT_EXCEEDED|OUTPUT_LIMIT|output.{0,30}limit/i.test(String(error.message || error))) {
        var limited = failure('OUTPUT_LIMIT', 'Git output exceeds 2 MiB. Open this repository in the terminal to review it.');
        limited.cause = error;
        throw limited;
      }
      throw error;
    }
    if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || typeof result.exitCode !== 'number') throw failure('INVALID_OUTPUT', 'The SSH host returned an invalid command result.');
    if (result.truncated || result.outputLimitExceeded) throw failure('OUTPUT_LIMIT', 'Git output exceeds 2 MiB. Open this repository in the terminal to review it.');
    if ((accepted || [0]).indexOf(result.exitCode) === -1) {
      var failed = failure('COMMAND_FAILED', result.stderr.trim() || result.stdout.trim() || 'Git exited with status ' + result.exitCode + '.');
      failed.exitCode = result.exitCode;
      failed.stderr = result.stderr;
      failed.stdout = result.stdout;
      throw failed;
    }
    return result;
  };

  Client.prototype._command = function (args, directory) {
    if (!directory && !this.root) throw failure('NO_REPOSITORY', 'Open a repository first.');
    return 'command git --no-pager --literal-pathspecs -c color.ui=false -c core.quotepath=true -C ' +
      pathArgument(directory || this.root) + ' ' + args.map(quote).join(' ');
  };

  Client.prototype._git = function (args, accepted, timeoutMs) {
    return this._exec(this._command(args), accepted, timeoutMs);
  };

  Client.prototype.open = async function (directory) {
    if (this.busy) throw failure('BUSY', 'Wait for the current Git operation to finish.');
    directory = directory || '~';
    if (typeof directory !== 'string') throw failure('INVALID_PATH', 'Enter a repository directory.');
    var discovered;
    try {
      // Only discovery needs stable diagnostics. Do not mistake missing paths,
      // permission failures or unsafe ownership for an ordinary non-repository.
      discovered = await this._exec('LC_ALL=C ' + this._command(['rev-parse', '--show-toplevel'], directory));
    } catch (error) {
      if (error.code === 'COMMAND_FAILED' && error.exitCode === 128 && /^fatal: not a git repository\b/m.test(error.stderr || '')) {
        error.code = 'NOT_REPOSITORY';
      }
      throw error;
    }
    // Remove only Git's terminating newline, preserving a newline in the name.
    var resolved = discovered.stdout.replace(/\n$/, '');
    if (resolved.indexOf('\uFFFD') !== -1) throw failure('INVALID_ENCODING', 'This repository path cannot be represented reliably by the SSH text bridge. Use the terminal for this repository.');
    if (!resolved || resolved[0] !== '/' || resolved.indexOf('\0') !== -1) throw failure('INVALID_OUTPUT', 'Git did not return an absolute working tree path.');
    var result = await this._exec(this._command(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--renames', '--ignore-submodules=none'], resolved));
    var state = parseStatus(result.stdout);
    this.root = resolved;
    state.root = resolved;
    this.lastStatus = state;
    return state;
  };

  Client.prototype.status = async function () {
    var result = await this._git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--renames', '--ignore-submodules=none']);
    var state = parseStatus(result.stdout);
    state.root = this.root;
    this.lastStatus = state;
    return state;
  };

  Client.prototype._currentFile = async function (file) {
    var path = filePath(typeof file === 'string' ? file : file && file.path);
    var state = await this.status();
    var current = state.files.find(function (entry) { return entry.path === path; });
    if (!current || (file && file.fingerprint && current.fingerprint !== file.fingerprint)) throw failure('STALE_FILE', 'This file changed since the list was loaded. Refresh and select it again.');
    return current;
  };

  function paths(file, oldToo) {
    var result = [filePath(typeof file === 'string' ? file : file.path)];
    if (oldToo && file.oldPath && file.oldPath !== result[0]) result.unshift(filePath(file.oldPath));
    return result;
  }

  Client.prototype.diff = async function (file, area) {
    if (area !== 'staged' && area !== 'unstaged') throw failure('INVALID_ARGUMENT', 'Choose staged or unstaged changes.');
    var current = await this._currentFile(file);
    if (current.conflicted) throw failure('CONFLICT', 'Resolve this conflict in the terminal, then refresh.');
    if (area === 'staged' && !current.staged || area === 'unstaged' && !current.unstaged) return '';
    if (current.untracked) {
      // Status lists individual files rather than untracked directories. Recheck
      // the parent physically so an intervening directory symlink cannot turn
      // --no-index into a reader outside the selected repository.
      var slash = current.path.lastIndexOf('/');
      var parent = slash < 0 ? '.' : current.path.slice(0, slash);
      var guard = 'cd -P ' + quote(this.root) + ' && mobile_git_root=${PWD%/} && mobile_git_parent=$(cd -P ' + quote('./' + parent) + ' && printf "%s/." "$PWD") && ' +
        'case "$mobile_git_parent" in "$mobile_git_root/"*) ;; *) printf %s ' + quote('Selected file is outside this repository.') + ' >&2; exit 1;; esac && ' +
        '! { test -d ' + quote('./' + current.path) + ' && ! test -L ' + quote('./' + current.path) + '; } && ';
      var untracked = await this._exec(guard + this._command(['diff', '--no-index', '--patch'].concat(DIFF_OPTIONS, ['--', '/dev/null', './' + current.path])), [0, 1]);
      if (untracked.exitCode === 1 && !untracked.stdout) throw failure('STALE_FILE', untracked.stderr.trim() || 'This file is no longer available. Refresh the repository.');
      return untracked.stdout;
    }
    var args = ['diff', '--patch', '--find-renames'].concat(DIFF_OPTIONS);
    if (area === 'staged') args.push('--cached');
    var result = await this._git(args.concat(['--'], paths(current, true)));
    return result.stdout;
  };

  Client.prototype.history = async function (options) {
    options = options || {};
    var skip = options.skip === undefined ? 0 : options.skip, limit = options.limit === undefined ? 30 : options.limit;
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw failure('INVALID_ARGUMENT', 'History pages must contain 1 to 100 commits.');
    var state = await this.status();
    if (state.unborn) return [];
    var result = await this._git(['log', '--no-color', '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00', '--skip=' + skip, '--max-count=' + limit, 'HEAD', '--']);
    var tokens = result.stdout.split('\0'), commits = [];
    for (var i = 0; i + 4 < tokens.length; i += 5) {
      commits.push({ oid: oid(tokens[i].replace(/^\n/, '')), parents: tokens[i + 1] ? tokens[i + 1].split(' ') : [], author: tokens[i + 2], date: tokens[i + 3], subject: tokens[i + 4] });
    }
    return commits;
  };

  Client.prototype._parents = async function (commit) {
    oid(commit);
    var result = await this._git(['rev-list', '--parents', '--max-count=1', commit, '--']);
    var all = result.stdout.trim().split(' ');
    if (all[0] !== commit) throw failure('INVALID_COMMIT', 'The selected commit is unavailable.');
    return all.slice(1);
  };

  Client.prototype.commitFiles = async function (commit) {
    var parents = await this._parents(commit);
    var args = parents.length ? ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', parents[0], commit, '--'] :
      ['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', commit, '--'];
    return parseNames((await this._git(args)).stdout);
  };

  Client.prototype.commitDiff = async function (commit, file) {
    var parents = await this._parents(commit);
    var args = parents.length ? ['diff', '--patch', '--find-renames'].concat(DIFF_OPTIONS, [parents[0], commit, '--']) :
      ['diff-tree', '--root', '--no-commit-id', '-r', '--patch', '--find-renames'].concat(DIFF_OPTIONS, [commit, '--']);
    return (await this._git(args.concat(paths(file, true)))).stdout;
  };

  Client.prototype._write = async function (operation) {
    if (this.busy) throw failure('BUSY', 'Wait for the current Git operation to finish.');
    this.busy = true;
    var completed = false;
    try {
      await operation.call(this);
      completed = true;
      return await this.status();
    } catch (error) {
      error.actionCompleted = completed;
      // Refresh once to show the actual state after a hook, network or command
      // failure. Never repeat the write: a disconnected command may have run.
      if (!completed) {
        try { error.status = await this.status(); } catch (ignored) { /* Preserve the original failure. */ }
      }
      throw error;
    } finally {
      this.busy = false;
    }
  };

  Client.prototype.stage = function (file) {
    return this._write(async function () {
      var current = await this._currentFile(file);
      if (current.conflicted) throw failure('CONFLICT', 'Resolve and stage conflicts in the terminal.');
      await this._git(['add', '-A', '--'].concat(paths(current, current.index === '.')));
    });
  };

  Client.prototype.unstage = function (file) {
    return this._write(async function () {
      var current = await this._currentFile(file);
      if (current.conflicted) throw failure('CONFLICT', 'Resolve conflicts in the terminal.');
      if (!current.staged) throw failure('STALE_FILE', 'This file has no staged changes. Refresh the repository.');
      var args = this.lastStatus.unborn ? ['rm', '--cached', '-r', '-f', '--ignore-unmatch', '--'] : ['reset', '--quiet', 'HEAD', '--'];
      await this._git(args.concat(paths(current, true)));
    });
  };

  Client.prototype.commit = function (message) {
    return this._write(async function () {
      if (typeof message !== 'string' || !message.trim() || message.indexOf('\0') !== -1) throw failure('INVALID_MESSAGE', 'Enter a commit message.');
      var state = await this.status();
      if (state.files.some(function (file) { return file.conflicted; })) throw failure('CONFLICT', 'Resolve conflicts in the terminal before committing.');
      if (!state.files.some(function (file) { return file.staged; })) throw failure('NOTHING_STAGED', 'Stage at least one file before committing.');
      await this._exec('printf %s ' + quote(message) + ' | ' + this._command(['commit', '--file=-']), [0], 120000);
    });
  };

  Client.prototype._upstream = async function () {
    var symbolic = await this._git(['symbolic-ref', '--quiet', 'HEAD'], [0, 1]);
    if (symbolic.exitCode !== 0) throw failure('NO_UPSTREAM', 'Check out a branch and configure its upstream in the terminal.');
    var ref = symbolic.stdout.replace(/\n$/, '');
    var info = await this._git(['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)%00', '--', ref]);
    var parts = info.stdout.split('\0');
    if (!parts[0] || !parts[1] || parts[1].indexOf('refs/heads/') !== 0) throw failure('NO_UPSTREAM', 'Configure this branch\'s upstream in the terminal first.');
    return { remote: parts[0], ref: parts[1] };
  };

  Client.prototype.fetch = function () {
    return this._write(async function () {
      var upstream = await this._upstream();
      await this._git(['fetch', '--no-recurse-submodules', '--', upstream.remote], [0], 120000);
    });
  };

  Client.prototype.pull = function () {
    return this._write(async function () {
      var upstream = await this._upstream();
      await this._git(['pull', '--ff-only', '--no-rebase', '--no-autostash', '--no-edit', '--no-recurse-submodules', '--', upstream.remote, upstream.ref], [0], 120000);
    });
  };

  Client.prototype.push = function () {
    return this._write(async function () {
      var upstream = await this._upstream();
      // Git reads remote.<name>.mirror after parsing --no-mirror. Override it
      // for this invocation as well, so a repository's mirror configuration
      // cannot broaden an ordinary push or turn it into a forced update.
      await this._git(['-c', 'remote.' + upstream.remote + '.mirror=false', 'push', '--no-force', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no', '--', upstream.remote, 'HEAD:' + upstream.ref], [0], 120000);
    });
  };

  return { Client: Client, parseStatus: parseStatus, parseNames: parseNames, quote: quote, maxOutputBytes: OUTPUT_LIMIT };
});
