import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Full-screen code editor modal — opened from the code node card's "展开"
 * button so editing has the whole node-mode surface to work in.
 *
 * @module components/CodeEditorModal
 */
import { createPortal } from 'react-dom';
import { useCanvasStore } from '../store/canvas.js';
import compressArrowsIcon from '../assets/icons/compress-arrows-alt.svg';
import { CodeEditor } from './CodeEditor.js';
export function CodeEditorModal({ value, onChange, language, onClose, }) {
    const theme = useCanvasStore((state) => state.theme);
    return createPortal(_jsxs("div", { className: "wf-editor-modal", "data-theme": theme, role: "dialog", "aria-modal": "true", "aria-labelledby": "wf-editor-modal-title", children: [_jsxs("div", { className: "wf-editor-modal__head", children: [_jsxs("div", { className: "wf-editor-modal__heading", children: [_jsx("span", { id: "wf-editor-modal-title", className: "wf-editor-modal__title", children: "\u4EE3\u7801\u7F16\u8F91\u5668" }), _jsx("span", { className: "wf-editor-modal__language", children: language === 'python' ? 'Python' : 'TypeScript' })] }), _jsx("button", { type: "button", className: "wf-editor-modal__collapse", onClick: onClose, title: "\u6536\u8D77\u7F16\u8F91\u5668", "aria-label": "\u6536\u8D77\u5168\u5C4F\u4EE3\u7801\u7F16\u8F91\u5668", children: _jsx("img", { className: "wf-icon-image", src: compressArrowsIcon, alt: "", "aria-hidden": "true" }) })] }), _jsx("div", { className: "wf-editor-modal__body", children: _jsx(CodeEditor, { value: value, onChange: onChange, language: language }) })] }), document.body);
}
