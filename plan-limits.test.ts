import { describe, expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

// Local times, so the tests read the same in any time zone: Wednesday 20:00
const NOW = new Date(2026, 9, 7, 20, 0).getTime()
const SURFACES = ['terminal', 'desktop'] as const

const props = (bodyColumns: number) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})

// What the band holds with no other mod drawing in it
const EMPTY = { type: 'Box' as const, children: [] }
// A stand-in for token-weather's line, about as wide as it draws
const WEATHER = {
  type: 'Text' as const,
  children: ['☁  Cloudy  34% of context  340k / 1M   last turns ▁▂▃▄▅▆▇█  ▲ +12k last turn'],
}

const USAGE: SessionUsage = {
  startedAt: NOW - 3_600_000,
  context: { tokens: 340_000, window: 1_000_000, percent: 34 },
  rateLimits: [
    // Sunday 00:00 in whatever time zone the tests run in
    { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(2026, 9, 11, 0, 0).toISOString() },
    { kind: 'five_hour', percentUsed: 92.5, resetsAt: new Date(2026, 9, 7, 22, 13).toISOString() },
  ],
  cost: { usd: 1.234 },
}

describe('plan-limits', () => {
  for (const surface of SURFACES) {
    test(`a wide band alone shows every detail (${surface})`, async ($, on) => {
      mock.clock(on, { now: NOW })
      on('session.usage', () => ({ value: USAGE }))
      on('ui.render', { component: 'AbovePrompt' }, () => EMPTY)

      const ui = await $.ui.mount({ plugin: 'plan-limits', surface, component: 'AbovePrompt', props: props(200) })

      // Ctx shows what is used and the limits what is left; 5h comes before Week; under 10% left is red
      const five = await ui.find({ key: 'five_hour' })
      const week = await ui.find({ key: 'seven_day' })
      expect((await ui.find({ key: 'context' }))?.text).toBe('☁ Ctx34% used███░░░░░░░Cloudy340k/1M')
      expect(five?.text).toContain('↯ 5h7.5% left')
      expect(five?.text).toContain('Limit soon')
      expect(five?.text).toContain('resets 22:13')
      expect(week?.text).toContain('☀ Week82% left')
      expect(week?.text).toContain('Clear')
      expect(week?.text).toContain('resets Sun 00:00')
      expect((await ui.find({ key: 'cost' }))?.text).toBe('Session$1.23')
      expect(await ui.find({ type: 'Text', text: '7.5% left' })).toMatchObject({ props: { color: 'red' } })
    })

    test(`beside token-weather it shares one line and drops detail to fit (${surface})`, async ($, on) => {
      mock.clock(on, { now: NOW })
      on('session.usage', () => ({ value: USAGE }))
      on('ui.render', { component: 'AbovePrompt' }, () => WEATHER)

      const ui = await $.ui.mount({ plugin: 'plan-limits', surface, component: 'AbovePrompt', props: props(190) })

      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'row' } })
      expect(await ui.find({ type: 'Text', text: /Cloudy/ })).toBeDefined()
      const five = await ui.find({ key: 'five_hour' })
      expect(five?.text).toContain('↻ 22:13')
      expect(five?.text).not.toContain('Limit soon')
      expect((await ui.find({ key: 'seven_day' }))?.text).toContain('↻ Sun 00:00')
      expect((await ui.find({ key: 'cost' }))?.text).toBe('Session$1.23')
      // No bar here, so each window carries a ring instead
      expect((await ui.find({ key: 'context' }))?.text).toBe('☁ Ctx🌒34% used')
      expect(five?.text).toContain('↯ 5h🌑7.5% left')
    })
  }

  test('alone in the band it draws no divider', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: USAGE }))
    // What the engine answers when no other mod draws in the band
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'plan-limits' } })
    expect(await ui.find({ type: 'Text', text: '│' })).toBeUndefined()
  })

  test('a narrow band keeps only the percents', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: USAGE }))
    on('ui.render', { component: 'AbovePrompt' }, () => WEATHER)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(100) })
    expect((await ui.find({ key: 'five_hour' }))?.text).toBe('↯ 5h🌑7.5% left')
  })

  test('a wide band draws the bar and no ring', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: USAGE }))
    on('ui.render', { component: 'AbovePrompt' }, () => EMPTY)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
    expect((await ui.find({ key: 'seven_day' }))?.text).not.toMatch(/[🌑🌒🌓🌔🌕]/u)
  })

  const LIMITS = [
    { kind: 'five_hour', percentUsed: 50 },
    { kind: 'seven_day', percentUsed: 0 },
  ]
  const RING_USAGE = { ...USAGE, context: { tokens: 800_000, window: 1_000_000, percent: 80 }, rateLimits: LIMITS }

  test('nerd rings fill in eighths and take the forecast colour', { options: { ringStyle: 'nerd' } }, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: RING_USAGE }))
    on('ui.render', { component: 'AbovePrompt' }, () => WEATHER)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(100) })
    expect((await ui.find({ key: 'context' }))?.text).toContain('Ctx\u{F0AA3} 80% used')
    expect((await ui.find({ key: 'five_hour' }))?.text).toContain('5h\u{F0AA1} 50% left')
    expect((await ui.find({ key: 'seven_day' }))?.text).toContain('Week\u{F0AA5} 100% left')
    expect(await ui.find({ type: 'Text', text: '\u{F0AA3} ' })).toMatchObject({ props: { color: 'magenta' } })
  })

  test('moon rings, the default, fill in quarters in their own colours', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: RING_USAGE }))
    on('ui.render', { component: 'AbovePrompt' }, () => WEATHER)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(100) })
    expect((await ui.find({ key: 'context' }))?.text).toContain('Ctx🌔80% used')
    expect((await ui.find({ key: 'five_hour' }))?.text).toContain('5h🌓50% left')
    expect((await ui.find({ key: 'seven_day' }))?.text).toContain('Week🌕100% left')
    expect((await ui.find({ type: 'Text', text: '🌔' }))?.props?.color).toBeUndefined()
  })

  test('circle rings fill in quarters and take the forecast colour', { options: { ringStyle: 'circle' } }, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: RING_USAGE }))
    on('ui.render', { component: 'AbovePrompt' }, () => WEATHER)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(100) })
    expect((await ui.find({ key: 'context' }))?.text).toContain('Ctx◕ 80% used')
    expect((await ui.find({ key: 'five_hour' }))?.text).toContain('5h◑ 50% left')
    expect(await ui.find({ type: 'Text', text: '● ' })).toMatchObject({ props: { color: 'yellow' } })
  })

  test('a 5-hour reset past midnight carries its weekday', async ($, on) => {
    mock.clock(on, { now: NOW })
    const late = { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(2026, 9, 8, 1, 30).toISOString() }
    on('session.usage', () => ({ value: { ...USAGE, rateLimits: [late] } }))
    on('ui.render', { component: 'AbovePrompt' }, () => EMPTY)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
    expect((await ui.find({ key: 'five_hour' }))?.text).toContain('resets Thu 01:30')
  })

  test('a nearly full context window reads Compact soon', async ($, on) => {
    mock.clock(on, { now: NOW })
    const full = { tokens: 950_000, window: 1_000_000, percent: 95 }
    on('session.usage', () => ({ value: { ...USAGE, context: full } }))
    on('ui.render', { component: 'AbovePrompt' }, () => EMPTY)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
    expect((await ui.find({ key: 'context' }))?.text).toContain('↯ Ctx95% used')
    expect((await ui.find({ key: 'context' }))?.text).toContain('Compact soon')
  })

  test('draws nothing off a subscription with no cost', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: { ...USAGE, context: { window: 1_000_000 }, rateLimits: [], cost: undefined } }))
    on('ui.render', { component: 'AbovePrompt' }, () => EMPTY)

    const ui = await $.ui.mount({ plugin: 'plan-limits', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
    expect(await ui.find({ key: 'plan-limits' })).toBeUndefined()
  })
})
