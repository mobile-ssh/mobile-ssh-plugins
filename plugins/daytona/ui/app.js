/* Daytona Desktop — drive a Daytona cloud sandbox (noVNC + Computer Use) from Mobile SSH. */
(function () {
  'use strict';

  var API = 'https://app.daytona.io/api';
  var TOOLBOX_FALLBACK = 'https://proxy.app.daytona.io/toolbox';
  var VNC_PORT = 6080;          // websockify/noVNC inside the sandbox (x11vnc is on 5901)
  var SIGNED_TTL = 3600;        // signed preview URL lifetime, seconds (Daytona allows 1..86400)
  var FRAME_MS = 900;           // screenshot poll interval right after something changed
  var IDLE_MAX = 6000;          // back off to this when the screen stops changing
  var CU_TRUST_MS = 30000;      // how long positive evidence that computer-use is live holds

  /* Measured against a stock daytonaio/sandbox desktop (1024x768, gradient wallpaper):
     png/0.6 = 84 KB per frame, jpeg q55/0.6 = 20 KB. PNG only wins on a flat, un-wallpapered
     desktop, so JPEG is the right default for a phone on mobile data. */
  var QUALITY = {
    low:    { format: 'jpeg', quality: 40, scale: 0.5 },   // ~13 KB
    medium: { format: 'jpeg', quality: 55, scale: 0.6 },   // ~20 KB
    high:   { format: 'png',  quality: 85, scale: 0.8 }    // ~150 KB, sharp text
  };

  var $ = function (id) { return document.getElementById(id); };
  var logEl, keyEl, boxesEl, imgEl, typeEl, infoEl;

  var apiKey = null;
  var list = [];
  var sb = null;                                  // the selected sandbox object
  var disp = { width: 1024, height: 768 };        // replaced by display/info once known
  var live = false, frameTimer = null, framing = false;
  var frame = QUALITY.medium, idleMs = FRAME_MS, lastFrame = null;
  var cuReady = false;          // is computer-use known-running? gates every input call
  var cuCheckedAt = 0;          // when we last had positive evidence of that
  var signedToken = null;       // last signed preview token, so we can revoke it
  var sshToken = null;          // last minted SSH access token, so we can revoke it
  var lastTap = 0, lastPt = null, down = null, longTimer = null, didLong = false;

  // ── helpers ──────────────────────────────────────────────────────────────
  function log(msg) { logEl.textContent = msg; try { MobileSSH.log('info', msg); } catch (e) {} }
  function fail(e) {
    var m = (e && e.message) ? e.message : String(e);
    logEl.textContent = 'Error: ' + m;
    try { MobileSSH.log('error', m); } catch (x) {}
  }
  function show(id) {
    ['s-key', 's-list', 's-desk'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function num(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* All network goes through the host (native, no CORS). The API key travels in an
     Authorization header — never in a URL, never in the log. */
  async function http(url, opts) {
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + apiKey };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var res = await MobileSSH.http.fetch({
      url: url,
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
      timeoutMs: opts.timeoutMs || 30000
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Daytona rejected the API key (HTTP ' + res.status + '). Tap "Change API key".');
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error('HTTP ' + res.status + ' — ' + clip(res.body, 160));
    }
    if (!res.body) return null;
    try { return JSON.parse(res.body); } catch (e) { return res.body; }
  }

  /* Computer Use lives on the sandbox's toolbox proxy, NOT on app.daytona.io. */
  function toolbox(s) {
    return String(s.toolboxProxyUrl || TOOLBOX_FALLBACK).replace(/\/+$/, '') + '/' + s.id;
  }
  function cu(path, opts) { return http(toolbox(sb) + '/computeruse' + path, opts); }

  // ── API key ──────────────────────────────────────────────────────────────
  async function loadKey() {
    try { apiKey = await MobileSSH.storage.getSecret('apiKey'); } catch (e) { apiKey = null; }
    return apiKey;
  }

  async function saveKey() {
    var v = (keyEl.value || '').trim();
    if (!v) { log('Paste your Daytona API key first.'); return; }
    var btn = $('save-key');
    btn.disabled = true;
    var prev = apiKey;
    try {
      apiKey = v;
      log('Checking the key…');
      await http(API + '/sandbox?limit=1');          // cheapest authenticated call
      await MobileSSH.storage.putSecret('apiKey', v);
      keyEl.value = '';
      show('s-list');
      await refresh();
    } catch (e) {
      apiKey = prev;
      fail(e);
    } finally {
      btn.disabled = false;
    }
  }

  async function forget() {
    stopLive();
    try { await MobileSSH.storage.remove('apiKey'); } catch (e) {}
    apiKey = null; sb = null; list = [];
    show('s-key');
    log('API key cleared from this device.');
  }

  // ── sandbox list ─────────────────────────────────────────────────────────
  async function refresh() {
    log('Loading sandboxes…');
    var j = await http(API + '/sandbox');
    list = (j && j.items) ? j.items : (Array.isArray(j) ? j : []);
    render();
    log(list.length ? list.length + ' sandbox(es).' : 'No sandboxes yet — create one.');
  }

  function render() {
    boxesEl.textContent = '';
    list.forEach(function (s) {
      var running = s.state === 'started';
      var stopped = s.state === 'stopped';

      var box = document.createElement('div');
      box.className = 'box';

      var h = document.createElement('h2');
      h.textContent = s.name || s.id;
      box.appendChild(h);

      var meta = document.createElement('div');
      meta.className = 'meta';
      var dot = document.createElement('span');
      dot.className = 'dot' + (running ? ' on' : (stopped ? '' : ' busy'));
      meta.appendChild(dot);
      meta.appendChild(document.createTextNode(
        s.state + ' · ' + s.cpu + ' vCPU / ' + s.memory + ' GB · ' + s.target + ' · ' +
        (s.autoStopInterval ? 'auto-stop ' + s.autoStopInterval + 'm' : 'NO auto-stop')
      ));
      box.appendChild(meta);

      var row = document.createElement('div');
      row.className = 'row';
      row.appendChild(button(running ? 'Open' : 'Start & open', '', function () { openSandbox(s); }));
      if (running) row.appendChild(button('Stop', 'secondary', function () { lifecycle(s, 'stop'); }));
      row.appendChild(confirmButton('Delete', function () { lifecycle(s, 'delete'); }));
      box.appendChild(row);

      boxesEl.appendChild(box);
    });
  }

  function button(label, cls, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    return b;
  }

  /* Two-tap confirm — window.confirm() is unreliable in these WebViews. */
  function confirmButton(label, fn) {
    var armed = false;
    var b = button(label, 'secondary', function () {
      if (!armed) {
        armed = true;
        b.textContent = 'Sure?';
        setTimeout(function () { armed = false; b.textContent = label; }, 6000);
        return;
      }
      fn();
    });
    return b;
  }

  async function lifecycle(s, what) {
    try {
      if (what === 'delete') {
        log('Deleting ' + clip(s.id, 12) + '…');
        await http(API + '/sandbox/' + s.id, { method: 'DELETE', timeoutMs: 60000 });
      } else {
        log(what === 'stop' ? 'Stopping…' : 'Starting…');
        await http(API + '/sandbox/' + s.id + '/' + what, { method: 'POST', timeoutMs: 120000 });
      }
      await refresh();
    } catch (e) { fail(e); }
  }

  async function create() {
    var btn = $('new');
    btn.disabled = true;
    try {
      var target = (await MobileSSH.storage.get('target')) || 'us';
      var autoStop = num(await MobileSSH.storage.get('autoStop'), 15);
      var autoDelete = num(await MobileSSH.storage.get('autoDelete'), 1440);
      log('Creating a sandbox in ' + target + ' (auto-stop ' + autoStop + 'm)…');
      /* No snapshot is specified on purpose: the org default image is the only one that
         ships the xvfb/xfce4/x11vnc/noVNC desktop stack Computer Use needs. */
      var made = await http(API + '/sandbox', {
        method: 'POST',
        timeoutMs: 180000,
        body: JSON.stringify({
          target: target,
          autoStopInterval: autoStop,
          autoDeleteInterval: autoDelete,
          public: false,
          labels: { createdBy: 'mobile-ssh' }
        })
      });
      /* GET /sandbox is eventually consistent — a list right after the create comes back
         without it. The create response is the full sandbox object, so use that. */
      if (made && made.id) {
        list.unshift(made);
        render();
        log('Created ' + clip(made.id, 8) + ' (' + made.state + '). Tap Open to start the desktop.');
      } else {
        await refresh();
      }
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  }

  // ── one sandbox: bring the desktop up ────────────────────────────────────
  async function openSandbox(s) {
    sb = s;
    lastFrame = null;               // don't let a previous sandbox's frame suppress the first paint
    idleMs = FRAME_MS;
    cuReady = false;
    sshToken = null;
    show('s-desk');
    $('remote').classList.add('hidden');
    $('restart').classList.add('hidden');
    ['ssh-box', 'ssh-help', 'ssh-revoke'].forEach(function (id) { $(id).classList.add('hidden'); });
    info();
    try {
      await ensureDesktop();
      info();
      $('remote').classList.remove('hidden');
      startLive();
      log('Desktop ready (' + disp.width + '×' + disp.height + '). Tap to click, long-press for right-click, drag to drag.');
    } catch (e) { desktopError(e); }
  }

  /* Bring the sandbox and the computer-use processes up, and only then mark input safe.
     Re-checks the control plane first: a sandbox can auto-stop underneath an open plugin
     (auto-stop is not reset by work happening inside the sandbox). */
  async function ensureDesktop() {
    var s = await http(API + '/sandbox/' + sb.id);
    if (s && s.state) sb.state = s.state;
    if (sb.state !== 'started') {
      log('The sandbox had stopped — starting it again…');
      await http(API + '/sandbox/' + sb.id + '/start', { method: 'POST', timeoutMs: 180000 });
      await waitState('started');
    }
    log('Starting the desktop (Xvfb, xfce4, x11vnc, noVNC)…');
    try {
      await cu('/start', { method: 'POST', timeoutMs: 120000 });
      await waitActive();
    } catch (e) {
      /* One retry: an individual process (novnc especially) can lose a startup race. */
      await sleep(2000);
      try {
        await cu('/start', { method: 'POST', timeoutMs: 120000 });
        await waitActive();
      } catch (e2) {
        throw needsRestart('The desktop could not be started: ' + clip((e2 && e2.message) || '', 100));
      }
    }
    try {
      var di = await cu('/display/info');
      if (di && di.displays && di.displays[0]) disp = di.displays[0];
    } catch (e) { /* keep the 1024x768 default */ }
    cuReady = true;
    cuCheckedAt = Date.now();
  }

  /* The only recovery from a bricked computer-use plugin: stop and start the sandbox. */
  async function restartSandbox() {
    var b = $('restart');
    b.disabled = true;
    try {
      log('Stopping the sandbox…');
      await http(API + '/sandbox/' + sb.id + '/stop', { method: 'POST', timeoutMs: 180000 });
      await waitState('stopped');
      cuReady = false;
      await ensureDesktop();
      b.classList.add('hidden');
      $('remote').classList.remove('hidden');
      startLive();
      log('Desktop restarted.');
    } catch (e) { fail(e); } finally { b.disabled = false; }
  }

  /* Lifecycle POSTs return before the sandbox has actually transitioned; starting one that
     is still stopping gives 409 Conflict. Wait for the control plane to settle. */
  async function waitState(target, timeoutMs) {
    var until = Date.now() + (timeoutMs || 180000);
    while (Date.now() < until) {
      var s = await http(API + '/sandbox/' + sb.id);
      if (s && s.state) {
        sb.state = s.state;
        if (s.state === target) return;
      }
      await sleep(3000);
    }
    throw new Error('The sandbox did not reach "' + target + '" in time.');
  }

  /* Tag an error as "only a sandbox stop/start will fix this", so both callers can offer it. */
  function needsRestart(msg) {
    var e = new Error(msg + ' Tap "Restart desktop" — stopping and starting the sandbox is the only fix.');
    e.needsRestart = true;
    return e;
  }

  /* Both entry points into the desktop funnel their failures through here. */
  function desktopError(e) {
    if (e && (e.needsRestart || /shut down/i.test(e.message || ''))) {
      cuReady = false;
      stopLive();
      $('restart').classList.remove('hidden');
    }
    fail(e);
  }

  async function waitActive() {
    for (var i = 0; i < 40; i++) {
      var st = await cu('/status');
      if (st && st.status === 'active') return;
      await sleep(1500);
    }
    throw new Error('The desktop did not come up in time. Try Refresh, or check the sandbox image includes the VNC stack.');
  }

  function info() {
    if (!sb) { infoEl.textContent = ''; return; }
    infoEl.textContent = (sb.name || sb.id) + ' · ' + sb.target + ' · ' +
      sb.cpu + ' vCPU / ' + sb.memory + ' GB · ' +
      (sb.autoStopInterval ? 'stops itself after ' + sb.autoStopInterval + ' idle minutes'
                           : 'NO auto-stop — this sandbox bills until you stop it');
  }

  // ── noVNC in the bridge-less service WebView ─────────────────────────────
  /* SECURITY: the sandbox's noVNC page must NEVER be loaded in this (bridged) WebView —
     neither host restricts navigation of the plugin WebView, so a remote origin loaded
     here would inherit window.MobileSSH and this plugin's capabilities. ui.openService()
     hands it to a separate WebView that has no bridge at all.

     We use the *signed* preview URL: its token lives in the hostname, so the HTML, every
     subresource and the wss:// websocket all authenticate with no headers — which is the
     only form a WebView can use. */
  async function vncUrl() {
    await revokeSigned();                       // don't leave an older link alive
    var j = await http(API + '/sandbox/' + sb.id + '/ports/' + VNC_PORT +
                       '/signed-preview-url?expiresInSeconds=' + SIGNED_TTL);
    if (!j || !j.url) throw new Error('Daytona did not return a signed preview URL for port ' + VNC_PORT + '.');
    signedToken = j.token || null;
    /* vnc.html, NOT vnc_lite.html: vnc_lite reads only host/password/path/port/scale/view_only,
       so autoconnect and resize are ignored and the 1024x768 canvas overflows the phone —
       and it has no control bar, so there is no way to raise the soft keyboard. */
    return String(j.url).replace(/\/+$/, '') + '/vnc.html?autoconnect=true&resize=scale&reconnect=true';
  }

  /* The desktop behind a signed URL has NO VNC password (x11vnc offers RFB security type
     "None"), so the URL itself is a bearer credential for full mouse and keyboard control.
     Revoke it as soon as we're done rather than leaving it live for the full TTL.
     Note the token lives under /ports/{port}/ — the shorter path silently 404s. */
  async function revokeSigned() {
    if (!signedToken || !sb) return;
    var tok = signedToken;
    signedToken = null;
    try {
      await http(API + '/sandbox/' + sb.id + '/ports/' + VNC_PORT +
                 '/signed-preview-url/' + encodeURIComponent(tok) + '/expire', { method: 'POST' });
    } catch (e) {
      MobileSSH.log('warn', 'could not revoke the desktop link; it stays valid until it expires');
    }
  }

  async function openVnc(external) {
    var btn = external ? $('vnc-ext') : $('vnc');
    btn.disabled = true;
    try {
      log('Getting a signed desktop URL…');
      var url = await vncUrl();                       // contains a token — never logged
      stopLive();                                     // don't poll screenshots behind the VNC view
      if (external) await MobileSSH.ui.openExternal(url);
      else await MobileSSH.ui.openService(url);
      log('Desktop opened. The link is valid for ' + (SIGNED_TTL / 60) + ' minutes.');
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  }

  // ── SSH access to the sandbox ────────────────────────────────────────────
  /* Daytona fronts every sandbox with an SSH gateway. POST /ssh-access mints a short-lived
     token that IS the username — the gateway authenticates on it alone and rejects password
     auth, so a saved server needs an empty password. (JSch attempts the "none" method before
     it ever consults PreferredAuthentications, so this works on the Android host as-is.)

     The plugin can only show these details: the bridge has no method to write to the saved
     server list or open a connection, so adding the server is a manual step for now. */
  var SSH_TTL_MIN = 60;

  async function sshAccess() {
    var btn = $('ssh');
    btn.disabled = true;
    try {
      log('Requesting SSH access…');
      var j = await http(API + '/sandbox/' + sb.id + '/ssh-access?expiresInMinutes=' + SSH_TTL_MIN,
                         { method: 'POST' });
      if (!j || !j.token) throw new Error('Daytona did not return an SSH token.');
      sshToken = j.token;

      /* Prefer the host Daytona itself puts in sshCommand over hardcoding the gateway. */
      var m = /@([A-Za-z0-9.-]+)/.exec(j.sshCommand || '');
      $('ssh-host').textContent = m ? m[1] : 'ssh.app.daytona.io';
      $('ssh-user').textContent = j.token;          // shown, never written to the log
      $('ssh-exp').textContent = j.expiresAt
        ? 'Expires ' + new Date(j.expiresAt).toLocaleString()
        : 'Expires in ' + SSH_TTL_MIN + ' minutes';
      $('ssh-box').classList.remove('hidden');
      $('ssh-help').classList.remove('hidden');
      $('ssh-revoke').classList.remove('hidden');
      log('SSH details ready. Tap this again later to mint a fresh token.');
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  }

  async function sshRevoke() {
    if (!sshToken) return;
    var btn = $('ssh-revoke');
    btn.disabled = true;
    var tok = sshToken;
    try {
      await http(API + '/sandbox/' + sb.id + '/ssh-access?token=' + encodeURIComponent(tok),
                 { method: 'DELETE' });
      sshToken = null;
      $('ssh-box').classList.add('hidden');
      $('ssh-help').classList.add('hidden');
      btn.classList.add('hidden');
      log('SSH access revoked. Any saved server using that username will stop working.');
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  }

  // ── screenshot loop ──────────────────────────────────────────────────────
  function startLive() { live = true; $('live').textContent = 'Pause'; tick(); }
  function stopLive() {
    live = false;
    if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
    if ($('live')) $('live').textContent = 'Resume';
  }

  async function tick() {
    if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
    if (!live || !sb) return;
    if (framing) { frameTimer = setTimeout(tick, 150); return; }
    framing = true;
    var t0 = Date.now();
    try {
      var j = await cu('/screenshot/compressed?format=' + frame.format +
                       '&quality=' + frame.quality + '&scale=' + frame.scale + '&showCursor=true');
      if (j && j.screenshot) {
        cuCheckedAt = Date.now();   // a frame arrived, so computer-use is demonstrably live
        cuReady = true;
        /* An idle desktop returns a byte-identical frame every poll. Decoding and
           re-uploading it costs nothing useful, so back off instead — idle drops from
           ~20 KB/s to ~3 KB/s. Any input calls soon(), which snaps back to full rate. */
        if (j.screenshot === lastFrame) {
          idleMs = Math.min(Math.round(idleMs * 1.6), IDLE_MAX);
        } else {
          lastFrame = j.screenshot;
          idleMs = FRAME_MS;
          imgEl.src = 'data:image/' + frame.format + ';base64,' + j.screenshot;
        }
        $('fps').textContent = Math.round((j.sizeBytes || 0) / 1024) + ' KB · ' +
          (Date.now() - t0) + ' ms · every ' + (idleMs / 1000).toFixed(1) + 's';
      }
    } catch (e) {
      framing = false;
      stopLive();
      fail(e);
      return;
    }
    framing = false;
    if (live) frameTimer = setTimeout(tick, idleMs);
  }

  /* Pull a fresh frame shortly after input so the screen feels responsive. */
  function soon() {
    if (!live) return;
    idleMs = FRAME_MS;
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = setTimeout(tick, 120);
  }

  // ── input → Computer Use ─────────────────────────────────────────────────
  /* The <img> is width:100%/height:auto, so its box matches the frame's aspect
     exactly and there is no letterboxing to correct for. */
  function coords(ev) {
    var r = imgEl.getBoundingClientRect();
    var x = (ev.clientX - r.left) / r.width * disp.width;
    var y = (ev.clientY - r.top) / r.height * disp.height;
    return {
      x: Math.max(0, Math.min(disp.width - 1, Math.round(x))),
      y: Math.max(0, Math.min(disp.height - 1, Math.round(y)))
    };
  }

  /* Every mouse/* and keyboard/* call goes through here.
     SAFETY: sending input while the computer-use processes are not running kills the
     sandbox daemon's plugin child. After that even POST /computeruse/start answers
     503 "connection is shut down", and the ONLY recovery is a sandbox stop+start.
     A sandbox can auto-stop underneath an open plugin (e.g. while the frame pump is
     paused), so never send input without knowing computer-use is live. Screenshots and
     /status are safe to call in any state — only the input endpoints brick it. */
  async function input(path, body) {
    try {
      await ensureReadyForInput();
      await cu(path, { method: 'POST', body: JSON.stringify(body) });
      soon();
    } catch (e) {
      cuReady = false;
      desktopError(e);
    }
  }

  /* The dangerous state is sandbox STARTED but computer-use NOT started — which is exactly
     what a stop/start cycle leaves behind. (A fully stopped sandbox is harmless: the proxy
     answers 400 "Is the Sandbox started?" before the request reaches the daemon.) So before
     sending input after any gap, confirm with /status, which is safe to call in every state.
     A successful screenshot is equally good evidence, so the live loop keeps this warm and
     a running session pays nothing extra. */
  async function ensureReadyForInput() {
    if (cuReady && (Date.now() - cuCheckedAt) < CU_TRUST_MS) return;
    var st = null;
    try { st = await cu('/status'); } catch (e) { st = null; }
    if (st && st.status === 'active') { cuReady = true; cuCheckedAt = Date.now(); return; }
    await ensureDesktop();
  }

  function click(x, y, btn, dbl) {
    return input('/mouse/click', { x: x, y: y, button: btn || 'left', double: !!dbl });
  }
  function drag(a, b) {
    return input('/mouse/drag', { startX: a.x, startY: a.y, endX: b.x, endY: b.y, button: 'left' });
  }
  function sendKey(k) { return input('/keyboard/key', { key: k, modifiers: [] }); }
  function sendHotkey(keys) { return input('/keyboard/hotkey', { keys: keys }); }
  function sendText(text) { return input('/keyboard/type', { text: text, delay: 0 }); }
  function sendScroll(dir) {
    return input('/mouse/scroll', {
      x: Math.round(disp.width / 2), y: Math.round(disp.height / 2),
      direction: dir, amount: 3
    });
  }

  function wirePointer() {
    imgEl.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      down = coords(ev);
      didLong = false;
      longTimer = setTimeout(function () {
        didLong = true;
        click(down.x, down.y, 'right', false);
      }, 550);
    });

    imgEl.addEventListener('pointerup', function (ev) {
      ev.preventDefault();
      clearTimeout(longTimer);
      if (!down || didLong) { down = null; return; }
      var up = coords(ev);
      var dx = up.x - down.x, dy = up.y - down.y;
      if (Math.sqrt(dx * dx + dy * dy) > 12) {
        drag(down, up);
      } else {
        var now = Date.now();
        var dbl = (now - lastTap < 350) && lastPt &&
                  Math.abs(lastPt.x - up.x) < 20 && Math.abs(lastPt.y - up.y) < 20;
        lastTap = now; lastPt = up;
        click(up.x, up.y, 'left', dbl);
      }
      down = null;
    });

    imgEl.addEventListener('pointercancel', function () {
      clearTimeout(longTimer); down = null;
    });
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  function wire() {
    $('save-key').addEventListener('click', saveKey);
    $('forget').addEventListener('click', forget);
    $('new').addEventListener('click', create);
    $('refresh').addEventListener('click', function () { refresh().catch(fail); });

    $('vnc').addEventListener('click', function () { openVnc(false); });
    $('vnc-ext').addEventListener('click', function () { openVnc(true); });
    $('restart').addEventListener('click', restartSandbox);
    $('ssh').addEventListener('click', sshAccess);
    $('ssh-revoke').addEventListener('click', sshRevoke);
    $('back').addEventListener('click', function () {
      stopLive();
      revokeSigned().catch(function () {}).then(function () {
        sb = null; cuReady = false; show('s-list'); refresh().catch(fail);
      });
    });

    $('live').addEventListener('click', function () { if (live) stopLive(); else startLive(); });
    $('shot').addEventListener('click', function () { tick(); });
    $('send').addEventListener('click', function () {
      var v = typeEl.value;
      if (!v) return;
      typeEl.value = '';
      sendText(v);
    });

    document.querySelectorAll('.keys button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.key) sendKey(b.dataset.key);
        else if (b.dataset.hotkey) sendHotkey(b.dataset.hotkey);
        else if (b.dataset.scroll) sendScroll(b.dataset.scroll);
      });
    });

    wirePointer();
  }

  async function theme() {
    try {
      var th = await MobileSSH.ui.theme();
      var r = document.documentElement.style;
      if (th.accent) r.setProperty('--accent', th.accent);
      if (th.background) r.setProperty('--bg', th.background);
      if (th.surface) r.setProperty('--surface', th.surface);
      if (th.text) r.setProperty('--text', th.text);
    } catch (e) { /* dev fallback colors */ }
  }

  async function init() {
    await theme();
    try { MobileSSH.ui.setTitle('Daytona Desktop'); } catch (e) {}
    try {
      var q = await MobileSSH.storage.get('frameQuality');
      if (q && QUALITY[q]) frame = QUALITY[q];
    } catch (e) { /* keep medium */ }
    await loadKey();
    if (apiKey) {
      show('s-list');
      try { await refresh(); } catch (e) { fail(e); }
    } else {
      show('s-key');
      log('Enter your Daytona API key to begin.');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    logEl = $('log'); keyEl = $('key'); boxesEl = $('boxes');
    imgEl = $('screen'); typeEl = $('typebox'); infoEl = $('sbinfo');
    wire();
    init();
  });
})();
