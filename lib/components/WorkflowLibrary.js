import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Workflow library drawer — the list of saved workflows.
 *
 * Every row is one file under `$DSH_HOME/workflow-canvas/workflows/<id>.json`.
 * Clicking a row (or dropping it on the canvas) loads that file into the canvas;
 * the toolbar's 保存 writes the canvas back to the same id. Each row's ⋯ menu
 * renames or deletes that file.
 *
 * @module components/WorkflowLibrary
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvas.js';
/** MIME type used when dragging a workflow row onto the canvas. */
export const WORKFLOW_DRAG_TYPE = 'application/x-dsh-workflow';
/** Load one workflow file into the canvas. */
export async function loadWorkflowFile(id) {
    const res = await fetch(`/dsh-node-flow/workflow?id=${encodeURIComponent(id)}`);
    const data = (await res.json().catch(() => ({})));
    if (!res.ok || data.doc === undefined)
        throw new Error(data.error ?? `HTTP ${res.status}`);
    useCanvasStore.getState().importDocument(data.doc, id);
}
export function WorkflowLibrary() {
    const currentId = useCanvasStore((s) => s.workflowId);
    // Bumped by the toolbar after a save: an open panel reloads its list instead
    // of showing what it fetched when it opened.
    const workflowsVersion = useCanvasStore((s) => s.workflowsVersion);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [menu, setMenu] = useState(null);
    const [renaming, setRenaming] = useState(null);
    const renameInput = useRef(null);
    const rootRef = useRef(null);
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/dsh-node-flow/workflows', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            const data = (await res.json().catch(() => ({})));
            if (!res.ok)
                throw new Error(data.error ?? `HTTP ${res.status}`);
            setRows(Array.isArray(data.workflows) ? data.workflows : []);
            setError('');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void refresh();
    }, [refresh, workflowsVersion]);
    // The menu closes on any click elsewhere or Escape.
    useEffect(() => {
        if (menu === null)
            return;
        const close = () => setMenu(null);
        const onKey = (e) => {
            if (e.key === 'Escape')
                close();
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);
    useEffect(() => {
        if (renaming !== null)
            renameInput.current?.focus();
    }, [renaming]);
    const open = (id) => {
        void loadWorkflowFile(id).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    };
    const post = async (path, body) => {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        return (await res.json().catch(() => ({})));
    };
    const commitRename = async () => {
        if (renaming === null)
            return;
        const { id, text } = renaming;
        setRenaming(null);
        const trimmed = text.trim();
        if (trimmed === '')
            return;
        try {
            const data = await post('/dsh-node-flow/workflow/rename', { id, name: trimmed });
            if (data.error !== undefined)
                throw new Error(data.error);
            if (id === useCanvasStore.getState().workflowId && typeof data.name === 'string') {
                useCanvasStore.getState().setWorkflowName(data.name);
            }
            setNotice(typeof data.name === 'string' && data.name !== trimmed ? `同名，已改为「${data.name}」` : '');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        await refresh();
    };
    // Deleting is immediate: no confirmation dialog, the file is just removed.
    const remove = async (id) => {
        setMenu(null);
        try {
            const data = await post('/dsh-node-flow/workflow/delete', { id });
            if (data.error !== undefined)
                throw new Error(data.error);
            // The open canvas keeps its nodes; it just stops being tied to a file.
            if (id === useCanvasStore.getState().workflowId)
                useCanvasStore.getState().setWorkflowId(null);
            setNotice('已删除');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        await refresh();
    };
    return (_jsxs("div", { className: "wf-palette wf-palette--workflows", ref: rootRef, children: [_jsxs("div", { className: "wf-palette__body", children: [loading && rows.length === 0 && _jsx("div", { className: "wf-palette__group-title", children: "\u52A0\u8F7D\u4E2D\u2026" }), !loading && error !== '' && _jsxs("div", { className: "wf-palette__group-title", children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", error] }), !loading && error === '' && rows.length === 0 && (_jsx("div", { className: "wf-palette__group-title", children: "\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u6D41" })), rows.map((row) => (_jsxs("div", { className: row.id === currentId ? 'wf-palette__item wf-palette__item--active' : 'wf-palette__item', draggable: renaming?.id !== row.id, onDragStart: (e) => {
                            e.dataTransfer.setData(WORKFLOW_DRAG_TYPE, row.id);
                            e.dataTransfer.effectAllowed = 'copy';
                        }, onClick: () => {
                            if (renaming?.id === row.id)
                                return;
                            open(row.id);
                        }, title: row.description ?? row.id, children: [renaming?.id === row.id ? (_jsx("input", { ref: renameInput, className: "wf-wfitem__rename", value: renaming.text, onChange: (e) => setRenaming({ id: row.id, text: e.target.value }), onClick: (e) => e.stopPropagation(), onKeyDown: (e) => {
                                    if (e.key === 'Enter')
                                        void commitRename();
                                    if (e.key === 'Escape')
                                        setRenaming(null);
                                }, onBlur: () => void commitRename(), "aria-label": "\u5DE5\u4F5C\u6D41\u540D\u79F0" })) : (_jsx("span", { className: "wf-palette__label", children: row.name })), _jsx("span", { className: "wf-wfitem__meta", children: row.nodeCount }), _jsx("button", { type: "button", className: "wf-wfitem__menu", draggable: false, onMouseDown: (e) => e.stopPropagation(), onClick: (e) => {
                                    e.stopPropagation();
                                    // Absolute inside the panel: a `fixed` popover would be trapped
                                    // by the panel's backdrop-filter containing block + overflow.
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const root = rootRef.current?.getBoundingClientRect();
                                    setMenu({
                                        id: row.id,
                                        name: row.name,
                                        x: rect.right - (root?.left ?? 0),
                                        y: rect.bottom - (root?.top ?? 0) + 4,
                                    });
                                }, "aria-label": "\u66F4\u591A\u64CD\u4F5C", title: "\u66F4\u591A\u64CD\u4F5C", children: "\u22EF" })] }, row.id)))] }), _jsx("div", { className: "wf-palette__hint", children: notice !== '' ? notice : '点击加载到画布，或拖到右侧' }), menu !== null && (_jsxs("div", { className: "wf-wfitem__pop", style: { left: Math.max(8, menu.x - 116), top: menu.y }, onMouseDown: (e) => e.stopPropagation(), children: [_jsx("button", { type: "button", onClick: () => {
                            setMenu(null);
                            setRenaming({ id: menu.id, text: menu.name });
                        }, children: "\u91CD\u547D\u540D" }), _jsx("button", { type: "button", className: "wf-wfitem__pop-danger", onClick: () => void remove(menu.id), children: "\u5220\u9664" })] }))] }));
}
