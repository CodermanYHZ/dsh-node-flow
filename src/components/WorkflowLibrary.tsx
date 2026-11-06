/**
 * Workflow library drawer — the list of saved workflows.
 *
 * Every row is one file under `$DSH_HOME/workflow-canvas/workflows/<id>.json`.
 * Clicking a row (or dropping it on the canvas) loads that file into the canvas;
 * the toolbar's 保存 writes the canvas back to the same id. Each row's ⋯ menu
 * renames or deletes that file.
 *
 * @module components/WorkflowLibrary
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvas.js'
import type { WorkflowDocument } from '../model.js'

/** One row of `GET /dsh-node-flow/workflows`. */
interface WorkflowSummary {
  id: string
  name: string
  description?: string
  updatedAt?: string
  nodeCount: number
}

/** MIME type used when dragging a workflow row onto the canvas. */
export const WORKFLOW_DRAG_TYPE = 'application/x-dsh-workflow'

/** Load one workflow file into the canvas. */
export async function loadWorkflowFile(id: string): Promise<void> {
  const res = await fetch(`/dsh-node-flow/workflow?id=${encodeURIComponent(id)}`)
  const data = (await res.json().catch(() => ({}))) as { doc?: WorkflowDocument; error?: string }
  if (!res.ok || data.doc === undefined) throw new Error(data.error ?? `HTTP ${res.status}`)
  useCanvasStore.getState().importDocument(data.doc, id)
}

/** Where the ⋯ menu is anchored, in viewport coordinates. */
interface MenuAnchor {
  id: string
  name: string
  x: number
  y: number
}

export function WorkflowLibrary() {
  const currentId = useCanvasStore((s) => s.workflowId)
  // Bumped by the toolbar after a save: an open panel reloads its list instead
  // of showing what it fetched when it opened.
  const workflowsVersion = useCanvasStore((s) => s.workflowsVersion)
  const [rows, setRows] = useState<WorkflowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const renameInput = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await fetch('/dsh-node-flow/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const data = (await res.json().catch(() => ({}))) as { workflows?: WorkflowSummary[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRows(Array.isArray(data.workflows) ? data.workflows : [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, workflowsVersion])

  // The menu closes on any click elsewhere or Escape.
  useEffect(() => {
    if (menu === null) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    if (renaming !== null) renameInput.current?.focus()
  }, [renaming])

  const open = (id: string): void => {
    void loadWorkflowFile(id).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  const post = async (path: string, body: unknown): Promise<{ error?: string; name?: string }> => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json().catch(() => ({}))) as { error?: string; name?: string }
  }

  const commitRename = async (): Promise<void> => {
    if (renaming === null) return
    const { id, text } = renaming
    setRenaming(null)
    const trimmed = text.trim()
    if (trimmed === '') return
    try {
      const data = await post('/dsh-node-flow/workflow/rename', { id, name: trimmed })
      if (data.error !== undefined) throw new Error(data.error)
      if (id === useCanvasStore.getState().workflowId && typeof data.name === 'string') {
        useCanvasStore.getState().setWorkflowName(data.name)
      }
      setNotice(typeof data.name === 'string' && data.name !== trimmed ? `同名，已改为「${data.name}」` : '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    await refresh()
  }

  // Deleting is immediate: no confirmation dialog, the file is just removed.
  const remove = async (id: string): Promise<void> => {
    setMenu(null)
    try {
      const data = await post('/dsh-node-flow/workflow/delete', { id })
      if (data.error !== undefined) throw new Error(data.error)
      // The open canvas keeps its nodes; it just stops being tied to a file.
      if (id === useCanvasStore.getState().workflowId) useCanvasStore.getState().setWorkflowId(null)
      setNotice('已删除')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    await refresh()
  }

  return (
    <div className="wf-palette wf-palette--workflows" ref={rootRef}>
      <div className="wf-palette__body">
        {loading && rows.length === 0 && <div className="wf-palette__group-title">加载中…</div>}
        {!loading && error !== '' && <div className="wf-palette__group-title">读取失败：{error}</div>}
        {!loading && error === '' && rows.length === 0 && (
          <div className="wf-palette__group-title">还没有工作流</div>
        )}
        {rows.map((row) => (
          <div
            key={row.id}
            className={row.id === currentId ? 'wf-palette__item wf-palette__item--active' : 'wf-palette__item'}
            draggable={renaming?.id !== row.id}
            onDragStart={(e) => {
              e.dataTransfer.setData(WORKFLOW_DRAG_TYPE, row.id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => {
              if (renaming?.id === row.id) return
              open(row.id)
            }}
            title={row.description ?? row.id}
          >
            {renaming?.id === row.id ? (
              <input
                ref={renameInput}
                className="wf-wfitem__rename"
                value={renaming.text}
                onChange={(e) => setRenaming({ id: row.id, text: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                onBlur={() => void commitRename()}
                aria-label="工作流名称"
              />
            ) : (
              <span className="wf-palette__label">{row.name}</span>
            )}
            <span className="wf-wfitem__meta">{row.nodeCount}</span>
            <button
              type="button"
              className="wf-wfitem__menu"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                // Absolute inside the panel: a `fixed` popover would be trapped
                // by the panel's backdrop-filter containing block + overflow.
                const rect = e.currentTarget.getBoundingClientRect()
                const root = rootRef.current?.getBoundingClientRect()
                setMenu({
                  id: row.id,
                  name: row.name,
                  x: rect.right - (root?.left ?? 0),
                  y: rect.bottom - (root?.top ?? 0) + 4,
                })
              }}
              aria-label="更多操作"
              title="更多操作"
            >
              ⋯
            </button>
          </div>
        ))}
      </div>
      <div className="wf-palette__hint">{notice !== '' ? notice : '点击加载到画布，或拖到右侧'}</div>
      {menu !== null && (
        <div
          className="wf-wfitem__pop"
          style={{ left: Math.max(8, menu.x - 116), top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setMenu(null)
              setRenaming({ id: menu.id, text: menu.name })
            }}
          >
            重命名
          </button>
          <button type="button" className="wf-wfitem__pop-danger" onClick={() => void remove(menu.id)}>
            删除
          </button>
        </div>
      )}
    </div>
  )
}
