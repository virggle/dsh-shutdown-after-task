#!/usr/bin/env node
/**
 * Submit dsh-shutdown-after-task to awesome-dsh-plugin (the source list behind
 * dshmarket). Runs the full flow: eligibility check → fork → clone → add entry
 * yml → regenerate READMEs → commit → push → open PR.
 *
 * Usage:
 *   GH_TOKEN=<classic token with repo scope> node scripts/submit-to-awesome.mjs
 *
 * Eligibility (checked by this script and enforced upstream):
 *   - repo ≥ 1 day old and ≥ 10 commits
 *   - carries the `dsh-plugin` topic
 *   - package.json declares a `dsh.bundle` manifest
 */
'use strict'
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const TOKEN = process.env.GH_TOKEN
if (!TOKEN) { console.error('GH_TOKEN not set'); process.exit(1) }

const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const REPO = 'dsh-shutdown-after-task'
const BRANCH = 'submit-dsh-shutdown-after-task'
const WORK = path.join(__dirname, '..', '.awesome-tmp')

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL('https://api.github.com' + urlPath)
    const r = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { Authorization: 'Bearer ' + TOKEN, 'User-Agent': 'dsh-submit', Accept: 'application/vnd.github+json', ...headers },
    }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { let j = null; try { j = JSON.parse(d) } catch { /* ignore */ } resolve({ status: res.statusCode, json: j, text: d }) })
    })
    r.on('error', reject)
    if (body !== undefined) r.write(JSON.stringify(body))
    r.end()
  })
}

async function main() {
  const me = await req('GET', '/user')
  if (me.status !== 200) { console.error('AUTH FAIL', me.status); process.exit(1) }
  const owner = me.json.login
  console.log('authenticated as:', owner)

  // ---- eligibility ----
  const repo = await req('GET', `/repos/${owner}/${REPO}`)
  if (repo.status !== 200) { console.error('repo not found'); process.exit(1) }
  const ageDays = (Date.now() - new Date(repo.json.created_at).getTime()) / 86400000
  const commits = await req('GET', `/repos/${owner}/${REPO}/commits?per_page=100`)
  const commitCount = Array.isArray(commits.json) ? commits.json.length : 0
  console.log(`repo age: ${ageDays.toFixed(2)} days, commits: ${commitCount}, topics: ${repo.json.topics.join(', ')}`)
  if (ageDays < 1 || commitCount < 10) {
    console.error('NOT ELIGIBLE YET — needs ≥1 day old and ≥10 commits (brand-new repos can resubmit once they clear this).')
    process.exit(1)
  }
  if (!repo.json.topics.includes('dsh-plugin')) { console.error('missing dsh-plugin topic'); process.exit(1) }

  // ---- fork upstream ----
  const fork = await req('POST', `/repos/${UPSTREAM}/forks`)
  if (fork.status !== 202 && fork.status !== 200) { console.error('FORK FAIL', fork.status, fork.text.slice(0, 300)); process.exit(1) }
  const forkName = fork.json.full_name
  console.log('fork ready:', forkName)

  // ---- clone + add entry ----
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })
  execSync(`git clone --depth 1 https://github.com/${forkName}.git`, { cwd: WORK, stdio: 'inherit' })
  const clone = path.join(WORK, 'awesome-dsh-plugin')

  const entry = [
    `url: https://github.com/${owner}/${REPO}`,
    `name: ${owner}/${REPO}`,
    'category: workflow',
    'description:',
    '  en: Shut down Windows automatically after DeepSeek Harness tasks complete — a floating arm button plus a cancellable countdown banner (shutdown /a), zero runtime dependencies.',
    '  zh: 任务完成后自动关机：右下角按钮开启模式，任务成功完成后进入可取消的倒计时（取消走 shutdown /a），零运行时依赖。',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(clone, `data/plugins/${owner}__${REPO}.yml`), entry)
  console.log('entry written')

  // ---- regenerate READMEs (best-effort) ----
  try {
    execSync('npm install --no-audit --no-fund --cache ' + path.join(WORK, '.npm-cache'), { cwd: clone, stdio: 'inherit' })
    execSync('node scripts/generate-readme.mjs', { cwd: clone, stdio: 'inherit' })
    console.log('READMEs regenerated')
  } catch (e) {
    console.warn('README regeneration failed; PR will carry the entry yml only:', String(e.message).split('\n')[0])
  }

  // ---- branch, commit, push ----
  execSync(`git checkout -b ${BRANCH}`, { cwd: clone, stdio: 'inherit' })
  execSync('git add -A', { cwd: clone })
  execSync(`git -c user.name="${owner}" -c user.email="${owner}@users.noreply.github.com" commit -m "Add ${owner}/${REPO}"`, { cwd: clone, stdio: 'inherit' })
  execSync(`git push https://x-access-token:${TOKEN}@github.com/${forkName}.git ${BRANCH}`, { cwd: clone, stdio: 'inherit' })
  console.log('pushed branch:', BRANCH)

  // ---- open PR ----
  const pr = await req('POST', `/repos/${UPSTREAM}/pulls`, {
    title: `Add ${owner}/${REPO}`,
    head: `${owner}:${BRANCH}`,
    base: 'main',
    body: `Adds [${owner}/${REPO}](https://github.com/${owner}/${REPO}) — a Windows auto-shutdown plugin for DeepSeek Harness: button-armed, cancellable countdown.`,
  })
  if (pr.status === 201) console.log('PR OPENED:', pr.json.html_url)
  else console.error('PR FAIL', pr.status, pr.text.slice(0, 400))
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
