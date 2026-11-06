import { jsx as _jsx } from "react/jsx-runtime";
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
import { useEffect, useSyncExternalStore } from 'react';
import { Canvas } from './Canvas.js';
import { getColorScheme, reportTheme, subscribeColorScheme } from '../hostTheme.js';
export function Panel({ onExit }) {
    const scheme = useSyncExternalStore(subscribeColorScheme, getColorScheme, getColorScheme);
    // Report the palette once the panel exists: the shell's alias tokens are
    // applied inside the layout subtree, so nothing can be read before this
    // element is in the document.
    useEffect(() => {
        reportTheme();
    }, [scheme]);
    return (
    // `data-wf-overlay-host` is where this page's own windows mount (code
    // editor, scheduled-task board, guide): it bounds them to this page instead
    // of the whole application window. See components/overlayHost.ts.
    _jsx("div", { className: "wf-panel", "data-theme": scheme, "data-wf-overlay-host": "", children: _jsx(Canvas, { onExitNodeMode: onExit }) }));
}
