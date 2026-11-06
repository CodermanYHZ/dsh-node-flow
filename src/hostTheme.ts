/**
 * The shell's light/dark scheme, mirrored for the canvas.
 *
 * The plugin no longer owns a palette switch: every colour resolves through the
 * host's alias tokens, so the canvas matches the application. The few
 * `[data-theme="light"]` widget tweaks still need the host's scheme on our own
 * element, which is the only reason this tiny store exists — the client context
 * lives in `ui.ts`, far above these components.
 *
 * @module hostTheme
 */

export type ColorScheme = 'light' | 'dark'

type Listener = () => void

const listeners = new Set<Listener>()
let current: ColorScheme = 'dark'

/** Record the host's scheme and notify the canvas when it actually changes. */
export function setColorScheme(next: ColorScheme): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

/** `useSyncExternalStore` subscriber for the current scheme. */
export function subscribeColorScheme(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getColorScheme(): ColorScheme {
  return current
}

/** Read one custom property off an element, or null when it does not resolve. */
function cssVar(element: Element | null, name: string): string | null {
  if (element === null) return null
  const value = window.getComputedStyle(element).getPropertyValue(name).trim()
  return value.length > 0 ? value : null
}

/**
 * What the canvas actually resolved for its palette.
 *
 * `host*` values are read from the panel, not from `<html>`: the shell's alias
 * layer is applied inside the layout subtree, so `getComputedStyle(documentElement)`
 * reports nothing even when the panel inherits a real value. `panelTheme` is the
 * mirrored scheme; `wfBg`/`wfPanel` are what our own tokens resolved to. When
 * `wfBg` is null while `hostBg` is set, the token wiring broke; when `wfBg`
 * equals the literal fallback, the host variable is missing.
 */
export function themeDiagnostics(): Record<string, unknown> {
  const panel = document.querySelector<HTMLElement>('.wf-panel')
  return {
    scheme: current,
    panelTheme: panel?.dataset.theme ?? null,
    hostBg: cssVar(panel, '--dsw-alias-bg-base'),
    hostLayer1: cssVar(panel, '--dsw-alias-bg-layer-1'),
    hostBrand: cssVar(panel, '--dsw-alias-brand-primary'),
    wfBg: cssVar(panel, '--wf-bg'),
    wfPanel: cssVar(panel, '--wf-panel'),
    wfText: cssVar(panel, '--wf-text'),
  }
}

/** Report the resolved palette to the host so it can be inspected from disk. */
export function reportTheme(): void {
  void fetch('/dsh-node-flow/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(themeDiagnostics()),
    cache: 'no-store',
  }).catch(() => {
    /* diagnostics are best-effort; the canvas does not depend on them */
  })
}
