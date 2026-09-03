// 分析单个会话：尾部事件 + 取材统计（复刻 command.ts 的 extractMaterial/packTurns 口径）
import { readSessionLog } from './decode.mjs'

const dir = process.argv[2]
const events = readSessionLog(dir)

const isChat = (e) => e?.type === 'user/message' || e?.type === 'assistant/message'
const chat = events.filter(isChat)
const pluginSrc = chat.filter((e) => e?.data?.source?.kind === 'plugin')
const real = chat.filter((e) => e?.data?.source?.kind !== 'plugin')

const plain = (e) => {
  const d = e?.data ?? {}
  const b = Array.isArray(d.content) ? d.content : []
  return (b.filter((x) => x?.type === 'text').map((x) => x.text).join('\n')) || (typeof d.text === 'string' ? d.text : '')
}

const ts = (e) => {
  const t = e?.meta?.at ?? e?.at ?? e?.data?.at ?? e?.timestamp
  return t ? new Date(typeof t === 'number' ? t : Date.parse(t)).toISOString().slice(5, 19).replace('T', ' ') : '?'
}

console.log('== 会话:', dir.split('/').filter(Boolean).pop())
console.log('总事件:', events.length, '| chat:', chat.length, '| plugin 注入:', pluginSrc.length, '| 真实对话:', real.length)

let chars = 0
for (const e of real) chars += plain(e).length
console.log('真实对话正文总字符:', chars)

// 取材预算（同 command.ts: 24000 字符）
console.log('取材预算 24000 字符 →', chars > 24000 ? `超限 ${((chars / 24000 - 1) * 100).toFixed(0)}%，需压缩` : '未超限')

console.log('\n-- 最近 15 个 chat 事件 --')
for (const e of chat.slice(-15)) {
  const role = e.type === 'user/message' ? '用户' : '助手'
  const kind = e?.data?.source?.kind ?? 'user'
  const txt = plain(e).replace(/\s+/g, ' ').slice(0, 90)
  console.log(`${ts(e)} [${role}/${kind}] ${txt}`)
}

console.log('\n-- 非 chat 事件类型分布 (top 12) --')
const m = new Map()
for (const e of events) {
  const t = String(e?.type ?? '?')
  m.set(t, (m.get(t) ?? 0) + 1)
}
for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(v, k)

console.log('\n-- 含 handoff/交接 的事件 --')
const hits = events.filter((e) => /handoff|交接/.test(JSON.stringify(e).slice(0, 400)))
console.log('命中数:', hits.length)
for (const e of hits.slice(-8)) console.log(ts(e), e?.type, JSON.stringify(e?.data ?? e).slice(0, 160))
