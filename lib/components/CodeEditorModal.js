import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Expanded code editor — a window inside the node-mode page.
 *
 * Mounted through `overlayHost()` (see components/overlayHost.ts), so expanding
 * the editor fills the workflow surface while the DSH shell around it stays
 * visible, instead of covering the whole application window.
 *
 * @module components/CodeEditorModal
 */
import { createPortal } from 'react-dom';
import compressArrowsIcon from '../assets/icons/compress-arrows-alt.svg';
import { CodeEditor } from './CodeEditor.js';
import { overlayHost } from './overlayHost.js';
export function CodeEditorModal({ value, onChange, language, onClose, }) {
    return createPortal(
    // Colours come from the page this mounts into (`data-theme` on .wf-panel),
    // so the window carries no palette of its own.
    _jsxs("div", { className: "wf-editor-modal", role: "dialog", "aria-labelledby": "wf-editor-modal-title", children: [_jsxs("div", { className: "wf-editor-modal__head", children: [_jsxs("div", { className: "wf-editor-modal__heading", children: [_jsx("span", { id: "wf-editor-modal-title", className: "wf-editor-modal__title", children: "\u4EE3\u7801\u7F16\u8F91\u5668" }), _jsx("span", { className: "wf-editor-modal__language", children: "Python" })] }), _jsx("button", { type: "button", className: "wf-editor-modal__collapse", onClick: onClose, title: "\u6536\u8D77\u7F16\u8F91\u5668", "aria-label": "\u6536\u8D77\u5168\u5C4F\u4EE3\u7801\u7F16\u8F91\u5668", children: _jsx("img", { className: "wf-icon-image", src: compressArrowsIcon, alt: "", "aria-hidden": "true" }) })] }), _jsx("div", { className: "wf-editor-modal__body", children: _jsx(CodeEditor, { value: value, onChange: onChange, language: language }) })] }), overlayHost());
}
