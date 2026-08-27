/**
 * DSH plugin entry for dsh-node-flow.
 *
 * Registers same-origin HTTP routes so canvas nodes can really execute on the
 * host, plus a scheduled-task engine (cron → host graph walker).
 *
 * - `/dsh-node-flow/run` — execute a code node via `ctx.codeRuntime`.
 * - `/dsh-node-flow/run-agent` — delegate an agent node to a DSH
 *   subagent via `ctx.subagents`, parented on a live root agent.
 * - `/dsh-node-flow/{schedule,schedules,runs,models}` — schedule/list/runs
 *   management and the agent model dropdown.
 *
 * The host half waits for `webServer` (the standard `inject` property) so the
 * routes always mount on the live server. Optional services are re-read at
 * call time, so a late provider still works; without a service a route returns
 * a clear JSON error instead of failing the canvas.
 *
 * @module dsh-node-flow
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const name = 'dsh-node-flow';
export const inject = ['webServer'];
/** True when the request Origin matches its Host (same-origin gate for POST). */
function sameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!origin || !host)
        return false;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
}
/** Read a JSON request body with a size cap; rejects oversized payloads. */
async function readJsonBody(request, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buf = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk));
        size += buf.byteLength;
        if (size > maxBytes)
            throw new Error('request body too large');
        chunks.push(buf);
    }
    if (chunks.length === 0)
        return undefined;
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(merged));
}
function sendJson(response, status, payload) {
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(payload));
}
/** Map a subagent stop reason to an error message; `undefined` means completed cleanly. */
function stopReasonError(result) {
    switch (result.stopReason) {
        case 'completed':
            return undefined;
        case 'aborted':
            return 'subagent run was cancelled';
        case 'error':
            return 'subagent run failed';
        case 'max-tokens':
            return 'subagent run hit its token limit before finishing';
        case 'refusal':
            return 'subagent declined the task';
        default:
            return `subagent run ended abnormally (${String(result.stopReason)})`;
    }
}
/** Join the text blocks of a subagent result output. */
function outputText(result) {
    return result.output
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
}
/** Pick a subagent provider: prefer known in-process names, else the first registered. */
function pickSubagentProvider(subagents) {
    for (const name of ['spawn', 'fork', 'acp']) {
        if (subagents.getProvider(name) !== undefined)
            return name;
    }
    const list = subagents.list();
    return list.length > 0 ? list[0] : undefined;
}
/**
 * Host bindings exposed to a code node program. The program runs as an async
 * function body and accesses these under one global `dsh` object:
 *
 * - `await dsh.fetch({ url, method?, headers?, body?, timeout? })` → HTTP via
 *   the host's global `fetch`; resolves to `{ status, ok, text, json }`.
 * - `await dsh.input(null)` → the previous node's output (the flow input).
 *   Note: the code-runtime requires every binding call to be passed a
 *   lossless-JSON argument, so `dsh.input()` with no args is rejected; pass
 *   `null` (the value is ignored, the flow input is returned).
 * - `await dsh.now(null)` → `{ iso, ts, local }`.
 */
function buildCodeBindings(input) {
    return [
        {
            global: 'dsh',
            functions: {
                fetch: async (args) => {
                    const a = (args ?? {});
                    if (typeof a.url !== 'string' || a.url.length === 0) {
                        throw new Error('dsh.fetch requires { url: string }');
                    }
                    const method = typeof a.method === 'string' ? a.method : 'GET';
                    const headers = a.headers !== null && typeof a.headers === 'object'
                        ? a.headers
                        : {};
                    const rawBody = a.body;
                    const body = rawBody === undefined
                        ? undefined
                        : typeof rawBody === 'string'
                            ? rawBody
                            : JSON.stringify(rawBody);
                    const controller = new AbortController();
                    const timeout = typeof a.timeout === 'number' ? a.timeout : 20_000;
                    const timer = setTimeout(() => controller.abort(new Error('dsh.fetch timed out')), timeout);
                    try {
                        const res = await fetch(a.url, { method, headers, body, signal: controller.signal });
                        const text = await res.text();
                        let json = null;
                        if (text.length > 0) {
                            try {
                                json = JSON.parse(text);
                            }
                            catch {
                                json = null;
                            }
                        }
                        return { status: res.status, ok: res.ok, text, json };
                    }
                    finally {
                        clearTimeout(timer);
                    }
                },
                input: async () => input ?? null,
                now: async () => ({
                    iso: new Date().toISOString(),
                    ts: Date.now(),
                    local: new Date().toLocaleString(),
                }),
            },
        },
    ];
}
/**
 * Execute a Python code node via a host subprocess (DSH's `ctx.codeRuntime`
 * only ships a TypeScript backend). The program gets the flow input through
 * the `DSH_INPUT` env var and prints its result to stdout (captured as the
 * value); `urllib` is available for networking. A non-zero exit or stderr
 * becomes the node's error.
 */
function runPythonCode(code, input, signal) {
    const inputStr = typeof input === 'string'
        ? input
        : input === undefined || input === null
            ? ''
            : JSON.stringify(input);
    return new Promise((resolve) => {
        // PYTHONIOENCODING forces UTF-8 stdout, so Chinese/° survive the pipe
        // (Windows Python defaults to the console code page, which Node mis-decodes).
        const env = { ...process.env, DSH_INPUT: inputStr, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
        // Prefer a conventional interpreter name; fall back to a couple of aliases.
        const candidates = ['python', 'python3', 'py'];
        const tryRun = (i) => {
            if (i >= candidates.length) {
                resolve({ logs: [], error: { kind: 'exception', message: 'no Python interpreter found (tried python, python3, py)' } });
                return;
            }
            const cmd = candidates[i];
            execFile(cmd, ['-u', '-c', code], { env, timeout: 60_000, maxBuffer: 10 * 1024 * 1024, signal }, (error, stdout, stderr) => {
                // A "command not found" spawn error is indistinguishable from a broken
                // program for the first candidate suffix; fall through to the next.
                if (error && error.code === 'ENOENT') {
                    tryRun(i + 1);
                    return;
                }
                if (error) {
                    const aborted = error.name === 'AbortError';
                    const detail = aborted ? '运行超时' : (stderr || error.message || '').trim();
                    resolve({ logs: stdout ? [stdout.trim()] : [], error: { kind: aborted ? 'abort' : 'exception', message: detail || `python exited with code ${error.code ?? '?'}` } });
                    return;
                }
                const out = stdout.trim();
                resolve({ value: out, logs: out ? out.split('\n').filter((l) => l.trim().length > 0) : [] });
            });
        };
        tryRun(0);
    });
}
/** Guard `request.method !== 'POST'` with a 405 and a boolean signal to skip. */
function rejectNonPost(request, response) {
    if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' });
        response.end();
        return true;
    }
    return false;
}
/**
 * Create a run signal that aborts after `timeoutSec` seconds (0 / NaN / empty =
 * no timeout). `isTimeout()` distinguishes a timeout abort from a caller
 * disconnect, so handlers can report "运行超时" specifically.
 */
function makeTimeoutSignal(timeoutSec) {
    const controller = new AbortController();
    let timedOut = false;
    const sec = Math.max(0, Math.floor(Number(timeoutSec)) || 0);
    const timer = sec > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, sec * 1000) : undefined;
    return {
        signal: controller.signal,
        seconds: sec,
        isTimeout: () => timedOut,
        clear: () => {
            if (timer)
                clearTimeout(timer);
        },
    };
}
function dshHome() {
    return process.env.DSH_HOME || join(homedir(), '.dsh');
}
function dataDir() {
    return join(dshHome(), 'workflow-canvas');
}
function schedulesFile() {
    return join(dataDir(), 'schedules.json');
}
function runsFile() {
    return join(dataDir(), 'runs.json');
}
function readJson(file, fallback) {
    try {
        if (!existsSync(file))
            return fallback;
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function writeJson(file, data) {
    try {
        mkdirSync(dataDir(), { recursive: true });
        writeFileSync(file, JSON.stringify(data, null, 2));
    }
    catch {
        /* persistence is best-effort */
    }
}
function loadSchedules() {
    return readJson(schedulesFile(), []);
}
function saveSchedules(list) {
    writeJson(schedulesFile(), list);
}
function loadRuns() {
    return readJson(runsFile(), []);
}
function saveRuns(runs) {
    writeJson(runsFile(), runs.slice(0, 50));
}
/** Match one 5-field cron expression against a local date (minute precision). */
function parseCronField(field, min, max) {
    const parts = field.split(',').map((s) => s.trim()).filter(Boolean);
    const checks = [];
    for (const part of parts) {
        const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
        if (!m)
            continue;
        const star = m[1] === '*';
        const lo = star ? min : parseInt(m[1], 10);
        const hi = m[2] !== undefined ? parseInt(m[2], 10) : (star ? max : parseInt(m[1], 10));
        const step = m[3] !== undefined ? parseInt(m[3], 10) : 1;
        const start = star ? min : lo;
        checks.push((v) => v >= lo && v <= hi && ((v - start) % step) === 0);
    }
    if (checks.length === 0)
        return () => true;
    return (v) => checks.some((c) => c(v));
}
function cronMatches(cron, date) {
    const f = cron.trim().split(/\s+/);
    if (f.length < 5)
        return false;
    return (parseCronField(f[0], 0, 59)(date.getMinutes()) &&
        parseCronField(f[1], 0, 23)(date.getHours()) &&
        parseCronField(f[2], 1, 31)(date.getDate()) &&
        parseCronField(f[3], 1, 12)(date.getMonth() + 1) &&
        parseCronField(f[4], 0, 6)(date.getDay()));
}
/**
 * Convert a stored `lastFired` minute key (UTC `YYYY-MM-DDTHH:mm`, from
 * `Date.toISOString().slice(0,16)`) into the host's local wall-clock time for
 * display. Leaves non-matching strings untouched.
 */
function utcMinuteKeyToLocal(key) {
    const m = key.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m)
        return key;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    if (Number.isNaN(d.getTime()))
        return key;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function stringifyValue(value) {
    return value === undefined || value === null
        ? ''
        : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
}
/* --------------- host graph walker (mirrors the client Run loop) --------------- */
function evalExprHost(expr, result) {
    try {
        // eslint-disable-next-line no-new-func
        return new Function('result', `"use strict"; return (${expr});`)(result);
    }
    catch {
        return undefined;
    }
}
function evalConditionHost(expr, result) {
    return Boolean(evalExprHost(expr, result));
}
function renderTemplateHost(template, vars) {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => {
        const v = vars[k];
        return v === undefined ? m : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
}
/** Parse a node's `"provider|model"` route into subagent `agentOptions`. */
function parseAgentOptions(model) {
    if (!model)
        return undefined;
    const i = model.indexOf('|');
    if (i <= 0)
        return undefined;
    const provider = model.slice(0, i);
    const m = model.slice(i + 1);
    return provider && m ? { provider, model: m } : undefined;
}
/**
 * Execute a full workflow document as a graph (branching + loop/while), so a
 * scheduled run behaves like a manual Run. Returns a {@link RunRecord} with
 * one entry per executed node.
 */
async function runDocumentGraph(ctx, doc, initialInput) {
    const docNodes = Array.isArray(doc?.nodes) ? doc.nodes : [];
    const docEdges = Array.isArray(doc?.edges) ? doc.edges : [];
    const byId = new Map(docNodes.map((n) => [n.id, n]));
    const edgesFrom = (id) => docEdges.filter((e) => e.source === id);
    const records = new Map();
    const visited = new Set();
    let budget = 0;
    let ran = false;
    let lastOutput = typeof initialInput === 'string' ? initialInput : '';
    const recFor = (id) => {
        let r = records.get(id);
        if (!r) {
            r = { id, kind: String(byId.get(id)?.data.kind ?? ''), status: 'skipped', ms: 0 };
            records.set(id, r);
        }
        return r;
    };
    // Run one loop/while body iteration (fresh visited per iteration; `stopAt`
    // ends the sub-walk when control flows back to the loop node).
    const runLoopBody = async (iterateId, loopId, input) => {
        if (!iterateId)
            return input;
        const bodyVisited = new Set(visited);
        return await executeNode(iterateId, input, bodyVisited, loopId);
    };
    const executeNode = async (id, input, ctxVisited, stopAt) => {
        if (!byId.has(id))
            return input;
        if (id === stopAt)
            return input;
        if (ctxVisited.has(id))
            return input;
        ctxVisited.add(id);
        ran = true;
        budget += 1;
        if (budget > 100_000)
            throw new Error('超过运行步数上限（可能死循环）');
        const n = byId.get(id);
        const d = n.data;
        const rec = recFor(id);
        const t0 = Date.now();
        const setRec = (patch) => {
            Object.assign(rec, patch);
            rec.ms = Date.now() - t0;
        };
        const onError = d.onError === 'continue' ? 'continue' : 'stop';
        const fanOut = async (value) => {
            let last = value;
            for (const e of edgesFrom(id))
                last = await executeNode(e.target, value, ctxVisited, stopAt);
            return last;
        };
        try {
            if (d.kind === 'trigger' || d.kind === 'schedule') {
                const value = d.text ?? '';
                setRec({ status: 'ok', output: value });
                return await fanOut(value);
            }
            else if (d.kind === 'code') {
                let nodeError;
                let val = '';
                let logs = [];
                const ts = makeTimeoutSignal(d.timeout);
                try {
                    if (d.language === 'python') {
                        const py = await runPythonCode(d.code ?? '', input, ts.signal);
                        val = typeof py.value === 'string' ? py.value : '';
                        logs = py.logs ?? [];
                        nodeError = py.error?.message;
                    }
                    else {
                        const codeRuntime = ctx.get('codeRuntime');
                        if (!codeRuntime)
                            nodeError = 'codeRuntime unavailable on this host';
                        else {
                            const result = await codeRuntime.run({ program: d.code ?? '', bindings: buildCodeBindings(input), signal: ts.signal });
                            val = stringifyValue(result.value);
                            logs = result.logs ?? [];
                            nodeError = result.error?.message;
                        }
                    }
                }
                catch (err) {
                    nodeError = err instanceof Error ? err.message : String(err);
                }
                finally {
                    ts.clear();
                }
                setRec({ status: nodeError ? 'error' : 'ok', output: val, logs, error: nodeError });
                lastOutput = nodeError ? '' : (val || logs.join('\n'));
                if (nodeError) {
                    if (onError === 'continue')
                        return await fanOut('');
                    return input;
                }
                return await fanOut(val || logs.join('\n'));
            }
            else if (d.kind === 'agent') {
                const received = input;
                const prompt = [received, d.prompt ?? ''].map((s) => s.trim()).filter(Boolean).join('\n\n');
                const agents = ctx.get('agents');
                const subagents = ctx.get('subagents');
                let nodeError;
                let out = '';
                const ts = makeTimeoutSignal(d.timeout);
                try {
                    if (!agents || !subagents)
                        nodeError = 'subagent services unavailable on this host';
                    else {
                        const parent = agents.roots()[0] ?? agents.list()[0];
                        const provider = pickSubagentProvider(subagents);
                        if (!parent)
                            nodeError = 'no live agent to delegate from';
                        else if (!provider)
                            nodeError = 'no subagent provider registered';
                        else {
                            const run = await subagents.start(provider, {
                                label: 'workflow-agent',
                                prompt: [{ type: 'text', text: prompt }],
                                parent,
                                signal: ts.signal,
                                agentOptions: parseAgentOptions(d.model),
                            });
                            const result = await run.result;
                            nodeError = stopReasonError(result);
                            out = outputText(result);
                            void run.dispose().catch(() => { });
                        }
                    }
                }
                catch (err) {
                    nodeError = err instanceof Error ? err.message : String(err);
                }
                finally {
                    ts.clear();
                }
                setRec({ status: nodeError ? 'error' : 'ok', output: out, error: nodeError });
                lastOutput = nodeError ? '' : out;
                if (nodeError) {
                    if (onError === 'continue')
                        return await fanOut('');
                    return received;
                }
                return await fanOut(out);
            }
            else if (d.kind === 'output') {
                const template = (d.template ?? '').trim() ? d.template : '{{result}}';
                const rendered = renderTemplateHost(template, { result: input });
                setRec({ status: 'ok', output: rendered });
                lastOutput = rendered;
                return await fanOut(rendered);
            }
            else if (d.kind === 'if') {
                const ok = evalConditionHost(d.condition ?? '', input);
                setRec({ status: 'ok', output: String(ok) });
                const want = ok ? 'true' : 'false';
                const edge = edgesFrom(id).find((e) => (e.sourceHandle ?? 'true') === want);
                if (edge)
                    return await executeNode(edge.target, input, ctxVisited, stopAt);
                return input;
            }
            else if (d.kind === 'switch') {
                const val = evalExprHost(d.condition ?? '', input);
                setRec({ status: 'ok', output: String(val) });
                const cases = (d.cases ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                const sval = String(val);
                let edge = edgesFrom(id).find((e) => e.sourceHandle && cases.includes(e.sourceHandle) && e.sourceHandle === sval);
                if (!edge)
                    edge = edgesFrom(id).find((e) => e.sourceHandle === 'default');
                if (edge)
                    return await executeNode(edge.target, input, ctxVisited, stopAt);
                return input;
            }
            else if (d.kind === 'loop' || d.kind === 'while') {
                const value = await runLoopOrWhile(id, d, input);
                setRec({ status: 'ok', output: value });
                lastOutput = value;
                const doneEdge = edgesFrom(id).find((e) => e.sourceHandle === 'done' || (!e.sourceHandle && e.sourceHandle !== 'iterate'));
                if (doneEdge)
                    return await executeNode(doneEdge.target, value, ctxVisited, stopAt);
                return value;
            }
            return input;
        }
        catch (err) {
            setRec({ status: 'error', error: err instanceof Error ? err.message : String(err) });
            return input;
        }
    };
    const runLoopOrWhile = async (id, d, input) => {
        const loopId = id;
        const iterateEdge = edgesFrom(id).find((e) => e.sourceHandle === 'iterate');
        const maxIters = parseInt(d.maxIters ?? '', 10) || 100;
        const collect = Boolean(d.collect);
        const results = [];
        let count = 0;
        if (d.kind === 'loop') {
            let items = [];
            if ((d.mode ?? 'items') === 'count') {
                const c = parseInt(d.count ?? '', 10) || 0;
                items = Array.from({ length: c }, (_, i) => String(i + 1));
            }
            else {
                const arr = evalExprHost(d.itemsExpr ?? '', input);
                items = Array.isArray(arr) ? arr : [];
            }
            for (const it of items) {
                if (count >= maxIters)
                    break;
                count += 1;
                const item = typeof it === 'string' ? it : JSON.stringify(it);
                const r = await runLoopBody(iterateEdge?.target ?? '', loopId, item);
                if (collect)
                    results.push(r);
            }
            return collect ? JSON.stringify(results) : String(results.length ? results[results.length - 1] : input);
        }
        let cond = input;
        while (true) {
            if (count >= maxIters)
                break;
            const ok = evalConditionHost(d.condition ?? '', cond);
            if (!ok)
                break;
            count += 1;
            const r = await runLoopBody(iterateEdge?.target ?? '', loopId, cond);
            cond = r;
            if (collect)
                results.push(r);
        }
        return collect ? JSON.stringify(results) : String(cond);
    };
    const startIds = docNodes
        .filter((n) => n.data.kind === 'trigger' || n.data.kind === 'schedule')
        .map((n) => n.id);
    const starts = startIds.length > 0 ? startIds : docNodes.map((n) => n.id);
    for (const sid of starts)
        await executeNode(sid, '', visited);
    if (!ran && records.size === 0) {
        const rec = { id: '', kind: 'none', status: 'ok', output: 'no runnable nodes', ms: 0 };
        records.set('__none__', rec);
    }
    const nodes = [...records.values()];
    const failed = nodes.filter((n) => n.status === 'error').length;
    return {
        id: `run-${Date.now().toString(36)}`,
        name: '',
        startedAt: new Date().toISOString(),
        nodeCount: nodes.length,
        status: failed === 0 ? 'ok' : 'error',
        failed,
        value: lastOutput,
        nodes,
    };
}
/** Find the next fire time of a 5-field cron strictly after `from` (host local time). */
function nextCronFire(cron, from) {
    const f = cron.trim().split(/\s+/);
    if (f.length < 5)
        return null;
    const minP = parseCronField(f[0], 0, 59);
    const hrP = parseCronField(f[1], 0, 23);
    const dayP = parseCronField(f[2], 1, 31);
    const monP = parseCronField(f[3], 1, 12);
    const dowP = parseCronField(f[4], 0, 6);
    const start = new Date(from.getTime());
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() + 1); // next whole minute
    for (let dayOffset = 0; dayOffset < 366 * 2; dayOffset++) {
        const day = new Date(start);
        day.setDate(start.getDate() + dayOffset);
        if (!monP(day.getMonth() + 1))
            continue;
        if (!dayP(day.getDate()))
            continue;
        if (!dowP(day.getDay()))
            continue;
        const baseHour = dayOffset === 0 ? start.getHours() : 0;
        const baseMin = dayOffset === 0 ? start.getMinutes() : 0;
        for (let h = baseHour; h < 24; h++) {
            if (!hrP(h))
                continue;
            for (let m = h === baseHour ? baseMin : 0; m < 60; m++) {
                if (!minP(m))
                    continue;
                const d = new Date(day);
                d.setHours(h, m, 0, 0);
                if (d.getTime() > from.getTime())
                    return d;
            }
        }
    }
    return null;
}
/** Single-timer scheduler: arm for the earliest next fire across all schedules. */
let scheduleTimer;
function rescheduleScheduler(ctx) {
    if (scheduleTimer) {
        clearTimeout(scheduleTimer);
        scheduleTimer = undefined;
    }
    const schedules = loadSchedules();
    let next = null;
    for (const s of schedules) {
        const t = nextCronFire(s.cron, new Date());
        if (t && (next === null || t.getTime() < next.getTime()))
            next = t;
    }
    if (next === null)
        return;
    let delay = Math.max(0, next.getTime() - Date.now());
    const MAX = 2_147_000_000; // clamp below Node's 2^31-1 ms timer ceiling (~24.8 days)
    if (delay > MAX)
        delay = MAX;
    scheduleTimer = setTimeout(() => {
        scheduleTimer = undefined;
        runDueSchedules(ctx);
        rescheduleScheduler(ctx); // re-arm for the next occurrence
    }, delay);
}
/** Fire every schedule whose cron matches the current minute. */
function runDueSchedules(ctx) {
    const now = new Date();
    const minuteKey = now.toISOString().slice(0, 16);
    const schedules = loadSchedules();
    for (const sched of schedules) {
        if (sched.lastFired === minuteKey)
            continue;
        if (!cronMatches(sched.cron, now))
            continue;
        sched.lastFired = minuteKey;
        saveSchedules(schedules);
        const doc = sched.doc;
        if (!doc) {
            console.info(`[dsh-node-flow] schedule "${sched.name}" has no workflow snapshot; skipping`);
            continue;
        }
        void (async () => {
            const run = await runDocumentGraph(ctx, doc, sched.input);
            run.scheduleId = sched.id;
            run.name = sched.name;
            const runs = loadRuns();
            runs.unshift(run);
            saveRuns(runs);
            console.info(`[dsh-node-flow] scheduled run "${sched.name}" → ${run.status} (${run.failed} failed)`);
        })();
    }
}
export function apply(ctx) {
    // `inject: ['webServer']` guarantees this is present when apply runs.
    const webServer = ctx.webServer;
    ctx.effect(() => {
        const disposers = [];
        // --- code route ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/run',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                if (!sameOrigin(request))
                    return sendJson(response, 403, { error: 'untrusted origin' });
                let ts;
                try {
                    const body = (await readJsonBody(request, 256 * 1024));
                    const program = typeof body?.program === 'string' ? body.program : '';
                    if (!program.trim()) {
                        return sendJson(response, 400, { error: 'program must be a non-empty string' });
                    }
                    const language = typeof body?.language === 'string' ? body.language : 'typescript';
                    ts = makeTimeoutSignal(body?.timeout);
                    // Python runs through a host subprocess (ctx.codeRuntime has no
                    // Python backend); the flow input arrives via the DSH_INPUT env var.
                    if (language === 'python') {
                        const py = await runPythonCode(program, body?.input, ts.signal);
                        const failure = ts.isTimeout() ? { kind: 'abort', message: `运行超时（>${Number(body?.timeout)}s）` } : py.error;
                        return sendJson(response, 200, {
                            ok: true,
                            language: 'python',
                            value: py.value,
                            logs: py.logs,
                            failure,
                        });
                    }
                    const codeRuntime = ctx.get('codeRuntime');
                    if (!codeRuntime) {
                        return sendJson(response, 503, { error: 'codeRuntime unavailable on this host' });
                    }
                    if (language !== codeRuntime.language) {
                        return sendJson(response, 400, {
                            error: `unsupported language '${language}' (runtime is '${codeRuntime.language}')`,
                        });
                    }
                    const result = await codeRuntime.run({
                        program,
                        bindings: buildCodeBindings(body?.input),
                        signal: ts.signal,
                    });
                    const failure = ts.isTimeout() ? { kind: 'abort', message: `运行超时（>${Number(body?.timeout)}s）` } : result.error;
                    sendJson(response, 200, {
                        ok: true,
                        language: codeRuntime.language,
                        value: result.value,
                        logs: result.logs,
                        failure,
                    });
                }
                catch (err) {
                    if (ts?.isTimeout()) {
                        return sendJson(response, 200, { ok: true, value: undefined, logs: [], failure: { kind: 'abort', message: `运行超时（>${ts.seconds}s）` } });
                    }
                    sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
                finally {
                    ts?.clear();
                }
            },
        }));
        // --- agent route ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/run-agent',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                if (!sameOrigin(request))
                    return sendJson(response, 403, { error: 'untrusted origin' });
                let ts;
                try {
                    const body = (await readJsonBody(request, 256 * 1024));
                    const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
                    if (!prompt.trim()) {
                        return sendJson(response, 400, { error: 'prompt must be a non-empty string' });
                    }
                    const agents = ctx.get('agents');
                    const subagents = ctx.get('subagents');
                    if (!agents || !subagents) {
                        return sendJson(response, 503, {
                            error: 'subagent services unavailable on this host (ctx.agents / ctx.subagents)',
                        });
                    }
                    // Delegate from a live agent (root preferred) so the child derives
                    // workspace, lineage, and delegation depth correctly.
                    const parent = agents.roots()[0] ?? agents.list()[0];
                    if (!parent) {
                        return sendJson(response, 400, { error: 'no live agent to delegate from' });
                    }
                    const provider = pickSubagentProvider(subagents);
                    if (!provider) {
                        return sendJson(response, 400, { error: 'no subagent provider registered' });
                    }
                    ts = makeTimeoutSignal(body?.timeout);
                    // Optional per-child model route: "provider|modelId" picked in the canvas.
                    let agentOptions;
                    if (typeof body?.agentOptions === 'object' && body?.agentOptions !== null) {
                        const ao = body.agentOptions;
                        if (typeof ao.provider === 'string' && typeof ao.model === 'string' && ao.provider && ao.model) {
                            agentOptions = { provider: ao.provider, model: ao.model };
                        }
                    }
                    const run = await subagents.start(provider, {
                        label: 'workflow-agent',
                        prompt: [{ type: 'text', text: prompt }],
                        parent,
                        signal: ts.signal,
                        agentOptions,
                    });
                    let result;
                    try {
                        result = await run.result;
                    }
                    finally {
                        void run.dispose().catch(() => { });
                    }
                    const error = ts.isTimeout() ? `运行超时（>${Number(body?.timeout)}s）` : stopReasonError(result);
                    sendJson(response, 200, {
                        ok: true,
                        output: outputText(result),
                        stopReason: result.stopReason,
                        error,
                        structured: result.structured,
                    });
                }
                catch (err) {
                    if (ts?.isTimeout()) {
                        return sendJson(response, 200, { ok: true, output: '', error: `运行超时（>${ts.seconds}s）` });
                    }
                    sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
                finally {
                    ts?.clear();
                }
            },
        }));
        // --- model list route (populates the agent-node model dropdown) ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/models',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                if (!sameOrigin(request))
                    return sendJson(response, 403, { error: 'untrusted origin' });
                const llm = ctx.get('llm');
                if (!llm) {
                    return sendJson(response, 200, { models: [] });
                }
                const models = [];
                let providers = [];
                try {
                    providers = await llm.listProviders();
                }
                catch {
                    providers = [];
                }
                for (const p of providers) {
                    try {
                        const list = await llm.listModels(p.id);
                        for (const m of list) {
                            if (typeof m.id === 'string' && m.id.length > 0) {
                                models.push({ provider: p.id, id: m.id, name: m.name || m.id });
                            }
                        }
                    }
                    catch {
                        // Provider that cannot enumerate models is skipped.
                    }
                }
                sendJson(response, 200, { models });
            },
        }));
        // --- schedule routes ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/schedule',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                if (!sameOrigin(request))
                    return sendJson(response, 403, { error: 'untrusted origin' });
                try {
                    const body = (await readJsonBody(request, 256 * 1024));
                    const schedules = loadSchedules();
                    if (body?.action === 'clear') {
                        const id = String(body.id ?? '');
                        const next = schedules.filter((s) => s.id !== id);
                        writeJson(schedulesFile(), next);
                        rescheduleScheduler(ctx);
                        return sendJson(response, 200, { ok: true, schedules: next.map((s) => ({ id: s.id, name: s.name, cron: s.cron })) });
                    }
                    // Manual "run now" from the scheduled-task board.
                    if (body?.action === 'run') {
                        const id = String(body.id ?? '');
                        const sched = schedules.find((s) => s.id === id);
                        if (!sched)
                            return sendJson(response, 404, { error: 'schedule not found' });
                        if (!sched.doc)
                            return sendJson(response, 400, { error: 'schedule has no workflow snapshot' });
                        const run = await runDocumentGraph(ctx, sched.doc, sched.input);
                        run.scheduleId = sched.id;
                        run.name = sched.name;
                        const runs = loadRuns();
                        runs.unshift(run);
                        saveRuns(runs);
                        return sendJson(response, 200, { ok: true, run });
                    }
                    const id = String(body?.id ?? `s-${Date.now().toString(36)}`);
                    const cron = String(body?.cron ?? '');
                    const name = String(body?.name ?? 'scheduled workflow');
                    const steps = Array.isArray(body?.steps) ? body.steps : [];
                    const doc = body?.doc && typeof body.doc === 'object' ? body.doc : undefined;
                    if (!cron.trim() || (!steps.length && !doc)) {
                        return sendJson(response, 400, { error: 'cron and steps (or doc) are required' });
                    }
                    const next = schedules.filter((s) => s.id !== id);
                    next.push({
                        id,
                        name,
                        cron,
                        input: typeof body?.input === 'string' ? body.input : '',
                        steps,
                        doc,
                    });
                    writeJson(schedulesFile(), next);
                    rescheduleScheduler(ctx);
                    return sendJson(response, 200, { ok: true, schedules: next.map((s) => ({ id: s.id, name: s.name, cron: s.cron })) });
                }
                catch (err) {
                    return sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/schedules',
            handler: (request, response) => {
                if (request.method !== 'GET') {
                    response.writeHead(405, { allow: 'GET' });
                    response.end();
                    return;
                }
                const list = loadSchedules().map((s) => ({
                    id: s.id,
                    name: s.name,
                    cron: s.cron,
                    input: s.input,
                    lastFired: s.lastFired ? utcMinuteKeyToLocal(s.lastFired) : undefined,
                    doc: s.doc,
                }));
                sendJson(response, 200, { schedules: list });
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/runs',
            handler: (request, response) => {
                if (request.method !== 'GET') {
                    response.writeHead(405, { allow: 'GET' });
                    response.end();
                    return;
                }
                sendJson(response, 200, { runs: loadRuns() });
            },
        }));
        // Arm the single next-fire scheduler (re-armed on save/clear and after each
        // fire); stop it on unload.
        rescheduleScheduler(ctx);
        return () => {
            if (scheduleTimer)
                clearTimeout(scheduleTimer);
            for (const dispose of disposers.splice(0))
                dispose();
        };
    });
}
