/**
 * The workflow canvas as a DSH main-column panel.
 *
 * The client half registers this component in the shell's `main` slot under
 * this package's panel id, and a `sidebar.panellist` row selects it — so the
 * canvas is a page of the shell instead of an overlay the plugin positions
 * itself.
 *
 * The panel mirrors the host's light/dark scheme onto `data-theme` and takes
 * every colour from the host's alias tokens (see canvas.css), so it looks like
 * part of the application instead of a themed island: switching the DSH theme
 * switches the canvas with it.
 *
 * @module components/Panel
 */
/** Props the client half supplies; the shell owns the rest of the panel's cell. */
export interface PanelProps {
    /** Return to the conversation panel; absent when the host has no `layout`. */
    onExit?: () => void;
}
export declare function Panel({ onExit }: PanelProps): import("react").JSX.Element;
