/**
 * Scheduled-task board — lists every saved schedule (cron workflow). Lets the
 * user view (load the workflow + its latest run result onto the canvas), run
 * once immediately, or cancel a schedule.
 *
 * @module components/ScheduleBoard
 */

import { useEffect, useState } from 'react'
import { useCanvasStore } from '../store/canvas.js'
import type { WorkflowDocument } from '../model.js'

type Schedule = {
  id: string
  name: string
  cron: string
  input?: string
  lastFired?: string
  doc?: WorkflowDocument
}

type RunNode = { id: string; kind: string; status: string; output?: unknown; logs?: string[]; error?: string; ms: number }
type Run = { id: string; scheduleId?: string; name: string; status: string; failed: number; value?: unknown; nodes: RunNode[] }

export function ScheduleBoard({ onClose }: { onClose: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setErr('')
    try {
      const [sRes, rRes] = await Promise.all([
        fetch('/dsh-node-flow/schedules').then((r) => r.json().catch(() => ({}))),
        fetch('/dsh-node-flow/runs').then((r) => r.json().catch(() => ({}))),
      ])
      setSchedules((sRes as { schedules?: Schedule[] }).schedules ?? [])
      setRuns((rRes as { runs?: Run[] }).runs ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const latestRun = (id: string): Run | undefined => runs.find((r) => r.scheduleId === id)

  // Load the workflow into the canvas and paste the latest run's per-node result
  // (green/red border + input/output in the inspector), like a completed manual run.
  const view = async (s: Schedule): Promise<void> => {
    const store = useCanvasStore.getState()
    if (s.doc) store.importDocument(s.doc)
    const run = latestRun(s.id)
    const at = new Date().toLocaleTimeString()
    for (const n of run?.nodes ?? []) {
      store.updateNodeData(n.id, {
        lastRun: { input: '', logs: n.logs ?? [], value: n.output, error: n.error, at, duration: n.ms },
      })
    }
    onClose()
  }

  const runOnce = async (s: Schedule): Promise<void> => {
    setLoading(true)
    setErr('')
    try {
      const res = await fetch('/dsh-node-flow/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'run', id: s.id }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setErr(data.error ?? '运行失败')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const cancel = async (s: Schedule): Promise<void> => {
    setLoading(true)
    setErr('')
    try {
      const res = await fetch('/dsh-node-flow/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clear', id: s.id }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setErr(data.error ?? '取消失败')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wf-schedule-board" role="dialog" aria-modal="true" aria-label="定时任务">
      <div className="wf-schedule-board__head">
        <div className="wf-schedule-board__title">定时任务</div>
        <button className="wf-schedule-board__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="wf-schedule-board__body">
        <button className="wf-btn" onClick={() => void refresh()} disabled={loading}>
          ↻ 刷新
        </button>
        {err && <div className="wf-schedule-board__err">{err}</div>}
        {schedules.length === 0 && !loading && <div className="wf-schedule-board__empty">还没有定时任务。选中一个 Schedule 节点填好 Cron 后点「保存定时」。</div>}
        {schedules.map((s) => {
          const run = latestRun(s.id)
          return (
            <div key={s.id} className="wf-schedule-board__item">
              <div className="wf-schedule-board__line">
                <span className="wf-schedule-board__name">{s.name}</span>
                <code className="wf-schedule-board__cron">{s.cron}</code>
              </div>
              <div className="wf-schedule-board__line wf-schedule-board__meta">
                <span>上次触发：{s.lastFired ?? '—'}</span>
                <span className={run && run.status === 'error' ? 'wf-schedule-board__bad wf-schedule-board__bad--err' : 'wf-schedule-board__bad'}>
                  最近运行：{run ? `${run.status}${run.failed ? `（${run.failed} 失败）` : ''}` : '—'}
                </span>
              </div>
              <div className="wf-schedule-board__actions">
                <button className="wf-btn" onClick={() => void view(s)} disabled={!s.doc}>
                  查看
                </button>
                <button className="wf-btn" onClick={() => void runOnce(s)} disabled={loading}>
                  运行一次
                </button>
                <button className="wf-btn wf-btn--danger" onClick={() => void cancel(s)} disabled={loading}>
                  取消
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
