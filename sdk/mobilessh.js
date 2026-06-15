/*
 * mobilessh.js — Mobile SSH plugin bridge shim
 * ============================================
 * Injected by the host app at document-start. Implements `window.MobileSSH` (see
 * mobilessh.d.ts) on top of a tiny native interface, turning the host's async
 * request/callback protocol into clean Promises.
 *
 * Native surface (provided by the host as an @JavascriptInterface named __MobileSSHNative):
 *   __MobileSSHNative.invoke(method: string, argsJson: string): string  // returns a requestId
 *
 * Host → JS callbacks (the host calls these via evaluateJavascript):
 *   window.__mobileSSH._resolve(requestId, errorOrNull, resultJson)     // settle a call
 *   window.__mobileSSH._emit(streamId, chunkJson)                       // stream datum
 *
 * This file is MIT-licensed and meant to be bundled by the host AND referenced by plugin
 * authors for local development/testing (a mock __MobileSSNative can stand in).
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  if (window.MobileSSH) return; // already injected

  var native = window.__MobileSSHNative;
  var pending = Object.create(null); // requestId -> { resolve, reject }
  var streams = Object.create(null); // streamId  -> onChunk(chunk)
  var seq = 0;

  function nextId(prefix) {
    seq += 1;
    return prefix + '_' + seq + '_' + Date.now();
  }

  // Internal host→JS entry points.
  var internal = {
    _resolve: function (requestId, errorOrNull, resultJson) {
      var p = pending[requestId];
      if (!p) return;
      delete pending[requestId];
      delete streams[requestId];
      if (errorOrNull) {
        p.reject(new Error(typeof errorOrNull === 'string' ? errorOrNull : JSON.stringify(errorOrNull)));
        return;
      }
      var result;
      try {
        result = resultJson ? JSON.parse(resultJson) : undefined;
      } catch (e) {
        p.reject(new Error('bridge: bad result JSON: ' + e));
        return;
      }
      p.resolve(result);
    },
    _emit: function (streamId, chunkJson) {
      var cb = streams[streamId];
      if (!cb) return;
      var chunk;
      try {
        chunk = chunkJson ? JSON.parse(chunkJson) : undefined;
      } catch (e) {
        return;
      }
      try {
        cb(chunk);
      } catch (e) {
        /* never let plugin callback errors break the bridge */
      }
    },
  };
  window.__mobileSSH = internal;

  // Core: send an invocation to the host, return a Promise settled by _resolve.
  // `onChunk` (optional) registers a stream consumer under the requestId/streamId.
  function invoke(method, args, onChunk) {
    return new Promise(function (resolve, reject) {
      if (!native || typeof native.invoke !== 'function') {
        reject(new Error('MobileSSH bridge unavailable (no native interface). Are you running inside the app?'));
        return;
      }
      var argsObj = args || {};
      var requestId;
      try {
        requestId = native.invoke(method, JSON.stringify(argsObj));
      } catch (e) {
        reject(new Error('bridge invoke failed: ' + e));
        return;
      }
      pending[requestId] = { resolve: resolve, reject: reject };
      if (onChunk) streams[requestId] = onChunk;
    });
  }

  // Build the streamId on the JS side so onChunk is registered before the host emits.
  function invokeStream(method, args, onChunk) {
    var streamId = nextId('stream');
    var argsObj = args || {};
    argsObj.__streamId = streamId;
    return new Promise(function (resolve, reject) {
      if (!native || typeof native.invoke !== 'function') {
        reject(new Error('MobileSSH bridge unavailable.'));
        return;
      }
      streams[streamId] = onChunk;
      var requestId;
      try {
        requestId = native.invoke(method, JSON.stringify(argsObj));
      } catch (e) {
        delete streams[streamId];
        reject(new Error('bridge invoke failed: ' + e));
        return;
      }
      // Map the terminal _resolve to this stream so cleanup removes the consumer too.
      pending[requestId] = {
        resolve: function (v) { delete streams[streamId]; resolve(v); },
        reject: function (e) { delete streams[streamId]; reject(e); },
      };
    });
  }

  var MobileSSH = {
    version: VERSION,

    session: function () { return invoke('session', {}); },
    hasCapability: function (cap) { return invoke('hasCapability', { cap: cap }); },

    ssh: {
      exec: function (command, opts) {
        return invoke('ssh.exec', { command: command, timeoutMs: (opts && opts.timeoutMs) || 0 });
      },
      execStream: function (command, onLine, opts) {
        return invokeStream(
          'ssh.execStream',
          { command: command, timeoutMs: (opts && opts.timeoutMs) || 0 },
          function (chunk) { onLine(chunk.line, chunk.stream || 'stdout'); }
        );
      },
    },

    tunnel: {
      open: function (opts) { return invoke('tunnel.open', opts || {}); },
      close: function (id) { return invoke('tunnel.close', { id: id }); },
      list: function () { return invoke('tunnel.list', {}); },
    },

    http: {
      fetch: function (req, onChunk) {
        if (req && req.stream && onChunk) {
          return invokeStream('http.fetch', req, function (chunk) { onChunk(chunk.data); });
        }
        return invoke('http.fetch', req || {});
      },
    },

    storage: {
      get: function (key) { return invoke('storage.get', { key: key }); },
      put: function (key, value) { return invoke('storage.put', { key: key, value: value }); },
      putSecret: function (key, value) { return invoke('storage.putSecret', { key: key, value: value }); },
      getSecret: function (key) { return invoke('storage.getSecret', { key: key }); },
      remove: function (key) { return invoke('storage.remove', { key: key }); },
    },

    recipe: {
      run: function (stepId, vars) { return invoke('recipe.run', { stepId: stepId || null, vars: vars || {} }); },
      status: function () { return invoke('recipe.status', {}); },
    },

    ui: {
      toast: function (message) { invoke('ui.toast', { message: message }).catch(function () {}); },
      setTitle: function (title) { invoke('ui.setTitle', { title: title }).catch(function () {}); },
      openService: function (url) { return invoke('ui.openService', { url: url }); },
      openExternal: function (url) { return invoke('ui.openExternal', { url: url }); },
      close: function () { invoke('ui.close', {}).catch(function () {}); },
      theme: function () { return invoke('ui.theme', {}); },
    },

    notify: function (opts) { return invoke('notify', opts || {}); },
    log: function (level, message) { invoke('log', { level: level, message: message }).catch(function () {}); },
  };

  Object.defineProperty(window, 'MobileSSH', { value: MobileSSH, writable: false, configurable: false });
})();
