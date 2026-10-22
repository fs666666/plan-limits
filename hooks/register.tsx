// Plan limits band: a weather forecast for the context window and the plan's 5-hour and weekly
// rate-limit windows, with each window's reset time, this session's API-equivalent cost and
// the output speed of the last response, above the prompt.
//
// The figures are $.session.usage()'s, the same the status line has: context once a response
// reported its fill; rateLimits only on a subscription and after the first response; cost is
// Claude Code's own estimate at API prices (what /cost shows). session.measure pushes a redraw
// when any of them moves; a one-minute timer redraws so a 5-hour reset gains its weekday after
// midnight.
//
// The speed is the last main-loop response's output tokens over the time from its first streamed
// chunk to its stop chunk, so the wait before the first token does not count, nor the time a tool
// the API runs itself (the advisor) held the stream. Thinking the
// terminal does not show is in output_tokens and in that time too, so the figure stays honest.
// While a response streams, a live estimate marked ~ stands in: the streamed text counted as
// tokens by a rule of thumb, scaled by how far that rule was off on the responses before.
import type { RenderElement, Register, SessionRateLimit } from 'claude-code'

const NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'Week',
  spend_limit: 'Spend',
}

// Forecast bands by percent of the window used, in token-weather's style.
// Single-width text symbols, not emoji: they line up in every terminal font.
const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Clear', color: 'yellow' },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Showers', color: 'blue' },
  { upTo: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Limit soon', color: 'red' },
] as const

const BAR_CELLS = 10

// Shorter responses than this give a speed that is mostly noise; the last good one stays
const MIN_SPEED_MS = 300
// The live estimate waits this long into a response before it shows, then redraws this often
const LIVE_AFTER_MS = 1_000
const LIVE_EVERY_MS = 500

// Roughly how many tokens streamed text is: a CJK character about one, other text about four
// characters to a token. Only a starting point: the scale learnt from finished responses corrects it.
const CJK = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g
function estimateTokens(s: string): number {
  const cjk = s.match(CJK)?.length ?? 0
  return cjk + (s.length - cjk) / 4
}

// The last band's word, per gauge: a full context window gets compacted, a full limit stops you
function forecastOf(percent: number, fullWord = 'Limit soon') {
  const f = FORECAST.find(f => percent <= f.upTo) ?? FORECAST[FORECAST.length - 1]!
  return { ...f, word: f.upTo === Infinity ? fullWord : f.word, isAlarm: f.upTo === Infinity }
}

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// A rate limit is a budget, so it shows what is left, like a battery; the context window is a
// fill, so it shows what is used. Each number says which it is. The weather always follows what
// is used: a fuller window or less budget left reads as worse weather.
function shownOf(used: number, shows: 'used' | 'left'): number {
  const value = shows === 'used' ? used : 100 - used
  return Math.max(0, Math.round(value * 10) / 10)
}

function bar(percent: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)))
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
}

// The bar's stand-in where the line has no room for it, following the shown value as the bar
// does, in the style the ringStyle option picks:
// - nerd: Nerd Font circle slices, nine steps, take the forecast's colour (needs a Nerd Font)
// - moon: moon-phase emoji, five steps, at the weather icon's size but in their own colours
// - circle: plain Unicode quarter circles, five steps, take the colour, but small in most fonts
// - none: no ring, the narrow line keeps only the percents
type RingStyle = 'nerd' | 'moon' | 'circle' | 'none'
type RingGlyphs = Exclude<RingStyle, 'none'>
const RINGS: Record<RingGlyphs, readonly string[]> = {
  nerd: ['\u{F0766}', '\u{F0A9E}', '\u{F0A9F}', '\u{F0AA0}', '\u{F0AA1}', '\u{F0AA2}', '\u{F0AA3}', '\u{F0AA4}', '\u{F0AA5}'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕'],
  circle: ['○', '◔', '◑', '◕', '●'],
}
// Emoji take their own colours and every terminal draws them two columns wide
const COLOURED: Record<RingGlyphs, boolean> = { nerd: true, moon: false, circle: true }

function ringStyleOf(value: unknown): RingStyle {
  // Moon unless asked otherwise: emoji draw in every terminal, Nerd Font glyphs only with that font
  return value === 'nerd' || value === 'circle' || value === 'none' ? value : 'moon'
}

function ring(style: RingGlyphs, percent: number): string {
  const steps = RINGS[style]
  const step = Math.round((percent / 100) * (steps.length - 1))
  return steps[Math.max(0, Math.min(steps.length - 1, step))]!
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

// The reset as a local time (the environment keeps the machine's time zone): 22:13 when it
// falls today, Thu 01:30 on another day, and always with the weekday for the weekly window
function resetText(limit: SessionRateLimit, now: number): string {
  if (!limit.resetsAt) return ''
  const d = new Date(limit.resetsAt)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const isToday = d.toDateString() === new Date(now).toDateString()
  return limit.kind === 'seven_day' || !isToday ? `${WEEKDAYS[d.getDay()]} ${time}` : time
}

function sortLimits(limits: SessionRateLimit[]): SessionRateLimit[] {
  const order = ['five_hour', 'seven_day']
  const rank = (kind: string) => (order.includes(kind) ? order.indexOf(kind) : order.length)
  return [...limits].sort((a, b) => rank(a.kind) - rank(b.kind))
}

// Whether the mods after this one left the band empty. With none drawing there, next(e)
// resolves to the engine's own drawing, { type: 'engine' }, and in the band the engine
// draws nothing; an empty Box is nothing too.
function isEmpty(el: RenderElement | null | undefined): boolean {
  if (!el || el.type === 'engine') return true
  const children = (el as { children?: unknown[] }).children
  return el.type === 'Box' && (!children || children.length === 0)
}

// Roughly how many columns a tree takes on one line: its texts, plus a row's gaps and padding.
// The weather and reset symbols count two columns: many terminals draw them as wide emoji, and
// overestimating only costs a little detail, while underestimating wraps the line.
const WIDE = new Set(['☀', '☁', '☂', '☇', '↯', '↻', '⚡', ...RINGS.moon])

function textWidth(s: string): number {
  let width = 0
  for (const ch of s) width += WIDE.has(ch) ? 2 : 1
  return width
}

function widthOf(node: unknown): number {
  if (typeof node === 'string' || typeof node === 'number') return textWidth(String(node))
  if (!node || typeof node !== 'object') return 0
  const el = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const children = (el.children ?? []).filter(c => c !== null && c !== undefined && c !== false)
  let width = children.reduce<number>((sum, c) => sum + widthOf(c), 0)
  if (el.type === 'Box') {
    const props = el.props ?? {}
    const gap = Number(props.columnGap ?? props.gap ?? 0)
    if (props.flexDirection !== 'column') width += gap * Math.max(0, children.length - 1)
    width += 2 * Number(props.paddingX ?? props.padding ?? 0)
  }
  return width
}

// One gauge on the line: the context window or a rate-limit window; percent is how much is used
type Gauge = {
  key: string
  label: string
  percent: number
  shows: 'used' | 'left'
  fullWord?: string
  reset?: string
  size?: string
}

// How much each window shows, from most to least, picked by what fits on the line
type Detail = 'full' | 'compact' | 'minimal'
const DETAILS: Detail[] = ['full', 'compact', 'minimal']

export const register: Register = (on, options) => {
  const ringStyle = ringStyleOf(options.ringStyle)
  // Each item on the line can be turned off in /config; unset reads as on
  const shows = (key: string) => options[key] !== false
  const showContext = shows('showContext')
  const showCost = shows('showCost')
  const showSpeed = shows('showSpeed')
  const SHOW_LIMIT: Record<string, boolean> = { five_hour: shows('showFiveHour'), seven_day: shows('showWeek') }
  // Output tokens per second of the last main-loop response, and the live estimate while one
  // streams; a reload starts both over
  let tokensPerSecond: number | undefined
  let liveTokensPerSecond: number | undefined
  // Real output tokens over estimated ones, averaged over finished responses: it takes in the
  // language mix and the thinking the stream does not show
  let scale = 1

  // Time each main-loop response as it streams; subagents stream alongside and are left out
  on('turn.step', async function* ($, e, next) {
    if (e.agentId || !showSpeed) return yield* next(e)
    let firstAt: number | undefined
    let stopAt: number | undefined
    let output = 0
    let drawnAt = 0
    let estimated = 0
    try {
      // Read by hand, not for await: the stream's return value carries the server tool calls
      const stream = next(e)
      let step = await stream.next()
      for (; !step.done; step = await stream.next()) {
        const chunk = step.value
        const now = await $.clock.now()
        if (firstAt === undefined) firstAt = now
        const ms = now - firstAt
        if (chunk.kind === 'text' || chunk.kind === 'thinking') estimated += estimateTokens(chunk.text)
        else if (chunk.kind === 'input') estimated += estimateTokens(chunk.json)

        if (chunk.kind === 'stop') {
          stopAt = now
          output = chunk.usage?.output_tokens ?? 0
        } else if (ms >= LIVE_AFTER_MS && now - drawnAt >= LIVE_EVERY_MS && estimated > 0) {
          liveTokensPerSecond = (estimated * scale) / (ms / 1000)
          drawnAt = now
          $.ui.invalidate('ui.render')
        }
        yield chunk
      }

      if (firstAt !== undefined && stopAt !== undefined) {
        // A tool the API runs itself (the advisor) holds the stream while the model writes
        // nothing of this response, so its time is left out as the wait before the first chunk is
        const start = firstAt
        const end = stopAt
        const serverMs = (step.value?.serverToolUses ?? []).reduce((sum, use) => {
          const from = Math.max(start, use.startedAt)
          const to = Math.min(end, use.endedAt ?? end)
          return sum + Math.max(0, to - from)
        }, 0)
        const ms = end - start - serverMs
        if (ms >= MIN_SPEED_MS && output > 0) tokensPerSecond = output / (ms / 1000)
        // Too few to learn from: a tool call alone, a word or two
        if (output > 0 && estimated >= 20) {
          scale = Math.max(0.5, Math.min(4, 0.7 * scale + 0.3 * (output / estimated)))
        }
        liveTokensPerSecond = undefined
        $.ui.invalidate('ui.render')
      }
      return step.value
    } finally {
      // A response cut off before its stop leaves the last real figure, not a stale estimate
      if (liveTokensPerSecond !== undefined) {
        liveTokensPerSecond = undefined
        $.ui.invalidate('ui.render')
      }
    }
  })

  // The status line under the prompt (directory, model, effort) is the script this mod ships,
  // lent to the merged settings rather than written to any file: settings that set a status line
  // of their own keep it, and uninstalling the mod takes ours away with it
  if (shows('statusLine')) {
    on('settings.read', async ($, e, next) => {
      // A call on $ resolves its value wrapped, { value: settings }, or { deny }
      const result = await next(e)
      if (e.source || !result.value || result.value.statusLine !== undefined) return result
      // Forward slashes: Git Bash on Windows takes C:/... as readily as a POSIX shell takes /...
      const script = `${$.plugin.root.replace(/\\/g, '/')}/statusline/statusline.sh`
      return { value: { ...result.value, statusLine: { type: 'command', command: `bash "${script}"` } } }
    })
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Redraw once a minute; a reload stops the old timer by itself
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return result
  })

  on('session.measure', async ($, e, next) => {
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { context, rateLimits, cost } = await $.session.usage()
    const now = await $.clock.now()

    const gauges: Gauge[] = []
    // The context window has a fill once a response reported one
    if (showContext && context.window > 0 && (context.percent !== undefined || (context.tokens ?? 0) > 0)) {
      const tokens = context.tokens ?? 0
      gauges.push({
        key: 'context',
        label: 'Ctx',
        percent: Math.round(context.percent ?? (tokens / context.window) * 100),
        shows: 'used',
        fullWord: 'Compact soon',
        size: `${short(tokens)}/${short(context.window)}`,
      })
    }
    // A window with no switch of its own (a gateway's spend limit) is always shown
    for (const limit of sortLimits(rateLimits.filter(l => SHOW_LIMIT[l.kind] !== false))) {
      gauges.push({
        key: limit.kind,
        label: NAMES[limit.kind] ?? limit.kind,
        percent: limit.percentUsed,
        shows: 'left',
        reset: resetText(limit, now),
      })
    }
    const shownCost = showCost ? cost : undefined
    const isLive = liveTokensPerSecond !== undefined
    const speed = showSpeed ? liveTokensPerSecond ?? tokensPerSecond : undefined
    if (gauges.length === 0 && shownCost === undefined && speed === undefined) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    const ours = (detail: Detail) => {
      const items = gauges.map(g => {
        const f = forecastOf(g.percent, g.fullWord)
        const shown = shownOf(g.percent, g.shows)
        const reset = detail === 'minimal' ? '' : g.reset
        return (
          <Box key={g.key} flexDirection="row" columnGap={1}>
            {/* A trailing space here and after ↻: many terminals draw these symbols two columns wide */}
            <Text color={f.color}>{`${f.icon} `}</Text>
            <Text bold>{g.label}</Text>
            {detail === 'full' || ringStyle === 'none' ? null : COLOURED[ringStyle] ? (
              // Trailing space as for the icon: a glyph may draw wider than its one column
              <Text color={f.color}>{`${ring(ringStyle, shown)} `}</Text>
            ) : (
              <Text>{ring(ringStyle, shown)}</Text>
            )}
            <Text color={f.color} bold={f.isAlarm}>{`${shown}% ${g.shows}`}</Text>
            {detail === 'full' ? <Text color={f.color}>{bar(shown)}</Text> : null}
            {detail === 'full' ? <Text color={f.color} bold={f.isAlarm}>{f.word}</Text> : null}
            {detail === 'full' && g.size ? <Text dimColor>{g.size}</Text> : null}
            {reset ? (
              <Text dimColor>
                {detail === 'full' ? `· resets ${reset}` : `↻ ${reset}`}
              </Text>
            ) : null}
          </Box>
        )
      })
      if (shownCost !== undefined) {
        items.push(
          <Box key="cost" flexDirection="row" columnGap={1}>
            {/* Always labelled: a bare dollar figure reads as nothing in particular */}
            <Text dimColor>Session</Text>
            <Text>{`$${shownCost.usd.toFixed(2)}`}</Text>
          </Box>,
        )
      }
      if (speed !== undefined) {
        items.push(
          <Box key="speed" flexDirection="row" columnGap={1}>
            {/* An emoji: its own colour, two columns wide in every terminal */}
            <Text>⚡</Text>
            {/* An estimate is marked ~ and dimmed until the response's own count replaces it */}
            <Text dimColor={isLive}>{`${isLive ? '~' : ''}${Math.round(speed)} tps`}</Text>
          </Box>,
        )
      }
      return (
        <Box key="plan-limits" flexDirection="row" columnGap={3}>
          {items}
        </Box>
      )
    }

    // Every mod shares the band: put what the mods after this one drew (token-weather)
    // first on the same line, a divider, then ours in as much detail as still fits
    const theirs = await next(e)
    const hasTheirs = !isEmpty(theirs)
    const room = e.props.bodyColumns - (hasTheirs ? widthOf(theirs) + 5 : 0)
    const detail = DETAILS.find(d => widthOf(ours(d)) <= room) ?? 'minimal'
    const line = ours(detail)
    if (!hasTheirs) return line
    return (
      <Box flexDirection="row" columnGap={2}>
        {theirs}
        <Text dimColor>│</Text>
        {line}
      </Box>
    )
  })
}
