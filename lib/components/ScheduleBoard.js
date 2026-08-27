import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Scheduled-task board — lists every saved schedule (cron workflow). Lets the
 * user view (load the workflow + its latest run result onto the canvas), run
 * once immediately, or cancel a schedule.
 *
 * @module components/ScheduleBoard
 */
import { useEffect, useState } from 'react';
import { useCanvasStore } from '../store/canvas.js';
export function ScheduleBoard({ onClose }) {
    const [schedules, setSchedules] = useState([]);
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const refresh = async () => {
        setLoading(true);
        setErr('');
        try {
            const [sRes, rRes] = await Promise.all([
                fetch('/dsh-node-flow/schedules').then((r) => r.json().catch(() => ({}))),
                fetch('/dsh-node-flow/runs').then((r) => r.json().catch(() => ({}))),
            ]);
            setSchedules(sRes.schedules ?? []);
            setRuns(rRes.runs ?? []);
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void refresh();
    }, []);
    const latestRun = (id) => runs.find((r) => r.scheduleId === id);
    // Load the workflow into the canvas and paste the latest run's per-node result
    // (green/red border + input/output in the inspector), like a completed manual run.
    const view = async (s) => {
        const store = useCanvasStore.getState();
        if (s.doc)
            store.importDocument(s.doc);
        const run = latestRun(s.id);
        const at = new Date().toLocaleTimeString();
        for (const n of run?.nodes ?? []) {
            store.updateNodeData(n.id, {
                lastRun: { input: '', logs: n.logs ?? [], value: n.output, error: n.error, at, duration: n.ms },
            });
        }
        onClose();
    };
    const runOnce = async (s) => {
        setLoading(true);
        setErr('');
        try {
            const res = await fetch('/dsh-node-flow/schedule', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'run', id: s.id }),
            });
            const data = (await res.json().catch(() => ({})));
            if (!res.ok)
                setErr(data.error ?? '运行失败');
            await refresh();
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
        finally {
            setLoading(false);
        }
    };
    const cancel = async (s) => {
        setLoading(true);
        setErr('');
        try {
            const res = await fetch('/dsh-node-flow/schedule', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'clear', id: s.id }),
            });
            const data = (await res.json().catch(() => ({})));
            if (!res.ok)
                setErr(data.error ?? '取消失败');
            await refresh();
        }
        catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsxs("div", { className: "wf-schedule-board", role: "dialog", "aria-modal": "true", "aria-label": "\u5B9A\u65F6\u4EFB\u52A1", children: [_jsxs("div", { className: "wf-schedule-board__head", children: [_jsx("div", { className: "wf-schedule-board__title", children: "\u5B9A\u65F6\u4EFB\u52A1" }), _jsx("button", { className: "wf-schedule-board__close", onClick: onClose, "aria-label": "\u5173\u95ED", children: "\u2715" })] }), _jsxs("div", { className: "wf-schedule-board__body", children: [_jsx("button", { className: "wf-btn", onClick: () => void refresh(), disabled: loading, children: "\u21BB \u5237\u65B0" }), err && _jsx("div", { className: "wf-schedule-board__err", children: err }), schedules.length === 0 && !loading && _jsx("div", { className: "wf-schedule-board__empty", children: "\u8FD8\u6CA1\u6709\u5B9A\u65F6\u4EFB\u52A1\u3002\u9009\u4E2D\u4E00\u4E2A Schedule \u8282\u70B9\u586B\u597D Cron \u540E\u70B9\u300C\u4FDD\u5B58\u5B9A\u65F6\u300D\u3002" }), schedules.map((s) => {
                        const run = latestRun(s.id);
                        return (_jsxs("div", { className: "wf-schedule-board__item", children: [_jsxs("div", { className: "wf-schedule-board__line", children: [_jsx("span", { className: "wf-schedule-board__name", children: s.name }), _jsx("code", { className: "wf-schedule-board__cron", children: s.cron })] }), _jsxs("div", { className: "wf-schedule-board__line wf-schedule-board__meta", children: [_jsxs("span", { children: ["\u4E0A\u6B21\u89E6\u53D1\uFF1A", s.lastFired ?? '—'] }), _jsxs("span", { className: run && run.status === 'error' ? 'wf-schedule-board__bad wf-schedule-board__bad--err' : 'wf-schedule-board__bad', children: ["\u6700\u8FD1\u8FD0\u884C\uFF1A", run ? `${run.status}${run.failed ? `（${run.failed} 失败）` : ''}` : '—'] })] }), _jsxs("div", { className: "wf-schedule-board__actions", children: [_jsx("button", { className: "wf-btn", onClick: () => void view(s), disabled: !s.doc, children: "\u67E5\u770B" }), _jsx("button", { className: "wf-btn", onClick: () => void runOnce(s), disabled: loading, children: "\u8FD0\u884C\u4E00\u6B21" }), _jsx("button", { className: "wf-btn wf-btn--danger", onClick: () => void cancel(s), disabled: loading, children: "\u53D6\u6D88" })] })] }, s.id));
                    })] })] }));
}
