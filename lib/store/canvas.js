/**
 * Zustand store for the canvas — nodes, edges, selection, and the bridge to
 * DSH's `ctx.workflows` service. Kept framework-agnostic so the same store can
 * back both the standalone demo UI and the embedded DSH client plugin.
 *
 * @module store
 */
import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { createNode, toStepList } from '../model.js';
export const useCanvasStore = create((set, get) => ({
    nodes: [
        {
            id: 'trigger-1',
            type: 'workflow',
            position: { x: 80, y: 200 },
            data: { kind: 'trigger', label: 'Start' },
            style: { width: 180 },
        },
    ],
    edges: [],
    activeEdgeIds: [],
    selectedId: null,
    selectedEdgeId: null,
    workflowName: 'Untitled workflow',
    theme: 'dark',
    setTheme: (t) => {
        try {
            localStorage.setItem('dsh-node-flow:theme', t);
        }
        catch {
            /* ignore */
        }
        set({ theme: t });
    },
    toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem('dsh-node-flow:theme', next);
        }
        catch {
            /* ignore */
        }
        set({ theme: next });
    },
    onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
    onEdgesChange: (changes) => set((s) => {
        const edges = applyEdgeChanges(changes, s.edges);
        const edgeIds = new Set(edges.map((edge) => edge.id));
        return {
            edges,
            activeEdgeIds: s.activeEdgeIds.filter((id) => edgeIds.has(id)),
        };
    }),
    onConnect: (conn) => set((s) => ({ edges: addEdge({ ...conn, data: { label: undefined } }, s.edges) })),
    addNodeAt: (kind, label, position) => {
        const n = createNode(kind, label, position);
        set((s) => ({ nodes: [...s.nodes, n], selectedId: n.id, selectedEdgeId: null }));
        return n.id;
    },
    updateNodeData: (id, patch) => set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    })),
    clearActiveEdges: () => set({ activeEdgeIds: [] }),
    markEdgeActive: (id) => set((s) => (s.activeEdgeIds.includes(id) ? {} : { activeEdgeIds: [...s.activeEdgeIds, id] })),
    removeNode: (id) => set((s) => {
        const edges = s.edges.filter((e) => e.source !== id && e.target !== id);
        const edgeIds = new Set(edges.map((edge) => edge.id));
        return {
            nodes: s.nodes.filter((n) => n.id !== id),
            edges,
            activeEdgeIds: s.activeEdgeIds.filter((edgeId) => edgeIds.has(edgeId)),
            selectedId: s.selectedId === id ? null : s.selectedId,
            selectedEdgeId: null,
        };
    }),
    removeEdge: (id) => set((s) => ({
        edges: s.edges.filter((e) => e.id !== id),
        activeEdgeIds: s.activeEdgeIds.filter((edgeId) => edgeId !== id),
        selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
    })),
    select: (id) => set({ selectedId: id, selectedEdgeId: null }),
    selectEdge: (id) => set({ selectedEdgeId: id, selectedId: null }),
    setWorkflowName: (name) => set({ workflowName: name }),
    exportDocument: () => ({
        version: 1,
        name: get().workflowName,
        nodes: get().nodes,
        edges: get().edges,
    }),
    toSteps: () => toStepList(get().exportDocument()),
    importDocument: (doc) => set({ nodes: doc.nodes, edges: doc.edges, activeEdgeIds: [], workflowName: doc.name }),
}));
