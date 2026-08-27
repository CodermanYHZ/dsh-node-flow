/**
 * Inspector panel for the selected node — edits kind-specific fields.
 *
 * @module components/Inspector
 */

import { useEffect, useState } from 'react'
import { useCanvasStore } from '../store/canvas.js'
import { CodeEditor } from './CodeEditor.js'
import { CodeEditorModal } from './CodeEditorModal.js'
import expandArrowsIcon from '../assets/icons/expand-arrows-alt.svg'
import type { WorkflowNodeData } from '../model.js'

type AgentModel = { provider: string; id: string; name: string }

/** Short deterministic hash so one schedule node can host several cron times. */
function hashCron(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

const KIND_LABELS: Record<WorkflowNodeData['kind'], string> = {
  trigger: 'Trigger',
  schedule: 'Schedule',
  agent: 'Sub-agent',
  if: 'If',
  switch: 'Switch',
  loop: 'Loop',
  while: 'While',
  code: 'Code',
  output: 'Output',
  note: 'Note',
}

export function Inspector() {
  const selectedId = useCanvasStore((s) => s.selectedId)
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === s.selectedId))
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const [codeExpanded, setCodeExpanded] = useState(false)
  const [agentModels, setAgentModels] = useState<AgentModel[]>([])

  // Load the available model routes once (for the agent-node model dropdown).
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/dsh-node-flow/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        const data = (await res.json().catch(() => ({}))) as { models?: AgentModel[] }
        if (!cancelled) setAgentModels(Array.isArray(data.models) ? data.models : [])
      } catch {
        if (!cancelled) setAgentModels([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (!node) {
    return (
      <aside className="wf-inspector wf-inspector--empty">
        <p>Select a node to configure it.</p>
      </aside>
    )
  }
  const d = node.data

  const saveSchedule = async (): Promise<void> => {
    if (!d.cron?.trim()) {
      alert('请先填写 Cron 表达式（例如 30 7 * * *）')
      return
    }
    try {
      const store = useCanvasStore.getState()
      const steps = store.toSteps()
      const doc = store.exportDocument()
      const res = await fetch('/dsh-node-flow/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: `wf-${node.id}-${hashCron(d.cron)}`,
          name: doc.name || 'scheduled workflow',
          cron: d.cron,
          input: d.text ?? '',
          steps,
          doc,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) alert(data.error ?? '保存计划失败')
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <aside className="wf-inspector">
      <header className="wf-inspector__head">
        <strong>{KIND_LABELS[d.kind]}</strong>
        <button className="wf-btn wf-btn--danger" onClick={() => removeNode(node.id)}>
          Delete
        </button>
      </header>

      <label className="wf-field">
        <span>Label</span>
        <input
          value={d.label}
          onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
        />
      </label>

      {d.kind === 'note' && (
        <label className="wf-field">
          <span>备注</span>
          <textarea
            rows={5}
            placeholder="这个备注不会参与执行，只做说明"
            value={d.text ?? ''}
            onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
          />
        </label>
      )}

      {d.kind === 'trigger' && (
        <label className="wf-field">
          <span>Trigger text</span>
          <textarea
            rows={4}
            placeholder="输入要交给 agent 的任务文字（会传到下游 agent）"
            value={d.text ?? ''}
            onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
          />
        </label>
      )}

      {d.kind === 'schedule' && (
        <>
          <label className="wf-field">
            <span>任务文字（可选）</span>
            <textarea
              rows={2}
              placeholder="这条定时任务的触发内容（可选）"
              value={d.text ?? ''}
              onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
            />
          </label>
          <div className="wf-trigger-schedule">
            <label className="wf-field">
              <span>定时 Cron (5段)</span>
              <input
                placeholder="30 7 * * *  (分 时 日 月 周)"
                value={d.cron ?? ''}
                onChange={(e) => updateNodeData(node.id, { cron: e.target.value })}
              />
            </label>
            <label className="wf-field">
              <span>时区</span>
              <input
                placeholder="Asia/Shanghai（留空=系统时区）"
                value={d.timezone ?? ''}
                onChange={(e) => updateNodeData(node.id, { timezone: e.target.value })}
              />
            </label>
            <div className="wf-trigger-schedule__actions">
              <button className="wf-btn wf-btn--primary" onClick={() => void saveSchedule()}>
                保存定时
              </button>
            </div>
          </div>
        </>
      )}

      {d.kind === 'agent' && (
        <>
          <label className="wf-field">
            <span>模型</span>
            <select value={d.model ?? ''} onChange={(e) => updateNodeData(node.id, { model: e.target.value })}>
              <option value="">官方默认（继承）</option>
              {agentModels.map((m) => (
                <option key={`${m.provider}|${m.id}`} value={`${m.provider}|${m.id}`}>
                  {m.name}（{m.provider}）
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field">
            <span>system prompt</span>
            <textarea
              rows={3}
              value={d.prompt ?? ''}
              onChange={(e) => updateNodeData(node.id, { prompt: e.target.value })}
            />
          </label>
          <label className="wf-field">
            <span>运行超时（秒，留空=不限制）</span>
            <input
              placeholder="例如 60"
              value={d.timeout ?? ''}
              onChange={(e) => updateNodeData(node.id, { timeout: e.target.value })}
            />
          </label>
          <label className="wf-field">
            <span>失败时行为</span>
            <select value={d.onError ?? 'stop'} onChange={(e) => updateNodeData(node.id, { onError: e.target.value })}>
              <option value="stop">停止分支</option>
              <option value="continue">继续用空值</option>
            </select>
          </label>
        </>
      )}

      {d.kind === 'if' && (
        <label className="wf-field">
          <span>Condition</span>
          <input
            placeholder="比如 result.ok === true；true 走上输出、false 走下输出"
            value={d.condition ?? ''}
            onChange={(e) => updateNodeData(node.id, { condition: e.target.value })}
          />
        </label>
      )}

      {d.kind === 'switch' && (
        <>
          <label className="wf-field">
            <span>判断表达式（值）</span>
            <input
              placeholder="比如 result.kind"
              value={d.condition ?? ''}
              onChange={(e) => updateNodeData(node.id, { condition: e.target.value })}
            />
          </label>
          <label className="wf-field">
            <span>Case（逗号分隔，对应右侧输出口）</span>
            <input
              placeholder="a, b, c（default 口兜底）"
              value={d.cases ?? ''}
              onChange={(e) => updateNodeData(node.id, { cases: e.target.value })}
            />
          </label>
        </>
      )}

      {d.kind === 'output' && (
        <label className="wf-field">
          <span>Template</span>
          <textarea
            rows={3}
            placeholder="留空=直接显示上一节点结果；或填 结果: {{result}}"
            value={d.template ?? ''}
            onChange={(e) => updateNodeData(node.id, { template: e.target.value })}
          />
        </label>
      )}

      {d.kind === 'loop' && (
        <>
          <label className="wf-field">
            <span>循环方式</span>
            <select value={d.mode ?? 'items'} onChange={(e) => updateNodeData(node.id, { mode: e.target.value })}>
              <option value="items">遍历数组 (items)</option>
              <option value="count">固定次数 (count)</option>
            </select>
          </label>
          {d.mode === 'count' ? (
            <label className="wf-field">
              <span>次数</span>
              <input
                placeholder="例如 5"
                value={d.count ?? ''}
                onChange={(e) => updateNodeData(node.id, { count: e.target.value })}
              />
            </label>
          ) : (
            <label className="wf-field">
              <span>数组表达式（用 result 表示上游结果）</span>
              <input
                placeholder="例如 JSON.parse(result)"
                value={d.itemsExpr ?? ''}
                onChange={(e) => updateNodeData(node.id, { itemsExpr: e.target.value })}
              />
            </label>
          )}
          <label className="wf-field">
            <span>次数上限 maxIters</span>
            <input
              placeholder="100"
              value={d.maxIters ?? ''}
              onChange={(e) => updateNodeData(node.id, { maxIters: e.target.value })}
            />
          </label>
          <label className="wf-field wf-field--checkbox">
            <input
              type="checkbox"
              checked={d.collect ?? false}
              onChange={(e) => updateNodeData(node.id, { collect: e.target.checked })}
            />
            <span>收集每轮结果成数组</span>
          </label>
        </>
      )}

      {d.kind === 'while' && (
        <>
          <label className="wf-field">
            <span>继续条件（用 result 表示当前值）</span>
            <input
              placeholder="例如 Number(result) < 5"
              value={d.condition ?? ''}
              onChange={(e) => updateNodeData(node.id, { condition: e.target.value })}
            />
          </label>
          <label className="wf-field">
            <span>次数上限 maxIters</span>
            <input
              placeholder="100"
              value={d.maxIters ?? ''}
              onChange={(e) => updateNodeData(node.id, { maxIters: e.target.value })}
            />
          </label>
          <label className="wf-field wf-field--checkbox">
            <input
              type="checkbox"
              checked={d.collect ?? false}
              onChange={(e) => updateNodeData(node.id, { collect: e.target.checked })}
            />
            <span>收集每轮结果成数组</span>
          </label>
        </>
      )}

      {d.kind === 'code' && (
        <>
          <label className="wf-field">
            <span>运行超时（秒，留空=不限制）</span>
            <input
              placeholder="例如 30"
              value={d.timeout ?? ''}
              onChange={(e) => updateNodeData(node.id, { timeout: e.target.value })}
            />
          </label>
          <label className="wf-field">
            <span>失败时行为</span>
            <select value={d.onError ?? 'stop'} onChange={(e) => updateNodeData(node.id, { onError: e.target.value })}>
              <option value="stop">停止分支</option>
              <option value="continue">继续用空值</option>
            </select>
          </label>
          <div className="wf-codecard">
            <div className="wf-codecard__head">
            <span className="wf-codecard__title">Code</span>
            <select
              className="wf-codecard__lang"
              value={d.language ?? 'typescript'}
              onChange={(e) => updateNodeData(node.id, { language: e.target.value, lastRun: undefined })}
            >
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
            </select>
          </div>
          <div className="wf-codecard__editor">
            <CodeEditor
              value={d.code ?? ''}
              onChange={(v) => updateNodeData(node.id, { code: v, lastRun: undefined })}
              language={d.language ?? 'typescript'}
            />
            <button
              type="button"
              className="wf-ed-expand"
              onClick={() => setCodeExpanded(true)}
              title="全屏编辑"
              aria-label="全屏编辑代码"
            >
              <img className="wf-icon-image" src={expandArrowsIcon} alt="" aria-hidden="true" />
            </button>
          </div>
          </div>
        </>
      )}

      {codeExpanded && (
        <CodeEditorModal
          value={d.code ?? ''}
          onChange={(v) => updateNodeData(node.id, { code: v, lastRun: undefined })}
          language={d.language ?? 'typescript'}
          onClose={() => setCodeExpanded(false)}
        />
      )}

      {d.lastRun && (
        <div className="wf-run">
          {d.kind !== 'output' && d.kind !== 'trigger' && d.lastRun.input !== undefined && d.lastRun.input !== '' && (
            <label className="wf-field">
              <span>输入 Input</span>
              <textarea className="wf-run__box" readOnly rows={3} value={d.lastRun.input} />
            </label>
          )}
          {d.kind !== 'trigger' && d.kind !== 'schedule' && d.lastRun.value !== undefined && (
            <label className="wf-field">
              <span>输出 Output</span>
              <textarea
                className="wf-run__box"
                readOnly
                rows={5}
                value={
                  typeof d.lastRun.value === 'string'
                    ? d.lastRun.value
                    : JSON.stringify(d.lastRun.value)
                }
              />
            </label>
          )}
          {d.lastRun.logs && d.lastRun.logs.length > 0 && (
            <label className="wf-field">
              <span>日志 Logs</span>
              <pre className="wf-result__logs">{d.lastRun.logs.join('\n')}</pre>
            </label>
          )}
          {d.lastRun.error && (
            <label className="wf-field">
              <span>错误 Error</span>
              <pre className="wf-result__error">{d.lastRun.error}</pre>
            </label>
          )}
        </div>
      )}

      <label className="wf-field">
        <span>Notes</span>
        <input
          value={d.notes ?? ''}
          onChange={(e) => updateNodeData(node.id, { notes: e.target.value })}
        />
      </label>
    </aside>
  )
}
