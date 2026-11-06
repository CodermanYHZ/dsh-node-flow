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
export declare const name = "dsh-node-flow";
/**
 * Client cordis services this half needs. `slots` is what makes the panel and
 * the sidebar row registrable; `theme` carries the shell's light/dark scheme so
 * the canvas can follow it; `layout` is reached through a nested inject so a
 * host without it still shows the canvas.
 */
export declare const inject: readonly ["slots", "theme"];
interface LayoutServiceLike {
    selectPanel(panelId: string | null): void;
}
/** The slice of the shell's theme service this half reads. */
interface ThemeServiceLike {
    getTheme(): {
        active: {
            colorScheme: 'light' | 'dark';
        };
    };
}
interface ClientContextLike {
    inject?(services: string[], callback: (scoped: {
        layout: LayoutServiceLike;
    }) => void): void;
    effect?(callback: () => unknown, label?: string): void;
    on?(event: string, callback: () => void): () => void;
    theme?: ThemeServiceLike;
    slots: {
        inject(slot: string, register: () => unknown): () => void;
        register(options: Record<string, unknown>, render: (props: Record<string, unknown>) => unknown): unknown;
    };
}
export declare function apply(ctx: ClientContextLike): void;
export {};
