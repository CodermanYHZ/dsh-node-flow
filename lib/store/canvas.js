/**
 * Zustand store for the canvas — nodes, edges, selection, and the exported
 * workflow document. Kept framework-agnostic so the same store can back both
 * the standalone demo UI and the embedded DSH client plugin.
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
    workflowId: null,
    workflowsVersion: 0,
    executionWorkspaceId: null,
    executionWorkspaceTitle: null,
    viewingRun: null,
    bufferBeforeRunView: null,
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
    setWorkflowId: (id) => set({ workflowId: id }),
    bumpWorkflows: () => set((s) => ({ workflowsVersion: s.workflowsVersion + 1 })),
    setExecutionWorkspace: (id, title) => set({ executionWorkspaceId: id, executionWorkspaceTitle: title }),
    showRun: (run) => set((state) => {
        const byRunNode = new Map(run.nodes.map((node) => [node.id, node]));
        const baseNodes = run.doc?.nodes ?? state.nodes;
        const nodes = baseNodes.map((node) => {
            const result = byRunNode.get(node.id);
            if (result === undefined)
                return { ...node, data: { ...node.data, lastRun: undefined } };
            return {
                ...node,
                data: {
                    ...node.data,
                    lastRun: {
                        logs: result.logs ?? [],
                        ...(result.output === undefined ? {} : { value: result.output }),
                        ...(result.error === undefined ? {} : { error: result.error }),
                        at: new Date(run.startedAt).toLocaleString(),
                        duration: result.ms,
                    },
                },
            };
        });
        return {
            // Park the live buffer only once: replaying from inside replay would
            // otherwise overwrite it with the previous replay's snapshot.
            bufferBeforeRunView: state.viewingRun === null
                ? {
                    nodes: state.nodes,
                    edges: state.edges,
                    workflowName: state.workflowName,
                    executionWorkspaceId: state.executionWorkspaceId,
                    executionWorkspaceTitle: state.executionWorkspaceTitle,
                }
                : state.bufferBeforeRunView,
            nodes,
            edges: run.doc?.edges ?? state.edges,
            workflowName: run.doc?.name ?? run.workflowName,
            executionWorkspaceId: run.doc?.executionWorkspaceId ?? state.executionWorkspaceId,
            executionWorkspaceTitle: run.doc?.executionWorkspaceTitle ?? state.executionWorkspaceTitle,
            activeEdgeIds: [],
            selectedId: null,
            selectedEdgeId: null,
            viewingRun: {
                runId: run.runId,
                workflowName: run.workflowName,
                trigger: run.trigger,
                startedAt: run.startedAt,
                status: run.status,
            },
        };
    }),
    exitRunView: () => set((state) => {
        const buffer = state.bufferBeforeRunView;
        if (buffer === null)
            return { viewingRun: null };
        return {
            nodes: buffer.nodes,
            edges: buffer.edges,
            workflowName: buffer.workflowName,
            executionWorkspaceId: buffer.executionWorkspaceId,
            executionWorkspaceTitle: buffer.executionWorkspaceTitle,
            activeEdgeIds: [],
            selectedId: null,
            selectedEdgeId: null,
            viewingRun: null,
            bufferBeforeRunView: null,
        };
    }),
    exportDocument: () => {
        const state = get();
        return {
            version: 1,
            name: state.workflowName,
            ...(state.executionWorkspaceId === null ? {} : { executionWorkspaceId: state.executionWorkspaceId }),
            ...(state.executionWorkspaceTitle === null ? {} : { executionWorkspaceTitle: state.executionWorkspaceTitle }),
            nodes: state.nodes,
            edges: state.edges,
        };
    },
    toSteps: () => toStepList(get().exportDocument()),
    importDocument: (doc, workflowId) => set({
        nodes: doc.nodes,
        edges: doc.edges,
        activeEdgeIds: [],
        workflowName: doc.name,
        workflowId: workflowId ?? null,
        executionWorkspaceId: doc.executionWorkspaceId ?? null,
        executionWorkspaceTitle: doc.executionWorkspaceTitle ?? null,
    }),
}));
