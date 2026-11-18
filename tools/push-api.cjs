#!/usr/bin/env node
/**
 * GitHub API 推送兜底脚本（第 87 批）。
 *
 * 为什么需要它：公司网络/代理经常把 `github.com:443` 掐掉（CONNECT 502 或直接 reset），
 * 但 `api.github.com` 一直是通的。这个脚本用 Git Data API 把本地待推的提交原样搬上去：
 *   blobs → trees(base_tree) → commits → PATCH ref
 *
 * 关键点：**远端 commit sha 与本地保持一致**。
 * 做法是把 author / committer（含原始时间与时区）、tree、message、parent 全部按本地提交原样传，
 * 因此不需要改写本地历史，也不会产生「远端有、本地没有」的分叉。
 *
 * 用法：
 *   node tools/push-api.cjs            # 推送当前分支所有领先远端的提交
 *   node tools/push-api.cjs --dry-run  # 只列出待推提交，不写远端
 *
 * 凭据：从 `git credential fill` 取（Windows 凭据管理器里存的 GitHub token），
 * 不读环境变量、不落盘、不打印。
 *
 * 限制：
 *   - 只支持 GitHub（origin 必须是 github.com 的仓库）
 *   - 只推直线历史；遇到 merge 提交或远端分叉会明确报错，让你改用 git push
 */
const { execFileSync } = require('child_process')
const https = require('https')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')

function git(argv, opts) {
  return execFileSync('git', argv, {
    cwd: process.cwd(),
    maxBuffer: 200 * 1024 * 1024,
    ...opts
  })
}

function parseRemote() {
  const url = git(['remote', 'get-url', 'origin']).toString('utf8').trim()
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) throw new Error('origin 不是 GitHub 仓库：' + url)
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
}

function readToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }).toString('utf8')
  const m = out.match(/^password=(.+)$/m)
  if (!m) throw new Error('git 凭据里没有 GitHub token（先在命令行 push 一次，或配置 credential）')
  return m[1].trim()
}

function api(method, path, body, tk) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${tk}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'vellum-push-api',
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {})
        },
        timeout: 90000
      },
      (res) => {
        let s = ''
        res.on('data', (d) => (s += d))
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(s))
            } catch {
              reject(new Error('响应不是 JSON：' + s.slice(0, 200)))
            }
          } else {
            reject(new Error(`${method} ${path} -> ${res.statusCode}: ${s.slice(0, 400)}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
    if (data) req.write(data)
    req.end()
  })
}

/** epoch + "+0800" → "2026-11-18T11:40:00+08:00"（Git 提交里存的就是这套） */
function isoWithOffset(ts, tz) {
  const sign = tz[0] === '-' ? -1 : 1
  const hh = Number(tz.slice(1, 3))
  const mm = Number(tz.slice(3, 5))
  const d = new Date((ts + sign * (hh * 60 + mm) * 60) * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${tz.slice(0, 3)}:${tz.slice(3, 5)}`
  )
}

function parsePerson(line) {
  const m = line.match(/^\w+ (.*) <(.*)> (\d+) ([+-]\d{4})$/)
  if (!m) throw new Error('解析不了身份行：' + line)
  return { name: m[1], email: m[2], date: isoWithOffset(Number(m[3]), m[4]) }
}

function parseCommit(sha) {
  const raw = git(['cat-file', 'commit', sha]).toString('utf8')
  const idx = raw.indexOf('\n\n')
  const head = raw.slice(0, idx)
  const lines = head.split('\n')
  return {
    tree: (head.match(/^tree (\w+)/m) || [])[1],
    parent: (head.match(/^parent (\w+)/m) || [])[1] || null,
    author: parsePerson(lines.find((l) => l.startsWith('author '))),
    committer: parsePerson(lines.find((l) => l.startsWith('committer '))),
    message: raw.slice(idx + 2)
  }
}

function changedFiles(parent, commit) {
  return git([
    '-c',
    'core.quotepath=false',
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    parent,
    commit
  ])
    .toString('utf8')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      return { status: parts[0][0], path: parts.slice(1).join('\t') }
    })
}

async function main() {
  const { owner, repo } = parseRemote()
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).toString('utf8').trim()
  const head = git(['rev-parse', 'HEAD']).toString('utf8').trim()
  const tk = readToken()

  let remoteSha = null
  try {
    const r = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, null, tk)
    remoteSha = r.object.sha
  } catch (e) {
    if (!/-> 404/.test(e.message)) throw e
    // 远端还没有这个分支：下面会把 HEAD 推过去（要求父提交已在远端）
  }

  if (remoteSha === head) {
    console.log(`已是最新：${head.slice(0, 7)}（${branch}）`)
    return
  }

  let commits = []
  if (remoteSha) {
    let isAncestor = true
    try {
      git(['merge-base', '--is-ancestor', remoteSha, head])
    } catch {
      isAncestor = false
    }
    if (!isAncestor) {
      throw new Error(
        `远端有本地没有的提交（分叉）：远端 ${remoteSha.slice(0, 7)}。请先 git pull，或改用 git push。`
      )
    }
    commits = git(['rev-list', '--reverse', `${remoteSha}..${head}`])
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
  } else {
    commits = [head]
  }

  console.log(`待推 ${commits.length} 个提交 → ${owner}/${repo}@${branch}`)
  for (const c of commits) console.log('  ' + c.slice(0, 7))

  if (DRY) {
    console.log('\n--dry-run：只列出待推提交，未写入远端。')
    return
  }

  let parentSha = remoteSha
  let baseTree = null
  if (remoteSha) {
    const c = await api('GET', `/repos/${owner}/${repo}/git/commits/${remoteSha}`, null, tk)
    baseTree = c.tree.sha
  }

  for (const full of commits) {
    const meta = parseCommit(full)
    if (meta.parent !== parentSha) {
      throw new Error(
        `提交 ${full.slice(0, 7)} 的父提交是 ${String(meta.parent).slice(0, 7)}，` +
          `与预期 ${String(parentSha).slice(0, 7)} 不符（merge 提交或历史不连续，请改用 git push）`
      )
    }

    const files = changedFiles(parentSha, full)
    const entries = []
    for (const f of files) {
      if (f.status === 'D') {
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null })
        continue
      }
      const buf = git(['show', `${full}:${f.path}`])
      const blob = await api(
        'POST',
        `/repos/${owner}/${repo}/git/blobs`,
        { content: buf.toString('base64'), encoding: 'base64' },
        tk
      )
      const mode = git(['ls-tree', full, '--', f.path]).toString('utf8').split(' ')[0] || '100644'
      entries.push({ path: f.path, mode, type: 'blob', sha: blob.sha })
      console.log(`  ${f.status} ${f.path}`)
    }

    const treeBody = baseTree ? { base_tree: baseTree, tree: entries } : { tree: entries }
    const tree = await api('POST', `/repos/${owner}/${repo}/git/trees`, treeBody, tk)
    if (tree.sha !== meta.tree) {
      throw new Error(`tree 不一致：本地 ${meta.tree}，远端生成 ${tree.sha}`)
    }

    const cm = await api(
      'POST',
      `/repos/${owner}/${repo}/git/commits`,
      {
        message: meta.message,
        tree: tree.sha,
        parents: parentSha ? [parentSha] : [],
        author: meta.author,
        committer: meta.committer
      },
      tk
    )
    if (cm.sha !== full) {
      throw new Error(`commit sha 不一致：本地 ${full}，远端生成 ${cm.sha}`)
    }
    console.log(`  ✓ ${full.slice(0, 7)}（sha 一致）`)

    parentSha = full
    baseTree = tree.sha
  }

  const patched = await api(
    'PATCH',
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { sha: parentSha, force: false },
    tk
  )
  console.log(`\n远端分支已更新：${branch} -> ${patched.object.sha}`)
  console.log('本地 origin 引用可用 git fetch 刷新，或执行：')
  console.log(`  git update-ref refs/remotes/origin/${branch} ${patched.object.sha}`)
}

main().catch((e) => {
  console.error('\n推送失败：' + e.message)
  process.exit(1)
})
