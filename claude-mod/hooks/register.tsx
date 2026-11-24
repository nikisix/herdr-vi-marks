import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mark } from '../types'

const PANE = 'vi-marks'
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

// Mods can't define keybinding actions, so the band's Buttons borrow four
// engine actions that only have handlers inside the /diff dialog. The person
// binds chords to them in ~/.claude/keybindings.json (Global context)
const ACTION = {
  prev: 'diff:previousFile',
  next: 'diff:nextFile',
  set: 'diff:previousSource',
  jump: 'diff:nextSource',
} as const

const marks = atom({ plugin: 'vi-marks', key: 'marks' } as const, {}, {
  shape: 'marks-1',
})
const back = atom({ plugin: 'vi-marks', key: 'back' } as const, null, {
  shape: 'back-1',
})

type Seen = { first: number; t: number }
// ids: every transcript row in display order; anchors: rows that only mark a
// position (slash commands), never a hop target
// keys: each turn's prompt and final response, which focus view always shows
type Order = {
  size: number
  ids: string[]
  index: Map<string, number>
  labels: Map<string, string>
  anchors: Set<string>
  keys: Set<string>
}

// The transcript JSONL keeps one row per assistant block and prompt, with the
// same uuids the renderer uses as requestIds (tool rows use their tool_use id).
// Walk the parentUuid chain back from the newest row so rewinds and sidechains
// drop out, then keep the rows the transcript draws
function parseOrder(text: string, size: number): Order {
  type Row = {
    uuid?: string
    parentUuid?: string | null
    logicalParentUuid?: string | null
    type?: string
    isSidechain?: boolean
    isMeta?: boolean
    message?: { content?: unknown }
  }
  const rows = new Map<string, Row>()
  let last: Row | undefined
  for (const line of text.split('\n')) {
    if (!line) continue
    let row: Row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row.uuid) continue
    rows.set(row.uuid, row)
    if ((row.type === 'user' || row.type === 'assistant') && !row.isSidechain) last = row
  }
  const chain: Row[] = []
  const visited = new Set<string>()
  let cur = last
  while (cur && cur.uuid && !visited.has(cur.uuid)) {
    visited.add(cur.uuid)
    chain.push(cur)
    const parent = cur.parentUuid ?? cur.logicalParentUuid
    cur = parent ? rows.get(parent) : undefined
  }
  chain.reverse()

  const ids: string[] = []
  const labels = new Map<string, string>()
  const anchors = new Set<string>()
  const add = (id: string, label: string, isAnchor = false) => {
    if (labels.has(id)) return
    ids.push(id)
    labels.set(id, label.replace(/\s+/g, ' ').trim().slice(0, 60))
    if (isAnchor) anchors.add(id)
  }
  for (const row of chain) {
    if (row.isSidechain || row.isMeta || !row.uuid) continue
    const content = row.message?.content
    if (row.type === 'user') {
      if (typeof content === 'string') {
        // A slash command's row is stored as <command-name>… markup
        add(row.uuid, `❯ ${content}`, content.startsWith('<'))
      } else if (Array.isArray(content)) {
        const texts = content.filter(b => b?.type === 'text' && typeof b.text === 'string')
        const text = texts.find(b => !b.text.startsWith('<'))
        const isResult = content.some(b => b?.type === 'tool_result')
        if (!isResult && texts.length) add(row.uuid, `❯ ${(text ?? texts[0]).text}`, !text)
      }
    } else if (row.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) add(row.uuid, `⏺ ${b.text}`)
        if (b?.type === 'tool_use' && typeof b.id === 'string') add(b.id, `⏺ ${b.name}(${toolArg(b.input)})`)
      }
    }
  }
  const keys = new Set<string>()
  let lastText: string | null = null
  for (const id of ids) {
    if (anchors.has(id)) continue
    if (labels.get(id)?.startsWith('❯')) {
      if (lastText) keys.add(lastText)
      keys.add(id)
      lastText = null
    } else if (!id.startsWith('toolu_')) lastText = id
  }
  if (lastText) keys.add(lastText)
  return { size, ids, index: new Map(ids.map((id, i) => [id, i])), labels, anchors, keys }
}

type Api = EngineInterface

// Rows report which of their lines the viewport shows, but only when that
// changes and only at the viewport's edges, and a row a long jump skips past
// can keep its last report. So the newest burst of reports is the truth: the
// earliest row in it is the top of the view. Module state; a reload resets it
const S = {
  seen: new Map<string, Seen>(),
  cursor: null as { id: string; t: number } | null,
  order: null as Order | null,
  path: null as string | null,
  mode: 'set' as 'set' | 'jump',
  pendingTop: null as string | null,
  // Rows that have been on screen as themselves at least once. Rows folded
  // away (focus view, Claude's tool groups) still mount but only ever report
  // being off screen, so they never land here
  visible: new Set<string>(),
  hidden: new Map<string, number>(),
}

// When the module (re)loads, every mounted row redraws at once with the
// geometry it last laid out, on screen or not: trust where rows say they are
// only once that settles
const LOADED = Date.now()

function observe(id: string, onScreen: { first: number } | null | undefined) {
  if (onScreen === undefined || id.startsWith('placeholder')) return
  if (onScreen === null) {
    S.seen.delete(id)
    return
  }
  S.visible.add(id)
  S.hidden.delete(id)
  if (Date.now() - LOADED > 1500) S.seen.set(id, { first: onScreen.first, t: Date.now() })
}

async function transcriptPath($: Api) {
  if (S.path) return S.path
  const home = await $.env.get('HOME')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const sid = await $.session.id()
  const cwd = await $.session.cwd()
  const guess = `${config}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${sid}.jsonl`
  const dirs = await $.fs.list(`${config}/projects`).catch(() => [])
  const candidates = [guess, ...dirs.filter(d => d.kind === 'dir').map(d => `${config}/projects/${d.name}/${sid}.jsonl`)]
  for (const candidate of candidates) {
    const dir = candidate.slice(0, candidate.lastIndexOf('/'))
    const entries = await $.fs.list(dir).catch(() => [])
    if (entries.some(f => f.name === `${sid}.jsonl`)) {
      S.path = candidate
      return candidate
    }
  }
  return null
}

async function loadOrder($: Api): Promise<Order> {
  const file = await transcriptPath($)
  if (!file) return S.order ?? parseOrder('', 0)
  const dir = file.slice(0, file.lastIndexOf('/'))
  const name = file.slice(file.lastIndexOf('/') + 1)
  const size = (await $.fs.list(dir).catch(() => [])).find(f => f.name === name)?.size ?? -1
  if (S.order && S.order.size === size) return S.order
  S.order = parseOrder(await $.fs.read(file), size)
  return S.order
}

// The view's top row: where the last hop put it, unless the view moved since
function topRow(o: Order): { id: string; first: number } | null {
  let newest = 0
  for (const s of S.seen.values()) newest = Math.max(newest, s.t)
  if (S.cursor && S.cursor.t >= newest - 400) return { id: S.cursor.id, first: 0 }
  let best: { id: string; first: number; i: number } | null = null
  for (const [id, s] of S.seen) {
    const i = o.index.get(id)
    if (i === undefined || s.t < newest - 150) continue
    if (!best || i < best.i) best = { id, first: s.first, i }
  }
  return best
}

// Whether a row a scroll just reached is on screen as itself. One seen on
// screen before is taken as drawn; one never seen gets a frame or four to
// report. Rows folded away never do
async function landed($: Api, id: string) {
  for (let k = 0; k < 4 && !S.visible.has(id); k++) await $.clock.sleep(30)
  return S.visible.has(id)
}

// The last row a dialog can stand for when the view's top is unknown: the
// newest row focus view or the screen has shown, never a slash command
function lastRow(o: Order) {
  for (let j = o.ids.length - 1; j >= 0; j--) {
    const id = o.ids[j]
    if (id && !o.anchors.has(id) && (S.visible.has(id) || o.keys.has(id))) return id
  }
  return null
}

async function hop($: Api, dir: 'prev' | 'next') {
  const o = await loadOrder($)
  const top = topRow(o)
  const at = top ? o.index.get(top.id) : undefined
  const step = dir === 'prev' ? -1 : 1
  let i: number
  // Nothing on screen has reported since the mod loaded: the view is where a
  // session starts, at the bottom
  if (at === undefined && dir === 'next') {
    $.ui.toast('At the last block')
    return
  }
  if (at === undefined) i = o.ids.length
  // A row whose top is scrolled away: prev goes to its own start first
  else i = dir === 'prev' && top && top.first > 0 ? at + 1 : at
  // Rows never seen on screen get probed: scroll to one and watch whether it
  // reports being on screen. Misses are remembered and skipped for a while.
  // Three misses in a row means a fold (focus view hides most of a turn), so
  // the rest of the hop only tries rows focus view shows and rows seen before
  let misses = 0
  let probes = 0
  for (let j = i + step; j >= 0 && j < o.ids.length; j += step) {
    const id = o.ids[j]
    if (!id || o.anchors.has(id) || Date.now() - (S.hidden.get(id) ?? 0) < 90_000) continue
    const known = S.visible.has(id)
    if (!known && (probes >= 12 || (misses >= 3 && !o.keys.has(id)))) continue
    const r = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
    // Rows that aren't drawn at all are refused: try the next
    if (r.deny) continue
    if (!known) {
      probes += 1
      if (!(await landed($, id))) {
        S.hidden.set(id, Date.now())
        misses += 1
        continue
      }
    }
    misses = 0
    S.cursor = { id, t: Date.now() }
    return
  }
  // Probes moved the view: put it back where the hop started
  if (probes && top) await $.ui.scroll({ to: { requestId: top.id }, block: 'start' })
  $.ui.toast(dir === 'prev' ? 'At the first block' : 'At the last block')
}

// Closing the docked pane widens the transcript, which re-lays it out from
// the bottom: give that a moment before scrolling anywhere
async function closeDialog($: Api) {
  await $.ui.close({ id: PANE })
  await $.clock.sleep(60)
}

// A scroll right after the dialog closes can land on the old layout, so
// scroll again once it has settled; scrolling to the same row is harmless
async function settledScroll($: Api, id: string) {
  const r = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
  if (r.deny) return r
  await $.clock.sleep(150)
  return $.ui.scroll({ to: { requestId: id }, block: 'start' })
}

async function openDialog($: Api, want: 'set' | 'jump') {
  const o = await loadOrder($)
  S.mode = want
  S.pendingTop = topRow(o)?.id ?? lastRow(o)
  const count = Object.keys(await read($, marks)).length
  await $.ui.open({
    id: PANE,
    title: want === 'set' ? 'Set mark' : 'Jump to mark',
    focus: true,
    closeOnEscape: true,
    rows: Math.min(30, count + 4),
  })
}

async function setMark($: Api, letter: string) {
  await closeDialog($)
  const id = S.pendingTop
  if (!id) {
    $.ui.toast('No block to mark yet')
    return
  }
  // Closing the docked pane re-lays out the transcript and drops it to the
  // bottom, so put the view back where it was
  await settledScroll($, id)
  S.cursor = { id, t: Date.now() }
  const o = await loadOrder($)
  const mark: Mark = { id, label: o.labels.get(id) ?? '' }
  await update($, marks, all => ({ ...all, [letter]: mark }))
  $.ui.toast(`Mark '${letter}' set: ${mark.label.slice(0, 40)}`)
}

async function jumpTo($: Api, mark: Mark | null, name: string) {
  await closeDialog($)
  if (!mark) {
    $.ui.toast(name === "'" ? 'No previous position' : `Mark '${name}' not set`)
    return
  }
  const here = S.pendingTop
  const r = await settledScroll($, mark.id)
  if (r.deny || !(await landed($, mark.id))) {
    // Closing the dialog dropped the view to the bottom: put it back
    if (here) await settledScroll($, here)
    $.ui.toast(`Mark '${name}' isn't shown in this view (folded by focus view?)`)
    return
  }
  S.cursor = { id: mark.id, t: Date.now() }
  if (here) {
    const o = await loadOrder($)
    await update($, back, () => ({ id: here, label: o.labels.get(here) ?? '' }))
  }
}

// What a tool row shows in its parentheses, roughly: its main argument
function toolArg(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  for (const k of ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'prompt']) {
    if (typeof o[k] === 'string') return (o[k] as string).slice(0, 50)
  }
  return JSON.stringify(o).slice(0, 40)
}

export const register: Register = on => {
  // Esc closes a dialog, and closing the docked pane drops the transcript to
  // the bottom: put the view back where it was
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const ran = await next(e)
    if (e.origin.kind === 'person' && S.pendingTop) {
      await $.clock.sleep(60)
      await settledScroll($, S.pendingTop)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Focus view folds and unfolds rows: what was learned about them is stale
  on('command.run', { command: 'focus' }, async ($, e, next) => {
    const ran = await next(e)
    S.visible.clear()
    S.hidden.clear()
    S.seen.clear()
    S.cursor = null
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage', plugin: '*' }, ($, e, next) => {
    observe(e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'UserMessage', plugin: '*' }, ($, e, next) => {
    observe(e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'ToolUse', plugin: '*' }, ($, e, next) => {
    observe(e.requestId, e.props.onScreen)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const letters = Object.keys(await read($, marks)).sort()
    // The Buttons must stay drawn for their chords to press them
    return (
      <Box>
        <Button key="prev" plain dimColor label="‹ prev" action={ACTION.prev} onPress={() => hop($, 'prev')} />
        <Text dimColor> </Text>
        <Button key="next" plain dimColor label="next ›" action={ACTION.next} onPress={() => hop($, 'next')} />
        <Text dimColor>  </Text>
        <Button key="set" plain dimColor label="mark" action={ACTION.set} onPress={() => openDialog($, 'set')} />
        <Text dimColor> </Text>
        <Button key="jump" plain dimColor label="jump" action={ACTION.jump} onPress={() => openDialog($, 'jump')} />
        <Text dimColor>{letters.length ? `  marks: ${letters.join(' ')}` : ''}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, marks)
    if (S.mode === 'set') {
      // Every letter needs a drawn Button for its hotkey; taken ones show what
      // they point at, so overwriting one is a choice
      const taken = LETTERS.filter(l => all[l])
      const free = LETTERS.filter(l => !all[l])
      return (
        <Box flexDirection="column">
          <Text>Press a–z to mark this block. Esc cancels.</Text>
          {taken.map(l => (
            <Button key={`set-${l}`} plain hotkey={l} label={all[l]?.label ?? ''} onPress={() => setMark($, l)} />
          ))}
          <Box flexWrap="wrap">
            {free.map(l => (
              <Button key={`set-${l}`} plain dimColor hotkey={l} label="·" onPress={() => setMark($, l)} />
            ))}
          </Box>
        </Box>
      )
    }
    const prev = await read($, back)
    const letters = Object.keys(all).sort()
    return (
      <Box flexDirection="column">
        {letters.length === 0 && <Text dimColor>No marks yet. ctrl+x m sets one.</Text>}
        {letters.map(l => (
          <Button key={`jump-${l}`} plain hotkey={l} label={`${all[l]?.label ?? ''}`} onPress={() => jumpTo($, all[l] ?? null, l)} />
        ))}
        <Button
          key="back"
          plain
          hotkey="0"
          action={ACTION.jump}
          label={`back${prev ? `: ${prev.label}` : ''}  (or the jump chord again)`}
          onPress={() => jumpTo($, prev, "'")}
        />
      </Box>
    )
  })
}
