/**
 * Scheduled tasks — tasks first, their runs underneath.
 *
 * The layout follows the shell's own automation page (title row with the primary
 * action, status tabs, a search field, then cards). The difference is what a
 * card expands into: every stored run of that task, newest first, because each
 * run keeps its own immutable record — the canvas itself only holds each node's
 * latest result, so a run would otherwise be gone the moment the next one starts.
 *
 * Mounted through `overlayHost()` like the other page windows.
 *
 * @module components/ScheduleBoard
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCanvasStore, type StoredRun } from '../store/canvas.js'
import { overlayHost } from './overlayHost.js'

type Schedule = {
  id: string
  name: string
  cron: string
  input?: string
  status: 'active' | 'ended'
  workflowKey: string
  hasWorkflow: boolean
  lastFired?: string
  nextFire?: string
  /** Anchor already in the past: the occurrence is owed and fires on the next look. */
  overdue?: boolean
}

type RunMeta = {
  runId: string
  workflowName: string
  workflowKey: string
  scheduleId?: string
  trigger: 'manual' | 'cron' | 'listen'
  startedAt: string
  durationMs: number
  status: 'ok' | 'error'
  failed: number
  nodeCount: number
}

/** One resident listener as reported by `/dsh-node-flow/listeners`. */
type ListenerRow = {
  workflowId: string
  nodeId: string
  label: string
  enabled: boolean
  status: 'stopped' | 'running' | 'error'
  pid?: number
  startedAt?: string
  lastEventAt?: string
  fireCount: number
  droppedCount: number
  queued: number
  readyLine?: string
  lastError?: string
  lastExitCode?: number | null
}

type ListenerLogs = { logs: string[]; events: string[] }


async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data as T
}

function absolute(iso: string | undefined): string {
  if (iso === undefined) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function when(iso: string | undefined): string {
  if (iso === undefined) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = date.getTime() - Date.now()
  const label = absolute(iso)
  if (Math.abs(diff) < 60_000) return '刚刚'
  if (diff > 0 && diff < 6 * 60 * 60 * 1000) return `${label}（${Math.round(diff / 60_000)} 分钟后）`
  if (diff < 0 && diff > -6 * 60 * 60 * 1000) return `${label}（${Math.round(-diff / 60_000)} 分钟前）`
  return label
}

function seconds(ms: number): string {
  if (ms <= 0) return '0s'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function nodeOutputText(output: unknown): string {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

export function ScheduleBoard({ onClose }: { onClose: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [runs, setRuns] = useState<RunMeta[]>([])
  const [view, setView] = useState<'tasks' | 'listeners'>('tasks')
  const [listeners, setListeners] = useState<ListenerRow[]>([])
  const [listenerOpen, setListenerOpen] = useState<string | null>(null)
  const [listenerLogs, setListenerLogs] = useState<Record<string, ListenerLogs>>({})
  const [listenerRuns, setListenerRuns] = useState<Record<string, RunMeta[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<StoredRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const [scheduleData, runData, listenerData] = await Promise.all([
        postJson<{ schedules?: Schedule[] }>('/dsh-node-flow/schedules', {}),
        postJson<{ runs?: RunMeta[] }>('/dsh-node-flow/runs', { limit: 200 }),
        postJson<{ listeners?: ListenerRow[] }>('/dsh-node-flow/listeners', {}),
      ])
      setSchedules(scheduleData.schedules ?? [])
      setRuns(runData.runs ?? [])
      setListeners(listenerData.listeners ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Start / stop / restart / test one resident listener. */
  const listenerAction = async (action: 'start' | 'stop' | 'restart', row: ListenerRow): Promise<void> => {
    setError('')
    try {
      await postJson(`/dsh-node-flow/listener/${action}`, { workflowId: row.workflowId, nodeId: row.nodeId })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const loadListenerLogs = async (row: ListenerRow): Promise<void> => {
    const key = `${row.workflowId}::${row.nodeId}`
    const open = listenerOpen === key
    setListenerOpen(open ? null : key)
    if (open) return
    try {
      const [logData, runData] = await Promise.all([
        postJson<ListenerLogs>('/dsh-node-flow/listener/logs', {
          workflowId: row.workflowId,
          nodeId: row.nodeId,
        }),
        postJson<{ runs?: RunMeta[] }>('/dsh-node-flow/runs', {
          workflowId: row.workflowId,
          nodeId: row.nodeId,
          limit: 20,
        }),
      ])
      setListenerLogs((prev) => ({ ...prev, [key]: { logs: logData.logs ?? [], events: logData.events ?? [] } }))
      setListenerRuns((prev) => ({ ...prev, [key]: runData.runs ?? [] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Delete this listener's stored run records (workflow untouched). */
  const clearRuns = async (row: ListenerRow): Promise<void> => {
    setError('')
    try {
      await postJson('/dsh-node-flow/listener/runs/clear', { workflowId: row.workflowId, nodeId: row.nodeId })
      const key = `${row.workflowId}::${row.nodeId}`
      setListenerRuns((prev) => ({ ...prev, [key]: [] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Forget this listener: stop it and drop its record from the board. */
  const deleteListenerRow = async (row: ListenerRow): Promise<void> => {
    setError('')
    try {
      await postJson('/dsh-node-flow/listener/delete', { workflowId: row.workflowId, nodeId: row.nodeId })
      const key = `${row.workflowId}::${row.nodeId}`
      setListenerOpen((prev) => (prev === key ? null : prev))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // Only runs that belong to a task through `scheduleId` are listed under it.
  // A canvas ▶ run carries no task id, so it is not a scheduled run and never
  // shows up in a task's history (it stays persisted for 回放).
  const runsBySchedule = useMemo(() => {
    const map = new Map<string, RunMeta[]>()
    for (const run of runs) {
      if (run.scheduleId === undefined) continue
      const list = map.get(run.scheduleId) ?? []
      list.push(run)
      map.set(run.scheduleId, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    }
    return map
  }, [runs])

  const visible = schedules

  const taskAction = async (action: 'run' | 'clear' | 'resume' | 'delete', id: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await postJson('/dsh-node-flow/schedule', { action, id })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const openRun = async (runId: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const data = await postJson<{ run: StoredRun }>('/dsh-node-flow/run-detail', { runId })
      setDetail(data.run)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** Load this run's graph + per-node results onto the canvas, read-only. */
  const replay = (run: StoredRun): void => {
    useCanvasStore.getState().showRun(run)
    onClose()
  }

  return createPortal(
    <div className="wf-schedule-board" role="dialog" aria-label="定时 / 监听">
      <div className="wf-board__head">
        <div className="wf-board__title">
          <button
            className={`wf-task__tab${view === 'tasks' ? ' wf-task__tab--active' : ''}`}
            onClick={() => setView('tasks')}
          >
            定时
          </button>
          <button
            className={`wf-task__tab${view === 'listeners' ? ' wf-task__tab--active' : ''}`}
            onClick={() => setView('listeners')}
          >
            监听
          </button>
        </div>
        <div className="wf-board__headActions">
          <button className="wf-schedule-board__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
      </div>

      {detail !== null ? (
        <RunDetailView run={detail} onBack={() => setDetail(null)} onReplay={() => replay(detail)} />
      ) : view === 'listeners' ? (
        <>
          <div className="wf-board__tabs">
            <span className="wf-task__meta" style={{ flex: 1, paddingLeft: 6 }}>
              {listeners.filter((row) => row.status === 'running').length} 个运行中 · 共 {listeners.length} 个
            </span>
            <button className="wf-board__refresh" onClick={() => void refresh()} disabled={busy} title="刷新">
              ↻
            </button>
          </div>

          {error !== '' && <div className="wf-schedule-board__err">{error}</div>}

          <div className="wf-board__body">
            {listeners.length === 0 && (
              <div className="wf-schedule-board__empty">
                还没有监听。在画布上添加「监听」节点、写好脚本并保存工作流，然后在节点属性里点「开启监听」。
              </div>
            )}
            {listeners.map((row) => {
              const key = `${row.workflowId}::${row.nodeId}`
              const open = listenerOpen === key
              const logs = listenerLogs[key]
              return (
                <div key={key} className="wf-task">
                  <div className="wf-task__head" style={{ cursor: 'default' }}>
                    <span className={`wf-listener__dot wf-listener__dot--${row.status}`} aria-hidden="true" />
                    <span className="wf-task__name">{row.label}</span>
                    <span className={`wf-task__badge wf-task__badge--${row.status === 'running' ? 'active' : 'ended'}`}>
                      {row.status === 'running' ? `运行中${row.pid ? ` · ${row.pid}` : ''}` : row.status === 'error' ? '异常' : '已停止'}
                    </span>
                    <span className="wf-task__meta">
                      触发 {row.fireCount} · 排队 {row.queued} · 丢弃 {row.droppedCount}
                      <span className="wf-task__sep"> · </span>
                      上次 {when(row.lastEventAt)}
                    </span>
                    {row.readyLine ? <span className="wf-task__meta wf-task__cron">{row.readyLine}</span> : null}
                    {row.status === 'error' && row.lastError ? (
                      <span className="wf-task__meta">{row.lastError}</span>
                    ) : null}
                  </div>

                  <div className="wf-task__actions">
                    {row.status === 'running' ? (
                      <button className="wf-btn" onClick={() => void listenerAction('stop', row)} disabled={busy}>
                        停止
                      </button>
                    ) : (
                      <button className="wf-btn wf-btn--primary" onClick={() => void listenerAction('start', row)} disabled={busy}>
                        启动
                      </button>
                    )}
                    <button className="wf-btn" onClick={() => void listenerAction('restart', row)} disabled={busy}>
                      重启
                    </button>
                    <button className="wf-btn" onClick={() => void loadListenerLogs(row)}>
                      {open ? '收起详情' : '详情'}
                    </button>
                    <button
                      className="wf-btn wf-btn--danger"
                      onClick={() => void deleteListenerRow(row)}
                      disabled={busy}
                      title="停止并从看板移除这条监听（工作流里的节点保留）"
                    >
                      删除
                    </button>
                  </div>

                  {open && (
                    <div className="wf-task__runs">
                      {logs === undefined ? (
                        <div className="wf-task__noRuns">加载中…</div>
                      ) : (
                        <>
                          <div className="wf-runHead">
                            <span>
                              运行记录（{(listenerRuns[key] ?? []).length}）· 点一行查看节点结果 / 在画布回放
                            </span>
                            <button
                              className="wf-btn wf-btn--danger"
                              onClick={() => void clearRuns(row)}
                              disabled={busy || (listenerRuns[key] ?? []).length === 0}
                              title="删除这条监听的全部运行记录（只删记录，不删工作流）"
                            >
                              清空记录
                            </button>
                          </div>
                          {(listenerRuns[key] ?? []).length === 0 && (
                            <div className="wf-task__noRuns">还没有运行记录。</div>
                          )}
                          {(listenerRuns[key] ?? []).map((run) => (
                            <button
                              key={run.runId}
                              className="wf-runRow"
                              onClick={() => void openRun(run.runId)}
                              title="查看这次运行的节点结果"
                            >
                              <span className={`wf-runRow__status wf-runRow__status--${run.status}`}>
                                {run.status === 'ok' ? '✓' : '✕'}
                              </span>
                              <span className="wf-runRow__when">{when(run.startedAt)}</span>
                              <span className="wf-runRow__trigger">监听</span>
                              <span className="wf-runRow__nodes">
                                {run.nodeCount} 节点{run.failed > 0 ? ` · ${run.failed} 失败` : ''}
                              </span>
                              <span className="wf-runRow__ms">{seconds(run.durationMs)}</span>
                              <span className="wf-runRow__open">查看结果 →</span>
                            </button>
                          ))}
                          <div className="wf-task__noRuns">最近事件（{logs.events.length}）</div>
                          {logs.events.slice(-5).map((event, index) => (
                            <pre key={`ev-${index}`} className="wf-run__box">{event}</pre>
                          ))}
                          <div className="wf-task__noRuns">stderr（最近 {Math.min(logs.logs.length, 20)} 行）</div>
                          {logs.logs.slice(-20).map((line, index) => (
                            <pre key={`log-${index}`} className="wf-run__box">{line}</pre>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="wf-board__tabs">
            <span className="wf-task__meta" style={{ flex: 1, paddingLeft: 6 }}>
              {schedules.filter((schedule) => schedule.status === 'active').length} 个已开启 · 共 {schedules.length} 个
            </span>
            <button className="wf-board__refresh" onClick={() => void refresh()} disabled={busy} title="刷新">
              ↻
            </button>
          </div>

          {error !== '' && <div className="wf-schedule-board__err">{error}</div>}

          <div className="wf-board__body">
            {visible.length === 0 && (
              <div className="wf-schedule-board__empty">
                还没有定时任务。在画布上添加「定时触发」节点、填好 Cron，再点「保存定时」。
              </div>
            )}
            {visible.map((schedule) => {
              const ownRuns = runsBySchedule.get(schedule.id) ?? []
              const latest = ownRuns[0]
              const open = expanded === schedule.id
              return (
                <div key={schedule.id} className="wf-task">
                  <div className="wf-task__head" style={{ cursor: 'default' }}>
                    <span className="wf-task__name">{schedule.name}</span>
                    <code className="wf-task__cron">{schedule.cron}</code>
                    <span className={`wf-task__badge wf-task__badge--${schedule.status}`}>
                      {schedule.status === 'active' ? '已开启' : '已结束'}
                    </span>
                    <span className="wf-task__meta">
                      {schedule.overdue === true ? (
                        <span className="wf-task__overdue">待补跑 · 原定 {absolute(schedule.nextFire)}</span>
                      ) : (
                        <>下次 {when(schedule.nextFire)}</>
                      )}
                      <span className="wf-task__sep"> · </span>
                      上次 {when(latest?.startedAt ?? schedule.lastFired)}
                    </span>
                    {latest !== undefined && (
                      <span className={`wf-task__status wf-task__status--${latest.status}`}>
                        {latest.status === 'ok' ? '✓ 成功' : `✕ ${latest.failed} 个节点失败`}
                      </span>
                    )}
                  </div>

                  <div className="wf-task__actions">
                    <button className="wf-btn" onClick={() => void taskAction('run', schedule.id)} disabled={busy}>
                      运行一次
                    </button>
                    <button className="wf-btn" onClick={() => setExpanded(open ? null : schedule.id)} aria-expanded={open}>
                      {open ? '收起详情' : '详情'}
                    </button>
                    {schedule.status === 'active' ? (
                      <button
                        className="wf-btn wf-btn--danger"
                        onClick={() => void taskAction('clear', schedule.id)}
                        disabled={busy}
                        title="停止定时，但保留任务和运行记录"
                      >
                        取消定时
                      </button>
                    ) : (
                      <>
                        <button
                          className="wf-btn"
                          onClick={() => void taskAction('resume', schedule.id)}
                          disabled={busy}
                        >
                          恢复定时
                        </button>
                        <button
                          className="wf-btn wf-btn--danger"
                          onClick={() => void taskAction('delete', schedule.id)}
                          disabled={busy}
                          title="彻底删除任务记录（运行历史仍保留在运行记录里）"
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>

                  {open && (
                    <div className="wf-task__runs">
                      {ownRuns.length === 0 && <div className="wf-task__noRuns">还没有运行记录。</div>}
                      {ownRuns.map((run) => (
                        <button
                          key={run.runId}
                          className="wf-runRow"
                          onClick={() => void openRun(run.runId)}
                          title="查看这次运行的节点结果"
                        >
                          <span className={`wf-runRow__status wf-runRow__status--${run.status}`}>
                            {run.status === 'ok' ? '✓' : '✕'}
                          </span>
                          <span className="wf-runRow__when">{when(run.startedAt)}</span>
                          <span className="wf-runRow__trigger">{run.trigger === 'cron' ? '定时' : run.trigger === 'listen' ? '监听' : '手动'}</span>
                          <span className="wf-runRow__nodes">
                            {run.nodeCount} 节点{run.failed > 0 ? ` · ${run.failed} 失败` : ''}
                          </span>
                          <span className="wf-runRow__ms">{seconds(run.durationMs)}</span>
                          <span className="wf-runRow__open">查看结果 →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>,
    overlayHost(),
  )
}

/** One stored run: its per-node results, its output, and a replay entry. */
function RunDetailView({
  run,
  onBack,
  onReplay,
}: {
  run: StoredRun
  onBack: () => void
  onReplay: () => void
}) {
  const ok = run.status === 'ok'
  return (
    <div className="wf-run-detail">
      <div className="wf-run-detail__head">
        <button className="wf-btn" onClick={onBack}>
          ← 返回
        </button>
        <div className="wf-run-detail__titleBlock">
          <div className="wf-run-detail__title">
            {run.workflowName}
            <span className={`wf-run-detail__badge wf-run-detail__badge--${run.status}`}>
              {ok ? '成功' : '有失败节点'}
            </span>
          </div>
          <div className="wf-run-detail__meta">
            {when(run.startedAt)} · {run.trigger === 'cron' ? '定时触发' : '手动触发'} · {seconds(run.durationMs)}
          </div>
        </div>
        <button className="wf-btn wf-btn--primary" onClick={onReplay} disabled={run.doc === null}>
          在画布回放
        </button>
      </div>

      <div className="wf-run-detail__body">
        <table className="wf-run-table">
          <thead>
            <tr>
              <th>节点</th>
              <th>类型</th>
              <th>状态</th>
              <th>耗时</th>
              <th>输出 / 错误</th>
            </tr>
          </thead>
          <tbody>
            {run.nodes.map((node) => {
              const text = node.error ?? nodeOutputText(node.output)
              const logs = (node.logs ?? []).join('\n')
              return (
                <tr key={node.id}>
                  <td className="wf-run-table__label">{node.label ?? node.id}</td>
                  <td className="wf-run-table__kind">{node.kind}</td>
                  <td>
                    <span className={`wf-run-table__status wf-run-table__status--${node.status}`}>
                      {node.status === 'ok' ? '成功' : node.status === 'error' ? '失败' : '跳过'}
                    </span>
                    {node.attempts !== undefined && node.attempts.length > 0 && (
                      <span className="wf-run-table__retries">重试 {node.attempts.length} 次</span>
                    )}
                  </td>
                  <td className="wf-run-table__ms">{seconds(node.ms)}</td>
                  <td className="wf-run-table__out">
                    {text !== '' && (
                      <pre
                        className={
                          node.error === undefined ? 'wf-run-table__pre' : 'wf-run-table__pre wf-run-table__pre--error'
                        }
                      >
                        {text.length > 600 ? `${text.slice(0, 600)}…` : text}
                      </pre>
                    )}
                    {logs !== '' && (
                      <pre className="wf-run-table__pre wf-run-table__pre--log">
                        {logs.length > 600 ? `${logs.slice(0, 600)}…` : logs}
                      </pre>
                    )}
                    {text === '' && logs === '' && <span className="wf-run-table__muted">—</span>}
                    {node.attempts !== undefined && node.attempts.length > 0 && (
                      <div className="wf-run-table__attempts">
                        {node.attempts.map((attempt) => (
                          <div
                            key={attempt.attempt}
                            className={`wf-run-table__attempt wf-run-table__attempt--${attempt.status}`}
                          >
                            第 {attempt.attempt} 次 · {attempt.status === 'ok' ? '成功' : '失败'} · {seconds(attempt.ms)}
                            {attempt.error !== undefined && attempt.error !== ''
                              ? ` · ${attempt.error.length > 140 ? `${attempt.error.slice(0, 140)}…` : attempt.error}`
                              : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="wf-run-detail__output">
          <div className="wf-run-detail__outputTitle">最终输出</div>
          <pre className="wf-run-detail__pre">{nodeOutputText(run.output) || '（这次运行没有返回值）'}</pre>
        </div>
      </div>
    </div>
  )
}
