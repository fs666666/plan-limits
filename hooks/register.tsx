// Plan limits band: a weather forecast for the plan's 5-hour and weekly rate-limit windows,
// with each window's reset countdown and this session's API-equivalent cost, above the prompt.
//
// The figures are $.session.usage()'s, the same the status line has: rateLimits only on a
// subscription and after the first response; cost is Claude Code's own estimate at API prices
// (what /cost shows). session.measure pushes a redraw when a window moves a point or the cost
// grows; a one-minute timer redraws so a 5-hour reset gains its weekday after midnight.
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

function forecastOf(percent: number) {
  return FORECAST.find(f => percent <= f.upTo) ?? FORECAST[FORECAST.length - 1]!
}

function bar(percent: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)))
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
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

// With no other mod drawing in the band, the engine hands back an empty Box
function isEmpty(el: RenderElement | null | undefined): boolean {
  if (!el) return true
  const children = (el as { children?: unknown[] }).children
  return el.type === 'Box' && (!children || children.length === 0)
}

// Roughly how many columns a tree takes on one line: its texts, plus a row's gaps and padding.
// Every symbol used here is one column wide, so a string's length is its width.
function widthOf(node: unknown): number {
  if (typeof node === 'string' || typeof node === 'number') return String(node).length
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

// How much each window shows, from most to least, picked by what fits on the line
type Detail = 'full' | 'compact' | 'minimal'
const DETAILS: Detail[] = ['full', 'compact', 'minimal']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Redraw once a minute; a reload stops the old timer by itself
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { rateLimits, cost } = await $.session.usage()
    if (rateLimits.length === 0 && cost === undefined) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const limits = sortLimits(rateLimits)

    const ours = (detail: Detail) => {
      const items = limits.map(limit => {
        const percent = limit.percentUsed
        const f = forecastOf(percent)
        const reset = detail === 'minimal' ? '' : resetText(limit, now)
        return (
          <Box key={limit.kind} flexDirection="row" columnGap={1}>
            {/* A trailing space here and after ↻: many terminals draw these symbols two columns wide */}
            <Text color={f.color}>{`${f.icon} `}</Text>
            <Text bold>{NAMES[limit.kind] ?? limit.kind}</Text>
            <Text color={f.color} bold={f.word === 'Limit soon'}>{`${percent}%`}</Text>
            {detail === 'full' ? <Text color={f.color}>{bar(percent)}</Text> : null}
            {detail === 'full' ? <Text color={f.color} bold={f.word === 'Limit soon'}>{f.word}</Text> : null}
            {reset ? (
              <Text dimColor>
                {detail === 'full' ? `· resets ${reset}` : `↻ ${reset}`}
              </Text>
            ) : null}
          </Box>
        )
      })
      if (cost !== undefined) {
        items.push(
          <Box key="cost" flexDirection="row" columnGap={1}>
            {detail === 'full' ? <Text dimColor>Session</Text> : null}
            <Text>{`$${cost.usd.toFixed(2)}`}</Text>
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
