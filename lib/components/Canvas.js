import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Main canvas — React Flow wrapper wiring the store to the renderer.
 *
 * @module components/Canvas
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant } from '@xyflow/react';
import './canvas.css';
import { useCanvasStore } from '../store/canvas.js';
import { WorkflowNodeView } from '../nodes/WorkflowNodeView.js';
import { Toolbar } from './Toolbar.js';
import { Inspector } from './Inspector.js';
import { NodePalette } from './NodePalette.js';
import './canvas.css';
const nodeTypes = { workflow: WorkflowNodeView };
const DEFAULT_LABELS = {
    trigger: '触发器',
    schedule: '定时触发',
    agent: 'Agent',
    code: '代码执行',
    output: '输出',
    if: 'If',
    switch: 'Switch',
    loop: 'Loop',
    while: 'While',
    note: '备注',
};
export function Canvas({ onExitNodeMode } = {}) {
    const nodes = useCanvasStore((s) => s.nodes);
    const edges = useCanvasStore((s) => s.edges);
    const activeEdgeIds = useCanvasStore((s) => s.activeEdgeIds);
    const onNodesChange = useCanvasStore((s) => s.onNodesChange);
    const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
    const onConnect = useCanvasStore((s) => s.onConnect);
    const select = useCanvasStore((s) => s.select);
    const selectEdge = useCanvasStore((s) => s.selectEdge);
    const addNodeAt = useCanvasStore((s) => s.addNodeAt);
    const selectedId = useCanvasStore((s) => s.selectedId);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const rfRef = useRef(null);
    const renderedEdges = useMemo(() => {
        const activeIds = new Set(activeEdgeIds);
        return edges.map((edge) => {
            const classes = (edge.className ?? '')
                .split(/\s+/)
                .filter((className) => className && className !== 'wf-edge--active');
            if (activeIds.has(edge.id))
                classes.push('wf-edge--active');
            return { ...edge, className: classes.join(' ') || undefined };
        });
    }, [activeEdgeIds, edges]);
    // Delete / Backspace removes the selected edge, else the selected node.
    // Guarded so it never fires while typing in an input/textarea/select or a contenteditable.
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace')
                return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
                return;
            }
            const store = useCanvasStore.getState();
            if (store.selectedEdgeId) {
                e.preventDefault();
                store.removeEdge(store.selectedEdgeId);
            }
            else if (store.selectedId) {
                e.preventDefault();
                store.removeNode(store.selectedId);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);
    const onDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };
    const onDrop = (e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData('application/reactflow');
        if (!kind || !rfRef.current)
            return;
        const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNodeAt(kind, DEFAULT_LABELS[kind] ?? kind, pos);
    };
    return (_jsxs("div", { className: "wf-shell", children: [_jsx(Toolbar, { onExitNodeMode: onExitNodeMode }), _jsxs("div", { className: "wf-main", children: [_jsxs("div", { className: "wf-canvas", children: [_jsxs(ReactFlow, { nodes: nodes, edges: renderedEdges, nodeTypes: nodeTypes, onNodesChange: onNodesChange, onEdgesChange: onEdgesChange, onConnect: onConnect, onSelectionChange: ({ nodes: selNodes, edges: selEdges }) => {
                                    if (selNodes.length > 0) {
                                        select(selNodes[0].id);
                                    }
                                    else if (selEdges.length > 0) {
                                        selectEdge(selEdges[0].id);
                                    }
                                    else {
                                        select(null);
                                    }
                                }, onPaneClick: () => select(null), onDragOver: onDragOver, onDrop: onDrop, onInit: (inst) => {
                                    rfRef.current = inst;
                                }, fitView: true, proOptions: { hideAttribution: true }, deleteKeyCode: null, children: [_jsx(Background, { variant: BackgroundVariant.Dots, gap: 18, size: 1 }), _jsx(Controls, {}), _jsx(MiniMap, { nodeColor: (n) => {
                                            const kinds = {
                                                trigger: '#10b981', schedule: '#fb923c', agent: '#8b5cf6',
                                                if: '#fbbf24', switch: '#f472b6', code: '#14b8a6', output: '#ef4444',
                                            };
                                            return kinds[n.data?.kind ?? ''] ?? '#94a3b8';
                                        } })] }), _jsx("button", { className: "wf-canvas__add", onClick: () => setPaletteOpen((v) => !v), children: paletteOpen ? '✕' : '➕ 添加节点' }), paletteOpen && _jsx(NodePalette, {})] }), selectedId && _jsx(Inspector, {})] })] }));
}
