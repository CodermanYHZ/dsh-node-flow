import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Workspace picker for the canvas toolbar.
 *
 * A native `<select>` cannot look like a host control: the closed state is a
 * system widget and the popup is drawn by the OS, so the pill ended up
 * oversized and off-style. This is a plain button plus a small menu instead —
 * the button names the Workspace in use, the menu lists every registered one
 * with its directory and its runner-session state, and everything is coloured
 * from the host's alias tokens via the canvas variables.
 *
 * @module components/WorkspacePicker
 */
import { useEffect, useRef, useState } from 'react';
const FOLDER_PATH = 'M3 5.5a2 2 0 0 1 2-2h3.2c.5 0 1 .2 1.4.6l1 1h6.4a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const CHECK_PATH = 'M4.5 9.5 7 12l4.5-5';
function FolderIcon() {
    return (_jsx("svg", { className: "wf-ws__icon", viewBox: "0 0 20 16", width: "14", height: "14", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: FOLDER_PATH }) }));
}
function ChevronIcon() {
    return (_jsx("svg", { className: "wf-ws__chevron", viewBox: "0 0 12 12", width: "10", height: "10", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "m3 4.5 3 3 3-3" }) }));
}
function CheckIcon() {
    return (_jsx("svg", { className: "wf-ws__check", viewBox: "0 0 16 16", width: "12", height: "12", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: CHECK_PATH }) }));
}
export function WorkspacePicker({ options, value, error, onChange, }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const selected = options.find((option) => option.id === value);
    useEffect(() => {
        if (!open)
            return;
        const onPointerDown = (event) => {
            if (rootRef.current !== null && !rootRef.current.contains(event.target))
                setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape')
                setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);
    const runnerLive = selected?.runner?.live === true;
    const label = selected?.title ?? (error !== '' ? '工作区不可用' : '选择工作区');
    return (_jsxs("div", { className: "wf-ws", ref: rootRef, children: [_jsxs("button", { type: "button", className: `wf-ws__button${error !== '' ? ' wf-ws__button--error' : ''}`, "aria-haspopup": "listbox", "aria-expanded": open, title: error !== ''
                    ? `工作区不可用：${error}`
                    : `${selected?.path ?? ''}\nAgent 节点在该工作区的运行会话下执行`, onClick: () => setOpen((previous) => !previous), children: [_jsx(FolderIcon, {}), _jsx("span", { className: "wf-ws__label", children: label }), runnerLive && _jsx("span", { className: "wf-ws__dot", "aria-label": "\u8FD0\u884C\u4F1A\u8BDD\u5DF2\u5C31\u7EEA" }), _jsx(ChevronIcon, {})] }), open && (_jsxs("div", { className: "wf-ws__menu", role: "listbox", "aria-label": "\u6267\u884C\u5DE5\u4F5C\u533A", children: [error !== '' && _jsx("div", { className: "wf-ws__error", children: error }), options.length === 0 && _jsx("div", { className: "wf-ws__empty", children: "\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A\uFF0C\u5148\u5728\u4FA7\u8FB9\u680F\u6DFB\u52A0\u4E00\u4E2A\u3002" }), options.map((option) => {
                        const active = option.id === value;
                        const live = option.runner?.live === true;
                        const archived = option.runner?.visible === false;
                        return (_jsxs("button", { type: "button", role: "option", "aria-selected": active, className: `wf-ws__row${active ? ' wf-ws__row--active' : ''}`, onClick: () => {
                                onChange(option.id, option.title);
                                setOpen(false);
                            }, children: [_jsx("span", { className: "wf-ws__rowCheck", children: active ? _jsx(CheckIcon, {}) : null }), _jsxs("span", { className: "wf-ws__rowText", children: [_jsx("span", { className: "wf-ws__rowTitle", children: option.title }), _jsx("span", { className: "wf-ws__rowPath", children: option.path ?? '（未知路径）' })] }), _jsx("span", { className: `wf-ws__rowState${live ? ' wf-ws__rowState--live' : ''}`, children: live ? '运行会话已就绪' : archived ? '会话已归档' : '首次运行将创建会话' })] }, option.id));
                    })] }))] }));
}
