import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Left-side node palette drawer. List node types grouped by category; drag an
 * item onto the canvas to place it there (or click to add at a random spot).
 * Saved workflows live in the separate 📂 工作流 drawer.
 *
 * @module components/NodePalette
 */
import { useCanvasStore } from '../store/canvas.js';
const GROUPS = [
    {
        group: '触发',
        items: [
            { kind: 'trigger', label: '触发器', icon: '▶', color: '#34d399' },
            { kind: 'schedule', label: '定时触发', icon: '⏰', color: '#fb923c' },
            { kind: 'listen', label: '监听', icon: '📡', color: '#38bdf8' },
        ],
    },
    {
        group: '处理',
        items: [
            { kind: 'agent', label: 'Agent', icon: '🤖', color: '#a78bfa' },
            { kind: 'code', label: 'Python 脚本', icon: '</>', color: '#2dd4bf' },
            { kind: 'output', label: '输出', icon: '✓', color: '#f87171' },
        ],
    },
    {
        group: '逻辑',
        items: [
            { kind: 'if', label: 'If', icon: '◇', color: '#fbbf24' },
            { kind: 'switch', label: 'Switch', icon: '⋔', color: '#f472b6' },
            { kind: 'loop', label: 'Loop', icon: '⟳', color: '#38bdf8' },
            { kind: 'while', label: 'While', icon: '↻', color: '#f59e0b' },
        ],
    },
    {
        group: '注释',
        items: [{ kind: 'note', label: '备注', icon: '📝', color: '#fcd34d' }],
    },
];
export function NodePalette() {
    const addNodeAt = useCanvasStore((s) => s.addNodeAt);
    return (_jsxs("div", { className: "wf-palette", children: [_jsx("div", { className: "wf-palette__body", children: GROUPS.map((g) => (_jsxs("div", { className: "wf-palette__group", children: [_jsx("div", { className: "wf-palette__group-title", children: g.group }), g.items.map((it) => (_jsxs("div", { className: "wf-palette__item", draggable: true, onDragStart: (e) => {
                                e.dataTransfer.setData('application/reactflow', it.kind);
                                e.dataTransfer.effectAllowed = 'move';
                            }, onClick: () => addNodeAt(it.kind, it.label, { x: 160 + Math.random() * 240, y: 120 + Math.random() * 240 }), children: [_jsx("span", { className: "wf-palette__icon", style: { background: it.color }, children: it.icon }), _jsx("span", { className: "wf-palette__label", children: it.label })] }, it.kind)))] }, g.group))) }), _jsx("div", { className: "wf-palette__hint", children: "\u62D6\u5230\u53F3\u4FA7\u753B\u5E03\uFF0C\u6216\u70B9\u51FB\u6DFB\u52A0" })] }));
}
