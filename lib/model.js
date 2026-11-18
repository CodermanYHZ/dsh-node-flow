/**
 * Workflow data model for dsh-node-flow.
 *
 * The model is deliberately transport-agnostic: nodes/edges serialise to a
 * plain JSON workflow that the host can store and re-walk for scheduled runs,
 * so the canvas is only ever a *view* over one document.
 *
 * @module model
 */
/** Default dimensions per node kind (px). All square nodes share one size; agent stays a wide rectangle. */
export const NODE_SIZE = {
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
};
/** Fresh node factory with a stable id. */
let seq = 0;
export function createNode(kind, label, position) {
    const size = NODE_SIZE[kind];
    // Agent / code default to a 120s runtime timeout (user may change it).
    const data = kind === 'agent' || kind === 'code'
        ? { kind, label, timeout: '120', ...(kind === 'code' ? { language: 'python' } : {}) }
        : kind === 'listen'
            ? { kind, label, minIntervalMs: '500' }
            : { kind, label };
    return {
        id: `${kind}-${++seq}-${Date.now().toString(36)}`,
        type: 'workflow',
        position,
        data,
        // React Flow uses this size to position the connection handles on the
        // node's edges; the node card sets the same size so handle and card agree.
        style: { width: size.width, height: size.height },
    };
}
/**
 * Flatten a canvas workflow into an ordered step list — the compact form the
 * schedule records store beside the full document. Breadth-first from every
 * trigger; conditions become conditional steps with `then`/`else` targets
 * derived from edges.
 */
export function toStepList(doc) {
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    const out = [];
    const visited = new Set();
    const emit = (id, branch) => {
        if (visited.has(id) || !byId.has(id))
            return;
        visited.add(id);
        const n = byId.get(id);
        const d = n.data;
        const step = { id: n.id, kind: d.kind, label: d.label };
        if (d.kind === 'trigger') {
            step.text = d.text;
        }
        else if (d.kind === 'schedule') {
            step.text = d.text;
            step.cron = d.cron;
            step.timezone = d.timezone;
        }
        else if (d.kind === 'listen') {
            step.code = d.code;
            step.minIntervalMs = d.minIntervalMs;
        }
        else if (d.kind === 'agent') {
            step.prompt = d.prompt;
            if (d.model)
                step.model = d.model;
            if (d.timeout)
                step.timeout = d.timeout;
        }
        else if (d.kind === 'if') {
            step.condition = d.condition;
        }
        else if (d.kind === 'switch') {
            step.condition = d.condition;
            step.cases = d.cases;
        }
        else if (d.kind === 'loop') {
            step.mode = d.mode;
            step.itemsExpr = d.itemsExpr;
            step.count = d.count;
            step.maxIters = d.maxIters;
        }
        else if (d.kind === 'while') {
            step.condition = d.condition;
            step.maxIters = d.maxIters;
        }
        else if (d.kind === 'code') {
            step.code = d.code;
            step.language = 'python';
            if (d.timeout)
                step.timeout = d.timeout;
        }
        else if (d.kind === 'output') {
            step.template = d.template;
        }
        if (branch)
            step.branch = branch;
        out.push(step);
        for (const e of doc.edges) {
            if (e.source === id)
                emit(e.target, e.data?.label);
        }
    };
    for (const n of doc.nodes) {
        if (n.data.kind === 'trigger' || n.data.kind === 'schedule' || n.data.kind === 'listen')
            emit(n.id);
    }
    return out;
}
