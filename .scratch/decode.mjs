// 多帧 zstd 会话日志读取器（Node 的 zstdDecompressSync 只解第一帧，需按帧魔数切帧）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export function decompressAllFrames(buf) {
  const idx = []
  for (let i = buf.indexOf(MAGIC); i !== -1; i = buf.indexOf(MAGIC, i + 1)) idx.push(i)
  if (idx.length === 0) throw new Error('no zstd frame magic')
  let out = ''
  for (let f = 0; f < idx.length; f += 1) {
    const start = idx[f]
    const end = f + 1 < idx.length ? idx[f + 1] : buf.length
    try {
      out += zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
    } catch (e) {
      // 容错：跳过坏帧
    }
  }
  return out
}

export function readSessionLog(dir) {
  const file = join(dir, 'session.jsonl.zstd')
  const text = decompressAllFrames(readFileSync(file))
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch {}
  }
  return events
}

export function listSessionDirs(root) {
  const out = []
  for (const name of readdirSync(root)) {
    const d = join(root, name)
    try {
      if (statSync(d).isDirectory() && statSync(join(d, 'session.jsonl.zstd')).isFile()) out.push(d)
    } catch {}
  }
  return out
}

// CLI: node decode.mjs <root> [--title <substr>]
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2]
  const tIdx = process.argv.indexOf('--title')
  const filter = tIdx > -1 ? process.argv[tIdx + 1] : null
  for (const dir of listSessionDirs(root)) {
    let events
    try { events = readSessionLog(dir) } catch (e) { console.error('ERR', dir, String(e).slice(0, 80)); continue }
    const titles = events.filter((e) => String(e?.type ?? '').endsWith('/title') || e?.type === 'title')
    const last = titles.length ? String(titles[titles.length - 1]?.data?.title ?? '') : ''
    const head = events.find((e) => e?.type === 'session' || e?.session)
    const sid = head?.session?.id ?? head?.id ?? ''
    const cwd = head?.session?.cwd ?? ''
    if (filter && !last.includes(filter)) continue
    console.log([dir.slice(dir.lastIndexOf('/') + 1), '|', last || '(no title)', '| n=' + events.length, '|', cwd].join(' '))
  }
}
