/**
 * Left-side node palette drawer. List node types grouped by category; drag an
 * item onto the canvas to place it there (or click to add at a random spot).
 * Saved workflows live in the separate 📂 工作流 drawer.
 *
 * @module components/NodePalette
 */

import { useCanvasStore } from '../store/canvas.js'
import type { WorkflowNodeType } from '../model.js'

interface Item {
  kind: WorkflowNodeType
  label: string
  icon: string
  color: string
}

const GROUPS: Array<{ group: string; items: Item[] }> = [
  {
    group: '触发',
    items: [
      { kind: 'trigger', label: '触发器', icon: '▶', color: '#34d399' },
      { kind: 'schedule', label: '定时触发', icon: '⏰', color: '#fb923c' },
      { kind: 'listen', label: '监听', icon: '📡', color: '#38bdf8' },
    ],
  },
  {
    group: '处理',
    items: [
      { kind: 'agent', label: 'Agent', icon: '🤖', color: '#a78bfa' },
      { kind: 'code', label: 'Python 脚本', icon: '</>', color: '#2dd4bf' },
      { kind: 'output', label: '输出', icon: '✓', color: '#f87171' },
    ],
  },
  {
    group: '逻辑',
    items: [
      { kind: 'if', label: 'If', icon: '◇', color: '#fbbf24' },
      { kind: 'switch', label: 'Switch', icon: '⋔', color: '#f472b6' },
      { kind: 'loop', label: 'Loop', icon: '⟳', color: '#38bdf8' },
      { kind: 'while', label: 'While', icon: '↻', color: '#f59e0b' },
    ],
  },
  {
    group: '注释',
    items: [{ kind: 'note', label: '备注', icon: '📝', color: '#fcd34d' }],
  },
]

export function NodePalette() {
  const addNodeAt = useCanvasStore((s) => s.addNodeAt)

  return (
    <div className="wf-palette">
      <div className="wf-palette__body">
        {GROUPS.map((g) => (
          <div key={g.group} className="wf-palette__group">
            <div className="wf-palette__group-title">{g.group}</div>
            {g.items.map((it) => (
              <div
                key={it.kind}
                className="wf-palette__item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', it.kind)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() =>
                  addNodeAt(it.kind, it.label, { x: 160 + Math.random() * 240, y: 120 + Math.random() * 240 })
                }
              >
                <span className="wf-palette__icon" style={{ background: it.color }}>
                  {it.icon}
                </span>
                <span className="wf-palette__label">{it.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="wf-palette__hint">拖到右侧画布，或点击添加</div>
    </div>
  )
}
