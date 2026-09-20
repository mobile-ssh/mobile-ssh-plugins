# Git plugin and terminal tools

The Git plugin reviews and changes working trees on the connected SSH server.
It uses the server's Git executable and bundles diff2html locally; repository
contents do not pass through a hosted service or an additional server process.

## Getting started

1. Connect to the server and open the Git plugin.
2. Enter the working tree directory. The plugin starts with the terminal's
   current directory when available and remembers the last directory per server.
   Absolute paths and `~/...` paths are supported.
   If the current folder is not a Git repository, the plugin asks you to open
   a Git project. Technical details stay collapsed below that guidance.
3. Select a file under **Staged**, **Unstaged**, or **Untracked** to review its
   patch. Unified view is the default; split view, wrapping, text size, and
   previous/next change controls are available.
4. Stage or unstage whole files, enter a commit message, then commit the staged
   changes. Fetch, pull, and push use the current branch's configured upstream.

Use **Terminal** to return to the SSH terminal. The Android **Git tools** action
opens lazygit in an interactive terminal pane for branch changes, hunk staging,
stash, rebase, conflicts, and operations requiring an interactive prompt. The
plugin's setup controls can check for Git, lazygit, and delta and install the
optional terminal tools through the host's recipe approval interface. Terminal
tool installation is separate from the touch interface; Git alone is sufficient
for the touch interface.

Expand **Git tools setup** and tap **Check tools** to see a status and compact
version for each tool. Installed tools do not offer an install action. Missing
optional tools offer **Install** once Git is available; missing Git includes
package-manager guidance. Full version output and installation logs are kept
under **Details**. **Check again** refreshes the status without installing anything.

The host must implement bridge **1.2.0** or later, including bounded `ssh.exec`
output. The plugin requests `SSH_EXEC` and `STORAGE`. The server needs Git with
porcelain-v2 status support and the diff/pull options used by the plugin (the
automated integration suite runs against Git 2.43). SSH commands are
noninteractive; configure Git identity, upstream branches, credentials, and
signing on the server as needed.

## Behavior and limits

- Staged and unstaged changes in the same file are shown separately. File
  operations affect the entire selected file. Staging uses the file's current
  working contents, so refresh after editing from another terminal.
- UTF-8 filenames are parsed from NUL-delimited Git output, including spaces,
  quotes, tabs, newlines, leading dashes, and Git pathspec-looking names. Names
  with invalid UTF-8 bytes cannot round-trip through the text bridge and must
  be handled in the terminal. The plugin rejects filenames and repository
  roots containing the replacement character U+FFFD, including names that
  contain that character literally: the bridge cannot distinguish them from
  invalid bytes that were replaced during decoding. This prevents selecting
  a different file with the same decoded name.
- Renames, deletions, binary files, symlinks, submodules, unborn branches,
  detached HEAD, and linked worktrees are recognized. Binary files receive a
  notice rather than a text preview. Submodules show the gitlink/dirty summary;
  open the submodule directory to review its internal files.
- History is paginated in groups of 30 commits. A selected commit shows its
  changes against its first parent; root commits are compared with an empty
  tree. Merge conflict resolution stays in the terminal.
- Pull is fast-forward-only and does not automatically rebase, merge, or stash.
  Push targets only `HEAD` at the configured upstream branch, without force,
  mirror, matching-branch, or follow-tags behavior. Neither action guesses a
  remote when an upstream is missing. Fetch uses the upstream remote.
- Git's repository/user settings, commit signing, and hooks remain active.
  The viewer disables external diff programs, text-conversion helpers, ANSI
  color, and custom patch presentation for each diff request. Git configuration
  files are not changed. Git repository-selection environment variables are
  cleared, including `GIT_NAMESPACE`, so the selected working tree determines
  the target repository and refs.
- Each command has a combined stdout/stderr limit of **2 MiB**. Exceeding it is
  an explicit failure; a partial patch is never passed to the renderer. The UI
  additionally declines patches over 400,000 characters or 6,000 lines to keep
  the WebView responsive. Use the terminal for larger results.
- Read commands time out after 30 seconds. Commit and synchronization commands
  allow up to 120 seconds. Interactive credential, signing, and hook failures
  show the server's error text and can be completed in the terminal.
- Only one write runs at a time. Status is refreshed after writes and, when
  possible, after failures. A write is never automatically retried after an SSH
  disconnect: it may already have completed on the server. Refresh before
  deciding whether another action is needed.

All filenames, commit messages, and repository paths are shell-quoted. Literal
pathspec handling prevents a filename such as `:(glob)*` from selecting other
files. Untracked previews check the current file list and physical parent path
before invoking `git diff --no-index`, and do not preview directories. Source
content and error details are displayed as text or escaped diff2html output.

## Core interface

`ui/git.js` exposes `window.MobileGit` and a CommonJS export for the test harness.
The UI creates `new MobileGit.Client(MobileSSH)` and calls:

```js
await client.open(directory);                 // Resolve working tree and status
await client.status();
await client.diff(file, 'staged');             // Or 'unstaged'; raw Git patch
await client.history({ skip: 0, limit: 30 });
await client.commitFiles(commitOid);
await client.commitDiff(commitOid, file);
await client.stage(file);
await client.unstage(file);
await client.commit(message);
await client.fetch();
await client.pull();
await client.push();
```

Status includes the resolved `root`, branch/HEAD information, upstream and
ahead/behind counts, and files with their exact `path`, optional `oldPath`, index
and worktree status, submodule state, and staged/unstaged/untracked/conflicted
flags. Pass the file object back to the core so it can reject a changed Git
status fingerprint instead of acting on an outdated selection. History entries
contain the commit object ID, parents, author, ISO date, and subject.

Writes return refreshed status. Errors have a `code`; server command failures
also retain `exitCode`, `stdout`, and `stderr`. A write error may include a fresh
`status`. `actionCompleted: true` means the write succeeded but its subsequent
status refresh failed. Errors with an unknown outcome are not evidence that
the server rolled back the command.

## Validation

Run the isolated real-Git fixtures and the repository's usual checks:

```sh
npm run test:git
npm run check
```

The core suite covers literal/shell-special filenames, staged plus unstaged
changes, rename/deletion/binary/symlink/submodule handling, unborn branches,
worktrees, history pagination/root/merge diffs, failing hooks, configured diff
helpers, upstream-only non-force pushes under conflicting push configuration,
fast-forward-only pulls, stale selections, traversal rejection, bounded output,
overlapping writes, and disconnects after a write was sent. Fixtures create
temporary repositories and never operate on the developer's working tree.

`tests/git-browser-smoke.cjs` runs the complete UI and bundled renderer against a temporary real
Git repository in Chromium, including mobile portrait/landscape layout, syntax highlighting,
escaped source, staging, commit/history, binary fallback, and a failed repository switch.
It uses Playwright if installed; an external installation and Chromium binary can be supplied:

```sh
MOBILE_GIT_PLAYWRIGHT=/path/to/node_modules/playwright \
MOBILE_GIT_CHROMIUM=/path/to/chrome \
MOBILE_GIT_ARTIFACTS=/tmp/mobile-git-artifacts \
node tests/git-browser-smoke.cjs
```

Device acceptance still includes portrait/landscape, a visible soft keyboard,
touch selection, terminal mouse events, current Android WebView rendering,
server authentication/signing prompts, and a connection lost during a write.
Bundled diff2html and highlighting license notices are shipped with the plugin.
