/**
 * Expanded code editor — a window inside the node-mode page.
 *
 * Mounted through `overlayHost()` (see components/overlayHost.ts), so expanding
 * the editor fills the workflow surface while the DSH shell around it stays
 * visible, instead of covering the whole application window.
 *
 * @module components/CodeEditorModal
 */
export declare function CodeEditorModal({ value, onChange, language, onClose, }: {
    value: string;
    onChange: (v: string) => void;
    language: string;
    onClose: () => void;
}): import("react").ReactPortal;
