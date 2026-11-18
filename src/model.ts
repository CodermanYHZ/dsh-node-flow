/**
 * Workflow data model for dsh-node-flow.
 *
 * The model is deliberately transport-agnostic: nodes/edges serialise to a
 * plain JSON workflow that the host can store and re-walk for scheduled runs,
 * so the canvas is only ever a *view* over one document.
 *
 * @module model
 */

import type { Node, Edge } from '@xyflow/react'

/** Node kinds the canvas understands. */
export type WorkflowNodeType =
  | 'trigger' // entry point / prompt trigger
  | 'schedule' // cron-triggered entry point (host schedules the flow)
  | 'listen' // resident listener entry point (host keeps a script running;每行 stdout 触发一次)
  | 'agent' // delegate to a sub-agent
  | 'if' // boolean branch: routes to "true" or "false" source handle
  | 'switch' // value branch: routes to a matching case source handle (or "default")
  | 'loop' // repeat a body over an array or N times (iterate / done / back)
  | 'while' // repeat a body while a condition holds (iterate / done / back)
  | 'code' // run a Python program on the DSH host (stdout becomes the node value)
  | 'output' // terminal result
  | 'note' // a free annotation (no connection handles)

/** Outcome of the last code-node execution, shown in the inspector. */
export type CodeRunOutcome = {
  /** The input this node received from the upstream flow (the `dsh.input()` value). */
  input?: string
  /** Text the program emitted (console.*), in order. */
  logs: string[]
  /** The program's completion value (top-level `return`), when present. */
  value?: unknown
  /** Failure message, when the run did not complete successfully. */
  error?: string
  /** Local wall-clock time the run finished (or was marked running). */
  at: string
  /** Elapsed milliseconds for the node's run (best-effort client timing). */
  duration?: number
  /** Per-attempt history, only present when the node had to be retried. */
  attempts?: Array<{ attempt: number; status: 'ok' | 'error'; ms: number; error?: string }>
  /** True while a run is in flight. */
  running?: boolean
}

/** Payload carried by each node — the part that maps to DSH workflow steps. */
export type WorkflowNodeData = {
  /** Node kind. */
  kind: WorkflowNodeType
  /** User-facing label. */
  label: string
  /** Trigger input text (kind === 'trigger'), flows to the next node. */
  text?: string
  /** Cron schedule (kind === 'trigger'), e.g. "30 7 * * *" — host runs the flow on this. */
  cron?: string
  /** IANA timezone for the cron schedule (kind === 'trigger'); defaults to system/local. */
  timezone?: string
  /** Prompt for the sub-agent. */
  prompt?: string
  /** Selected model route for the sub-agent (kind === 'agent'); stored as
   *  `"<provider>|<modelId>"`, empty means inherit the parent agent's model. */
  model?: string
  /** Condition expression (kind === 'if' | 'switch' | 'while'). */
  condition?: string
  /** Comma-separated case values (kind === 'switch'); each maps to a source handle. */
  cases?: string
  /** Loop mode (kind === 'loop'): 'items' (iterate over an array) or 'count' (repeat N times). */
  mode?: string
  /** Expression producing the array to iterate over (kind === 'loop' && mode === 'items'). */
  itemsExpr?: string
  /** Repeat count (kind === 'loop' && mode === 'count'); parsed as an integer. */
  count?: string
  /** Hard iteration cap for loop / while; parsed as an integer, defaults to 100. */
  maxIters?: string
  /** Collect every iteration's result into an array delivered to `done`. */
  collect?: boolean
  /** Code source (kind === 'code' | 'listen'). */
  code?: string
  /**
   * kind === 'listen': the resident Python script whose stdout lines fire the
   * flow. `minIntervalMs` coalesces event bursts on the host (default 500).
   */
  minIntervalMs?: string
  /** kind === 'listen': remembered user intent for restoring on host start. */
  enabled?: boolean
  /** Code language (kind === 'code'). Python only; the field is kept for
   *  document compatibility and older canvases are re-run as Python. */
  language?: string
  /** Per-node runtime timeout in seconds (kind === 'code' | 'agent'); the host
   *  aborts the run past this and the node is recorded as a failure. */
  timeout?: string
  /** Failure behavior (kind === 'code' | 'agent'): 'stop' (default) cuts the
   *  branch when the node fails; 'continue' keeps going with an empty value. */
  onError?: string
  /** Extra attempts when this node fails, 0-5 (default 0 = no retry). */
  retries?: string
  /** Delay between retry attempts in milliseconds, 0-10000 (default 0). */
  retryDelayMs?: string
  /** Last execution outcome (kind === 'code'), set after a run. */
  lastRun?: CodeRunOutcome
  /** Output template / summary (kind === 'output'). */
  template?: string
  /** Free-form notes. */
  notes?: string
}

/** A canvas node with our typed data payload. */
export type WorkflowNode = Node<WorkflowNodeData>

/** A canvas edge, optionally carrying a branch label. */
export type WorkflowEdge = Edge<{ label?: string }>

/** The serialisable workflow document the canvas produces. */
export type WorkflowDocument = {
  /** Spec version for forward compat. */
  version: 1
  name: string
  description?: string
  /**
   * Workspace this workflow executes in. Agent nodes delegate from that
   * Workspace's runner session, so the child inherits its directory and sandbox
   * boundary; scheduled runs read it from the document (there is no UI then).
   */
  executionWorkspaceId?: string
  /** Display-only title of `executionWorkspaceId`, for the toolbar chip. */
  executionWorkspaceTitle?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** Default dimensions per node kind (px). All square nodes share one size; agent stays a wide rectangle. */
export const NODE_SIZE: Record<WorkflowNodeType, { width: number; height: number }> = {
  trigger: { width: 124, height: 124 },
  schedule: { width: 124, height: 124 },
  listen: { width: 124, height: 124 },
  agent: { width: 212, height: 128 },
  if: { width: 132, height: 132 },
  switch: { width: 132, height: 132 },
  loop: { width: 132, height: 132 },
  while: { width: 132, height: 132 },
  code: { width: 124, height: 124 },
  output: { width: 124, height: 124 },
  note: { width: 168, height: 120 },
}

/** Fresh node factory with a stable id. */
let seq = 0
export function createNode(kind: WorkflowNodeType, label: string, position: { x: number; y: number }): WorkflowNode {
  const size = NODE_SIZE[kind]
  // Agent / code default to a 120s runtime timeout (user may change it).
  const data: WorkflowNodeData =
    kind === 'agent' || kind === 'code'
      ? { kind, label, timeout: '120', ...(kind === 'code' ? { language: 'python' } : {}) }
      : kind === 'listen'
        ? { kind, label, minIntervalMs: '500' }
        : { kind, label }
  return {
    id: `${kind}-${++seq}-${Date.now().toString(36)}`,
    type: 'workflow',
    position,
    data,
    // React Flow uses this size to position the connection handles on the
    // node's edges; the node card sets the same size so handle and card agree.
    style: { width: size.width, height: size.height },
  }
}

/**
 * Flatten a canvas workflow into an ordered step list — the compact form the
 * schedule records store beside the full document. Breadth-first from every
 * trigger; conditions become conditional steps with `then`/`else` targets
 * derived from edges.
 */
export function toStepList(doc: WorkflowDocument): unknown[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const out: unknown[] = []
  const visited = new Set<string>()

  const emit = (id: string, branch?: string): void => {
    if (visited.has(id) || !byId.has(id)) return
    visited.add(id)
    const n = byId.get(id)!
    const d = n.data
    const step: Record<string, unknown> = { id: n.id, kind: d.kind, label: d.label }
    if (d.kind === 'trigger') {
      step.text = d.text
    } else if (d.kind === 'schedule') {
      step.text = d.text
      step.cron = d.cron
      step.timezone = d.timezone
    } else if (d.kind === 'listen') {
      step.code = d.code
      step.minIntervalMs = d.minIntervalMs
    } else if (d.kind === 'agent') {
      step.prompt = d.prompt
      if (d.model) step.model = d.model
      if (d.timeout) step.timeout = d.timeout
    } else if (d.kind === 'if') {
      step.condition = d.condition
    } else if (d.kind === 'switch') {
      step.condition = d.condition
      step.cases = d.cases
    } else if (d.kind === 'loop') {
      step.mode = d.mode
      step.itemsExpr = d.itemsExpr
      step.count = d.count
      step.maxIters = d.maxIters
    } else if (d.kind === 'while') {
      step.condition = d.condition
      step.maxIters = d.maxIters
    } else if (d.kind === 'code') {
      step.code = d.code
      step.language = 'python'
      if (d.timeout) step.timeout = d.timeout
    } else if (d.kind === 'output') {
      step.template = d.template
    }
    if (branch) step.branch = branch
    out.push(step)
    for (const e of doc.edges) {
      if (e.source === id) emit(e.target, e.data?.label)
    }
  }

  for (const n of doc.nodes) {
    if (n.data.kind === 'trigger' || n.data.kind === 'schedule' || n.data.kind === 'listen') emit(n.id)
  }
  return out
}
