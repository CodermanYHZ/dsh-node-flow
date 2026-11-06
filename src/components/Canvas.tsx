/**
 * Main canvas — React Flow wrapper wiring the store to the renderer.
 *
 * @module components/Canvas
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant } from '@xyflow/react'
// The plugin bundle inlines this stylesheet once (see scripts/build-client.mjs);
// the standalone Vite demo needs this import. esbuild drops it as a bare import.
import './canvas.css'
import { useCanvasStore } from '../store/canvas.js'
import type { WorkflowNodeType } from '../model.js'
import { WorkflowNodeView } from '../nodes/WorkflowNodeView.js'
import { Toolbar } from './Toolbar.js'
import { Inspector } from './Inspector.js'
import { NodePalette } from './NodePalette.js'
import { WorkflowLibrary, WORKFLOW_DRAG_TYPE, loadWorkflowFile } from './WorkflowLibrary.js'

const nodeTypes = { workflow: WorkflowNodeView }

const DEFAULT_LABELS: Record<string, string> = {
  trigger: '触发器',
  schedule: '定时触发',
  listen: '监听',
  agent: 'Agent',
  code: 'Python 脚本',
  output: '输出',
  if: 'If',
  switch: 'Switch',
  loop: 'Loop',
  while: 'While',
  note: '备注',
}

type RFInstance = { screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } }

export function Canvas({ onExitNodeMode }: { onExitNodeMode?: () => void } = {}) {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const activeEdgeIds = useCanvasStore((s) => s.activeEdgeIds)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const select = useCanvasStore((s) => s.select)
  const selectEdge = useCanvasStore((s) => s.selectEdge)
  const addNodeAt = useCanvasStore((s) => s.addNodeAt)
  const selectedId = useCanvasStore((s) => s.selectedId)
  const viewingRun = useCanvasStore((s) => s.viewingRun)
  const exitRunView = useCanvasStore((s) => s.exitRunView)
  const [openPanel, setOpenPanel] = useState<'nodes' | 'workflows' | null>(null)
  const rfRef = useRef<RFInstance | null>(null)
  const renderedEdges = useMemo(() => {
    const activeIds = new Set(activeEdgeIds)
    return edges.map((edge) => {
      const classes = (edge.className ?? '')
        .split(/\s+/)
        .filter((className) => className && className !== 'wf-edge--active')
      if (activeIds.has(edge.id)) classes.push('wf-edge--active')
      return { ...edge, className: classes.join(' ') || undefined }
    })
  }, [activeEdgeIds, edges])

  // Delete / Backspace removes the selected edge, else the selected node.
  // Guarded so it never fires while typing in an input/textarea/select or a contenteditable.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return
      }
      const store = useCanvasStore.getState()
      if (store.selectedEdgeId) {
        e.preventDefault()
        store.removeEdge(store.selectedEdgeId)
      } else if (store.selectedId) {
        e.preventDefault()
        store.removeNode(store.selectedId)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const workflowId = e.dataTransfer.getData(WORKFLOW_DRAG_TYPE)
    if (workflowId) {
      void loadWorkflowFile(workflowId)
      return
    }
    const kind = e.dataTransfer.getData('application/reactflow') as WorkflowNodeType
    if (!kind || !rfRef.current) return
    const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNodeAt(kind, DEFAULT_LABELS[kind] ?? kind, pos)
  }

  return (
    <div className="wf-shell">
      <Toolbar onExitNodeMode={onExitNodeMode} />
      <div className="wf-main">
        <div className="wf-canvas">
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: selNodes, edges: selEdges }) => {
              if (selNodes.length > 0) {
                select(selNodes[0].id)
              } else if (selEdges.length > 0) {
                selectEdge(selEdges[0].id)
              } else {
                select(null)
              }
            }}
            onPaneClick={() => select(null)}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onInit={(inst) => {
              rfRef.current = inst as unknown as RFInstance
            }}
            fitView
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const kinds: Record<string, string> = {
                  trigger: '#10b981', schedule: '#fb923c', agent: '#8b5cf6',
                  if: '#fbbf24', switch: '#f472b6', code: '#14b8a6', output: '#ef4444',
                }
                return kinds[(n.data as { kind?: string })?.kind ?? ''] ?? '#94a3b8'
              }}
            />
          </ReactFlow>
          {viewingRun !== null && (
            <div
              className={`wf-runview wf-runview--floating wf-runview--${viewingRun.status}`}
              title={`${viewingRun.workflowName} · ${new Date(viewingRun.startedAt).toLocaleString()}`}
            >
              <span className="wf-runview__dot" aria-hidden="true" />
              <span className="wf-runview__text">
                正在查看 {new Date(viewingRun.startedAt).toLocaleString()} 的运行
              </span>
              <button className="wf-runview__exit" onClick={exitRunView}>
                返回编辑
              </button>
            </div>
          )}
          <div className="wf-canvas__tools">
            <button
              className="wf-canvas__add"
              onClick={() => setOpenPanel((v) => (v === 'nodes' ? null : 'nodes'))}
            >
              {openPanel === 'nodes' ? '✕' : '➕ 添加节点'}
            </button>
            <button
              className="wf-canvas__add"
              onClick={() => setOpenPanel((v) => (v === 'workflows' ? null : 'workflows'))}
            >
              {openPanel === 'workflows' ? '✕' : '📂 工作流'}
            </button>
          </div>
          {openPanel === 'nodes' && <NodePalette />}
          {openPanel === 'workflows' && <WorkflowLibrary />}
        </div>
        {selectedId && <Inspector />}
      </div>
    </div>
  )
}
