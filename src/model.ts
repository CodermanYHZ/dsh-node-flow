/**
 * Workflow data model for dsh-node-flow.
 *
 * The model is deliberately transport-agnostic: nodes/edges serialise to a
 * plain JSON workflow that can be handed to DSH's `ctx.workflows` service, so
 * the canvas is only ever a *view* over a DSH-native workflow spec.
 *
 * @module model
 */

import type { Node, Edge } from '@xyflow/react'

/** Node kinds the canvas understands. */
export type WorkflowNodeType =
  | 'trigger' // entry point / prompt trigger
  | 'schedule' // cron-triggered entry point (host schedules the flow)
  | 'agent' // delegate to a sub-agent
  | 'if' // boolean branch: routes to "true" or "false" source handle
  | 'switch' // value branch: routes to a matching case source handle (or "default")
  | 'loop' // repeat a body over an array or N times (iterate / done / again)
  | 'while' // repeat a body while a condition holds (iterate / done / again)
  | 'code' // execute code on the DSH host (ctx.codeRuntime)
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
  /** Code source (kind === 'code'). */
  code?: string
  /** Code language (kind === 'code'); defaults to 'typescript'. */
  language?: string
  /** Per-node runtime timeout in seconds (kind === 'code' | 'agent'); the host
   *  aborts the run past this and the node is recorded as a failure. */
  timeout?: string
  /** Failure behavior (kind === 'code' | 'agent'): 'stop' (default) cuts the
   *  branch when the node fails; 'continue' keeps going with an empty value. */
  onError?: string
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
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** Default dimensions per node kind (px). All square nodes share one size; agent stays a wide rectangle. */
export const NODE_SIZE: Record<WorkflowNodeType, { width: number; height: number }> = {
  trigger: { width: 124, height: 124 },
  schedule: { width: 124, height: 124 },
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
  // Agent / code default to a 120s runtime timeout (user may clear it for "no limit").
  const data: WorkflowNodeData = kind === 'agent' || kind === 'code' ? { kind, label, timeout: '120' } : { kind, label }
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
 * Flatten a canvas workflow into an ordered step list — the bridge to DSH's
 * `ctx.workflows`. Breadth-first from every trigger; conditions become
 * conditional steps with `then`/`else` targets derived from edges.
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
      step.language = d.language ?? 'typescript'
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
    if (n.data.kind === 'trigger' || n.data.kind === 'schedule') emit(n.id)
  }
  return out
}

/**
 * A ready-made "fetch weather → agent organizes → output" workflow document,
 * loaded by the toolbar's "加载天气示例" button.
 */
export function buildWeatherExample(): WorkflowDocument {
  const nodes: WorkflowNode[] = [
    {
      id: 'w-trigger',
      type: 'workflow',
      position: { x: 40, y: 200 },
      data: { kind: 'trigger', label: '天气触发', text: '抓取上海实时天气，并整理成一句中文播报' },
    },
    {
      id: 'w-fetch',
      type: 'workflow',
      position: { x: 230, y: 200 },
      data: {
        kind: 'code',
        label: '拉取天气',
        language: 'typescript',
        code: [
          'const r = await dsh.fetch({ url: \'https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&current=temperature_2m,weather_code&timezone=Asia%2FShanghai\' })',
          'if (!r.ok) throw new Error(\'天气接口失败: HTTP \' + r.status)',
          'return JSON.stringify({ temp: r.json?.current?.temperature_2m, code: r.json?.current?.weather_code })',
        ].join('\n'),
      },
    },
    {
      id: 'w-agent',
      type: 'workflow',
      position: { x: 440, y: 200 },
      data: {
        kind: 'agent',
        label: '整理天气',
        prompt: '请把下面这段实时天气数据整理成一句简洁、自然的中文天气播报，包含温度和天气状况（天气代码含义：0=晴，1-2=多云，3=阴，45/48=雾，51-67=雨，71-77=雪，80-82=阵雨，95+=雷雨），不要罗列原始 JSON。',
      },
    },
    {
      id: 'w-output',
      type: 'workflow',
      position: { x: 720, y: 200 },
      data: { kind: 'output', label: '输出', template: '{{result}}' },
    },
  ]
  const edges: WorkflowEdge[] = [
    { id: 'we1', source: 'w-trigger', target: 'w-fetch' },
    { id: 'we2', source: 'w-fetch', target: 'w-agent' },
    { id: 'we3', source: 'w-agent', target: 'w-output' },
  ]
  return { version: 1, name: '天气示例', description: '拉取上海实时天气 → agent 整理 → 输出', nodes, edges }
}

/**
 * IF example: fetch Shanghai weather; if temperature > 25, delegate to an agent
 * to summarize; otherwise output a short note. Demonstrates real true/false
 * branch routing.
 */
/** 定时新闻摘要：schedule → python 拉取 AIHOT 热点 → agent 总结 → 输出。 */
const NEWS_PY = [
  'import json, urllib.request',
  "req = urllib.request.Request('https://aihot.virxact.com/api/v1/items?mode=selected&window=7d&limit=10', headers={'User-Agent': 'aihot-skill/1.5.4'})",
  'try:',
  '  with urllib.request.urlopen(req, timeout=20) as r:',
  '    data = json.load(r)',
  "  items = data.get('items') or data.get('data') or []",
  '  lines = []',
  '  for it in items[:8]:',
  "    t = it.get('title', '')",
  "    s = it.get('summary', '')",
  "    src = (it.get('source') or {}).get('name', '')",
  "    link = (it.get('links') or {}).get('aihot', '')",
  '    lines.append(f"[{src}] {t}\\n   {s}\\n   {link}")',
  "  print('\\n'.join(lines) or 'no data')",
  'except Exception as e:',
  "  print('news fetch failed: ' + str(e))",
].join('\n')

export function buildNewsExample(): WorkflowDocument {
  const nodes: WorkflowNode[] = [
    { id: 'n-trig', type: 'workflow', position: { x: 20, y: 220 }, data: { kind: 'schedule', label: '每日定时', cron: '30 8 * * *', text: '抓取今天 AI 热点并总结' } },
    { id: 'n-fetch', type: 'workflow', position: { x: 230, y: 220 }, data: { kind: 'code', label: '拉取新闻', language: 'python', code: NEWS_PY } },
    {
      id: 'n-agent', type: 'workflow', position: { x: 470, y: 220 },
      data: { kind: 'agent', label: '总结新闻', prompt: '请把下面的 AI 热点整理成一段简洁的中文简报，按重要度排序，每条只保留标题和一句摘要，不要罗列原始 JSON。' },
    },
    { id: 'n-out', type: 'workflow', position: { x: 730, y: 220 }, data: { kind: 'output', label: '输出', template: '{{result}}' } },
  ]
  const edges: WorkflowEdge[] = [
    { id: 'ne1', source: 'n-trig', target: 'n-fetch' },
    { id: 'ne2', source: 'n-fetch', target: 'n-agent' },
    { id: 'ne3', source: 'n-agent', target: 'n-out' },
  ]
  return { version: 1, name: '定时 · 新闻摘要', description: '每天 08:30 python 拉取 AIHOT 热点 → agent 总结 → 输出', nodes, edges }
}

/** 通用条件分流：code 生成一个数 → If >10 → true/false 两个输出。 */
export function buildBasicIfExample(): WorkflowDocument {
  const nodes: WorkflowNode[] = [
    { id: 'b-trig', type: 'workflow', position: { x: 20, y: 240 }, data: { kind: 'trigger', label: '入口', text: '判断一个数是否大于 10' } },
    { id: 'b-code', type: 'workflow', position: { x: 200, y: 240 }, data: { kind: 'code', label: '生成一个数', language: 'typescript', code: 'return JSON.stringify({ n: 15 })' } },
    { id: 'b-if', type: 'workflow', position: { x: 400, y: 240 }, data: { kind: 'if', label: '大于10?', condition: 'Number(JSON.parse(result).n) > 10' } },
    { id: 'b-true', type: 'workflow', position: { x: 620, y: 100 }, data: { kind: 'output', label: '大于10', template: '这个数 {{result}} 大于 10' } },
    { id: 'b-false', type: 'workflow', position: { x: 620, y: 360 }, data: { kind: 'output', label: '≤10', template: '这个数 {{result}} 小于等于 10' } },
  ]
  const edges: WorkflowEdge[] = [
    { id: 'be1', source: 'b-trig', target: 'b-code' },
    { id: 'be2', source: 'b-code', target: 'b-if' },
    { id: 'be3', source: 'b-if', target: 'b-true', sourceHandle: 'true' },
    { id: 'be4', source: 'b-if', target: 'b-false', sourceHandle: 'false' },
  ]
  return { version: 1, name: 'If 分流', description: '生成一个数，大于10 走 true、否则走 false（改 code 里的数字可测另一条分支）', nodes, edges }
}

/** AI 问答·判断：agent 回答后，If 判断回答是否提到 "AI" 走不同分支。 */
export function buildQaIfExample(): WorkflowDocument {
  const nodes: WorkflowNode[] = [
    { id: 'q-trig', type: 'workflow', position: { x: 20, y: 240 }, data: { kind: 'trigger', label: '问题', text: '请回答：最近 AI 有什么热点？' } },
    { id: 'q-agent', type: 'workflow', position: { x: 220, y: 240 }, data: { kind: 'agent', label: 'AI 回答', prompt: '用一句话回答用户的问题。' } },
    { id: 'q-if', type: 'workflow', position: { x: 470, y: 240 }, data: { kind: 'if', label: '提到AI?', condition: 'result.includes("AI")' } },
    { id: 'q-yes', type: 'workflow', position: { x: 700, y: 100 }, data: { kind: 'output', label: '提到AI', template: '回答提到 AI：{{result}}' } },
    { id: 'q-no', type: 'workflow', position: { x: 700, y: 360 }, data: { kind: 'output', label: '没提AI', template: '回答没提 AI：{{result}}' } },
  ]
  const edges: WorkflowEdge[] = [
    { id: 'qe1', source: 'q-trig', target: 'q-agent' },
    { id: 'qe2', source: 'q-agent', target: 'q-if' },
    { id: 'qe3', source: 'q-if', target: 'q-yes', sourceHandle: 'true' },
    { id: 'qe4', source: 'q-if', target: 'q-no', sourceHandle: 'false' },
  ]
  return { version: 1, name: 'AI 问答·判断', description: 'agent 回答后，if 判断是否提到 "AI" 并走不同分支', nodes, edges }
}

/** 日常 Switch：按当前时段（早上/下午/晚上）路由到不同问候。 */
export function buildDailySwitchExample(): WorkflowDocument {
  const nodes: WorkflowNode[] = [
    { id: 'd-trig', type: 'workflow', position: { x: 20, y: 240 }, data: { kind: 'trigger', label: '问候', text: '按当前时间给问候' } },
    { id: 'd-code', type: 'workflow', position: { x: 200, y: 240 }, data: { kind: 'code', label: '取时段', language: 'typescript', code: "const h = new Date().getHours(); const label = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; return label" } },
    { id: 'd-sw', type: 'workflow', position: { x: 420, y: 240 }, data: { kind: 'switch', label: '按时段', condition: 'result', cases: 'morning, afternoon, evening' } },
    { id: 'd-m', type: 'workflow', position: { x: 660, y: 60 }, data: { kind: 'output', label: '早上', template: '早上好 ☀️，新的一天开始啦' } },
    { id: 'd-a', type: 'workflow', position: { x: 660, y: 220 }, data: { kind: 'output', label: '下午', template: '下午好 ☕，继续加油' } },
    { id: 'd-e', type: 'workflow', position: { x: 660, y: 380 }, data: { kind: 'output', label: '晚上', template: '晚上好 🌙，今天辛苦了' } },
    { id: 'd-def', type: 'workflow', position: { x: 660, y: 520 }, data: { kind: 'output', label: '其它', template: '你好' } },
  ]
  const edges: WorkflowEdge[] = [
    { id: 'de1', source: 'd-trig', target: 'd-code' },
    { id: 'de2', source: 'd-code', target: 'd-sw' },
    { id: 'de3', source: 'd-sw', target: 'd-m', sourceHandle: 'morning' },
    { id: 'de4', source: 'd-sw', target: 'd-a', sourceHandle: 'afternoon' },
    { id: 'de5', source: 'd-sw', target: 'd-e', sourceHandle: 'evening' },
    { id: 'de6', source: 'd-sw', target: 'd-def', sourceHandle: 'default' },
  ]
  return { version: 1, name: 'Switch · 时段问候', description: '按当前时段（早上/下午/晚上）路由到不同问候', nodes, edges }
}

/** Loop 示例：遍历一批热点，按是否含 "AI" 分流到 agent 深入或直接跳过，并收集每轮结果。 */
export function buildLoopExample(): WorkflowDocument {
  const nodes: WorkflowNode[] = [
    { id: 'lp-trig', type: 'workflow', position: { x: 20, y: 240 }, data: { kind: 'trigger', label: '热点列表', text: '["AI 大模型再突破","芯片供应回暖","开源社区新进展"]' } },
    { id: 'lp-loop', type: 'workflow', position: { x: 220, y: 240 }, data: { kind: 'loop', label: '遍历热点', mode: 'items', itemsExpr: 'JSON.parse(result)', maxIters: '100', collect: true } },
    { id: 'lp-code', type: 'workflow', position: { x: 440, y: 240 }, data: { kind: 'code', label: '读取本条', language: 'typescript', code: ['const it = await dsh.input(null)', 'return String(it)'].join('\n') } },
    { id: 'lp-if', type: 'workflow', position: { x: 660, y: 240 }, data: { kind: 'if', label: '含AI?', condition: 'result.includes("AI")' } },
    {
      id: 'lp-agent', type: 'workflow', position: { x: 880, y: 120 },
      data: { kind: 'agent', label: '深入总结', prompt: '请把这条科技热点用一句话总结清楚，包含核心信息，不要罗列原始 JSON。' },
    },
    { id: 'lp-out-agent', type: 'workflow', position: { x: 1100, y: 120 }, data: { kind: 'output', label: 'AI 条目', template: 'AI → {{result}}' } },
    { id: 'lp-out-skip', type: 'workflow', position: { x: 880, y: 380 }, data: { kind: 'output', label: '跳过', template: '跳过(非AI) → {{result}}' } },
    { id: 'lp-out-done', type: 'workflow', position: { x: 220, y: 480 }, data: { kind: 'output', label: '全部结果', template: '{{result}}' } },
  ]
  const edges: WorkflowEdge[] = [
    { id: 'lpe1', source: 'lp-trig', target: 'lp-loop', targetHandle: 'in' },
    { id: 'lpe2', source: 'lp-loop', target: 'lp-code', sourceHandle: 'iterate' },
    { id: 'lpe3', source: 'lp-code', target: 'lp-if' },
    { id: 'lpe4', source: 'lp-if', target: 'lp-agent', sourceHandle: 'true' },
    { id: 'lpe5', source: 'lp-if', target: 'lp-out-skip', sourceHandle: 'false' },
    { id: 'lpe6', source: 'lp-agent', target: 'lp-out-agent' },
    { id: 'lpe7', source: 'lp-out-agent', target: 'lp-loop', targetHandle: 'again' },
    { id: 'lpe8', source: 'lp-out-skip', target: 'lp-loop', targetHandle: 'again' },
    { id: 'lpe9', source: 'lp-loop', target: 'lp-out-done', sourceHandle: 'done' },
  ]
  return { version: 1, name: 'Loop · 批量处理热点', description: '遍历热点列表 → 含 AI 的交 agent 深入、否则跳过 → 收集每轮结果', nodes, edges }
}

/** While 示例：用字符串状态（待处理→处理中→完成）做判断，直到状态变为"完成"才停。 */
export function buildWhileExample(): WorkflowDocument {
  const nodes: WorkflowNode[] = [
    { id: 'wh-trig', type: 'workflow', position: { x: 20, y: 240 }, data: { kind: 'trigger', label: '初始状态', text: '待处理' } },
    { id: 'wh-while', type: 'workflow', position: { x: 220, y: 240 }, data: { kind: 'while', label: '直到完成', condition: 'result !== "完成"', maxIters: '100', collect: true } },
    {
      id: 'wh-code', type: 'workflow', position: { x: 440, y: 240 },
      data: { kind: 'code', label: '状态机', language: 'typescript', code: ['const s = await dsh.input(null)', "if (s === '待处理') return '处理中'", "if (s === '处理中') return '完成'", 'return s'].join('\n') },
    },
    { id: 'wh-if', type: 'workflow', position: { x: 660, y: 240 }, data: { kind: 'if', label: '是否处理中?', condition: 'result === "处理中"' } },
    { id: 'wh-out', type: 'workflow', position: { x: 220, y: 480 }, data: { kind: 'output', label: '状态推进', template: '状态推进: {{result}}' } },
  ]
  const edges: WorkflowEdge[] = [
    { id: 'whe1', source: 'wh-trig', target: 'wh-while', targetHandle: 'in' },
    { id: 'whe2', source: 'wh-while', target: 'wh-code', sourceHandle: 'iterate' },
    { id: 'whe3', source: 'wh-code', target: 'wh-if' },
    { id: 'whe4', source: 'wh-if', target: 'wh-while', sourceHandle: 'true', targetHandle: 'again' },
    { id: 'whe5', source: 'wh-if', target: 'wh-while', sourceHandle: 'false', targetHandle: 'again' },
    { id: 'whe6', source: 'wh-while', target: 'wh-out', sourceHandle: 'done' },
  ]
  return { version: 1, name: 'While · 状态轮询', description: '用字符串状态(待处理→处理中→完成)判断，直到状态变为"完成"才停，收集每次推进', nodes, edges }
}
