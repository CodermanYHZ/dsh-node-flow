/**
 * DSH web client half for dsh-node-flow.
 *
 * Runs inside the sandboxed `dsh-cordis-client-runner` closure, so it only
 * touches the client services the guarded `ctx` exposes. Presentation follows
 * the host's own contract:
 *
 * - the canvas is registered into the `main` slot under this package's panel
 *   id, so it fills the central column as a page;
 * - a `sidebar.panellist` row with the same id is the entry: the sidebar owns
 *   the button, its placement, its collapsed-rail behavior, and its label.
 *
 * Nothing is written to `document.body` and no shell class name is guessed —
 * the earlier version injected its own sidebar row and read the shell's
 * `sidebarCol` / `logoRow` / `newSession` classes, which no longer exist.
 *
 * `react` / `react-dom` are externalized (resolved by the host ModuleLoader,
 * like the official dsh-client-* bundles); everything else is inlined.
 *
 * @module client
 */

import React from 'react'
import { Panel } from './components/Panel.js'
import { getColorScheme, reportTheme, setColorScheme } from './hostTheme.js'
import rfCss from '@xyflow/react/dist/style.css'
import canvasCss from './components/canvas.css'

export const name = 'dsh-node-flow'

/**
 * Client cordis services this half needs. `slots` is what makes the panel and
 * the sidebar row registrable; `theme` carries the shell's light/dark scheme so
 * the canvas can follow it; `layout` is reached through a nested inject so a
 * host without it still shows the canvas.
 */
export const inject = ['slots', 'theme'] as const

/** The `main` key and the `sidebar.panellist` id this package registers. */
const PANEL_ID = 'dsh-node-flow'

/**
 * Below the shipped rows (plugins 0, scheduled tasks 10) and the third-party
 * rows already present (dsh-context 20).
 */
const PANEL_ORDER = 30

/** Shown on the sidebar row and used as the panel's accessible name. */
const ENTRY_LABEL = '节点模式'

interface LayoutServiceLike {
  selectPanel(panelId: string | null): void
}

/** The slice of the shell's theme service this half reads. */
interface ThemeServiceLike {
  getTheme(): { active: { colorScheme: 'light' | 'dark' } }
}

interface ClientContextLike {
  inject?(services: string[], callback: (scoped: { layout: LayoutServiceLike }) => void): void
  effect?(callback: () => unknown, label?: string): void
  on?(event: string, callback: () => void): () => void
  theme?: ThemeServiceLike
  slots: {
    inject(slot: string, register: () => unknown): () => void
    register(options: Record<string, unknown>, render: (props: Record<string, unknown>) => unknown): unknown
  }
}

/** Owner props the sidebar supplies to a global panel icon. */
interface PanelIconProps {
  size?: number
  active?: boolean
}

function ensureStyles(): void {
  if (document.getElementById('dsh-node-flow-styles')) return
  const style = document.createElement('style')
  style.id = 'dsh-node-flow-styles'
  style.textContent = `${rfCss}\n${canvasCss}`
  document.head.appendChild(style)
}

/**
 * The sidebar glyph: three connected nodes, emphasizing the selected panel.
 * `currentColor` lets the shell's own active/inactive rail color win.
 */
function WorkflowIcon({ size = 16, active = false }: PanelIconProps) {
  return React.createElement(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: active ? 1.7 : 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block' },
    },
    React.createElement('path', { d: 'M6.5 7.5h4.2M13.3 7.5h4.2M6.5 16.5h4.2M13.3 16.5h4.2' }),
    React.createElement('rect', { x: 2.6, y: 5.1, width: 3.9, height: 4.8, rx: 1.3 }),
    React.createElement('rect', { x: 17.5, y: 5.1, width: 3.9, height: 4.8, rx: 1.3 }),
    React.createElement('rect', { x: 2.6, y: 14.1, width: 3.9, height: 4.8, rx: 1.3 }),
    React.createElement('rect', { x: 17.5, y: 14.1, width: 3.9, height: 4.8, rx: 1.3 }),
    React.createElement('circle', { cx: 12, cy: 12, r: 2.3 }),
  )
}

export function apply(ctx: ClientContextLike): void {
  ensureStyles()

  // `layout` owns panel selection; without it the canvas still renders and the
  // close button is simply absent.
  let layout: LayoutServiceLike | undefined
  ctx.inject?.(['layout'], (scoped) => {
    layout = scoped.layout
  })

  // Follow the shell's scheme. Colours come from the host's alias tokens, but
  // the handful of `[data-theme="light"]` widget rules need the scheme mirrored
  // onto our own element, and a theme switch has to reach the mounted panel.
  const theme = ctx.theme
  if (theme !== undefined) {
    setColorScheme(theme.getTheme().active.colorScheme)
    const sync = (): void => {
      setColorScheme(theme.getTheme().active.colorScheme)
    }
    if (typeof ctx.on === 'function') {
      if (typeof ctx.effect === 'function') ctx.effect(() => ctx.on?.('theme/change', sync), 'dsh-node-flow: theme')
      else ctx.on('theme/change', sync)
    }
  }

  const exitPanel = (): void => {
    layout?.selectPanel('conversation')
  }

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: PANEL_ID, label: () => ENTRY_LABEL },
      () => React.createElement(Panel, { onExit: exitPanel }),
    ),
  )

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => ENTRY_LABEL },
      (owner?: Record<string, unknown>) =>
        React.createElement(WorkflowIcon, {
          size: typeof owner?.size === 'number' ? owner.size : 16,
          active: owner?.active === true,
        }),
    ),
  )

  // One-shot reachability probe: a POST carries this page's Origin, so the host
  // records the shell's real Origin/Host pair. The palette report needs a
  // mounted panel (the alias tokens live inside the layout subtree), so it is
  // sent from Panel instead — see `reportTheme`.
  void fetch('/dsh-node-flow/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scheme: getColorScheme(), phase: 'client-ready' }),
    cache: 'no-store',
  })
    .then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as { origin?: unknown; host?: unknown; error?: unknown }
      if (res.ok) console.info('[dsh-node-flow] host routes reachable', body.origin, body.host)
      else console.warn('[dsh-node-flow] host route check failed:', res.status, body.error ?? '')
    })
    .catch((err: unknown) => {
      console.warn('[dsh-node-flow] host route check failed:', err)
    })

  // A canvas that is never opened still reports its palette on every theme
  // change, so the report cannot go stale after the first mount.
  if (typeof ctx.on === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() => ctx.on?.('theme/change', () => reportTheme()), 'dsh-node-flow: theme report')
  }
}
