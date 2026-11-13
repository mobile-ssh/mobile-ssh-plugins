const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function mock() {
  let request;
  const window = { __MobileSSHNative: { invoke(method, json) {
    request = { method, args: JSON.parse(json) };
    return 'request';
  } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sdk/mobilessh.js'), 'utf8'), { window });
  return { window, request: () => request };
}

test('bounded exec sends byte limit and preserves NUL output', async () => {
  const m = mock();
  const result = m.window.MobileSSH.ssh.exec('git status', { maxOutputBytes: 2097152, timeoutMs: 500 });
  assert.equal(m.window.MobileSSH.version, '1.4.0');
  assert.deepEqual(m.request(), { method: 'ssh.exec', args: {
    command: 'git status', timeoutMs: 500, maxOutputBytes: 2097152
  } });
  m.window.__mobileSSH._resolve('request', null, JSON.stringify({ stdout: 'a\0b', stderr: '', exitCode: 0 }));
  assert.equal((await result).stdout, 'a\0b');
});

test('legacy exec omits the byte limit', async () => {
  const m = mock();
  const result = m.window.MobileSSH.ssh.exec('pwd');
  assert.deepEqual(m.request().args, { command: 'pwd', timeoutMs: 0 });
  m.window.__mobileSSH._resolve('request', null, '{"exitCode":0}');
  await result;
});

test('output limit is an explicit rejection, never a partial success', async () => {
  const m = mock();
  const result = m.window.MobileSSH.ssh.exec('git diff', { maxOutputBytes: 10 });
  m.window.__mobileSSH._resolve('request', 'OUTPUT_LIMIT_EXCEEDED: stdout and stderr exceed 10 bytes', null);
  await assert.rejects(result, /OUTPUT_LIMIT_EXCEEDED/);
});

test('terminal navigation does not pass a command or credentials', () => {
  const m = mock();
  m.window.MobileSSH.ui.showTerminal();
  assert.deepEqual(m.request(), { method: 'ui.showTerminal', args: {} });
  m.window.__mobileSSH._resolve('request', null, null);
});

test('workflow replies carry revision guards and native export never returns configuration', async () => {
  const m = mock();
  const answer = m.window.MobileSSH.workflows.answer({ id: 'job', revision: 8, requestId: 'provider', value: { provider: 'gcp' } });
  assert.deepEqual(m.request(), { method: 'workflows.answer', args: {
    id: 'job', revision: 8, requestId: 'provider', value: { provider: 'gcp' }
  } });
  m.window.__mobileSSH._resolve('request', null, '{"id":"job","revision":9}');
  assert.equal((await answer).revision, 9);
  const exported = m.window.MobileSSH.workflows.export({ id: 'job', clientId: '1' });
  assert.deepEqual(m.request(), { method: 'workflows.export', args: { id: 'job', clientId: '1' } });
  m.window.__mobileSSH._resolve('request', null, '{"opened":true}');
  assert.equal((await exported).opened, true);
});
