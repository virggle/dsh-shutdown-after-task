/**
 * dsh-shutdown-after-task — Shut down Windows after DeepSeek Harness tasks complete
 * 任务完成后自动关机（DeepSeek Harness 插件）
 *
 * A zero-dependency cordis plugin for the DeepSeek Harness web profile:
 *   - A floating "任务完成后关机 / Shutdown after task" text button sits at the
 *     bottom-right of the GUI (draggable — position persisted in localStorage).
 *     Click it to arm (or disarm) "shutdown after the task completes".
 *   - Auto-dodge: when another plugin's corner popup (fixed overlay with
 *     clickable content) overlaps the button, the button steps aside and
 *     returns once the popup is gone.
 *   - When armed, once ALL root sessions go idle with no agent/error in the
 *     batch, a 60 s cancellable countdown starts and `shutdown /s /t <n>` is
 *     issued. The GUI banner shows the remaining seconds with a "取消关机 /
 *     Cancel shutdown" button (POST /cancel → `shutdown /a`); the banner is
 *     anchored above the button wherever it currently sits.
 *   - Starting a new task during the countdown also aborts the shutdown
 *     automatically while keeping the mode armed.
 *   - Clicking "Cancel shutdown" aborts THIS shutdown AND disarms the mode.
 *
 * UI delivery (no client bundle, no build):
 *   - webServer.tapIndex injects <script src="/api/dsh-shutdown-after-task/ui.js">
 *     into every index.html response (applies on the next page load).
 *   - HTTP routes under /api/dsh-shutdown-after-task/*:
 *     GET /state, POST /arm, POST /disarm, POST /cancel, GET /ui.js
 *     (POSTs reject non-loopback Origins).
 *
 * Events (per @deepseek-ai/dsh-agent runtime-types):
 *   agent/status { agent, status: 'idle' | 'running' }; agent/error { agent, ... }
 * Only root agents (agents.roots()) count; subagents are folded into their root.
 *
 * Windows only: the plugin executes `shutdown.exe`. On other platforms it logs
 * and stays inert.
 *
 * Runtime log: $DSH_HOME/dsh-shutdown-after-task.log
 * License: MIT
 */
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const BASE = '/api/dsh-shutdown-after-task'

function dshHome() {
  const env = process.env.DSH_HOME && String(process.env.DSH_HOME).trim()
  return env ? path.resolve(env) : path.join(os.homedir(), '.dsh')
}
const LOG_PATH = path.join(dshHome(), 'dsh-shutdown-after-task.log')

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`
  console.log('[dsh-shutdown-after-task]', ...args)
  try { fs.appendFileSync(LOG_PATH, line + '\n', 'utf8') } catch { /* best-effort */ }
}

/** Normalize plugin config (no schema dependency; defaults match the prototype). */
function normalizeConfig(raw) {
  const c = (raw && typeof raw === 'object') ? raw : {}
  const clampInt = (v, def, min, max) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def
  }
  return {
    /** GUI countdown seconds before shutdown executes. */
    countdownSec: clampInt(c.countdownSec, 60, 10, 600),
    /** Extra seconds added to the OS `shutdown /t` command (startup slack). */
    marginSec: clampInt(c.marginSec, 5, 0, 60),
    /** Only shut down when the batch had no agent/error. */
    onlyOnSuccess: c.onlyOnSuccess !== false,
  }
}

// ---------- Injected UI script (plain JS, no build; no backticks/${} inside) ----------
const UI_JS = `
(function () {
  if (window.__dshSatLoaded) return
  window.__dshSatLoaded = true
  var BASE = '/api/dsh-shutdown-after-task'
  var btn = null, banner = null, note = null, noteTimer = null
  var suppressClick = false, dodging = false, drag = null, scanTimer = null

  function makeEl(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }
  function setVisible(e, show) { if (e) e.style.display = show ? 'block' : 'none' }
  function post(p) { return fetch(BASE + p, { method: 'POST' }).then(function (r) { return r.json() }).catch(function () { return null }) }

  var style = document.createElement('style')
  style.textContent = [
    '.dsh-sat-btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;pointer-events:auto;cursor:grab;touch-action:none;',
    'border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:8px 16px;font:13px/1.4 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;',
    'color:#c9c9d4;background:rgba(24,24,30,.85);box-shadow:0 4px 16px rgba(0,0,0,.35);backdrop-filter:blur(8px);user-select:none;',
    'transition:background .15s,color .15s,transform .18s ease}',
    '.dsh-sat-btn:active{cursor:grabbing}',
    '.dsh-sat-btn:hover{color:#fff;background:rgba(38,38,48,.9)}',
    '.dsh-sat-btn.on{color:#0f0f12;background:#ffd166;border-color:rgba(255,209,102,.5)}',
    '.dsh-sat-btn.on:hover{background:#ffdf8a}',
    '.dsh-sat-panel{position:fixed;z-index:2147483000;pointer-events:auto;display:none;',
    'width:300px;background:rgba(17,17,22,.94);color:#f2f2f4;border:1px solid rgba(255,255,255,.14);border-radius:12px;',
    'padding:14px 16px;font:13px/1.5 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;',
    'box-shadow:0 8px 30px rgba(0,0,0,.45);backdrop-filter:blur(10px)}',
    '.dsh-sat-panel .t{font-weight:600;font-size:14px;margin-bottom:4px}',
    '.dsh-sat-panel .b{color:#c8c8d0;margin-bottom:10px}',
    '.dsh-sat-panel .cancel{pointer-events:auto;cursor:pointer;border:0;border-radius:8px;padding:6px 14px;',
    'font-size:13px;color:#fff;background:#e5484d}',
    '.dsh-sat-panel .cancel:hover{background:#f2555a}',
    '.dsh-sat-panel.warn .t{color:#ffd166}',
    '.dsh-sat-panel.err .t{color:#ff9aa2}'
  ].join('')
  document.head.appendChild(style)

  btn = makeEl('button', 'dsh-sat-btn', '任务完成后关机')
  btn.setAttribute('type', 'button')
  document.body.appendChild(btn)

  banner = makeEl('div', 'dsh-sat-panel')
  banner.appendChild(makeEl('div', 't', '任务已完成'))
  banner.appendChild(makeEl('div', 'b', ''))
  var cancelBtn = makeEl('button', 'cancel', '取消关机')
  cancelBtn.addEventListener('click', function () {
    post('/cancel').then(function (s) { if (s) applyState(s) })
  })
  banner.appendChild(cancelBtn)
  document.body.appendChild(banner)

  note = makeEl('div', 'dsh-sat-panel warn')
  document.body.appendChild(note)

  // ---- restore saved drag position ----
  try {
    var saved = JSON.parse(localStorage.getItem('dsh-sat-pos') || 'null')
    if (saved && typeof saved.l === 'number' && typeof saved.t === 'number') {
      btn.style.left = saved.l + 'px'
      btn.style.top = saved.t + 'px'
      btn.style.right = 'auto'
      btn.style.bottom = 'auto'
    }
  } catch (e) { /* ignore */ }

  // ---- draggable: pointer events; a real drag suppresses the click ----
  btn.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return
    undodge()
    drag = { sx: e.clientX, sy: e.clientY, l: btn.offsetLeft, t: btn.offsetTop, moved: false }
    try { btn.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
  })
  btn.addEventListener('pointermove', function (e) {
    if (!drag) return
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true
    if (!drag.moved) return
    var l = Math.min(Math.max(8, drag.l + e.clientX - drag.sx), window.innerWidth - btn.offsetWidth - 8)
    var t = Math.min(Math.max(8, drag.t + e.clientY - drag.sy), window.innerHeight - btn.offsetHeight - 8)
    btn.style.left = l + 'px'
    btn.style.top = t + 'px'
    btn.style.right = 'auto'
    btn.style.bottom = 'auto'
  })
  function endDrag() {
    if (!drag) return
    suppressClick = drag.moved
    if (drag.moved) {
      try { localStorage.setItem('dsh-sat-pos', JSON.stringify({ l: btn.offsetLeft, t: btn.offsetTop })) } catch (err) { /* ignore */ }
    }
    drag = null
  }
  btn.addEventListener('pointerup', endDrag)
  btn.addEventListener('pointercancel', endDrag)
  btn.addEventListener('click', function () {
    if (suppressClick) { suppressClick = false; return }
    var on = btn.classList.contains('on')
    post(on ? '/disarm' : '/arm').then(function (s) { if (s) applyState(s) })
  })

  // ---- auto-dodge: step aside when another plugin's fixed popup with
  //      clickable content overlaps our button; restore when it goes away ----
  function isOurs(el) {
    return el === btn || el === banner || el === note ||
      (btn && btn.contains(el)) || (banner && banner.contains(el)) || (note && note.contains(el))
  }
  function fixedOverlay(el) {
    var cur = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (isOurs(cur)) return null
      var st = window.getComputedStyle(cur)
      if (st.position === 'fixed' && st.display !== 'none' && st.visibility !== 'hidden') return cur
      cur = cur.parentElement
    }
    return null
  }
  function clickableAt(el) {
    var t = el && el.tagName
    if (!t) return false
    if (t === 'BUTTON' || t === 'A' || t === 'INPUT' || t === 'SELECT' || el.getAttribute('role') === 'button') return true
    return typeof el.onclick === 'function'
  }
  function area(r) { return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top) }
  function intersectArea(a, b) {
    var w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    var h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    return w * h
  }
  function findIntruder() {
    if (!btn) return null
    var r = btn.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return null
    var pts = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 2, r.top + 2], [r.right - 2, r.top + 2],
      [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]
    ]
    for (var i = 0; i < pts.length; i++) {
      var chain = document.elementsFromPoint(pts[i][0], pts[i][1])
      for (var j = 0; j < chain.length; j++) {
        var el = chain[j]
        if (el === btn || isOurs(el)) continue
        var ov = fixedOverlay(el)
        if (!ov || !clickableAt(el)) continue
        var or = ov.getBoundingClientRect()
        if (intersectArea(or, r) > area(r) * 0.3) return ov
      }
    }
    return null
  }
  function undodge() {
    if (dodging) { btn.style.transform = ''; dodging = false }
  }
  function dodgeScan() {
    if (!btn || drag) return
    var intr = findIntruder()
    if (intr && !dodging) {
      var br = btn.getBoundingClientRect()
      var ir = intr.getBoundingClientRect()
      var off = Math.max(0, br.bottom - ir.top) + 14
      btn.style.transform = 'translateY(-' + off + 'px)'
      dodging = true
    } else if (!intr && dodging) {
      btn.style.transform = ''
      dodging = false
    }
  }
  try {
    var mo = new MutationObserver(function () {
      clearTimeout(scanTimer)
      scanTimer = setTimeout(dodgeScan, 250)
    })
    mo.observe(document.body, { childList: true, subtree: true })
  } catch (e) { /* ignore */ }

  // ---- countdown/notice panel follows the button's current position ----
  function placePanel(panelEl) {
    var r = btn.getBoundingClientRect()
    var pw = panelEl.offsetWidth || 300
    var ph = panelEl.offsetHeight || 120
    panelEl.style.right = 'auto'
    panelEl.style.bottom = 'auto'
    panelEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + 'px'
    var top = r.top - ph - 10
    panelEl.style.top = (top >= 8 ? top : r.bottom + 10) + 'px'
  }

  function showBanner(title, body, cls, showCancel) {
    banner.className = 'dsh-sat-panel' + (cls ? ' ' + cls : '')
    banner.querySelector('.t').textContent = title
    banner.querySelector('.b').textContent = body
    setVisible(cancelBtn, !!showCancel)
    placePanel(banner)
    setVisible(banner, true)
  }
  function hideBanner() { setVisible(banner, false) }
  function showNote(text, ms) {
    note.querySelector('.t').textContent = text
    placePanel(note)
    setVisible(note, true)
    clearTimeout(noteTimer)
    noteTimer = setTimeout(function () { setVisible(note, false) }, ms || 6000)
  }
  window.addEventListener('resize', function () {
    if (banner && banner.style.display === 'block') placePanel(banner)
    if (note && note.style.display === 'block') placePanel(note)
    dodgeScan()
  })

  function applyState(s) {
    if (!s) return
    if (s.armed) { btn.textContent = '任务完成后关机：已开启'; btn.classList.add('on') }
    else { btn.textContent = '任务完成后关机'; btn.classList.remove('on') }
    if (s.state === 'countdown') {
      var remain = Math.max(0, Math.ceil(((s.deadline || 0) - Date.now()) / 1000))
      showBanner('任务已完成', remain > 0 ? remain + ' 秒后自动关机' : '正在关机…', '', true)
    } else if (s.state === 'fired') {
      showBanner('系统即将关机', '关机指令已生效，无法取消', '', false)
    } else {
      hideBanner()
    }
    if (s.lastSkip && (Date.now() - s.lastSkip.at) < 6000) {
      showNote(s.lastSkip.reason, 6000)
    }
  }

  function tick() {
    fetch(BASE + '/state', { cache: 'no-store' }).then(function (r) { return r.json() }).then(applyState).catch(function () {})
  }
  tick()
  setInterval(tick, 1000)
  setInterval(dodgeScan, 1000)
})();
`

module.exports = {
  name: 'dsh-shutdown-after-task',
  inject: ['agents', 'subprocess', 'webServer'],
  apply(ctx, rawConfig) {
    const cfg = normalizeConfig(rawConfig)

    if (process.platform !== 'win32') {
      log(`当前平台 ${process.platform} 非 Windows（需要 shutdown.exe），插件保持惰性`)
      return
    }

    const agents = ctx.get('agents')
    const subprocess = ctx.get('subprocess')
    const webServer = ctx.get('webServer')
    if (agents === undefined || subprocess === undefined) {
      log('缺少 agents/subprocess 服务，插件不加载')
      return
    }

    // ---------- state ----------
    let armed = false          // mode switch (button-controlled)
    let state = 'idle'         // idle | countdown | fired
    let errored = new Set()    // root agents that errored in this batch
    let deadline = 0
    let firedTimer = null
    let lastSkip = null        // { at, reason } most recent "errored, skipped" notice

    function roots() {
      try { return agents.roots() } catch { return [] }
    }
    function rootsRunning() {
      try { return roots().filter((a) => a && a.status === 'running').length } catch { return 0 }
    }
    function isRoot(agent) {
      try { return roots().includes(agent) } catch { return true }
    }

    async function spawnShutdown(args) {
      let argv = args
      try {
        const exe = await subprocess.resolveExecutable('shutdown')
        if (typeof exe === 'string' && exe.length > 0) argv = [exe, ...args]
      } catch { /* fall back to the bare command name (System32 is on PATH) */ }
      try {
        const handle = subprocess.spawn({
          argv,
          cwd: '/',
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
          graceMs: 15000,
        })
        handle.done.then((outcome) => log('shutdown 进程退出:', JSON.stringify(outcome)))
          .catch((err) => log('shutdown 进程启动失败:', err && err.message ? err.message : err))
      } catch (err) {
        log('spawn 失败:', err && err.message ? err.message : err)
      }
    }

    function reset() {
      state = 'idle'
      deadline = 0
      if (firedTimer !== null) { try { firedTimer() } catch { /* ignore */ } firedTimer = null }
    }

    function armShutdown() {
      if (state !== 'idle') return
      state = 'countdown'
      deadline = Date.now() + cfg.countdownSec * 1000
      log(`★ 任务完成 → ${cfg.countdownSec} 秒后关机（GUI 可取消）`)
      void spawnShutdown(['/s', '/t', String(cfg.countdownSec + cfg.marginSec)])
      firedTimer = ctx.setTimeout(() => {
        state = 'fired'
        log('系统关机指令已生效（无法取消）')
      }, (cfg.countdownSec + cfg.marginSec + 5) * 1000)
    }

    /** Cancel the pending OS shutdown; also disarms the mode (user clicked Cancel). */
    function cancelShutdown() {
      if (state !== 'countdown' && state !== 'fired') return false
      void spawnShutdown(['/a'])
      reset()
      if (armed) {
        armed = false
        errored = new Set()
        log('已取消关机（shutdown /a），模式已关闭')
      } else {
        log('已取消关机（shutdown /a）')
      }
      return true
    }

    function setArmed(next) {
      if (next === armed) return armed
      armed = next
      errored = new Set()
      if (!next && state !== 'idle') cancelShutdown()
      log(armed ? '已开启：任务完成后自动关机' : '已关闭：任务完成后自动关机')
      return armed
    }

    // ---------- events ----------
    ctx.on('agent/status', ({ agent, status }) => {
      if (!agent || !isRoot(agent)) return
      if (status === 'running') {
        errored = new Set() // new activity: fresh error window
        if (state === 'countdown') {
          log('倒计时期间新任务开始，取消关机（模式保持开启）')
          cancelShutdown()
        }
        return
      }
      // status === 'idle'
      if (!armed || state !== 'idle') return
      if (rootsRunning() > 0) return
      if (cfg.onlyOnSuccess && errored.size > 0) {
        lastSkip = { at: Date.now(), reason: `本批次有 ${errored.size} 个会话出错，仅成功时关机（模式保持开启）` }
        log(lastSkip.reason)
        return
      }
      armShutdown()
    })

    ctx.on('agent/error', ({ agent }) => {
      if (!agent || !isRoot(agent)) return
      errored.add(String(agent.id))
      log('root 会话出错:', String(agent.id))
    })

    // ---------- HTTP routes & UI injection ----------
    const disposers = []
    if (webServer !== undefined) {
      const json = (res, status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      const text = (res, status, body, type) => {
        res.writeHead(status, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
      }
      const originOk = (req) => {
        const origin = req.headers.origin
        if (origin === undefined) return true
        try { const u = new URL(origin); return u.hostname === '127.0.0.1' || u.hostname === 'localhost' } catch { return false }
      }
      const statePayload = () => ({
        armed, state, deadline, countdownSec: cfg.countdownSec, erroredCount: errored.size, lastSkip,
      })

      disposers.push(webServer.register({
        kind: 'exact', path: BASE + '/state',
        handler: (req, res) => json(res, 200, statePayload()),
      }))
      disposers.push(webServer.register({
        kind: 'exact', path: BASE + '/arm',
        handler: (req, res) => { if (!originOk(req)) return json(res, 403, { error: 'origin rejected' }); setArmed(true); json(res, 200, statePayload()) },
      }))
      disposers.push(webServer.register({
        kind: 'exact', path: BASE + '/disarm',
        handler: (req, res) => { if (!originOk(req)) return json(res, 403, { error: 'origin rejected' }); setArmed(false); json(res, 200, statePayload()) },
      }))
      disposers.push(webServer.register({
        kind: 'exact', path: BASE + '/cancel',
        handler: (req, res) => { if (!originOk(req)) return json(res, 403, { error: 'origin rejected' }); const ok = cancelShutdown(); json(res, 200, { ok, ...statePayload() }) },
      }))
      disposers.push(webServer.register({
        kind: 'exact', path: BASE + '/ui.js',
        handler: (req, res) => text(res, 200, UI_JS, 'text/javascript; charset=utf-8'),
      }))

      disposers.push(webServer.tapIndex((html) => {
        if (html.includes('dsh-shutdown-after-task')) return html
        const tag = '<script defer src="' + BASE + '/ui.js"></script>'
        return html.includes('</body>') ? html.replace('</body>', tag + '</body>') : html + tag
      }))
      log('HTTP 路由与 UI 注入已注册')
    }

    log(`插件已挂载：root 会话 ${roots().length} 个，运行中 ${rootsRunning()} 个（模式默认关闭，点右下角按钮开启）`)
    return () => { for (const d of disposers) { try { d() } catch { /* ignore */ } } }
  },
}
