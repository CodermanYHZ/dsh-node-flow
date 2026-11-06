/**
 * Zustand store for the canvas — nodes, edges, selection, and the exported
 * workflow document. Kept framework-agnostic so the same store can back both
 * the standalone demo UI and the embedded DSH client plugin.
 *
 * @module store
 */

import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge, type NodeChange, type EdgeChange, type Connection } from '@xyflow/react'
import { createNode, toStepList, type WorkflowDocument, type WorkflowNode, type WorkflowEdge, type WorkflowNodeType } from '../model.js'

/** One stored run, reduced to what the canvas needs to replay it. */
export interface StoredRunNode {
  id: string
  kind: string
  label?: string
  status: 'ok' | 'error' | 'skipped'
  ms: number
  output?: unknown
  error?: string
  logs?: string[]
  /** Present when the node needed more than one attempt. */
  attempts?: Array<{ attempt: number; status: 'ok' | 'error'; ms: number; error?: string }>
}
export interface StoredRun {
  runId: string
  workflowName: string
  trigger: 'manual' | 'cron'
  startedAt: string
  durationMs: number
  status: 'ok' | 'error'
  doc: WorkflowDocument | null
  nodes: StoredRunNode[]
  output?: unknown
}
export interface ViewingRun {
  runId: string
  workflowName: string
  trigger: 'manual' | 'cron'
  startedAt: string
  status: 'ok' | 'error'
}

type CanvasState = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  activeEdgeIds: string[]
  selectedId: string | null
  selectedEdgeId: string | null
  workflowName: string
  /**
   * Id of the workflow file this canvas is editing
   * (`$DSH_HOME/workflow-canvas/workflows/<id>.json`); `null` = not saved yet.
   */
  workflowId: string | null
  /**
   * Bumped whenever a workflow file is written, so an already-open library
   * panel reloads its list instead of showing the list from when it opened.
   */
  workflowsVersion: number
  /**
   * Workspace this workflow executes in. Agent nodes delegate from that
   * Workspace's runner session, so the child inherits its directory and sandbox
   * boundary; the choice is saved in the document so scheduled runs agree.
   */
  executionWorkspaceId: string | null
  executionWorkspaceTitle: string | null
  /**
   * Set while the canvas shows a stored run instead of the editing buffer: the
   * graph and every node's result come from that record, and the toolbar says
   * so. `null` means "editing the live workflow".
   */
  viewingRun: ViewingRun | null
  /**
   * The editing buffer, parked while a stored run is replayed. `exitRunView`
   * puts it back, so looking at an old run can never cost the user the graph
   * they were editing.
   */
  bufferBeforeRunView: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
    workflowName: string
    executionWorkspaceId: string | null
    executionWorkspaceTitle: string | null
  } | null
  // actions
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  onConnect: (conn: Connection) => void
  addNodeAt: (kind: WorkflowNodeType, label: string, position: { x: number; y: number }) => string
  updateNodeData: (id: string, patch: Partial<WorkflowNode['data']>) => void
  clearActiveEdges: () => void
  markEdgeActive: (id: string) => void
  removeNode: (id: string) => void
  removeEdge: (id: string) => void
  select: (id: string | null) => void
  selectEdge: (id: string | null) => void
  setWorkflowName: (name: string) => void
  setWorkflowId: (id: string | null) => void
  /** Tell an open workflow-library panel that the files changed. */
  bumpWorkflows: () => void
  setExecutionWorkspace: (id: string | null, title: string | null) => void
  /** Replay a stored run: its graph snapshot plus every node's recorded result. */
  showRun: (run: StoredRun) => void
  /** Leave replay and return to the live editing buffer. */
  exitRunView: () => void
  /** Export the current canvas as a DSH workflow spec. */
  exportDocument: () => WorkflowDocument
  /** Build the ordered step list stored beside the document for a schedule. */
  toSteps: () => unknown[]
  /** Load a saved document into the canvas; `id` ties it to its workflow file. */
  importDocument: (doc: WorkflowDocument, workflowId?: string | null) => void
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
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

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
  onEdgesChange: (changes) =>
    set((s) => {
      const edges = applyEdgeChanges(changes, s.edges)
      const edgeIds = new Set(edges.map((edge) => edge.id))
      return {
        edges,
        activeEdgeIds: s.activeEdgeIds.filter((id) => edgeIds.has(id)),
      }
    }),
  onConnect: (conn) =>
    set((s) => ({ edges: addEdge({ ...conn, data: { label: undefined } }, s.edges) })),

  addNodeAt: (kind, label, position) => {
    const n = createNode(kind, label, position)
    set((s) => ({ nodes: [...s.nodes, n], selectedId: n.id, selectedEdgeId: null }))
    return n.id
  },

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    })),

  clearActiveEdges: () => set({ activeEdgeIds: [] }),
  markEdgeActive: (id) =>
    set((s) => (s.activeEdgeIds.includes(id) ? {} : { activeEdgeIds: [...s.activeEdgeIds, id] })),

  removeNode: (id) =>
    set((s) => {
      const edges = s.edges.filter((e) => e.source !== id && e.target !== id)
      const edgeIds = new Set(edges.map((edge) => edge.id))
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        edges,
        activeEdgeIds: s.activeEdgeIds.filter((edgeId) => edgeIds.has(edgeId)),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedEdgeId: null,
      }
    }),

  removeEdge: (id) =>
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== id),
      activeEdgeIds: s.activeEdgeIds.filter((edgeId) => edgeId !== id),
      selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
    })),

  select: (id) => set({ selectedId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedId: null }),
  setWorkflowName: (name) => set({ workflowName: name }),
  setWorkflowId: (id) => set({ workflowId: id }),
  bumpWorkflows: () => set((s) => ({ workflowsVersion: s.workflowsVersion + 1 })),
  setExecutionWorkspace: (id, title) =>
    set({ executionWorkspaceId: id, executionWorkspaceTitle: title }),

  showRun: (run) =>
    set((state) => {
      const byRunNode = new Map(run.nodes.map((node) => [node.id, node]))
      const baseNodes = run.doc?.nodes ?? state.nodes
      const nodes = baseNodes.map((node) => {
        const result = byRunNode.get(node.id)
        if (result === undefined) return { ...node, data: { ...node.data, lastRun: undefined } }
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
        }
      })
      return {
        // Park the live buffer only once: replaying from inside replay would
        // otherwise overwrite it with the previous replay's snapshot.
        bufferBeforeRunView:
          state.viewingRun === null
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
      }
    }),
  exitRunView: () =>
    set((state) => {
      const buffer = state.bufferBeforeRunView
      if (buffer === null) return { viewingRun: null }
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
      }
    }),

  exportDocument: () => {
    const state = get()
    return {
      version: 1,
      name: state.workflowName,
      ...(state.executionWorkspaceId === null ? {} : { executionWorkspaceId: state.executionWorkspaceId }),
      ...(state.executionWorkspaceTitle === null ? {} : { executionWorkspaceTitle: state.executionWorkspaceTitle }),
      nodes: state.nodes,
      edges: state.edges,
    }
  },

  toSteps: () => toStepList(get().exportDocument()),

  importDocument: (doc, workflowId) =>
    set({
      nodes: doc.nodes,
      edges: doc.edges,
      activeEdgeIds: [],
      workflowName: doc.name,
      workflowId: workflowId ?? null,
      executionWorkspaceId: doc.executionWorkspaceId ?? null,
      executionWorkspaceTitle: doc.executionWorkspaceTitle ?? null,
    }),
}))
