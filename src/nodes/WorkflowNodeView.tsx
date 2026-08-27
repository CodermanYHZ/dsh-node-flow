/**
 * A single workflow node card rendered on the canvas.
 *
 * Most nodes render as a rounded square (icon on top, label + summary below);
 * the agent node stays a wider rounded rectangle. After a run, the node's
 * outer border turns green (success) or red (failure) — no checkmark — and an
 * amber border shows while running. The node's elapsed time appears in the
 * top-left corner, its run time in the bottom-right.
 *
 * IF and SWITCH nodes render extra source handles so the flow can branch:
 * IF → "true" / "false"; SWITCH → one per configured case, plus "default".
 *
 * @module nodes/WorkflowNodeView
 */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { WorkflowNode, WorkflowNodeType } from '../model.js'
import { NODE_SIZE } from '../model.js'

const KIND_META: Record<WorkflowNodeType, { color: string; icon: string; tag: string }> = {
  trigger: { color: '#34d399', icon: '▶', tag: 'TRIGGER' },
  schedule: { color: '#fb923c', icon: '⏰', tag: 'SCHEDULE' },
  agent: { color: '#a78bfa', icon: '🤖', tag: 'AGENT' },
  if: { color: '#fbbf24', icon: '◇', tag: 'IF' },
  switch: { color: '#f472b6', icon: '⋔', tag: 'SWITCH' },
  loop: { color: '#38bdf8', icon: '⟳', tag: 'LOOP' },
  while: { color: '#f59e0b', icon: '↻', tag: 'WHILE' },
  code: { color: '#2dd4bf', icon: '</>', tag: 'CODE' },
  output: { color: '#f87171', icon: '✓', tag: 'OUTPUT' },
  note: { color: '#fcd34d', icon: '📝', tag: 'NOTE' },
}

const HANDLE = 'wf-handle wf-handle--branch'

export function WorkflowNodeView({ data, selected }: NodeProps<WorkflowNode>) {
  const meta = KIND_META[data.kind]
  const runState = data.lastRun
    ? data.lastRun.running
      ? 'running'
      : data.lastRun.error
        ? 'error'
        : 'ok'
    : ''

  // Branch source handles for IF / SWITCH (stacked on the right edge).
  const branches: Array<{ id: string; label: string; top: string }> = []
  // Loop / While re-entry targets (stacked on the left edge).
  const targets: Array<{ id: string; label: string; top: string }> = []
  if (data.kind === 'if') {
    branches.push(
      { id: 'true', label: 'true', top: '32%' },
      { id: 'false', label: 'false', top: '68%' },
    )
  } else if (data.kind === 'switch') {
    const cases = (data.cases ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const n = Math.max(cases.length, 1)
    cases.forEach((c, i) => branches.push({ id: c, label: c, top: `${28 + i * ((58 - 10) / n)}%` }))
    branches.push({ id: 'default', label: 'default', top: '88%' })
  } else if (data.kind === 'loop' || data.kind === 'while') {
    branches.push(
      { id: 'iterate', label: 'iterate', top: '32%' },
      { id: 'done', label: 'done', top: '68%' },
    )
    targets.push(
      { id: 'in', label: 'in', top: '32%' },
      { id: 'again', label: 'back', top: '68%' },
    )
  }
  const isBranch = data.kind === 'if' || data.kind === 'switch' || data.kind === 'loop' || data.kind === 'while'
  const isLoop = data.kind === 'loop' || data.kind === 'while'

  const cls = [
    'wf-node',
    `wf-node--${data.kind}`,
    selected ? 'wf-node--selected' : '',
    runState ? `wf-node--${runState}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const size = NODE_SIZE[data.kind]

  return (
    <div
      className={cls}
      style={{
        ['--kind' as string]: meta.color,
        width: size.width,
        height: size.height,
      }}
    >
      {data.kind === 'note' ? (
        <div className="wf-node__note">
          <span className="wf-node__note-icon">📝</span>
          <div className="wf-node__note-text">{data.text || '点选编辑这个备注'}</div>
        </div>
      ) : (
        <>
          {data.lastRun?.duration != null && (
            <span className="wf-node__duration">{data.lastRun.duration}ms</span>
          )}
          {data.lastRun?.at && (
            <span className="wf-node__timenote">{data.lastRun.at}</span>
          )}
          <div className="wf-node__icon" style={{ background: meta.color }}>
            {meta.icon}
          </div>
          <div className="wf-node__label">{data.label}</div>
          {isLoop ? (
            targets.map((t) => (
              <Handle key={`h-${t.id}`} type="target" position={Position.Left} id={t.id} style={{ top: t.top }} className="wf-handle" />
            ))
          ) : (
            <Handle type="target" position={Position.Left} className="wf-handle" />
          )}
          {!isBranch && <Handle type="source" position={Position.Right} className="wf-handle" />}
          {branches.map((b) => (
            <Handle key={`h-${b.id}`} type="source" position={Position.Right} id={b.id} style={{ top: b.top }} className={HANDLE} />
          ))}
          {branches.map((b) => (
            <span key={`l-${b.id}`} className="wf-node__branch-label" style={{ top: b.top }}>
              {b.label}
            </span>
          ))}
          {targets.map((t) => (
            <span key={`tl-${t.id}`} className="wf-node__branch-label wf-node__branch-label--left" style={{ top: t.top }}>
              {t.label}
            </span>
          ))}
        </>
      )}
    </div>
  )
}
