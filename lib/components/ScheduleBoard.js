import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore } from '../store/canvas.js';
import { overlayHost } from './overlayHost.js';
async function postJson(path, body) {
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({})));
    if (!response.ok)
        throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
}
function absolute(iso) {
    if (iso === undefined)
        return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return '—';
    return date.toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}
function when(iso) {
    if (iso === undefined)
        return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return '—';
    const diff = date.getTime() - Date.now();
    const label = absolute(iso);
    if (Math.abs(diff) < 60_000)
        return '刚刚';
    if (diff > 0 && diff < 6 * 60 * 60 * 1000)
        return `${label}（${Math.round(diff / 60_000)} 分钟后）`;
    if (diff < 0 && diff > -6 * 60 * 60 * 1000)
        return `${label}（${Math.round(-diff / 60_000)} 分钟前）`;
    return label;
}
function seconds(ms) {
    if (ms <= 0)
        return '0s';
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
function nodeOutputText(output) {
    if (output === undefined || output === null)
        return '';
    if (typeof output === 'string')
        return output;
    try {
        return JSON.stringify(output);
    }
    catch {
        return String(output);
    }
}
export function ScheduleBoard({ onClose }) {
    const [schedules, setSchedules] = useState([]);
    const [runs, setRuns] = useState([]);
    const [tab, setTab] = useState('all');
    const [view, setView] = useState('tasks');
    const [listeners, setListeners] = useState([]);
    const [listenerOpen, setListenerOpen] = useState(null);
    const [listenerLogs, setListenerLogs] = useState({});
    const [listenerRuns, setListenerRuns] = useState({});
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(null);
    const [detail, setDetail] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const refresh = async () => {
        setBusy(true);
        setError('');
        try {
            const [scheduleData, runData, listenerData] = await Promise.all([
                postJson('/dsh-node-flow/schedules', {}),
                postJson('/dsh-node-flow/runs', { limit: 200 }),
                postJson('/dsh-node-flow/listeners', {}),
            ]);
            setSchedules(scheduleData.schedules ?? []);
            setRuns(runData.runs ?? []);
            setListeners(listenerData.listeners ?? []);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    };
    /** Start / stop / restart / test one resident listener. */
    const listenerAction = async (action, row) => {
        setError('');
        try {
            await postJson(`/dsh-node-flow/listener/${action}`, { workflowId: row.workflowId, nodeId: row.nodeId });
            await refresh();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    const loadListenerLogs = async (row) => {
        const key = `${row.workflowId}::${row.nodeId}`;
        const open = listenerOpen === key;
        setListenerOpen(open ? null : key);
        if (open)
            return;
        try {
            const [logData, runData] = await Promise.all([
                postJson('/dsh-node-flow/listener/logs', {
                    workflowId: row.workflowId,
                    nodeId: row.nodeId,
                }),
                postJson('/dsh-node-flow/runs', {
                    workflowId: row.workflowId,
                    nodeId: row.nodeId,
                    limit: 20,
                }),
            ]);
            setListenerLogs((prev) => ({ ...prev, [key]: { logs: logData.logs ?? [], events: logData.events ?? [] } }));
            setListenerRuns((prev) => ({ ...prev, [key]: runData.runs ?? [] }));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    /** Delete this listener's stored run records (workflow untouched). */
    const clearRuns = async (row) => {
        setError('');
        try {
            await postJson('/dsh-node-flow/listener/runs/clear', { workflowId: row.workflowId, nodeId: row.nodeId });
            const key = `${row.workflowId}::${row.nodeId}`;
            setListenerRuns((prev) => ({ ...prev, [key]: [] }));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    /** Forget this listener: stop it and drop its record from the board. */
    const deleteListenerRow = async (row) => {
        setError('');
        try {
            await postJson('/dsh-node-flow/listener/delete', { workflowId: row.workflowId, nodeId: row.nodeId });
            const key = `${row.workflowId}::${row.nodeId}`;
            setListenerOpen((prev) => (prev === key ? null : prev));
            await refresh();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    useEffect(() => {
        void refresh();
    }, []);
    // Only runs that belong to a task through `scheduleId` are listed under it.
    // A canvas ▶ run carries no task id, so it is not a scheduled run and never
    // shows up in a task's history (it stays persisted for 回放).
    const runsBySchedule = useMemo(() => {
        const map = new Map();
        for (const run of runs) {
            if (run.scheduleId === undefined)
                continue;
            const list = map.get(run.scheduleId) ?? [];
            list.push(run);
            map.set(run.scheduleId, list);
        }
        for (const list of map.values()) {
            list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
        }
        return map;
    }, [runs]);
    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return schedules.filter((schedule) => {
            if (tab === 'active' && schedule.status !== 'active')
                return false;
            if (tab === 'ended' && schedule.status !== 'ended')
                return false;
            if (needle.length === 0)
                return true;
            const ownRuns = runsBySchedule.get(schedule.id) ?? [];
            const haystack = [schedule.name, schedule.cron, ...ownRuns.map((run) => run.startedAt)]
                .join(' ')
                .toLowerCase();
            return haystack.includes(needle);
        });
    }, [schedules, tab, search, runsBySchedule]);
    const taskAction = async (action, id) => {
        setBusy(true);
        setError('');
        try {
            await postJson('/dsh-node-flow/schedule', { action, id });
            await refresh();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    };
    const openRun = async (runId) => {
        setBusy(true);
        setError('');
        try {
            const data = await postJson('/dsh-node-flow/run-detail', { runId });
            setDetail(data.run);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    };
    /** Load this run's graph + per-node results onto the canvas, read-only. */
    const replay = (run) => {
        useCanvasStore.getState().showRun(run);
        onClose();
    };
    return createPortal(_jsxs("div", { className: "wf-schedule-board", role: "dialog", "aria-label": "\u5B9A\u65F6 / \u76D1\u542C", children: [_jsxs("div", { className: "wf-board__head", children: [_jsxs("div", { className: "wf-board__title", children: [_jsx("button", { className: `wf-task__tab${view === 'tasks' ? ' wf-task__tab--active' : ''}`, onClick: () => setView('tasks'), children: "\u5B9A\u65F6" }), _jsx("button", { className: `wf-task__tab${view === 'listeners' ? ' wf-task__tab--active' : ''}`, onClick: () => setView('listeners'), children: "\u76D1\u542C" })] }), _jsx("div", { className: "wf-board__headActions", children: _jsx("button", { className: "wf-schedule-board__close", onClick: onClose, "aria-label": "\u5173\u95ED", children: "\u2715" }) })] }), detail !== null ? (_jsx(RunDetailView, { run: detail, onBack: () => setDetail(null), onReplay: () => replay(detail) })) : view === 'listeners' ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "wf-board__tabs", children: [_jsxs("span", { className: "wf-task__meta", style: { flex: 1, paddingLeft: 6 }, children: [listeners.filter((row) => row.status === 'running').length, " \u4E2A\u8FD0\u884C\u4E2D \u00B7 \u5171 ", listeners.length, " \u4E2A"] }), _jsx("button", { className: "wf-board__refresh", onClick: () => void refresh(), disabled: busy, title: "\u5237\u65B0", children: "\u21BB" })] }), error !== '' && _jsx("div", { className: "wf-schedule-board__err", children: error }), _jsxs("div", { className: "wf-board__body", children: [listeners.length === 0 && (_jsx("div", { className: "wf-schedule-board__empty", children: "\u8FD8\u6CA1\u6709\u76D1\u542C\u3002\u5728\u753B\u5E03\u4E0A\u6DFB\u52A0\u300C\u76D1\u542C\u300D\u8282\u70B9\u3001\u5199\u597D\u811A\u672C\u5E76\u4FDD\u5B58\u5DE5\u4F5C\u6D41\uFF0C\u7136\u540E\u5728\u8282\u70B9\u5C5E\u6027\u91CC\u70B9\u300C\u5F00\u542F\u76D1\u542C\u300D\u3002" })), listeners.map((row) => {
                                const key = `${row.workflowId}::${row.nodeId}`;
                                const open = listenerOpen === key;
                                const logs = listenerLogs[key];
                                return (_jsxs("div", { className: "wf-task", children: [_jsxs("div", { className: "wf-task__head", style: { cursor: 'default' }, children: [_jsx("span", { className: `wf-listener__dot wf-listener__dot--${row.status}`, "aria-hidden": "true" }), _jsx("span", { className: "wf-task__name", children: row.label }), _jsx("span", { className: `wf-task__badge wf-task__badge--${row.status === 'running' ? 'active' : 'ended'}`, children: row.status === 'running' ? `运行中${row.pid ? ` · ${row.pid}` : ''}` : row.status === 'error' ? '异常' : '已停止' }), _jsxs("span", { className: "wf-task__meta", children: ["\u89E6\u53D1 ", row.fireCount, " \u00B7 \u6392\u961F ", row.queued, " \u00B7 \u4E22\u5F03 ", row.droppedCount, _jsx("span", { className: "wf-task__sep", children: " \u00B7 " }), "\u4E0A\u6B21 ", when(row.lastEventAt)] }), row.readyLine ? _jsx("span", { className: "wf-task__meta wf-task__cron", children: row.readyLine }) : null, row.status === 'error' && row.lastError ? (_jsx("span", { className: "wf-task__meta", children: row.lastError })) : null] }), _jsxs("div", { className: "wf-task__actions", children: [row.status === 'running' ? (_jsx("button", { className: "wf-btn", onClick: () => void listenerAction('stop', row), disabled: busy, children: "\u505C\u6B62" })) : (_jsx("button", { className: "wf-btn wf-btn--primary", onClick: () => void listenerAction('start', row), disabled: busy, children: "\u542F\u52A8" })), _jsx("button", { className: "wf-btn", onClick: () => void listenerAction('restart', row), disabled: busy, children: "\u91CD\u542F" }), _jsx("button", { className: "wf-btn", onClick: () => void loadListenerLogs(row), children: open ? '收起详情' : '详情' }), _jsx("button", { className: "wf-btn wf-btn--danger", onClick: () => void deleteListenerRow(row), disabled: busy, title: "\u505C\u6B62\u5E76\u4ECE\u770B\u677F\u79FB\u9664\u8FD9\u6761\u76D1\u542C\uFF08\u5DE5\u4F5C\u6D41\u91CC\u7684\u8282\u70B9\u4FDD\u7559\uFF09", children: "\u5220\u9664" })] }), open && (_jsx("div", { className: "wf-task__runs", children: logs === undefined ? (_jsx("div", { className: "wf-task__noRuns", children: "\u52A0\u8F7D\u4E2D\u2026" })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "wf-runHead", children: [_jsxs("span", { children: ["\u8FD0\u884C\u8BB0\u5F55\uFF08", (listenerRuns[key] ?? []).length, "\uFF09\u00B7 \u70B9\u4E00\u884C\u67E5\u770B\u8282\u70B9\u7ED3\u679C / \u5728\u753B\u5E03\u56DE\u653E"] }), _jsx("button", { className: "wf-btn wf-btn--danger", onClick: () => void clearRuns(row), disabled: busy || (listenerRuns[key] ?? []).length === 0, title: "\u5220\u9664\u8FD9\u6761\u76D1\u542C\u7684\u5168\u90E8\u8FD0\u884C\u8BB0\u5F55\uFF08\u53EA\u5220\u8BB0\u5F55\uFF0C\u4E0D\u5220\u5DE5\u4F5C\u6D41\uFF09", children: "\u6E05\u7A7A\u8BB0\u5F55" })] }), (listenerRuns[key] ?? []).length === 0 && (_jsx("div", { className: "wf-task__noRuns", children: "\u8FD8\u6CA1\u6709\u8FD0\u884C\u8BB0\u5F55\u3002" })), (listenerRuns[key] ?? []).map((run) => (_jsxs("button", { className: "wf-runRow", onClick: () => void openRun(run.runId), title: "\u67E5\u770B\u8FD9\u6B21\u8FD0\u884C\u7684\u8282\u70B9\u7ED3\u679C", children: [_jsx("span", { className: `wf-runRow__status wf-runRow__status--${run.status}`, children: run.status === 'ok' ? '✓' : '✕' }), _jsx("span", { className: "wf-runRow__when", children: when(run.startedAt) }), _jsx("span", { className: "wf-runRow__trigger", children: "\u76D1\u542C" }), _jsxs("span", { className: "wf-runRow__nodes", children: [run.nodeCount, " \u8282\u70B9", run.failed > 0 ? ` · ${run.failed} 失败` : ''] }), _jsx("span", { className: "wf-runRow__ms", children: seconds(run.durationMs) }), _jsx("span", { className: "wf-runRow__open", children: "\u67E5\u770B\u7ED3\u679C \u2192" })] }, run.runId))), _jsxs("div", { className: "wf-task__noRuns", children: ["\u6700\u8FD1\u4E8B\u4EF6\uFF08", logs.events.length, "\uFF09"] }), logs.events.slice(-5).map((event, index) => (_jsx("pre", { className: "wf-run__box", children: event }, `ev-${index}`))), _jsxs("div", { className: "wf-task__noRuns", children: ["stderr\uFF08\u6700\u8FD1 ", Math.min(logs.logs.length, 20), " \u884C\uFF09"] }), logs.logs.slice(-20).map((line, index) => (_jsx("pre", { className: "wf-run__box", children: line }, `log-${index}`)))] })) }))] }, key));
                            })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "wf-board__tabs", role: "tablist", children: [[
                                ['all', '全部'],
                                ['active', '已开启'],
                                ['ended', '已结束'],
                            ].map(([value, label]) => {
                                const count = value === 'all'
                                    ? schedules.length
                                    : schedules.filter((schedule) => schedule.status === value).length;
                                return (_jsxs("button", { role: "tab", "aria-selected": tab === value, className: `wf-board__tab${tab === value ? ' wf-board__tab--active' : ''}`, onClick: () => setTab(value), children: [label, _jsx("span", { className: "wf-board__tabCount", children: count })] }, value));
                            }), _jsx("input", { className: "wf-board__search", value: search, onChange: (event) => setSearch(event.target.value), placeholder: "\u641C\u7D22\u5B9A\u65F6\u4EFB\u52A1\u2026", "aria-label": "\u641C\u7D22\u5B9A\u65F6\u4EFB\u52A1" }), _jsx("button", { className: "wf-board__refresh", onClick: () => void refresh(), disabled: busy, title: "\u5237\u65B0", children: "\u21BB" })] }), error !== '' && _jsx("div", { className: "wf-schedule-board__err", children: error }), _jsxs("div", { className: "wf-board__body", children: [visible.length === 0 && (_jsx("div", { className: "wf-schedule-board__empty", children: tab === 'ended'
                                    ? '还没有已结束的任务。取消一个任务会把它保留在这里，运行记录也不会丢。'
                                    : '还没有定时任务。在画布上添加「定时触发」节点、填好 Cron，再点「保存定时」。' })), visible.map((schedule) => {
                                const ownRuns = runsBySchedule.get(schedule.id) ?? [];
                                const latest = ownRuns[0];
                                const open = expanded === schedule.id;
                                return (_jsxs("div", { className: "wf-task", children: [_jsxs("button", { className: "wf-task__head", onClick: () => setExpanded(open ? null : schedule.id), "aria-expanded": open, children: [_jsx("span", { className: `wf-task__chevron${open ? ' wf-task__chevron--open' : ''}`, "aria-hidden": "true", children: "\u25B8" }), _jsx("span", { className: "wf-task__name", children: schedule.name }), _jsx("code", { className: "wf-task__cron", children: schedule.cron }), _jsx("span", { className: `wf-task__badge wf-task__badge--${schedule.status}`, children: schedule.status === 'active' ? '已开启' : '已结束' }), _jsxs("span", { className: "wf-task__meta", children: [schedule.overdue === true ? (_jsxs("span", { className: "wf-task__overdue", children: ["\u5F85\u8865\u8DD1 \u00B7 \u539F\u5B9A ", absolute(schedule.nextFire)] })) : (_jsxs(_Fragment, { children: ["\u4E0B\u6B21 ", when(schedule.nextFire)] })), _jsx("span", { className: "wf-task__sep", children: " \u00B7 " }), "\u4E0A\u6B21 ", when(latest?.startedAt ?? schedule.lastFired)] }), latest !== undefined && (_jsx("span", { className: `wf-task__status wf-task__status--${latest.status}`, children: latest.status === 'ok' ? '✓ 成功' : `✕ ${latest.failed} 个节点失败` }))] }), _jsxs("div", { className: "wf-task__actions", children: [_jsx("button", { className: "wf-btn", onClick: () => void taskAction('run', schedule.id), disabled: busy, children: "\u8FD0\u884C\u4E00\u6B21" }), schedule.status === 'active' ? (_jsx("button", { className: "wf-btn wf-btn--danger", onClick: () => void taskAction('clear', schedule.id), disabled: busy, title: "\u505C\u6B62\u5B9A\u65F6\uFF0C\u4F46\u4FDD\u7559\u4EFB\u52A1\u548C\u8FD0\u884C\u8BB0\u5F55", children: "\u53D6\u6D88\u5B9A\u65F6" })) : (_jsxs(_Fragment, { children: [_jsx("button", { className: "wf-btn", onClick: () => void taskAction('resume', schedule.id), disabled: busy, children: "\u6062\u590D\u5B9A\u65F6" }), _jsx("button", { className: "wf-btn wf-btn--danger", onClick: () => void taskAction('delete', schedule.id), disabled: busy, title: "\u5F7B\u5E95\u5220\u9664\u4EFB\u52A1\u8BB0\u5F55\uFF08\u8FD0\u884C\u5386\u53F2\u4ECD\u4FDD\u7559\u5728\u8FD0\u884C\u8BB0\u5F55\u91CC\uFF09", children: "\u5220\u9664" })] }))] }), open && (_jsxs("div", { className: "wf-task__runs", children: [ownRuns.length === 0 && _jsx("div", { className: "wf-task__noRuns", children: "\u8FD8\u6CA1\u6709\u8FD0\u884C\u8BB0\u5F55\u3002" }), ownRuns.map((run) => (_jsxs("button", { className: "wf-runRow", onClick: () => void openRun(run.runId), title: "\u67E5\u770B\u8FD9\u6B21\u8FD0\u884C\u7684\u8282\u70B9\u7ED3\u679C", children: [_jsx("span", { className: `wf-runRow__status wf-runRow__status--${run.status}`, children: run.status === 'ok' ? '✓' : '✕' }), _jsx("span", { className: "wf-runRow__when", children: when(run.startedAt) }), _jsx("span", { className: "wf-runRow__trigger", children: run.trigger === 'cron' ? '定时' : run.trigger === 'listen' ? '监听' : '手动' }), _jsxs("span", { className: "wf-runRow__nodes", children: [run.nodeCount, " \u8282\u70B9", run.failed > 0 ? ` · ${run.failed} 失败` : ''] }), _jsx("span", { className: "wf-runRow__ms", children: seconds(run.durationMs) }), _jsx("span", { className: "wf-runRow__open", children: "\u67E5\u770B\u7ED3\u679C \u2192" })] }, run.runId)))] }))] }, schedule.id));
                            })] })] }))] }), overlayHost());
}
/** One stored run: its per-node results, its output, and a replay entry. */
function RunDetailView({ run, onBack, onReplay, }) {
    const ok = run.status === 'ok';
    return (_jsxs("div", { className: "wf-run-detail", children: [_jsxs("div", { className: "wf-run-detail__head", children: [_jsx("button", { className: "wf-btn", onClick: onBack, children: "\u2190 \u8FD4\u56DE" }), _jsxs("div", { className: "wf-run-detail__titleBlock", children: [_jsxs("div", { className: "wf-run-detail__title", children: [run.workflowName, _jsx("span", { className: `wf-run-detail__badge wf-run-detail__badge--${run.status}`, children: ok ? '成功' : '有失败节点' })] }), _jsxs("div", { className: "wf-run-detail__meta", children: [when(run.startedAt), " \u00B7 ", run.trigger === 'cron' ? '定时触发' : '手动触发', " \u00B7 ", seconds(run.durationMs)] })] }), _jsx("button", { className: "wf-btn wf-btn--primary", onClick: onReplay, disabled: run.doc === null, children: "\u5728\u753B\u5E03\u56DE\u653E" })] }), _jsxs("div", { className: "wf-run-detail__body", children: [_jsxs("table", { className: "wf-run-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u8282\u70B9" }), _jsx("th", { children: "\u7C7B\u578B" }), _jsx("th", { children: "\u72B6\u6001" }), _jsx("th", { children: "\u8017\u65F6" }), _jsx("th", { children: "\u8F93\u51FA / \u9519\u8BEF" })] }) }), _jsx("tbody", { children: run.nodes.map((node) => {
                                    const text = node.error ?? nodeOutputText(node.output);
                                    const logs = (node.logs ?? []).join('\n');
                                    return (_jsxs("tr", { children: [_jsx("td", { className: "wf-run-table__label", children: node.label ?? node.id }), _jsx("td", { className: "wf-run-table__kind", children: node.kind }), _jsxs("td", { children: [_jsx("span", { className: `wf-run-table__status wf-run-table__status--${node.status}`, children: node.status === 'ok' ? '成功' : node.status === 'error' ? '失败' : '跳过' }), node.attempts !== undefined && node.attempts.length > 0 && (_jsxs("span", { className: "wf-run-table__retries", children: ["\u91CD\u8BD5 ", node.attempts.length, " \u6B21"] }))] }), _jsx("td", { className: "wf-run-table__ms", children: seconds(node.ms) }), _jsxs("td", { className: "wf-run-table__out", children: [text !== '' && (_jsx("pre", { className: node.error === undefined ? 'wf-run-table__pre' : 'wf-run-table__pre wf-run-table__pre--error', children: text.length > 600 ? `${text.slice(0, 600)}…` : text })), logs !== '' && (_jsx("pre", { className: "wf-run-table__pre wf-run-table__pre--log", children: logs.length > 600 ? `${logs.slice(0, 600)}…` : logs })), text === '' && logs === '' && _jsx("span", { className: "wf-run-table__muted", children: "\u2014" }), node.attempts !== undefined && node.attempts.length > 0 && (_jsx("div", { className: "wf-run-table__attempts", children: node.attempts.map((attempt) => (_jsxs("div", { className: `wf-run-table__attempt wf-run-table__attempt--${attempt.status}`, children: ["\u7B2C ", attempt.attempt, " \u6B21 \u00B7 ", attempt.status === 'ok' ? '成功' : '失败', " \u00B7 ", seconds(attempt.ms), attempt.error !== undefined && attempt.error !== ''
                                                                    ? ` · ${attempt.error.length > 140 ? `${attempt.error.slice(0, 140)}…` : attempt.error}`
                                                                    : ''] }, attempt.attempt))) }))] })] }, node.id));
                                }) })] }), _jsxs("div", { className: "wf-run-detail__output", children: [_jsx("div", { className: "wf-run-detail__outputTitle", children: "\u6700\u7EC8\u8F93\u51FA" }), _jsx("pre", { className: "wf-run-detail__pre", children: nodeOutputText(run.output) || '（这次运行没有返回值）' })] })] })] }));
}
