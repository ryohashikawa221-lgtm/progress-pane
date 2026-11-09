import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// 進行状況は JSON ファイル（statusFile、既定は ~/.claude/progress/STATUS.json）から読む。
// 週の使用量はこのセッションの値から読み、無ければ ~/.claude/usage-latest.json（あれば）を使う。
const PANE = 'progress-pane'
const DEFAULT_TITLE = '進行と使用量'
const tick = atom({ plugin: 'progress-pane', key: 'tick' } as const, 0)

type Item = { no?: string; name: string; stage: number; now?: string; next?: string }
type Status = {
  title?: string
  updated_at?: string
  stages?: string[]
  items?: Item[]
  waiting?: string
  waiting_label?: string
}
type Usage = { left?: number; resetAt: string; source: string }
type Snapshot = { status: Status; statusError: string; usage: Usage; total: number }

let statusPath = ''

const bar = (n: number, total: number) =>
  '█'.repeat(Math.max(0, Math.min(total, n))) + '░'.repeat(Math.max(0, total - n))

const when = (d: Date) => {
  if (isNaN(d.getTime())) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const hhmm = (iso?: string) => (iso ? when(new Date(iso)) : '')

async function home($: EngineInterface) {
  return (await $.env.get('HOME')) ?? ''
}

async function resolvePath($: EngineInterface) {
  const h = await home($)
  const p = statusPath.trim() || `${h}/.claude/progress/STATUS.json`
  return p.startsWith('~/') ? h + p.slice(1) : p
}

async function snapshot($: EngineInterface): Promise<Snapshot> {
  let status: Status = {}
  let statusError = ''
  const path = await resolvePath($)
  try {
    status = JSON.parse(await $.fs.read(path))
  } catch {
    statusError = `進行状況のファイルを読めません：${path}`
  }
  const usage: Usage = { resetAt: '', source: '' }
  try {
    const w = (await $.session.usage()).rateLimits.find(r => r.kind === 'seven_day')
    if (w) {
      usage.left = Math.round(100 - w.percentUsed)
      usage.resetAt = hhmm(w.resetsAt)
      usage.source = 'このセッション'
    }
  } catch {}
  if (usage.left === undefined) {
    try {
      const j = JSON.parse(await $.fs.read(`${await home($)}/.claude/usage-latest.json`))
      const r = j?.seven_day?.remaining_percentage
      if (typeof r === 'number') {
        usage.left = Math.round(r)
        const at = j?.seven_day?.resets_at
        usage.resetAt = typeof at === 'number' ? when(new Date(at * 1000)) : ''
        usage.source = `記録 ${hhmm(j?.recorded_at)}`
      }
    } catch {}
  }
  const total = status.stages?.length || 6
  return { status, statusError, usage, total }
}

const isWaiting = (s: Status) => !!s.waiting && !/^(なし|none|-)/i.test(s.waiting.trim())
const label = (s: Status) => s.waiting_label || 'あなたの番'

function statusLine(s: Snapshot) {
  const items = s.status.items ?? []
  const done = items.filter(i => i.stage >= s.total).length
  const left = s.usage.left === undefined ? '?' : `${s.usage.left}%`
  const each = items.map(i => `${i.no ?? i.name}${i.stage}/${s.total}`).join(' ')
  const wait = isWaiting(s.status) ? ` ｜ ${label(s.status)}あり` : ''
  return `週の残り ${left} ｜ 完了 ${done}/${items.length} ｜ ${each}${wait}`
}

function textReport(s: Snapshot) {
  const u = s.usage
  const lines = [
    `週の使用量の残り：${u.left === undefined ? '読めていません' : `${bar(Math.round(u.left / 10), 10)} ${u.left}%`}${u.resetAt ? `（戻るのは ${u.resetAt}）` : ''}`,
    '',
    ...(s.status.items ?? []).map(
      i => `${bar(i.stage, s.total)} ${i.no ?? ''} ${i.name}${i.now ? ` — 今：${i.now}` : ''}${i.next ? ` → 次：${i.next}` : ''}`,
    ),
  ]
  if (s.status.waiting) lines.push('', `${label(s.status)}：${s.status.waiting}`)
  if (s.status.updated_at) lines.push(`更新 ${hhmm(s.status.updated_at)}`)
  if (s.statusError) lines.unshift(s.statusError)
  return lines.join('\n')
}

async function refresh($: EngineInterface) {
  $.ui.status(statusLine(await snapshot($)))
  await update($, tick, n => n + 1)
}

export const register: Register = (on, options) => {
  statusPath = typeof options.statusFile === 'string' ? options.statusFile : ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: '進行状況と使用量を出す（枠も開く）' })
    void $.ui.open({ id: PANE, title: DEFAULT_TITLE })
    void refresh($)
    // 1 分ごとに下の 1 行と枠を新しくする
    $.clock.every(60_000, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'progress' }, async $ => {
    const s = await snapshot($)
    const opened = await $.ui.open({ id: PANE, title: s.status.title || DEFAULT_TITLE })
    $.ui.status(statusLine(s))
    const note = opened.isPlaced ? '' : `\n\n（枠はこの画面には出せません：${opened.reason}）`
    return { text: textReport(s) + note }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const s = await snapshot($)
    const items = s.status.items ?? []
    const done = items.filter(i => i.stage >= s.total).length
    const left = s.usage.left
    const usageColor = left === undefined ? undefined : left < 15 ? 'red' : left < 30 ? 'yellow' : 'green'

    return (
      <Box flexDirection="column">
        <Text bold>週の使用量の残り</Text>
        {left === undefined ? (
          <Text dimColor>まだ読めていません</Text>
        ) : (
          <Text color={usageColor}>
            {bar(Math.round(left / 10), 10)} {left}%
          </Text>
        )}
        {s.usage.resetAt !== '' && (
          <Text dimColor>
            戻るのは {s.usage.resetAt}（{s.usage.source}）
          </Text>
        )}
        <Text> </Text>
        <Text bold>
          {s.status.title || '進行'}（完了 {done}/{items.length}）
        </Text>
        {s.statusError !== '' && <Text color="red">{s.statusError}</Text>}
        {items.map(i => (
          <Box flexDirection="column">
            <Text>
              <Text color={i.stage >= s.total ? 'green' : undefined}>{bar(i.stage, s.total)}</Text> {i.no ?? ''} {i.name}
            </Text>
            {(i.now || i.next) && (
              <Text dimColor>
                {'   '}
                {i.now ? `今：${i.now}` : ''}
                {i.next ? ` → 次：${i.next}` : ''}
              </Text>
            )}
          </Box>
        ))}
        <Text> </Text>
        {s.status.waiting && (
          <Text>
            {label(s.status)}：{s.status.waiting}
          </Text>
        )}
        {(s.status.stages ?? []).length > 0 && <Text dimColor>段：{(s.status.stages ?? []).join('→')}</Text>}
        {s.status.updated_at && <Text dimColor>更新 {hhmm(s.status.updated_at)}</Text>}
      </Box>
    )
  })
}
