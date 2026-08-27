import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * A lightweight, dependency-free code editor with line numbers and syntax
 * highlighting — a transparent <textarea> overlaid on a highlighted <pre>,
 * so the caret and typing behave like a normal editor while the visible text
 * is the colored token stream. This keeps the plugin's client bundle
 * self-contained (no Monaco/CodeMirror dependency).
 *
 * @module components/CodeEditor
 */
import { useMemo, useRef } from 'react';
const TS_KEYWORDS = new Set([
    'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for',
    'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
    'let', 'new', 'of', 'private', 'protected', 'public', 'return', 'set', 'static', 'super',
    'switch', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'this',
    'true', 'false', 'null', 'undefined', 'number', 'string', 'boolean', 'any', 'never', 'unknown',
    'keyof', 'readonly', 'satisfies', 'infer', 'declare',
]);
const PY_KEYWORDS = new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
    'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
    'with', 'yield', 'True', 'False', 'None', 'print',
]);
/** Escape HTML special chars before wrapping tokens. */
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Token regex: strings, comments, numbers, identifiers/keywords. */
const TOKEN_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
/** Return HTML with syntax tokens wrapped in `tk-*` spans (safely escaped). */
function highlight(code, lang) {
    const keywords = lang === 'python' ? PY_KEYWORDS : TS_KEYWORDS;
    return escapeHtml(code).replace(TOKEN_RE, (m) => {
        if (/^("|'|`)/.test(m))
            return `<span class="tk-str">${m}</span>`;
        if (m.startsWith('//') || m.startsWith('/*') || (lang === 'python' && m.startsWith('#'))) {
            return `<span class="tk-com">${m}</span>`;
        }
        if (/^\d/.test(m))
            return `<span class="tk-num">${m}</span>`;
        if (keywords.has(m))
            return `<span class="tk-kw">${m}</span>`;
        return m;
    });
}
export function CodeEditor({ value, onChange, language, expanded = false, }) {
    const preRef = useRef(null);
    const inputRef = useRef(null);
    const gutterRef = useRef(null);
    const html = useMemo(() => highlight(value, language), [value, language]);
    const lineCount = useMemo(() => value.split('\n').length, [value]);
    const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount]);
    const syncScroll = () => {
        const ta = inputRef.current;
        const pre = preRef.current;
        const gutter = gutterRef.current;
        if (!ta || !pre || !gutter)
            return;
        pre.scrollTop = ta.scrollTop;
        pre.scrollLeft = ta.scrollLeft;
        gutter.scrollTop = ta.scrollTop;
    };
    return (_jsxs("div", { className: expanded ? 'wf-ed wf-ed--expanded' : 'wf-ed', children: [_jsx("div", { className: "wf-ed__gutter", ref: gutterRef, children: _jsx("pre", { children: gutter }) }), _jsxs("div", { className: "wf-ed__body", children: [_jsx("pre", { className: "wf-ed__pre", ref: preRef, dangerouslySetInnerHTML: { __html: html } }), _jsx("textarea", { className: "wf-ed__input", ref: inputRef, value: value, onChange: (e) => onChange(e.target.value), onScroll: syncScroll, spellCheck: false, wrap: "off", "aria-label": "Code editor" })] })] }));
}
