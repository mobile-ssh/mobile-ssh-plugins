/* Bounded, read-only remote Git tool detection. MIT. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MobileGitTools = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  var LIMIT = 32768;
  var START = '\0MOBILE_SSH_GIT_TOOLS_V1\0';
  var END = 'MOBILE_SSH_GIT_TOOLS_END\0';
  var IDS = ['git', 'lazygit', 'delta'];
  // Version output goes directly to the bounded SSH stream. Command substitution
  // would buffer it on the server and remove trailing newlines and NUL bytes.
  var COMMAND = 'export PATH="$HOME/.local/bin:$PATH" LC_ALL=C; ' +
    "printf '\\000MOBILE_SSH_GIT_TOOLS_V1\\000'; " +
    'for mobile_git_tool in git lazygit delta; do ' +
      'if mobile_git_executable=$(command -v "$mobile_git_tool" 2>/dev/null); then ' +
        "printf '%s\\0001\\000' \"$mobile_git_tool\"; " +
        'if "$mobile_git_executable" --version 2>&1; then mobile_git_status=0; else mobile_git_status=$?; fi; ' +
        "printf '\\000%s\\000' \"$mobile_git_status\"; " +
      'else ' +
        "printf '%s\\0000\\000\\000127\\000' \"$mobile_git_tool\"; " +
      'fi; ' +
    'done; ' +
    "printf 'MOBILE_SSH_GIT_TOOLS_END\\000'";

  function failure(code, details) {
    var error = new Error('Unable to check the Git tools on this server.');
    error.code = code;
    error.details = details || '';
    return error;
  }

  function version(id, output) {
    var patterns = {
      git: /^git version ([0-9][0-9A-Za-z.+_-]*)(?:[ \t]|\r?$)/gm,
      lazygit: /(?:^|,[ \t]*)version=v?([0-9][0-9A-Za-z.+_-]*)(?=,|\s|$)|^lazygit(?: version)?[ \t]+v?([0-9][0-9A-Za-z.+_-]*)(?:[ \t]|\r?$)/gm,
      delta: /^delta[ \t]+v?([0-9][0-9A-Za-z.+_-]*)(?:[ \t]|\r?$)/gm
    };
    var matches = [], match;
    while ((match = patterns[id].exec(output))) matches.push(match[1] || match[2]);
    return matches.length === 1 ? matches[0] : '';
  }

  function readable(text) {
    // Framing and unexpected control bytes belong in diagnostics as escaped text.
    return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, function (character) {
      return '\\x' + character.charCodeAt(0).toString(16).padStart(2, '0');
    });
  }

  function parse(result) {
    if (!result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || !Number.isInteger(result.exitCode)) {
      throw failure('INVALID_OUTPUT', 'The SSH command returned an incomplete result.');
    }
    var stdout = result.stdout, stderr = result.stderr;
    var rawDetails = readable(stdout + (stderr ? '\n' + stderr : ''));
    if (result.truncated || result.outputLimitExceeded) throw failure('OUTPUT_LIMIT', 'Tool check output exceeds 32 KiB.\n' + rawDetails);
    if (result.exitCode !== 0) throw failure('TOOLS_CHECK_FAILED', rawDetails);
    var start = stdout.indexOf(START), end = stdout.indexOf(END);
    if (start < 0 || end < start + START.length || stdout.indexOf(START, start + START.length) !== -1 || stdout.indexOf(END, end + END.length) !== -1) {
      throw failure('INVALID_OUTPUT', rawDetails);
    }
    var before = stdout.slice(0, start), after = stdout.slice(end + END.length);
    var fields = stdout.slice(start + START.length, end).split('\0');
    if (before.indexOf('\0') !== -1 || after.indexOf('\0') !== -1 || fields.length !== IDS.length * 4 + 1 || fields.pop() !== '') {
      throw failure('INVALID_OUTPUT', rawDetails);
    }
    var tools = [], diagnostics = [];
    IDS.forEach(function (id, index) {
      var offset = index * 4;
      var found = fields[offset + 1], output = fields[offset + 2], status = fields[offset + 3];
      if (fields[offset] !== id || !/^[01]$/.test(found) || !/^(?:0|[1-9][0-9]{0,2})$/.test(status) || Number(status) > 255 || (found === '0' && (output !== '' || status !== '127'))) {
        throw failure('INVALID_OUTPUT', rawDetails);
      }
      var detected = found === '1' && status === '0' ? version(id, output) : '';
      tools.push({ id: id, state: found === '0' ? 'missing' : detected ? 'installed' : 'failed', version: detected, details: readable(output) });
      diagnostics.push(id + ' --version (exit ' + status + ')\n' + (found === '0' ? 'Executable not found in PATH.' : readable(output)));
    });
    if (before || after || stderr) diagnostics.push('Shell output\n' + readable(before + after + stderr));
    return { tools: tools, details: diagnostics.join('\n\n') };
  }

  async function check(bridge) {
    if (!bridge || !bridge.ssh || typeof bridge.ssh.exec !== 'function') throw failure('NO_BRIDGE', 'The Mobile SSH bridge is unavailable.');
    return parse(await bridge.ssh.exec(COMMAND, { timeoutMs: 15000, maxOutputBytes: LIMIT }));
  }

  return { check: check };
});
