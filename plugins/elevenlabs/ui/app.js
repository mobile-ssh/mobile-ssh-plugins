/* ElevenLabs Speak — read remote output aloud on the phone. */
(function () {
  'use strict';

  var API = 'https://api.elevenlabs.io/v1';

  /* The bridge's http.fetch returns a STRING body, so raw MP3 bytes would not survive it.
     /with-timestamps returns the same audio as base64 inside JSON, which does. */
  var TTS = '/text-to-speech/';
  var TTS_SUFFIX = '/with-timestamps';

  /* 50 ms of silent WAV. Played on the first tap to satisfy the WebView's autoplay gesture
     requirement, so the real clip — which arrives after an await, by which time the gesture is
     spent — can start on its own. WAV, not MP3: the header is short enough to be verifiable
     by eye and every WebView decodes it. */
  var SILENCE = 'data:audio/wav;base64,' +
                'UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
                'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

  var $ = function (id) { return document.getElementById(id); };
  var logEl, keyEl, textEl, cmdEl, voiceEl, countEl, player;

  var apiKey = null;
  var voices = [];
  var cfg = { model: 'eleven_turbo_v2_5', quality: 'mp3_22050_32', maxChars: 800 };
  var unlocked = false;
  var lastAudio = null;     // base64 of the clip now loaded, so it can be saved after playing

  // ── helpers ──────────────────────────────────────────────────────────────
  function log(msg) { logEl.textContent = msg; try { MobileSSH.log('info', msg); } catch (e) {} }
  function fail(e) {
    var m = (e && e.message) ? e.message : String(e);
    logEl.textContent = 'Error: ' + m;
    try { MobileSSH.log('error', m); } catch (x) {}
  }
  function show(id) {
    ['s-key', 's-main'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }
  function num(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* All network goes through the host (native, no CORS). The key travels in the
     xi-api-key header — never in a URL, never in the log. */
  async function http(path, opts) {
    opts = opts || {};
    var headers = { 'xi-api-key': apiKey };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var res = await MobileSSH.http.fetch({
      url: API + path,
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
      timeoutMs: opts.timeoutMs || 60000
    });
    if (res.status === 401) {
      throw new Error('ElevenLabs rejected the API key. Tap "Change API key".');
    }
    if (res.status === 403) {
      throw new Error('That key lacks the permission this needs (Text to Speech + Voices read).');
    }
    if (res.status === 429) {
      throw new Error('Rate limited or out of credits — check your ElevenLabs quota.');
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error('HTTP ' + res.status + ' — ' + detail(res.body));
    }
    if (!res.body) return null;
    try { return JSON.parse(res.body); } catch (e) { return res.body; }
  }

  /* ElevenLabs errors are {detail:{message}} or {detail:[{msg}]} depending on the endpoint. */
  function detail(body) {
    try {
      var d = JSON.parse(body).detail;
      if (!d) return clip(body, 160);
      if (typeof d === 'string') return d;
      if (d.message) return d.message;
      if (d.length && d[0] && d[0].msg) return d[0].msg;
    } catch (e) {}
    return clip(body, 160);
  }

  // ── API key ──────────────────────────────────────────────────────────────
  async function loadKey() {
    try { apiKey = await MobileSSH.storage.getSecret('apiKey'); } catch (e) { apiKey = null; }
    return apiKey;
  }

  async function saveKey() {
    var v = (keyEl.value || '').trim();
    if (!v) { log('Paste your ElevenLabs API key first.'); return; }
    var btn = $('save-key');
    btn.disabled = true;
    var prev = apiKey;
    try {
      apiKey = v;
      log('Checking the key…');
      await loadVoices();                       // cheapest authenticated call
      await MobileSSH.storage.putSecret('apiKey', v);
      keyEl.value = '';
      show('s-main');
      log(voices.length + ' voices. Type something, or run a command.');
    } catch (e) {
      apiKey = prev;
      fail(e);
    } finally {
      btn.disabled = false;
    }
  }

  async function forget() {
    try { await MobileSSH.storage.remove('apiKey'); } catch (e) {}
    apiKey = null;
    show('s-key');
    log('API key cleared from this device.');
  }

  // ── voices ───────────────────────────────────────────────────────────────
  async function loadVoices() {
    var j = await http('/voices');
    voices = (j && j.voices) ? j.voices : [];
    if (!voices.length) throw new Error('The key works but returned no voices.');
    try { await MobileSSH.storage.put('voices', JSON.stringify(voices.map(slim))); } catch (e) {}
    renderVoices();
  }

  function slim(v) { return { voice_id: v.voice_id, name: v.name }; }

  async function renderVoices() {
    voiceEl.textContent = '';
    voices.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.voice_id;
      o.textContent = v.name;
      voiceEl.appendChild(o);
    });
    var saved = null;
    try { saved = await MobileSSH.storage.get('voiceId'); } catch (e) {}
    if (saved && voices.some(function (v) { return v.voice_id === saved; })) voiceEl.value = saved;
  }

  // ── text preparation ─────────────────────────────────────────────────────
  /* Lines that are shell commands, paths or invocations. You typed those — you don't need
     them read back, and they pronounce terribly. Tested BEFORE punctuation is stripped,
     while the sigils that identify them are still there. */
  function looksLikeCommand(t) {
    if (/^[$#>]\s/.test(t)) return true;                        // "$ ls -la"
    if (/^[a-z][\w.-]*\s+-{1,2}[A-Za-z]/.test(t)) return true;  // "tmux capture-pane -p"
    if (/^-{1,2}[A-Za-z0-9]/.test(t)) return true;              // wrapped flags: "-S -60 -t"
    if (/\/[\w.-]+\/[\w.-]+/.test(t)) return true;              // "/tmp/dtn-harness/server.mjs"
    return (t.match(/[|$><&;`{}]/g) || []).length >= 2;
  }

  /* Status bars and telemetry — pure noise, and billed by the character. */
  function looksLikeStatus(t) {
    if (/^\(?\d+[hms]\b/.test(t)) return true;                  // "(7m 57s ..."
    /* Needs a NUMBER beside it, or prose like "token counters and status bars" gets
       dropped and the surrounding sentence comes out mangled. */
    if (/\d+(\.\d+)?k?\s*tokens?\b/i.test(t) && t.length < 60) return true;
    return /\besc to interrupt\b/i.test(t);
  }

  /* Agent panes are full of ANSI colour, carriage-return spinners, box drawing, dingbats
     and status chrome. Spoken verbatim it is noise, and every character is billed.

     Whitelist what a voice can pronounce instead of blocklisting glyph ranges: the old
     [─-▟] covered Box Drawing and Block Elements but missed everything a real
     agent pane actually contains (⎿ ● ✢ ✦ ❯ ⏸ ← ·), so all of it survived and got
     spoken. Measured on a live capture: 596 billed characters down to 390. */
  function clean(s) {
    var lines = String(s || '')
      .replace(/\[[0-9;?]*[ -\/]*[@-~]/g, '')     // CSI escapes (colour, cursor moves)
      .replace(/\][^]*(|\\)/g, '')  // OSC (window titles)
      .replace(/\r/g, '\n')
      .split('\n');

    var kept = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/[ \t]+/g, ' ').trim();
      if (!t) continue;
      if (looksLikeCommand(t) || looksLikeStatus(t)) continue;

      t = t.replace(/[^\p{L}\p{N}\s.,!?;:'()\-]/gu, ' ').replace(/\s+/g, ' ').trim();
      if (!t) continue;

      var letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
      if (letters < 4) continue;                  // a lone "ok", or a bare glyph
      if (letters / t.length < 0.5) continue;     // mostly punctuation
      if (kept.length && kept[kept.length - 1] === t) continue;   // redraw duplicates
      kept.push(t);
    }

    /* Terminals hard-wrap, so one sentence arrives as several lines; joining them all with
       ". " invents breaks mid-sentence ("it grabbed a. live Claude Code pane"). Rejoin a
       continuation (next line starts lower-case, this one didn't end a sentence) but keep
       real line breaks — they read as natural pauses, and cap() cuts on them. */
    var out = [];
    for (var j = 0; j < kept.length; j++) {
      var cur = kept[j];
      if (out.length && !/[.!?:]$/.test(out[out.length - 1]) && /^[a-z]/.test(cur)) {
        out[out.length - 1] += ' ' + cur;
      } else {
        out.push(cur);
      }
    }
    return out.join('\n').trim();
  }

  /* Billing is per character, so cut at a sentence or line boundary rather than mid-word,
     and always say how much was dropped. */
  function cap(s, max) {
    if (s.length <= max) return { text: s, dropped: 0 };
    var head = s.slice(0, max);
    var cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'),
                       head.lastIndexOf('! '), head.lastIndexOf('? '));
    if (cut < max * 0.5) cut = head.lastIndexOf(' ');
    if (cut < 1) cut = max - 1;                 // no boundary at all: never exceed max
    return { text: s.slice(0, cut + 1).trim(), dropped: s.length - (cut + 1) };
  }

  function updateCount() {
    var n = clean(textEl.value).length;
    countEl.textContent = n + ' / ' + cfg.maxChars + ' characters';
    countEl.classList.toggle('over', n > cfg.maxChars);
  }

  // ── speak ────────────────────────────────────────────────────────────────
  /* WebViews only let audio start from a user gesture. The clip arrives after an await,
     by which time the gesture is spent — so burn a silent frame on the tap itself, which
     marks the element as user-activated for every later play(). */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      player.src = SILENCE;
      var p = player.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  async function speak(raw) {
    var body = clean(raw);
    if (!body) { log('Nothing to say.'); return; }

    var capped = cap(body, cfg.maxChars);
    var voiceId = voiceEl.value;
    if (!voiceId) { log('Pick a voice first.'); return; }

    $('speak').disabled = true;
    $('run').disabled = true;
    $('replay').classList.add('hidden');
    try {
      log('Generating ' + capped.text.length + ' characters…' +
          (capped.dropped ? ' (' + capped.dropped + ' dropped by the character cap)' : ''));
      var j = await http(TTS + encodeURIComponent(voiceId) + TTS_SUFFIX +
                         '?output_format=' + encodeURIComponent(cfg.quality), {
        method: 'POST',
        timeoutMs: 120000,
        body: JSON.stringify({ text: capped.text, model_id: cfg.model })
      });
      if (!j || !j.audio_base64) throw new Error('ElevenLabs returned no audio.');

      lastAudio = j.audio_base64;
      player.src = 'data:audio/mpeg;base64,' + j.audio_base64;
      player.classList.remove('hidden');        // scrub bar is only useful once there's a clip
      $('save-audio').classList.remove('hidden');
      var kb = Math.round(j.audio_base64.length * 0.75 / 1024);
      try {
        await player.play();
        log('Speaking · ' + capped.text.length + ' chars · ' + kb + ' KB' +
            (capped.dropped ? ' · ' + capped.dropped + ' chars dropped' : ''));
      } catch (e) {
        /* Autoplay still refused (some hosts require a gesture per clip) — offer a button. */
        $('replay').classList.remove('hidden');
        log('Ready to play · ' + kb + ' KB. Tap ▶ Play.');
      }
    } catch (e) {
      fail(e);
    } finally {
      $('speak').disabled = false;
      $('run').disabled = false;
    }
  }

  // ── save the clip ────────────────────────────────────────────────────────
  /* The <audio> element's own download control cannot work here, for two independent
     reasons: the bridged plugin WebView has no DownloadListener on Android
     (PluginHostActivity attaches one only to the service WebView) and no WKDownloadDelegate
     on iOS, so the download is dropped silently; and the clip is a data: URL, which the
     host refuses to re-fetch even where a listener exists ("blob:/data: can't be
     re-fetched"). Writing it to the server you are already connected to needs no host
     change — and the app's own SFTP File Transfer screen can then pull it to the phone. */
  var B64_CHUNK = 24576;   // base64 chars per exec: many commands, each far below ARG_MAX

  async function sh(cmd) {
    var r = await MobileSSH.ssh.exec(cmd, { timeoutMs: 60000 });
    if (r.exitCode !== 0) {
      throw new Error(((r.stderr || r.stdout || 'command failed').trim()).slice(0, 160));
    }
    return r;
  }

  async function saveToServer() {
    if (!lastAudio) { log('Speak something first — there is no clip to save.'); return; }
    var btn = $('save-audio');
    btn.disabled = true;
    try {
      var stamp = new Date().toISOString().replace(/[:-]/g, '').replace(/\..+$/, '');
      var dir = '~/mobile-ssh-speech';
      var tmp = dir + '/.speech-' + stamp + '.b64';
      var mp3 = dir + '/speech-' + stamp + '.mp3';

      await sh('mkdir -p ' + dir);
      /* base64's alphabet is A-Za-z0-9+/= so it is safe inside single quotes with no
         escaping; appending in chunks keeps any single command comfortably small. */
      for (var i = 0; i < lastAudio.length; i += B64_CHUNK) {
        await sh('printf %s ' + "'" + lastAudio.slice(i, i + B64_CHUNK) + "' " +
                 (i === 0 ? '>' : '>>') + ' ' + tmp);
        log('Saving to the server… ' +
            Math.min(100, Math.round((i + B64_CHUNK) / lastAudio.length * 100)) + '%');
      }
      /* -d is GNU/Linux, -D is BSD/macOS. */
      await sh('{ base64 -d ' + tmp + ' > ' + mp3 + ' 2>/dev/null || base64 -D ' + tmp + ' > ' + mp3 + '; } && rm -f ' + tmp);
      var r = await sh('ls -l ' + mp3 + " | awk '{print $5}'");
      log('Saved ' + mp3.replace('~', '~') + ' (' + (r.stdout || '').trim() +
          ' bytes). Open File Transfer to copy it to your phone.');
    } catch (e) {
      fail(e);
    } finally {
      btn.disabled = false;
    }
  }

  // ── run a command over SSH, then speak it ────────────────────────────────
  async function runCommand(alsoSpeak) {
    var cmd = (cmdEl.value || cmdEl.placeholder || '').trim();
    if (!cmd) { log('Type a command first.'); return; }
    $('run').disabled = true;
    $('run-only').disabled = true;
    try {
      log('$ ' + clip(cmd, 120));
      var r = await MobileSSH.ssh.exec(cmd, { timeoutMs: 60000 });
      var out = clean((r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''));
      if (!out) {
        log('The command printed nothing (exit ' + r.exitCode + ').');
        return;
      }
      textEl.value = out;
      updateCount();
      if (r.exitCode !== 0) log('exit ' + r.exitCode + ' · ' + out.length + ' characters');
      if (alsoSpeak) await speak(out);
      else log(out.length + ' characters captured. Tap Speak when ready.');
    } catch (e) {
      fail(e);
    } finally {
      $('run').disabled = false;
      $('run-only').disabled = false;
    }
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  function wire() {
    $('save-key').addEventListener('click', saveKey);
    $('forget').addEventListener('click', forget);

    $('speak').addEventListener('click', function () { unlock(); speak(textEl.value); });
    $('run').addEventListener('click', function () { unlock(); runCommand(true); });
    $('run-only').addEventListener('click', function () { runCommand(false); });
    $('save-audio').addEventListener('click', saveToServer);
    $('replay').addEventListener('click', function () {
      var p = player.play();
      if (p && p.catch) p.catch(fail);
    });

    textEl.addEventListener('input', updateCount);
    voiceEl.addEventListener('change', function () {
      MobileSSH.storage.put('voiceId', voiceEl.value).catch(function () {});
    });

    document.querySelectorAll('.presets button').forEach(function (b) {
      b.addEventListener('click', function () { cmdEl.value = b.dataset.cmd; });
    });
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

  async function settings() {
    try {
      var m = await MobileSSH.storage.get('model');
      var q = await MobileSSH.storage.get('quality');
      var c = await MobileSSH.storage.get('maxChars');
      if (m) cfg.model = m;
      if (q) cfg.quality = q;
      cfg.maxChars = Math.max(50, num(c, cfg.maxChars));
    } catch (e) { /* keep defaults */ }
  }

  /* Voices are cached so the picker is populated before the network answers — the list
     rarely changes and a phone on a train may not have signal. */
  async function cachedVoices() {
    try {
      var s = await MobileSSH.storage.get('voices');
      if (!s) return false;
      voices = JSON.parse(s) || [];
      if (!voices.length) return false;
      await renderVoices();
      return true;
    } catch (e) { return false; }
  }

  async function init() {
    await theme();
    await settings();
    try { MobileSSH.ui.setTitle('ElevenLabs Speak'); } catch (e) {}
    updateCount();
    await loadKey();
    if (!apiKey) {
      show('s-key');
      log('Enter your ElevenLabs API key to begin.');
      return;
    }
    show('s-main');
    var had = await cachedVoices();
    try {
      await loadVoices();
      log(voices.length + ' voices. Type something, or run a command.');
    } catch (e) {
      if (had) log('Using cached voices — could not reach ElevenLabs.');
      else fail(e);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    logEl = $('log'); keyEl = $('key'); textEl = $('text'); cmdEl = $('cmd');
    voiceEl = $('voice'); countEl = $('count'); player = $('player');
    wire();
    init();
  });
})();
