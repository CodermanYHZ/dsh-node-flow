/**
 * Workflow data model for dsh-node-flow.
 *
 * The model is deliberately transport-agnostic: nodes/edges serialise to a
 * plain JSON workflow that can be handed to DSH's `ctx.workflows` service, so
 * the canvas is only ever a *view* over a DSH-native workflow spec.
 *
 * @module model
 */
import type { Node, Edge } from '@xyflow/react';
/** Node kinds the canvas understands. */
export type WorkflowNodeType = 'trigger' | 'schedule' | 'agent' | 'if' | 'switch' | 'loop' | 'while' | 'code' | 'output' | 'note';
/** Outcome of the last code-node execution, shown in the inspector. */
export type CodeRunOutcome = {
    /** The input this node received from the upstream flow (the `dsh.input()` value). */
    input?: string;
    /** Text the program emitted (console.*), in order. */
    logs: string[];
    /** The program's completion value (top-level `return`), when present. */
    value?: unknown;
    /** Failure message, when the run did not complete successfully. */
    error?: string;
    /** Local wall-clock time the run finished (or was marked running). */
    at: string;
    /** Elapsed milliseconds for the node's run (best-effort client timing). */
    duration?: number;
    /** True while a run is in flight. */
    running?: boolean;
};
/** Payload carried by each node — the part that maps to DSH workflow steps. */
export type WorkflowNodeData = {
    /** Node kind. */
    kind: WorkflowNodeType;
    /** User-facing label. */
    label: string;
    /** Trigger input text (kind === 'trigger'), flows to the next node. */
    text?: string;
    /** Cron schedule (kind === 'trigger'), e.g. "30 7 * * *" — host runs the flow on this. */
    cron?: string;
    /** IANA timezone for the cron schedule (kind === 'trigger'); defaults to system/local. */
    timezone?: string;
    /** Prompt for the sub-agent. */
    prompt?: string;
    /** Selected model route for the sub-agent (kind === 'agent'); stored as
     *  `"<provider>|<modelId>"`, empty means inherit the parent agent's model. */
    model?: string;
    /** Condition expression (kind === 'if' | 'switch' | 'while'). */
    condition?: string;
    /** Comma-separated case values (kind === 'switch'); each maps to a source handle. */
    cases?: string;
    /** Loop mode (kind === 'loop'): 'items' (iterate over an array) or 'count' (repeat N times). */
    mode?: string;
    /** Expression producing the array to iterate over (kind === 'loop' && mode === 'items'). */
    itemsExpr?: string;
    /** Repeat count (kind === 'loop' && mode === 'count'); parsed as an integer. */
    count?: string;
    /** Hard iteration cap for loop / while; parsed as an integer, defaults to 100. */
    maxIters?: string;
    /** Collect every iteration's result into an array delivered to `done`. */
    collect?: boolean;
    /** Code source (kind === 'code'). */
    code?: string;
    /** Code language (kind === 'code'); defaults to 'typescript'. */
    language?: string;
    /** Per-node runtime timeout in seconds (kind === 'code' | 'agent'); the host
     *  aborts the run past this and the node is recorded as a failure. */
    timeout?: string;
    /** Failure behavior (kind === 'code' | 'agent'): 'stop' (default) cuts the
     *  branch when the node fails; 'continue' keeps going with an empty value. */
    onError?: string;
    /** Last execution outcome (kind === 'code'), set after a run. */
    lastRun?: CodeRunOutcome;
    /** Output template / summary (kind === 'output'). */
    template?: string;
    /** Free-form notes. */
    notes?: string;
};
/** A canvas node with our typed data payload. */
export type WorkflowNode = Node<WorkflowNodeData>;
/** A canvas edge, optionally carrying a branch label. */
export type WorkflowEdge = Edge<{
    label?: string;
}>;
/** The serialisable workflow document the canvas produces. */
export type WorkflowDocument = {
    /** Spec version for forward compat. */
    version: 1;
    name: string;
    description?: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
};
/** Default dimensions per node kind (px). All square nodes share one size; agent stays a wide rectangle. */
export declare const NODE_SIZE: Record<WorkflowNodeType, {
    width: number;
    height: number;
}>;
export declare function createNode(kind: WorkflowNodeType, label: string, position: {
    x: number;
    y: number;
}): WorkflowNode;
/**
 * Flatten a canvas workflow into an ordered step list — the bridge to DSH's
 * `ctx.workflows`. Breadth-first from every trigger; conditions become
 * conditional steps with `then`/`else` targets derived from edges.
 */
export declare function toStepList(doc: WorkflowDocument): unknown[];
/**
 * A ready-made "fetch weather → agent organizes → output" workflow document,
 * loaded by the toolbar's "加载天气示例" button.
 */
export declare function buildWeatherExample(): WorkflowDocument;
export declare function buildNewsExample(): WorkflowDocument;
/** 通用条件分流：code 生成一个数 → If >10 → true/false 两个输出。 */
export declare function buildBasicIfExample(): WorkflowDocument;
/** AI 问答·判断：agent 回答后，If 判断回答是否提到 "AI" 走不同分支。 */
export declare function buildQaIfExample(): WorkflowDocument;
/** 日常 Switch：按当前时段（早上/下午/晚上）路由到不同问候。 */
export declare function buildDailySwitchExample(): WorkflowDocument;
/** Loop 示例：遍历一批热点，按是否含 "AI" 分流到 agent 深入或直接跳过，并收集每轮结果。 */
export declare function buildLoopExample(): WorkflowDocument;
/** While 示例：用字符串状态（待处理→处理中→完成）做判断，直到状态变为"完成"才停。 */
export declare function buildWhileExample(): WorkflowDocument;
