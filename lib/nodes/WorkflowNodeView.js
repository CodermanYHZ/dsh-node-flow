import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * A single workflow node card rendered on the canvas.
 *
 * Most nodes render as a rounded square (icon on top, label + summary below);
 * the agent node stays a wider rounded rectangle. After a run, the node's
 * outer border turns green (success) or red (failure) — no checkmark — and an
 * amber border shows while running. The node's elapsed time appears in the
 * top-left corner, its run time in the bottom-right.
 *
 * IF and SWITCH nodes render extra source handles so the flow can branch:
 * IF → "true" / "false"; SWITCH → one per configured case, plus "default".
 *
 * @module nodes/WorkflowNodeView
 */
import { Handle, Position } from '@xyflow/react';
import { NODE_SIZE } from '../model.js';
const KIND_META = {
    trigger: { color: '#34d399', icon: '▶', tag: 'TRIGGER' },
    schedule: { color: '#fb923c', icon: '⏰', tag: 'SCHEDULE' },
    agent: { color: '#a78bfa', icon: '🤖', tag: 'AGENT' },
    if: { color: '#fbbf24', icon: '◇', tag: 'IF' },
    switch: { color: '#f472b6', icon: '⋔', tag: 'SWITCH' },
    loop: { color: '#38bdf8', icon: '⟳', tag: 'LOOP' },
    while: { color: '#f59e0b', icon: '↻', tag: 'WHILE' },
    code: { color: '#2dd4bf', icon: '</>', tag: 'CODE' },
    output: { color: '#f87171', icon: '✓', tag: 'OUTPUT' },
    note: { color: '#fcd34d', icon: '📝', tag: 'NOTE' },
};
const HANDLE = 'wf-handle wf-handle--branch';
export function WorkflowNodeView({ data, selected }) {
    const meta = KIND_META[data.kind];
    const runState = data.lastRun
        ? data.lastRun.running
            ? 'running'
            : data.lastRun.error
                ? 'error'
                : 'ok'
        : '';
    // Branch source handles for IF / SWITCH (stacked on the right edge).
    const branches = [];
    // Loop / While re-entry targets (stacked on the left edge).
    const targets = [];
    if (data.kind === 'if') {
        branches.push({ id: 'true', label: 'true', top: '32%' }, { id: 'false', label: 'false', top: '68%' });
    }
    else if (data.kind === 'switch') {
        const cases = (data.cases ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const n = Math.max(cases.length, 1);
        cases.forEach((c, i) => branches.push({ id: c, label: c, top: `${28 + i * ((58 - 10) / n)}%` }));
        branches.push({ id: 'default', label: 'default', top: '88%' });
    }
    else if (data.kind === 'loop' || data.kind === 'while') {
        branches.push({ id: 'iterate', label: 'iterate', top: '32%' }, { id: 'done', label: 'done', top: '68%' });
        targets.push({ id: 'in', label: 'in', top: '32%' }, { id: 'again', label: 'back', top: '68%' });
    }
    const isBranch = data.kind === 'if' || data.kind === 'switch' || data.kind === 'loop' || data.kind === 'while';
    const isLoop = data.kind === 'loop' || data.kind === 'while';
    const cls = [
        'wf-node',
        `wf-node--${data.kind}`,
        selected ? 'wf-node--selected' : '',
        runState ? `wf-node--${runState}` : '',
    ]
        .filter(Boolean)
        .join(' ');
    const size = NODE_SIZE[data.kind];
    return (_jsx("div", { className: cls, style: {
            ['--kind']: meta.color,
            width: size.width,
            height: size.height,
        }, children: data.kind === 'note' ? (_jsxs("div", { className: "wf-node__note", children: [_jsx("span", { className: "wf-node__note-icon", children: "\uD83D\uDCDD" }), _jsx("div", { className: "wf-node__note-text", children: data.text || '点选编辑这个备注' })] })) : (_jsxs(_Fragment, { children: [data.lastRun?.duration != null && (_jsxs("span", { className: "wf-node__duration", children: [data.lastRun.duration, "ms"] })), data.lastRun?.at && (_jsx("span", { className: "wf-node__timenote", children: data.lastRun.at })), _jsx("div", { className: "wf-node__icon", style: { background: meta.color }, children: meta.icon }), _jsx("div", { className: "wf-node__label", children: data.label }), isLoop ? (targets.map((t) => (_jsx(Handle, { type: "target", position: Position.Left, id: t.id, style: { top: t.top }, className: "wf-handle" }, `h-${t.id}`)))) : (_jsx(Handle, { type: "target", position: Position.Left, className: "wf-handle" })), !isBranch && _jsx(Handle, { type: "source", position: Position.Right, className: "wf-handle" }), branches.map((b) => (_jsx(Handle, { type: "source", position: Position.Right, id: b.id, style: { top: b.top }, className: HANDLE }, `h-${b.id}`))), branches.map((b) => (_jsx("span", { className: "wf-node__branch-label", style: { top: b.top }, children: b.label }, `l-${b.id}`))), targets.map((t) => (_jsx("span", { className: "wf-node__branch-label wf-node__branch-label--left", style: { top: t.top }, children: t.label }, `tl-${t.id}`)))] })) }));
}
