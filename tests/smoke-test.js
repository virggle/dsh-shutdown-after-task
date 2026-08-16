/**
 * Smoke test for dsh-shutdown-after-task (no harness required).
 * Verifies the module shape and that apply() wires up without throwing.
 * Run: node tests/smoke-test.js
 */
'use strict'
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Isolate the plugin's log path (module computes LOG_PATH at require time).
const fakeHome = path.join(__dirname, '.tmp-dsh-home')
fs.mkdirSync(fakeHome, { recursive: true })
process.env.DSH_HOME = fakeHome

const plugin = require('../index.js')

assert.strictEqual(plugin.name, 'dsh-shutdown-after-task')
assert.deepStrictEqual(plugin.inject, ['agents', 'subprocess', 'webServer'])
assert.strictEqual(typeof plugin.apply, 'function')

function fakeCtx() {
  const routes = []
  let tapped = 0
  return {
    get(name) {
      if (name === 'agents') return { roots: () => [] }
      if (name === 'subprocess') {
        return {
          resolveExecutable: async () => 'shutdown.exe',
          spawn: () => ({ done: Promise.resolve({ exitCode: 0, signal: null }) }),
        }
      }
      if (name === 'webServer') {
        return {
          register: (route) => { routes.push(route); return () => {} },
          tapIndex: () => { tapped += 1; return () => {} },
        }
      }
      return undefined
    },
    on: () => () => {},
    setTimeout: () => () => {},
  }
}

const ctx = fakeCtx()
const disposer = plugin.apply(ctx, {})
// On Windows the plugin activates; elsewhere it stays inert (undefined disposer).
assert.ok(disposer === undefined || typeof disposer === 'function')
if (typeof disposer === 'function') disposer()

console.log('smoke test OK')
process.exit(0)
