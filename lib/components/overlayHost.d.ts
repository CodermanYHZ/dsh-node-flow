/**
 * Where the node-mode page's own windows mount: the code editor, the
 * scheduled-task board, and the generation guide.
 *
 * They are portaled into the page element marked `data-wf-overlay-host` — not
 * into `document.body`. A window positioned against the viewport also covers
 * the DSH shell around the page (sidebar and header), which the canvas itself
 * never does; bounding them to the page keeps one consistent frame.
 *
 * The standalone Vite demo renders the canvas without that page element, so the
 * lookup falls back to `document.body`.
 *
 * @module components/overlayHost
 */
/** The node-mode page when the shell hosts one, else the document body. */
export declare function overlayHost(): HTMLElement;
