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
export type ColorScheme = 'light' | 'dark';
type Listener = () => void;
/** Record the host's scheme and notify the canvas when it actually changes. */
export declare function setColorScheme(next: ColorScheme): void;
/** `useSyncExternalStore` subscriber for the current scheme. */
export declare function subscribeColorScheme(listener: Listener): () => void;
export declare function getColorScheme(): ColorScheme;
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
export declare function themeDiagnostics(): Record<string, unknown>;
/** Report the resolved palette to the host so it can be inspected from disk. */
export declare function reportTheme(): void;
export {};
