/**
 * DSH plugin entry for dsh-node-flow.
 *
 * Registers same-origin HTTP routes so canvas nodes can really execute on the
 * host, plus a scheduled-task engine (cron → host graph walker).
 *
 * - `/dsh-node-flow/run` — execute a code node with the host Python interpreter
 *   (`python -u -c <code>`); the flow input arrives in `DSH_INPUT`. Python is
 *   the only code runtime: the former TypeScript/`ctx.ptcRuntime` path is gone.
 * - `/dsh-node-flow/run-agent` — delegate an agent node to a DSH
 *   subagent via `ctx.subagents.startActivation`, parented on a live root agent.
 * - `/dsh-node-flow/{schedule,schedules,runs,models}` — schedule/list/runs
 *   management and the agent model dropdown.
 * - `/dsh-node-flow/health` — capability report + a real runtime self-test,
 *   also written to `$DSH_HOME/workflow-canvas/health.json` on activation.
 *
 * The host half waits for `webServer` (the standard `inject` property) so the
 * routes always mount on the live server. Optional services are re-read at
 * call time, so a late provider still works; without a service a route returns
 * a clear JSON error instead of failing the canvas.
 *
 * @module dsh-node-flow
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_EXAMPLES } from './model.js';
export const name = 'dsh-node-flow';
export const inject = ['webServer'];
/**
 * Build marker written into `health.json`. Bump it when the host half changes
 * so a stale module generation (a host that has not reloaded the plugin yet)
 * is visible in the report instead of being guessed at.
 */
const BUILD_REVISION = '2026-11-02.1';
/**
 * Wall-clock ceiling for one Python code node. The per-node `timeout` (seconds)
 * aborts earlier through the node's AbortSignal; this value only guarantees a
 * runaway program cannot outlive the run.
 */
const PYTHON_HARD_TIMEOUT_MS = 600_000;
/** Host names that mean "this machine"; the desktop shell may use any of them. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
function isLoopbackHostname(hostname) {
    const h = hostname.toLowerCase();
    return LOOPBACK_HOSTNAMES.has(h) || h.endsWith('.localhost');
}
/**
 * Local fallback for a host without `ctx.connection`: the request Origin must
 * name the same authority as its Host header, treating loopback aliases
 * (`localhost` / `127.0.0.1` / `[::1]`) as the same machine — the desktop
 * shell does not always spell them the same way in both headers.
 */
function sameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!origin || !host)
        return false;
    try {
        const originUrl = new URL(origin);
        const hostUrl = new URL(`http://${host}`);
        const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80');
        const hostPort = hostUrl.port || '80';
        if (originPort !== hostPort)
            return false;
        if (originUrl.hostname === hostUrl.hostname)
            return true;
        return isLoopbackHostname(originUrl.hostname) && isLoopbackHostname(hostUrl.hostname);
    }
    catch {
        return false;
    }
}
/**
 * Browser-enforced proof that the request comes from a page on this very
 * loopback origin: `Sec-Fetch-Site` is set by the user agent (a foreign page
 * cannot claim `same-origin`), and the Host must be a loopback authority.
 * The desktop shell loads the app under an authority its Host header does not
 * always spell identically, which an Origin comparison alone cannot see.
 */
function localSameOriginProof(request) {
    const site = request.headers['sec-fetch-site'];
    if (typeof site !== 'string')
        return false;
    if (site !== 'same-origin' && site !== 'none')
        return false;
    const host = request.headers.host;
    if (!host)
        return false;
    try {
        return isLoopbackHostname(new URL(`http://${host}`).hostname);
    }
    catch {
        return false;
    }
}
/**
 * Persist a few route decisions so a rejected canvas call can be explained
 * without reproducing it (the canvas only surfaces the status text).
 */
function recordDecision(request, decision) {
    const file = join(dataDir(), 'requests.json');
    const previous = readJson(file, []);
    previous.unshift(decision);
    writeJson(file, previous.slice(0, 20));
}
/**
 * Decide whether a route may serve this request.
 *
 * DSH's `connection` service owns the Host/Origin checks and browser
 * authentication for every Web route, so it is asked first. When it refuses,
 * the only accepted counter-evidence is a browser-enforced same-origin marker
 * on a loopback Host — the desktop shell’s case, where a hand-rolled Origin
 * comparison fails while the request demonstrably comes from the app's own
 * page. A foreign Origin (`Sec-Fetch-Site: cross-site`) is never admitted.
 */
function routeRejection(ctx, request) {
    const base = {
        at: new Date().toISOString(),
        path: request.url ?? '',
        method: request.method ?? '',
        origin: request.headers.origin,
        host: request.headers.host,
        secFetchSite: typeof request.headers['sec-fetch-site'] === 'string' ? request.headers['sec-fetch-site'] : undefined,
    };
    const connection = ctx.get('connection');
    let gate = 'connection';
    let rejection;
    if (connection !== undefined && typeof connection.requestRejection === 'function') {
        try {
            rejection = connection.requestRejection({ headers: request.headers });
        }
        catch {
            gate = 'connection-error';
            rejection = undefined;
        }
    }
    else {
        gate = 'fallback';
        rejection = sameOrigin(request) ? undefined : 403;
    }
    if (rejection === undefined) {
        recordDecision(request, { ...base, gate, verdict: 'accepted' });
        return undefined;
    }
    if (localSameOriginProof(request)) {
        recordDecision(request, { ...base, gate: 'local-same-origin', verdict: 'accepted' });
        return undefined;
    }
    recordDecision(request, { ...base, gate, verdict: rejection });
    return rejection;
}
/** Reject a route call with the trust gate's status and a readable reason. */
function rejectUntrusted(response, status) {
    sendJson(response, status, {
        error: status === 401
            ? 'authentication required: reopen the DSH page from the URL printed by dsh web'
            : 'untrusted origin: this route only serves the DSH page',
    });
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
/**
 * Pick a subagent provider: prefer the known in-process names, else the first
 * registered one. The provider object is returned because its `capabilities`
 * decide whether a per-node model route can be honored.
 */
function pickSubagentProvider(subagents) {
    for (const name of ['spawn', 'fork', 'acp']) {
        const provider = subagents.getProvider(name);
        if (provider !== undefined)
            return provider;
    }
    for (const name of subagents.list()) {
        const provider = subagents.getProvider(name);
        if (provider !== undefined)
            return provider;
    }
    return undefined;
}
/**
 * Delegate one prompt to a child agent through the 0.2.x activation seam.
 *
 * `delivery: 'caller'` keeps the child's final text for this caller instead of
 * appending it to the parent agent's conversation: a workflow run is not a
 * turn in the user's chat. `subagents.startActivation` is the successor of the
 * removed `subagents.start(name, request)`.
 */
async function delegateToSubagent(subagents, parent, prompt, label, agentOptions, signal) {
    const provider = pickSubagentProvider(subagents);
    if (provider === undefined)
        return { output: '', error: 'no subagent provider registered' };
    if (agentOptions !== undefined && provider.capabilities?.agentOptions === false) {
        return {
            output: '',
            error: `subagent provider '${provider.name}' cannot honor a per-node model route`,
        };
    }
    // Mirror the depth policy the built-in delegation tools use; a host without
    // `resolveMaxDepth` keeps its own default.
    let maxDepth;
    try {
        if (typeof subagents.resolveMaxDepth === 'function')
            maxDepth = subagents.resolveMaxDepth();
    }
    catch {
        maxDepth = undefined;
    }
    const activation = await subagents.startActivation({
        provider: provider.name,
        label: label || 'workflow-agent',
        request: {
            prompt: [{ type: 'text', text: prompt }],
            parent,
            ...(agentOptions === undefined ? {} : { agentOptions }),
            ...(maxDepth === undefined ? {} : { maxDepth }),
        },
        signal,
        delivery: 'caller',
    });
    let result;
    try {
        result = await activation.result;
    }
    finally {
        void activation.dispose().catch(() => { });
    }
    return { output: outputText(result), error: stopReasonError(result) };
}
/**
 * Execute a Python code node via a host subprocess. The node reads its flow
 * input from the `DSH_INPUT` env var and prints its result to stdout (captured
 * as the node value). A non-zero exit or stderr becomes the node's error.
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
        // Windows' C runtime parses TZ as a POSIX spec; an IANA name such as
        // "Asia/Shanghai" makes localtime() drift silently (measured -7h here).
        // Dropping it makes Python use the system time zone like every other app.
        delete env.TZ;
        // Prefer a conventional interpreter name; fall back to a couple of aliases.
        const candidates = ['python', 'python3', 'py'];
        const tryRun = (i) => {
            if (i >= candidates.length) {
                resolve({ logs: [], error: { kind: 'exception', message: 'no Python interpreter found (tried python, python3, py)' } });
                return;
            }
            const cmd = candidates[i];
            execFile(cmd, ['-u', '-c', code], { env, timeout: PYTHON_HARD_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, signal }, (error, stdout, stderr) => {
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
/** Run history retention, mirroring the built-in scheduler's own defaults. */
const RUN_RETENTION_DAYS = 30;
const RUN_RETENTION_RECORDS = 200;
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
/** What the board needs about one task without shipping its whole document. */
function scheduleSummary(record) {
    const active = record.status !== 'ended';
    // The durable anchor is the truth; a record without one only exists mid-
    // migration, and falling back keeps the board honest in that window.
    const anchor = record.nextFireAt ?? (active ? (nextCronFire(record.cron, new Date())?.toISOString() ?? null) : null);
    const overdue = active && anchor !== null && Date.parse(anchor) <= Date.now();
    return {
        id: record.id,
        name: record.name,
        cron: record.cron,
        input: record.input ?? '',
        status: active ? 'active' : 'ended',
        workflowKey: workflowKeyOf(record.name),
        hasWorkflow: record.doc !== undefined,
        ...(record.lastFired === undefined ? {} : { lastFired: record.lastFired }),
        ...(active && anchor !== null ? { nextFire: anchor } : {}),
        ...(overdue ? { overdue: true } : {}),
    };
}
function loadRuns() {
    return readJson(runsFile(), []);
}
function saveRuns(runs) {
    writeJson(runsFile(), runs.slice(0, 50));
}
/* ------------------------- immutable run history ------------------------- */
function runsDir() {
    return join(dataDir(), 'runs');
}
/** Group runs of the same workflow: its normalized name, else `untitled`. */
function workflowKeyOf(name) {
    const key = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return key.length > 0 ? key.slice(0, 80) : 'untitled';
}
/** A sortable, unique run id: time first so directory order is chronological. */
function newRunId(now = Date.now()) {
    const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    return `run-${now.toString(36).padStart(9, '0')}-${suffix}`;
}
/* ---------------------------- workflow files ---------------------------- */
/** `$DSH_HOME/workflow-canvas/workflows` — one JSON document per saved workflow. */
function workflowsDir() {
    const dir = join(dataDir(), 'workflows');
    mkdirSync(dir, { recursive: true });
    return dir;
}
/** Ids become file names, so keep them to a conservative character set. */
const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
function workflowPath(id) {
    return WORKFLOW_ID_PATTERN.test(id) ? join(workflowsDir(), `${id}.json`) : undefined;
}
function newWorkflowId() {
    return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
function listWorkflows() {
    const dir = workflowsDir();
    const out = [];
    for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.json'))
            continue;
        const id = entry.slice(0, -'.json'.length);
        if (!WORKFLOW_ID_PATTERN.test(id))
            continue;
        try {
            const doc = JSON.parse(readFileSync(join(dir, entry), 'utf8'));
            out.push({
                id,
                name: typeof doc.name === 'string' && doc.name.trim() ? doc.name : id,
                ...(typeof doc.description === 'string' ? { description: doc.description } : {}),
                ...(typeof doc.updatedAt === 'string' ? { updatedAt: doc.updatedAt } : {}),
                nodeCount: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
            });
        }
        catch {
            /* a malformed file is skipped, not fatal */
        }
    }
    return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}
function readWorkflow(id) {
    const path = workflowPath(id);
    if (path === undefined || !existsSync(path))
        return undefined;
    try {
        const doc = JSON.parse(readFileSync(path, 'utf8'));
        if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges))
            return undefined;
        return { ...doc, id };
    }
    catch {
        return undefined;
    }
}
/**
 * Keep library names distinct, because the list is the only way to tell two
 * workflows apart. `name`, `name (2)`, `name (3)`… — the file id never changes,
 * so this is purely the display title stored inside the document.
 */
function uniqueWorkflowName(desired, exceptId) {
    const base = (typeof desired === 'string' ? desired.trim() : '') || 'Untitled workflow';
    const owner = new Map(listWorkflows().map((w) => [w.name.trim().toLowerCase(), w.id]));
    const held = (candidate) => {
        const id = owner.get(candidate.trim().toLowerCase());
        return id !== undefined && id !== exceptId;
    };
    if (!held(base))
        return base;
    for (let i = 2; i < 1000; i += 1) {
        const candidate = `${base} (${i})`;
        if (!held(candidate))
            return candidate;
    }
    return `${base} (${Date.now().toString(36)})`;
}
/** Write through a temp file + rename so a crash never leaves half a workflow. */
function writeWorkflow(id, doc) {
    const path = workflowPath(id);
    if (path === undefined)
        throw new Error('invalid workflow id');
    const updatedAt = new Date().toISOString();
    const payload = { ...doc, id, updatedAt };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, path);
    return updatedAt;
}
/** First run: materialise the built-in templates as ordinary workflow files. */
function seedExampleWorkflows() {
    const dir = workflowsDir();
    if (readdirSync(dir).some((entry) => entry.endsWith('.json')))
        return;
    for (const example of BUILTIN_EXAMPLES) {
        try {
            writeWorkflow(example.id, example.build());
        }
        catch {
            /* one bad template must not block the others */
        }
    }
}
const LISTENER_QUEUE_LIMIT = 5;
const LISTENER_LOG_LINES = 200;
const listenerRuntimes = new Map();
/** Set on activation so a fire can run the graph without threading ctx everywhere. */
let listenerCtx;
function listenersFile() {
    return join(dataDir(), 'listeners.json');
}
function listenerKey(workflowId, nodeId) {
    return `${workflowId}::${nodeId}`;
}
function listenerStates() {
    return [...listenerRuntimes.values()].map((rt) => rt.state);
}
function persistListeners() {
    try {
        writeJson(listenersFile(), listenerStates());
    }
    catch {
        /* diagnostics only */
    }
}
function loadPersistedListeners() {
    const raw = readJson(listenersFile(), []);
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const entry of raw) {
        const e = entry;
        if (typeof e.workflowId !== 'string' || typeof e.nodeId !== 'string')
            continue;
        out.push({
            workflowId: e.workflowId,
            nodeId: e.nodeId,
            label: typeof e.label === 'string' ? e.label : e.nodeId,
            enabled: e.enabled === true,
            status: e.status === 'error' ? 'error' : 'stopped',
            fireCount: Number.isFinite(e.fireCount) ? Number(e.fireCount) : 0,
            droppedCount: Number.isFinite(e.droppedCount) ? Number(e.droppedCount) : 0,
            queued: 0,
            minIntervalMs: Number.isFinite(e.minIntervalMs) ? Number(e.minIntervalMs) : 500,
            ...(typeof e.startedAt === 'string' ? { startedAt: e.startedAt } : {}),
            ...(typeof e.lastEventAt === 'string' ? { lastEventAt: e.lastEventAt } : {}),
            ...(typeof e.readyLine === 'string' ? { readyLine: e.readyLine } : {}),
            ...(typeof e.lastError === 'string' ? { lastError: e.lastError } : {}),
        });
    }
    return out;
}
/** Working directory for a listener script: its workflow's workspace, else host cwd. */
function listenerCwd(ctx, doc) {
    const registry = ctx.get('workspaceRegistry');
    const id = doc.executionWorkspaceId;
    if (registry !== undefined && typeof id === 'string') {
        const workspace = registry.list().find((w) => w.id === id);
        if (workspace?.path)
            return workspace.path;
    }
    return process.cwd();
}
/**
 * Spawn the listener program, falling back through the usual interpreter names.
 * stdout lines go to `onLine`, stderr lines to `onLog`.
 */
function spawnPythonProgram(code, cwd, onLine, onLog) {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    // Same TZ caveat as runPythonCode: let the listener see the real system clock.
    delete env.TZ;
    const candidates = ['python', 'python3', 'py'];
    return new Promise((resolve, reject) => {
        const attempt = (index) => {
            if (index >= candidates.length) {
                reject(new Error('找不到 Python 解释器（尝试 python / python3 / py）'));
                return;
            }
            const child = spawn(candidates[index], ['-u', '-c', code], { cwd, env, windowsHide: true });
            let settled = false;
            child.once('spawn', () => {
                settled = true;
                let outBuffer = '';
                child.stdout?.on('data', (chunk) => {
                    outBuffer += chunk.toString();
                    let newline = outBuffer.indexOf('\n');
                    while (newline >= 0) {
                        onLine(outBuffer.slice(0, newline).replace(/\r$/, ''));
                        outBuffer = outBuffer.slice(newline + 1);
                        newline = outBuffer.indexOf('\n');
                    }
                });
                let errBuffer = '';
                child.stderr?.on('data', (chunk) => {
                    errBuffer += chunk.toString();
                    let newline = errBuffer.indexOf('\n');
                    while (newline >= 0) {
                        onLog(errBuffer.slice(0, newline).replace(/\r$/, ''));
                        errBuffer = errBuffer.slice(newline + 1);
                        newline = errBuffer.indexOf('\n');
                    }
                });
                resolve(child);
            });
            child.once('error', (error) => {
                if (settled)
                    return;
                if (error.code === 'ENOENT') {
                    attempt(index + 1);
                    return;
                }
                reject(error);
            });
        };
        attempt(0);
    });
}
function killProcessTree(pid) {
    try {
        if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
            killer.on('error', () => {
                /* best effort */
            });
            return;
        }
        process.kill(-pid, 'SIGTERM');
    }
    catch {
        /* best effort */
    }
}
function pushListenerLog(rt, line) {
    const text = line.trimEnd();
    if (text === '')
        return;
    rt.logs.push(text.slice(0, 2000));
    if (rt.logs.length > LISTENER_LOG_LINES)
        rt.logs.splice(0, rt.logs.length - LISTENER_LOG_LINES);
}
/** One stdout line: `[ready] …` is a status line, anything else is an event. */
function enqueueListenerEvent(rt, line) {
    // Once stop/delete has started the process is being killed: lines still in
    // flight must not start another run.
    if (rt.stopping)
        return;
    const text = line.trim();
    if (text === '')
        return;
    if (text.startsWith('[ready]')) {
        rt.state.readyLine = text.slice('[ready]'.length).trim();
        persistListeners();
        return;
    }
    const now = Date.now();
    // Bursts inside minIntervalMs collapse onto the newest event.
    if (rt.state.minIntervalMs > 0 && now - rt.lastEnqueueAt < rt.state.minIntervalMs && rt.queue.length > 0) {
        rt.queue[rt.queue.length - 1] = text;
        rt.lastEnqueueAt = now;
        persistListeners();
        return;
    }
    rt.lastEnqueueAt = now;
    if (rt.queue.length >= LISTENER_QUEUE_LIMIT) {
        rt.queue.shift();
        rt.state.droppedCount += 1;
    }
    rt.queue.push(text);
    rt.state.queued = rt.queue.length;
    rt.events.push(text.slice(0, 2000));
    if (rt.events.length > 20)
        rt.events.shift();
    persistListeners();
    drainListener(rt);
}
/** Run queued events one at a time; a fire never starts while another runs. */
function drainListener(rt) {
    if (rt.inflight)
        return;
    const ctx = listenerCtx;
    if (ctx === undefined)
        return;
    const next = rt.queue.shift();
    rt.state.queued = rt.queue.length;
    if (next === undefined)
        return;
    rt.inflight = true;
    const startedAt = Date.now();
    void (async () => {
        try {
            if (rt.doc === undefined)
                throw new Error('监听工作流快照缺失');
            const run = await runDocumentGraph(ctx, rt.doc, next);
            const file = runFileFromRecord(run, rt.doc, 'listen', Date.now() - startedAt);
            file.workflowId = rt.state.workflowId;
            file.nodeId = rt.state.nodeId;
            persistRun(file);
            rt.state.fireCount += 1;
            rt.state.lastEventAt = new Date().toISOString();
        }
        catch (err) {
            rt.state.lastError = err instanceof Error ? err.message : String(err);
        }
        finally {
            rt.inflight = false;
            persistListeners();
            drainListener(rt);
        }
    })();
}
function onListenerExit(rt, code, signal) {
    const wasStopping = rt.stopping;
    rt.child = undefined;
    rt.state.pid = undefined;
    rt.queue = [];
    rt.state.queued = 0;
    rt.state.lastExitCode = code;
    if (wasStopping) {
        rt.state.status = 'stopped';
    }
    else {
        rt.state.status = 'error';
        rt.state.enabled = false;
        rt.state.lastError = code === 0 ? '监听进程已退出' : `监听进程异常退出（码 ${code ?? signal ?? '?'}）`;
        console.info(`[dsh-node-flow] listener "${rt.state.label}" exited (${String(code ?? signal)})`);
    }
    persistListeners();
}
async function startListener(ctx, workflowId, nodeId) {
    const key = listenerKey(workflowId, nodeId);
    const current = listenerRuntimes.get(key);
    if (current?.child !== undefined)
        return current.state;
    const doc = readWorkflow(workflowId);
    if (doc === undefined)
        throw new Error('工作流文件不存在，请先保存工作流');
    const node = doc.nodes.find((n) => n.id === nodeId && n.data.kind === 'listen');
    if (node === undefined)
        throw new Error('工作流文件里找不到这个监听节点，请先保存');
    const code = typeof node.data.code === 'string' ? node.data.code : '';
    if (code.trim() === '')
        throw new Error('监听代码是空的');
    const rawInterval = parseInt(String(node.data.minIntervalMs ?? '500'), 10);
    const minIntervalMs = Math.min(60_000, Math.max(0, Number.isFinite(rawInterval) ? rawInterval : 500));
    const state = {
        workflowId,
        nodeId,
        label: node.data.label,
        enabled: true,
        status: 'running',
        startedAt: new Date().toISOString(),
        fireCount: current?.state.fireCount ?? 0,
        droppedCount: current?.state.droppedCount ?? 0,
        queued: 0,
        minIntervalMs,
    };
    const rt = {
        state,
        doc,
        logs: [],
        events: [],
        queue: [],
        inflight: false,
        lastEnqueueAt: 0,
        stopping: false,
    };
    listenerRuntimes.set(key, rt);
    listenerCtx = ctx;
    try {
        const child = await spawnPythonProgram(code, listenerCwd(ctx, doc), (line) => enqueueListenerEvent(rt, line), (line) => pushListenerLog(rt, line));
        rt.child = child;
        state.pid = child.pid;
        child.on('exit', (exitCode, signal) => onListenerExit(rt, exitCode, signal));
        persistListeners();
        console.info(`[dsh-node-flow] listener "${state.label}" started (pid ${String(state.pid)})`);
        return state;
    }
    catch (error) {
        state.status = 'error';
        state.enabled = false;
        state.lastError = error instanceof Error ? error.message : String(error);
        persistListeners();
        throw error;
    }
}
function stopListener(workflowId, nodeId, options = {}) {
    const rt = listenerRuntimes.get(listenerKey(workflowId, nodeId));
    if (rt === undefined)
        return undefined;
    rt.stopping = true;
    rt.queue = [];
    rt.state.queued = 0;
    const child = rt.child;
    const pid = child?.pid;
    rt.child = undefined;
    if (pid !== undefined)
        killProcessTree(pid);
    rt.state.status = 'stopped';
    rt.state.pid = undefined;
    rt.state.readyLine = undefined;
    if (options.keepEnabled !== true)
        rt.state.enabled = false;
    persistListeners();
    return rt.state;
}
/**
 * Forget a listener entirely: stop it (if running) and drop its record so the
 * board no longer lists it. The workflow node itself is untouched.
 */
function deleteListener(workflowId, nodeId) {
    const key = listenerKey(workflowId, nodeId);
    if (!listenerRuntimes.has(key))
        return false;
    stopListener(workflowId, nodeId);
    listenerRuntimes.delete(key);
    persistListeners();
    return true;
}
/**
 * Delete every stored run that belongs to this listener (workflow + node).
 * Only that listener's history is touched — schedules and manual runs keep
 * theirs. The legacy `runs.json` list is pruned in step.
 */
function clearListenerRuns(workflowId, nodeId) {
    let names;
    try {
        names = readdirSync(runsDir()).filter((name) => name.startsWith('run-') && name.endsWith('.json'));
    }
    catch {
        return 0;
    }
    const removed = new Set();
    for (const name of names) {
        const file = join(runsDir(), name);
        const run = readJson(file, undefined);
        if (run === undefined || run === null || typeof run !== 'object')
            continue;
        if (run.workflowId !== workflowId || run.nodeId !== nodeId)
            continue;
        try {
            rmSync(file, { force: true });
            removed.add(run.runId);
        }
        catch {
            /* a run that cannot be deleted is not worth failing the request */
        }
    }
    if (removed.size > 0) {
        saveRuns(loadRuns().filter((entry) => !removed.has(entry.id)));
    }
    return removed.size;
}
/** Re-arm the listeners that were enabled when the host last stopped. */
function restoreListeners(ctx) {
    for (const state of loadPersistedListeners()) {
        listenerRuntimes.set(listenerKey(state.workflowId, state.nodeId), {
            state,
            logs: [],
            events: [],
            queue: [],
            inflight: false,
            lastEnqueueAt: 0,
            stopping: false,
        });
    }
    for (const rt of [...listenerRuntimes.values()]) {
        if (!rt.state.enabled)
            continue;
        void startListener(ctx, rt.state.workflowId, rt.state.nodeId).catch((error) => {
            rt.state.status = 'error';
            rt.state.enabled = false;
            rt.state.lastError = error instanceof Error ? error.message : String(error);
            persistListeners();
        });
    }
}
/** Host shutdown: kill every listener process but keep `enabled` for next time. */
function stopAllListeners() {
    for (const rt of listenerRuntimes.values()) {
        const pid = rt.child?.pid;
        rt.stopping = true;
        rt.child = undefined;
        if (pid !== undefined)
            killProcessTree(pid);
        rt.state.status = 'stopped';
        rt.state.pid = undefined;
        rt.queue = [];
        rt.state.queued = 0;
    }
    persistListeners();
}
/**
 * Persist one run as its own file, then prune history.
 *
 * `runs.json` (the legacy 50-entry list the old board read) is kept in sync
 * while both shapes exist, so nothing that still reads it goes blind.
 */
function persistRun(run) {
    try {
        mkdirSync(runsDir(), { recursive: true });
        writeFileSync(join(runsDir(), `${run.runId}.json`), JSON.stringify(run, null, 2));
    }
    catch {
        return;
    }
    pruneRuns();
    const legacy = loadRuns();
    legacy.unshift({
        id: run.runId,
        ...(run.scheduleId === undefined ? {} : { scheduleId: run.scheduleId }),
        name: run.workflowName,
        startedAt: run.startedAt,
        nodeCount: run.nodes.length,
        status: run.status,
        failed: run.failed,
        ...(run.output === undefined ? {} : { value: run.output }),
        nodes: run.nodes.map((node) => ({
            id: node.id,
            kind: node.kind,
            status: node.status,
            ms: node.ms,
            ...(node.output === undefined ? {} : { output: node.output }),
            ...(node.error === undefined ? {} : { error: node.error }),
            ...(node.logs === undefined ? {} : { logs: node.logs }),
            ...(node.attempts === undefined ? {} : { attempts: node.attempts }),
        })),
    });
    saveRuns(legacy);
}
/** Drop runs past the retention window, newest first (both caps). */
function pruneRuns(now = Date.now()) {
    let names;
    try {
        names = readdirSync(runsDir()).filter((name) => name.startsWith('run-') && name.endsWith('.json'));
    }
    catch {
        return;
    }
    names.sort().reverse();
    const cutoff = now - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    names.forEach((name, index) => {
        const file = join(runsDir(), name);
        let stale = index >= RUN_RETENTION_RECORDS;
        if (!stale) {
            try {
                stale = statSync(file).mtimeMs < cutoff;
            }
            catch {
                stale = false;
            }
        }
        if (!stale)
            return;
        try {
            rmSync(file, { force: true });
        }
        catch {
            /* a run that cannot be pruned is not worth failing a run over */
        }
    });
}
function runMeta(run) {
    return {
        runId: run.runId,
        workflowName: run.workflowName,
        workflowKey: run.workflowKey,
        ...(run.workflowId === undefined ? {} : { workflowId: run.workflowId }),
        ...(run.nodeId === undefined ? {} : { nodeId: run.nodeId }),
        ...(run.scheduleId === undefined ? {} : { scheduleId: run.scheduleId }),
        trigger: run.trigger,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        status: run.status,
        failed: run.failed,
        nodeCount: run.nodes.length,
    };
}
function loadRun(runId) {
    if (!/^run-[a-z0-9-]+$/i.test(runId))
        return undefined;
    const file = join(runsDir(), `${runId}.json`);
    const run = readJson(file, undefined);
    if (run === undefined || typeof run !== 'object' || run === null)
        return undefined;
    return run;
}
/**
 * Every run's metadata, newest first, with the list filters applied. Broken
 * files are skipped rather than failing the whole list.
 */
function listRuns(filter) {
    let names;
    try {
        names = readdirSync(runsDir()).filter((name) => name.startsWith('run-') && name.endsWith('.json'));
    }
    catch {
        return [];
    }
    names.sort().reverse();
    const limit = Math.max(1, Math.min(500, Math.floor(Number(filter.limit)) || 100));
    const search = typeof filter.search === 'string' ? filter.search.trim().toLowerCase() : '';
    const out = [];
    for (const name of names) {
        if (out.length >= limit)
            break;
        const run = readJson(join(runsDir(), name), undefined);
        if (run === undefined || typeof run !== 'object' || run === null)
            continue;
        const meta = runMeta(run);
        if (filter.workflowKey !== undefined && meta.workflowKey !== filter.workflowKey)
            continue;
        if (filter.workflowId !== undefined && meta.workflowId !== filter.workflowId)
            continue;
        if (filter.nodeId !== undefined && meta.nodeId !== filter.nodeId)
            continue;
        if (filter.scheduleId !== undefined && meta.scheduleId !== filter.scheduleId)
            continue;
        if (search.length > 0) {
            const haystack = `${meta.workflowName} ${meta.status} ${meta.trigger} ${meta.startedAt}`.toLowerCase();
            const inNodes = run.nodes.some((node) => (typeof node.output === 'string' && node.output.toLowerCase().includes(search)) ||
                (typeof node.error === 'string' && node.error.toLowerCase().includes(search)));
            if (!haystack.includes(search) && !inNodes)
                continue;
        }
        out.push(meta);
    }
    return out;
}
/** Map a host graph-walker record onto the immutable run shape. */
function runFileFromRecord(record, doc, trigger, durationMs) {
    const kinds = new Map(doc.nodes.map((node) => [node.id, node]));
    return {
        runId: newRunId(),
        workflowName: record.name || doc.name || 'Untitled workflow',
        workflowKey: workflowKeyOf(record.name || doc.name || ''),
        ...(record.scheduleId === undefined ? {} : { scheduleId: record.scheduleId }),
        trigger,
        startedAt: record.startedAt,
        durationMs,
        status: record.status === 'error' ? 'error' : 'ok',
        failed: record.failed,
        doc,
        nodes: record.nodes.map((node) => ({
            id: node.id,
            kind: node.kind,
            ...(kinds.get(node.id)?.data.label === undefined ? {} : { label: kinds.get(node.id).data.label }),
            status: node.status === 'error' ? 'error' : 'ok',
            ms: node.ms,
            ...(node.output === undefined ? {} : { output: node.output }),
            ...(node.error === undefined ? {} : { error: node.error }),
            ...(node.logs === undefined ? {} : { logs: node.logs }),
        })),
        ...(record.value === undefined ? {} : { output: record.value }),
    };
}
/**
 * Outcome of the most recent runner-session bootstrap prompt. Recorded because
 * a swallowed failure there is indistinguishable from success: the session is
 * created and usable, it just never becomes visible in the sidebar.
 */
let lastBootstrap = null;
function settingsFile() {
    return join(dataDir(), 'settings.json');
}
function loadSettings() {
    const raw = readJson(settingsFile(), {});
    return {
        bindings: raw.bindings !== null && typeof raw.bindings === 'object' ? raw.bindings : {},
        ...(typeof raw.lastWorkspaceId === 'string' ? { lastWorkspaceId: raw.lastWorkspaceId } : {}),
    };
}
function saveSettings(settings) {
    writeJson(settingsFile(), settings);
}
/** Display name of a Workspace's runner session; also its sidebar row title. */
function runnerTitle(workspace) {
    return `节点模式运行会话 · ${workspace.title}`;
}
/**
 * Resolve which Workspace a run belongs to: the request's own choice, else the
 * last one used, else the first registered Workspace (reported as a fallback so
 * the caller can show it). Never invents a Workspace that does not exist.
 */
function resolveWorkspace(ctx, requested) {
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined)
        throw new Error('workspaceRegistry unavailable on this host');
    const list = registry.list();
    if (list.length === 0)
        throw new Error('no Workspace registered: add one in the sidebar first');
    const requestedId = typeof requested === 'string' && requested.length > 0 ? requested : undefined;
    if (requestedId !== undefined) {
        const found = list.find((w) => w.id === requestedId);
        if (found === undefined)
            throw new Error(`Workspace not found: ${requestedId}`);
        return { workspace: found, usedFallback: false };
    }
    const lastId = loadSettings().lastWorkspaceId;
    const remembered = lastId === undefined ? undefined : list.find((w) => w.id === lastId);
    if (remembered !== undefined)
        return { workspace: remembered, usedFallback: true };
    return { workspace: list[0], usedFallback: true };
}
/**
 * Sessions the user archived.
 *
 * There is no read-only accessor for this on the public workspace surface: the
 * only calls that return the set are the archive/unarchive MUTATIONS, the
 * `workspaceController.follow()` stream that publishes it does not drive from a
 * host plugin context, and `sessionController.list` does NOT filter archived
 * rows (measured: archived sids still appear there). The durable storage unit
 * holds it as plain JSON, so the canvas reads that — read-only, and `undefined`
 * when the file is missing or shaped differently, which callers treat as
 * "unknown, keep the binding" rather than "archived".
 */
function archivedSessionIds() {
    const file = join(dshHome(), 'storages', 'workspace.json');
    const raw = readJson(file, {});
    const ids = raw?.global?.archivedSessionIds;
    if (!Array.isArray(ids))
        return undefined;
    return new Set(ids.map((id) => String(id)));
}
async function runnerState(ctx, workspace) {
    const binding = loadSettings().bindings[workspace.id];
    if (binding === undefined)
        return { workspace, live: false };
    const agents = ctx.get('agents');
    const live = agents?.get(binding.sessionId) !== undefined;
    const archived = archivedSessionIds()?.has(binding.sessionId) === true;
    return { workspace, binding, live, archived };
}
/**
 * Ensure the Workspace has a usable runner session, creating one when there is
 * none, when the user archived it, or when its agent can no longer be revived.
 *
 * The session is created through `sessionController.create({ workspaceId })`,
 * the only API that ACCOUNTS it to the Workspace (and therefore lists it in the
 * sidebar); `agentLoop.resume` revives it after a host restart. A live agent is
 * reused as-is: the delegation seam requires the exact live parent instance.
 */
async function ensureRunner(ctx, requestedWorkspaceId) {
    const { workspace, usedFallback } = resolveWorkspace(ctx, requestedWorkspaceId);
    const settings = loadSettings();
    const controller = ctx.get('sessionController');
    const loop = ctx.get('agentLoop');
    const agents = ctx.get('agents');
    if (agents === undefined)
        throw new Error('ctx.agents unavailable on this host');
    const remember = (sessionId, title) => {
        const previous = settings.bindings[workspace.id];
        settings.bindings[workspace.id] = {
            sessionId,
            title,
            // Keep the original creation time when this is the same session, so the
            // binding records when the runner was created, not when it was last used.
            createdAt: previous !== undefined && previous.sessionId === sessionId
                ? previous.createdAt
                : new Date().toISOString(),
        };
        settings.lastWorkspaceId = workspace.id;
        saveSettings(settings);
    };
    const existing = settings.bindings[workspace.id];
    if (existing !== undefined) {
        // An archived runner session is the user asking for a fresh one. The
        // `list()` row cannot tell us that (see `archivedSessionIds`), so the
        // archive set is the signal.
        const archived = archivedSessionIds()?.has(existing.sessionId) === true;
        if (!archived) {
            const live = agents.get(existing.sessionId);
            if (live !== undefined) {
                remember(existing.sessionId, existing.title);
                return { sessionId: existing.sessionId, workspace, agent: live, created: false, usedFallback };
            }
            if (loop !== undefined) {
                // `resolveAgent` is the controller's own "live or resume" path, so it
                // keeps one write handle per session; `agentLoop.resume` is the fallback
                // for hosts without it (it refuses a session another handle owns).
                try {
                    const resolved = await controller?.resolveAgent?.(existing.sessionId);
                    if (resolved?.agent !== undefined) {
                        remember(existing.sessionId, existing.title);
                        return {
                            sessionId: existing.sessionId,
                            workspace,
                            agent: resolved.agent,
                            created: false,
                            usedFallback,
                        };
                    }
                }
                catch {
                    // fall through to the agent factory
                }
                try {
                    const handle = await loop.resume(ctx, { resumeSessionId: existing.sessionId });
                    remember(existing.sessionId, existing.title);
                    return { sessionId: existing.sessionId, workspace, agent: handle.agent, created: false, usedFallback };
                }
                catch {
                    // Not revivable (deleted, or owned by another live handle): rebuild.
                }
            }
        }
    }
    if (controller === undefined)
        throw new Error('sessionController unavailable on this host');
    const created = await controller.create({ workspaceId: workspace.id });
    const title = runnerTitle(workspace);
    try {
        await controller.rename({ sessionId: created.sessionId, title });
    }
    catch {
        /* the title is cosmetic; the binding does not depend on it */
    }
    remember(created.sessionId, title);
    const agent = agents.get(created.sessionId);
    if (agent === undefined)
        throw new Error(`runner session ${created.sessionId} was created but has no live agent`);
    // A brand-new session has no messages, and a message-less ("blank") session is
    // not rendered by the sidebar's Workspace grouping — the row the user is
    // supposed to see and archive would never appear. One short bootstrap prompt
    // gives it a single tiny turn so the row exists; the pinned title survives,
    // because `rename` supersedes later automatic titling. Fire-and-forget: the
    // workflow run does not wait for it, but the outcome is recorded (see
    // `lastBootstrap`) instead of being swallowed, because a silent failure here
    // looks exactly like success until the user notices the missing row.
    const promptRequest = {
        requestId: `dsh-node-flow-runner-${Date.now().toString(36)}`,
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '节点模式运行会话已就绪，请只回复：收到。' }],
    };
    if (typeof controller.prompt !== 'function') {
        lastBootstrap = { at: new Date().toISOString(), ok: false, error: 'host has no sessionController.prompt' };
    }
    else {
        void controller
            .prompt(promptRequest, AbortSignal.timeout(120_000))
            .then(() => {
            lastBootstrap = { at: new Date().toISOString(), ok: true };
        })
            .catch((err) => {
            lastBootstrap = {
                at: new Date().toISOString(),
                ok: false,
                error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
            };
        });
    }
    return { sessionId: created.sessionId, workspace, agent, created: true, usedFallback };
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
        // Per-node retry: `retries` extra attempts on a node failure (not on a
        // downstream error, and never on the budget guard).
        const parseCount = (raw, max) => {
            const value = Number.parseInt(raw ?? '', 10);
            return Number.isFinite(value) && value > 0 ? Math.min(max, value) : 0;
        };
        const retries = parseCount(d.retries, 5);
        const retryDelayMs = parseCount(d.retryDelayMs, 10_000);
        const attempts = [];
        /** Marks a failure of this node itself, so it can be retried. */
        class NodeFailure extends Error {
        }
        const fanOut = async (value) => {
            let last = value;
            for (const e of edgesFrom(id))
                last = await executeNode(e.target, value, ctxVisited, stopAt);
            return last;
        };
        const attemptOnce = async () => {
            if (d.kind === 'trigger' || d.kind === 'schedule' || d.kind === 'listen') {
                // A listen entry carries the event line that fired it; everything else
                // starts from the node's own text.
                const value = d.kind === 'listen' && typeof initialInput === 'string' && initialInput !== ''
                    ? initialInput
                    : (d.text ?? '');
                setRec({ status: 'ok', output: value });
                return await fanOut(value);
            }
            else if (d.kind === 'code') {
                let nodeError;
                let val = '';
                let logs = [];
                const ts = makeTimeoutSignal(d.timeout);
                try {
                    const py = await runPythonCode(d.code ?? '', input, ts.signal);
                    val = typeof py.value === 'string' ? py.value : '';
                    logs = py.logs ?? [];
                    nodeError = py.error?.message;
                }
                catch (err) {
                    nodeError = err instanceof Error ? err.message : String(err);
                }
                finally {
                    ts.clear();
                }
                setRec({ status: nodeError ? 'error' : 'ok', output: val, logs, error: nodeError });
                if (nodeError)
                    throw new NodeFailure(nodeError);
                lastOutput = val || logs.join('\n');
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
                        // Scheduled runs have no UI: the workspace comes from the saved
                        // document (or the last one used), never from a live root agent.
                        const runner = await ensureRunner(ctx, doc.executionWorkspaceId);
                        const delegated = await delegateToSubagent(subagents, runner.agent, prompt, d.label ?? 'workflow-agent', parseAgentOptions(d.model), ts.signal);
                        nodeError = delegated.error;
                        out = delegated.output;
                    }
                }
                catch (err) {
                    nodeError = err instanceof Error ? err.message : String(err);
                }
                finally {
                    ts.clear();
                }
                setRec({ status: nodeError ? 'error' : 'ok', output: out, error: nodeError });
                if (nodeError)
                    throw new NodeFailure(nodeError);
                lastOutput = out;
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
        };
        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            const startedAt = Date.now();
            try {
                const value = await attemptOnce();
                if (attempts.length > 0)
                    setRec({ attempts });
                return value;
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (!(err instanceof NodeFailure)) {
                    // Downstream or guard errors are not this node's fault: never retried.
                    setRec({ status: 'error', error: message });
                    if (attempts.length > 0)
                        setRec({ attempts });
                    return input;
                }
                attempts.push({ attempt, status: 'error', ms: Date.now() - startedAt, error: message });
                if (attempt <= retries) {
                    if (retryDelayMs > 0)
                        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                    continue;
                }
                setRec({ attempts });
                if (onError === 'continue')
                    return await fanOut('');
                return input;
            }
        }
        return input;
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
        .filter((n) => n.data.kind === 'trigger' || n.data.kind === 'schedule' || n.data.kind === 'listen')
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
/**
 * Single-timer scheduler over the durable anchor.
 *
 * The timer only decides WHEN to look; the durable `nextFireAt` decides WHAT is
 * due. Arming for the earliest anchor (clamped below Node's 2^31-1 ms timer
 * ceiling) is enough: any anchor that passes while the process is asleep or
 * stopped is still in the past when the next look happens, so it fires late
 * instead of being skipped.
 */
let scheduleTimer;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
/** Re-arm the single timer for the earliest active anchor; never fires anything. */
function armScheduler(ctx) {
    if (scheduleTimer !== undefined) {
        clearTimeout(scheduleTimer);
        scheduleTimer = undefined;
    }
    let next;
    for (const schedule of loadSchedules()) {
        if (schedule.status === 'ended' || schedule.nextFireAt === undefined)
            continue;
        const at = Date.parse(schedule.nextFireAt);
        if (!Number.isFinite(at))
            continue;
        if (next === undefined || at < next)
            next = at;
    }
    if (next === undefined)
        return;
    const delay = Math.min(Math.max(0, next - Date.now()), MAX_TIMER_DELAY_MS);
    scheduleTimer = setTimeout(() => {
        scheduleTimer = undefined;
        driveSchedules(ctx);
    }, delay);
    // Do not let a pending occurrence keep the host process alive on its own.
    scheduleTimer.unref?.();
}
/** Schedules whose current run has not settled yet, so one occurrence cannot stack. */
const schedulesInFlight = new Set();
/**
 * Deliver every occurrence that is due, then re-arm.
 *
 * For each due record the anchor is advanced and persisted BEFORE its workflow
 * runs: a crash mid-run must cost that run, not replay it forever. Several
 * missed occurrences of a daily task deliver ONCE (the anchor jumps to the next
 * future time), which is what a late reminder means.
 */
function driveSchedules(ctx) {
    const now = new Date();
    const nowMs = now.getTime();
    const schedules = loadSchedules();
    const due = schedules.filter((schedule) => {
        if (schedule.status === 'ended' || schedule.nextFireAt === undefined)
            return false;
        const at = Date.parse(schedule.nextFireAt);
        return Number.isFinite(at) && at <= nowMs;
    });
    if (due.length > 0) {
        for (const schedule of due) {
            const next = nextCronFire(schedule.cron, now);
            schedule.nextFireAt = next === null ? undefined : next.toISOString();
            schedule.lastFired = now.toISOString().slice(0, 16);
            const doc = schedule.doc;
            if (doc === undefined) {
                console.info(`[dsh-node-flow] schedule "${schedule.name}" has no workflow snapshot; skipping`);
                continue;
            }
            if (schedulesInFlight.has(schedule.id)) {
                console.info(`[dsh-node-flow] schedule "${schedule.name}" is still running; this occurrence is skipped`);
                continue;
            }
            schedulesInFlight.add(schedule.id);
            void (async () => {
                const startedAt = Date.now();
                try {
                    const run = await runDocumentGraph(ctx, doc, schedule.input);
                    run.scheduleId = schedule.id;
                    run.name = schedule.name;
                    persistRun(runFileFromRecord(run, doc, 'cron', Date.now() - startedAt));
                    console.info(`[dsh-node-flow] scheduled run "${schedule.name}" → ${run.status} (${run.failed} failed)`);
                }
                catch (error) {
                    console.info(`[dsh-node-flow] scheduled run "${schedule.name}" failed: ${String(error)}`);
                }
                finally {
                    schedulesInFlight.delete(schedule.id);
                }
            })();
        }
        saveSchedules(schedules);
    }
    armScheduler(ctx);
}
/**
 * Give an active record a future anchor.
 *
 * A record without one (written before the anchor existed, or just re-enabled)
 * starts from the next occurrence — no catch-up, because nothing recorded that a
 * fire was owed. A record that HAS an anchor keeps it even when it is in the
 * past, which is exactly the overdue state the catch-up path needs.
 */
function ensureScheduleAnchor(schedule, now = new Date()) {
    if (schedule.status === 'ended')
        return;
    const current = schedule.nextFireAt === undefined ? Number.NaN : Date.parse(schedule.nextFireAt);
    if (Number.isFinite(current))
        return;
    const next = nextCronFire(schedule.cron, now);
    schedule.nextFireAt = next === null ? undefined : next.toISOString();
}
/** One-time migration for records saved by the minute-matching engine. */
function backfillScheduleAnchors(now = new Date()) {
    const schedules = loadSchedules();
    let changed = false;
    for (const schedule of schedules) {
        const before = schedule.nextFireAt;
        ensureScheduleAnchor(schedule, now);
        if (schedule.nextFireAt !== before)
            changed = true;
    }
    if (changed)
        saveSchedules(schedules);
}
/* --------------------------- capability report --------------------------- */
/** Every route this plugin owns; reported by the health probe. */
const ROUTES = [
    '/dsh-node-flow/run',
    '/dsh-node-flow/run-agent',
    '/dsh-node-flow/models',
    '/dsh-node-flow/workspaces',
    '/dsh-node-flow/runner',
    '/dsh-node-flow/schedule',
    '/dsh-node-flow/schedules',
    '/dsh-node-flow/workflows',
    '/dsh-node-flow/workflow',
    '/dsh-node-flow/workflow/rename',
    '/dsh-node-flow/workflow/delete',
    '/dsh-node-flow/listeners',
    '/dsh-node-flow/listener/start',
    '/dsh-node-flow/listener/stop',
    '/dsh-node-flow/listener/restart',
    '/dsh-node-flow/listener/delete',
    '/dsh-node-flow/listener/runs/clear',
    '/dsh-node-flow/listener/logs',
    '/dsh-node-flow/runs',
    '/dsh-node-flow/run-detail',
    '/dsh-node-flow/record-run',
    '/dsh-node-flow/health',
];
/**
 * A real runtime self-test: the same path a Code node takes (a Python program
 * run through the host subprocess), so a missing or broken interpreter shows up
 * as a failed probe instead of an unexplained empty node result.
 */
async function runtimeSelfTest(timeoutMs = 15_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('self-test timeout')), timeoutMs);
    try {
        const out = await runPythonCode('import json, sys\nprint(json.dumps({"ok": True, "python": sys.version.split()[0]}))', '', controller.signal);
        if (out.error)
            return { ok: false, error: out.error.message, language: 'python' };
        let value = out.value;
        if (typeof value === 'string') {
            try {
                value = JSON.parse(value);
            }
            catch {
                /* plain-text completion is still a successful probe */
            }
        }
        return { ok: true, value, language: 'python' };
    }
    catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            language: 'python',
        };
    }
    finally {
        clearTimeout(timer);
    }
}
/** Which Workspace each runner session belongs to, and its current state. */
async function runnerReport(ctx) {
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined)
        return { workspaces: [], lastWorkspaceId: null };
    const settings = loadSettings();
    const agents = ctx.get('agents');
    const archived = archivedSessionIds();
    return {
        lastWorkspaceId: settings.lastWorkspaceId ?? null,
        bootstrap: lastBootstrap,
        workspaces: registry.list().map((workspace) => {
            const binding = settings.bindings[workspace.id];
            return {
                id: workspace.id,
                title: workspace.title,
                path: workspace.path ?? null,
                runner: binding === undefined
                    ? null
                    : {
                        sessionId: binding.sessionId,
                        title: binding.title,
                        createdAt: binding.createdAt,
                        live: agents?.get(binding.sessionId) !== undefined,
                        // `null` means the archive set could not be read at all.
                        archived: archived === undefined ? null : archived.has(binding.sessionId),
                    },
            };
        }),
    };
}
/** The capability snapshot the health route returns and activation persists. */
async function capabilityReport(ctx) {
    const subagents = ctx.get('subagents');
    const agents = ctx.get('agents');
    const llm = ctx.get('llm');
    let providers = [];
    if (llm) {
        try {
            providers = (await llm.listProviders()).map((p) => p.id);
        }
        catch {
            providers = [];
        }
    }
    return {
        plugin: 'dsh-node-flow',
        revision: BUILD_REVISION,
        checkedAt: new Date().toISOString(),
        routes: ROUTES,
        services: {
            webServer: ctx.get('webServer') !== undefined,
            // Python is the only code runtime: `python -u -c <code>` with DSH_INPUT.
            python: { command: 'python', hardTimeoutMs: PYTHON_HARD_TIMEOUT_MS },
            agents: agents === undefined ? null : { live: agents.list().length, roots: agents.roots().length },
            subagents: subagents === undefined ? null : { providers: subagents.list() },
            llm: llm === undefined ? null : { providers },
        },
        runner: await runnerReport(ctx),
        selfTest: await runtimeSelfTest(),
    };
}
/** Persist the capability snapshot so a failed node can be diagnosed offline. */
async function writeHealthFile(ctx) {
    try {
        writeJson(join(dataDir(), 'health.json'), await capabilityReport(ctx));
    }
    catch {
        /* diagnostics are best-effort */
    }
}
export function apply(ctx) {
    // `inject: ['webServer']` guarantees this is present when apply runs.
    const webServer = ctx.webServer;
    // First activation materialises the built-in templates into the workflow
    // directory, so the library has something to show before the first save.
    try {
        seedExampleWorkflows();
    }
    catch {
        /* the library still works when seeding fails */
    }
    ctx.effect(() => {
        const disposers = [];
        // --- code route ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/run',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                let ts;
                try {
                    const body = (await readJsonBody(request, 256 * 1024));
                    const program = typeof body?.program === 'string' ? body.program : '';
                    if (!program.trim()) {
                        return sendJson(response, 400, { error: 'program must be a non-empty string' });
                    }
                    // Python is the only runtime; a legacy `language` field is accepted
                    // and ignored so old canvases keep running (as Python).
                    ts = makeTimeoutSignal(body?.timeout);
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
        // --- workflow library: rename + delete ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/workflow/rename',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const id = typeof body?.id === 'string' ? body.id : '';
                    const doc = readWorkflow(id);
                    if (doc === undefined)
                        return sendJson(response, 404, { error: 'workflow not found' });
                    const name = uniqueWorkflowName(body?.name, id);
                    const updatedAt = writeWorkflow(id, { ...doc, name });
                    return sendJson(response, 200, { ok: true, id, name, updatedAt });
                }
                catch (err) {
                    return sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/workflow/delete',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const id = typeof body?.id === 'string' ? body.id : '';
                    const path = workflowPath(id);
                    if (path === undefined)
                        return sendJson(response, 400, { error: 'invalid workflow id' });
                    if (!existsSync(path))
                        return sendJson(response, 200, { ok: true, deleted: false });
                    rmSync(path);
                    return sendJson(response, 200, { ok: true, deleted: true });
                }
                catch (err) {
                    return sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        // --- workflow library: list + save ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/workflows',
            handler: async (request, response) => {
                if (request.method !== 'GET' && request.method !== 'POST') {
                    response.writeHead(405, { allow: 'GET, POST' });
                    response.end();
                    return;
                }
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    seedExampleWorkflows();
                    return sendJson(response, 200, { workflows: listWorkflows(), dir: workflowsDir() });
                }
                catch (err) {
                    return sendJson(response, 500, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/workflow',
            handler: async (request, response) => {
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    if (request.method === 'GET') {
                        const url = new URL(request.url ?? '', 'http://127.0.0.1');
                        const id = url.searchParams.get('id') ?? '';
                        const doc = readWorkflow(id);
                        if (doc === undefined)
                            return sendJson(response, 404, { error: 'workflow not found' });
                        return sendJson(response, 200, { ok: true, id, doc });
                    }
                    if (request.method !== 'POST') {
                        response.writeHead(405, { allow: 'GET, POST' });
                        response.end();
                        return;
                    }
                    const body = (await readJsonBody(request, 2 * 1024 * 1024));
                    const doc = body?.doc;
                    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) {
                        return sendJson(response, 400, { error: 'doc must contain nodes[] and edges[]' });
                    }
                    const requested = typeof body?.id === 'string' ? body.id : '';
                    const id = WORKFLOW_ID_PATTERN.test(requested) ? requested : newWorkflowId();
                    const name = uniqueWorkflowName(doc.name, id);
                    const updatedAt = writeWorkflow(id, { ...doc, name });
                    return sendJson(response, 200, { ok: true, id, name, updatedAt });
                }
                catch (err) {
                    return sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        // --- listeners: list / start / stop / restart / test / logs ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/listeners',
            handler: async (request, response) => {
                if (request.method !== 'GET' && request.method !== 'POST') {
                    response.writeHead(405, { allow: 'GET, POST' });
                    response.end();
                    return;
                }
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                let workflowId = '';
                if (request.method === 'POST') {
                    try {
                        const body = (await readJsonBody(request, 64 * 1024));
                        workflowId = typeof body?.workflowId === 'string' ? body.workflowId : '';
                    }
                    catch {
                        workflowId = '';
                    }
                }
                const listeners = listenerStates().filter((s) => workflowId === '' || s.workflowId === workflowId);
                return sendJson(response, 200, { listeners });
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/listener/start',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : '';
                    const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : '';
                    if (workflowId === '' || nodeId === '')
                        return sendJson(response, 400, { error: 'workflowId and nodeId are required' });
                    const state = await startListener(ctx, workflowId, nodeId);
                    return sendJson(response, 200, { ok: true, listener: state });
                }
                catch (error) {
                    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/listener/stop',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : '';
                    const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : '';
                    const state = stopListener(workflowId, nodeId);
                    return sendJson(response, 200, { ok: true, listener: state ?? null });
                }
                catch (error) {
                    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/listener/restart',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : '';
                    const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : '';
                    if (workflowId === '' || nodeId === '')
                        return sendJson(response, 400, { error: 'workflowId and nodeId are required' });
                    stopListener(workflowId, nodeId);
                    const state = await startListener(ctx, workflowId, nodeId);
                    return sendJson(response, 200, { ok: true, listener: state });
                }
                catch (error) {
                    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/listener/runs/clear',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : '';
                    const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : '';
                    if (workflowId === '' || nodeId === '') {
                        return sendJson(response, 400, { error: 'workflowId and nodeId are required' });
                    }
                    const removed = clearListenerRuns(workflowId, nodeId);
                    return sendJson(response, 200, { ok: true, removed });
                }
                catch (error) {
                    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/listener/delete',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : '';
                    const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : '';
                    const deleted = deleteListener(workflowId, nodeId);
                    return sendJson(response, 200, { ok: true, deleted });
                }
                catch (error) {
                    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/listener/logs',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : '';
                    const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : '';
                    const rt = listenerRuntimes.get(listenerKey(workflowId, nodeId));
                    if (rt === undefined)
                        return sendJson(response, 404, { error: 'listener not found' });
                    return sendJson(response, 200, {
                        ok: true,
                        listener: rt.state,
                        logs: rt.logs.slice(-LISTENER_LOG_LINES),
                        events: rt.events.slice(-20),
                    });
                }
                catch (error) {
                    return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
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
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
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
                    if (pickSubagentProvider(subagents) === undefined) {
                        return sendJson(response, 400, { error: 'no subagent provider registered' });
                    }
                    // The canvass delegate is the Workspace's own runner session: the
                    // child then inherits that Workspace's directory and sandbox
                    // boundary, and the run shows up where the user expects it.
                    let runner;
                    try {
                        runner = await ensureRunner(ctx, body?.workspaceId);
                    }
                    catch (err) {
                        return sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                    }
                    // Optional per-child model route: "provider|modelId" picked in the canvas.
                    let agentOptions;
                    if (typeof body?.agentOptions === 'object' && body?.agentOptions !== null) {
                        const ao = body.agentOptions;
                        if (typeof ao.provider === 'string' && typeof ao.model === 'string' && ao.provider && ao.model) {
                            agentOptions = { provider: ao.provider, model: ao.model };
                        }
                    }
                    ts = makeTimeoutSignal(body?.timeout);
                    const delegated = await delegateToSubagent(subagents, runner.agent, prompt, 'workflow-agent', agentOptions, ts.signal);
                    const error = ts.isTimeout() ? `运行超时（>${Number(body?.timeout)}s）` : delegated.error;
                    sendJson(response, 200, {
                        ok: true,
                        output: delegated.output,
                        error,
                        // Lets the canvas show which runner session produced the result.
                        sessionId: runner.sessionId,
                        workspaceId: runner.workspace.id,
                        workspaceTitle: runner.workspace.title,
                        createdSession: runner.created,
                        usedFallbackWorkspace: runner.usedFallback,
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
        // --- workspace / runner routes (which session a run delegates from) ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/workspaces',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    sendJson(response, 200, await runnerReport(ctx));
                }
                catch (err) {
                    sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/runner',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 64 * 1024));
                    const runner = await ensureRunner(ctx, body?.workspaceId);
                    sendJson(response, 200, {
                        ok: true,
                        sessionId: runner.sessionId,
                        workspaceId: runner.workspace.id,
                        workspaceTitle: runner.workspace.title,
                        created: runner.created,
                        usedFallbackWorkspace: runner.usedFallback,
                    });
                }
                catch (err) {
                    sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
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
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
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
        // --- capability / self-test route ---
        // GET answers the capability report; POST is the client half's one-shot
        // reachability probe (a POST carries the page's Origin, so the answer and
        // the recorded decision describe the shell's real authority pair).
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/health',
            handler: async (request, response) => {
                if (request.method !== 'GET' && request.method !== 'POST') {
                    response.writeHead(405, { allow: 'GET, POST' });
                    response.end();
                    return;
                }
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                if (request.method === 'POST') {
                    // The client reports what it actually resolved for its palette, so
                    // "is the canvas following the shell theme?" is answerable from
                    // disk instead of by eye.
                    let client;
                    try {
                        const body = await readJsonBody(request, 16 * 1024);
                        if (body !== undefined && typeof body === 'object' && body !== null)
                            client = body;
                    }
                    catch {
                        client = undefined;
                    }
                    if (client !== undefined) {
                        writeJson(join(dataDir(), 'client.json'), {
                            at: new Date().toISOString(),
                            origin: request.headers.origin ?? null,
                            host: request.headers.host ?? null,
                            theme: client,
                        });
                    }
                    return sendJson(response, 200, {
                        ok: true,
                        origin: request.headers.origin ?? null,
                        host: request.headers.host ?? null,
                        secFetchSite: request.headers['sec-fetch-site'] ?? null,
                        theme: client ?? null,
                    });
                }
                try {
                    sendJson(response, 200, await capabilityReport(ctx));
                }
                catch (err) {
                    sendJson(response, 500, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        // --- schedule routes ---
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/schedule',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 256 * 1024));
                    const schedules = loadSchedules();
                    // `clear` stops the task but KEEPS it (status ended) so its run
                    // history stays reachable; `delete` removes the record for good.
                    if (body?.action === 'clear' || body?.action === 'delete') {
                        const id = String(body.id ?? '');
                        const target = schedules.find((s) => s.id === id);
                        if (target === undefined)
                            return sendJson(response, 404, { error: 'schedule not found' });
                        const next = body.action === 'delete'
                            ? schedules.filter((s) => s.id !== id)
                            : schedules.map((s) => (s.id === id ? { ...s, status: 'ended' } : s));
                        writeJson(schedulesFile(), next);
                        armScheduler(ctx);
                        return sendJson(response, 200, { ok: true, schedules: next.map(scheduleSummary) });
                    }
                    if (body?.action === 'resume') {
                        const id = String(body.id ?? '');
                        const next = schedules.map((s) => s.id === id ? { ...s, status: 'active', nextFireAt: undefined } : s);
                        // Re-enabling starts from the next occurrence, not from a stale anchor.
                        for (const schedule of next)
                            ensureScheduleAnchor(schedule);
                        writeJson(schedulesFile(), next);
                        armScheduler(ctx);
                        return sendJson(response, 200, { ok: true, schedules: next.map(scheduleSummary) });
                    }
                    // Manual "run now" from the scheduled-task board.
                    if (body?.action === 'run') {
                        const id = String(body.id ?? '');
                        const sched = schedules.find((s) => s.id === id);
                        if (!sched)
                            return sendJson(response, 404, { error: 'schedule not found' });
                        if (!sched.doc)
                            return sendJson(response, 400, { error: 'schedule has no workflow snapshot' });
                        const startedAt = Date.now();
                        const run = await runDocumentGraph(ctx, sched.doc, sched.input);
                        run.scheduleId = sched.id;
                        run.name = sched.name;
                        const file = runFileFromRecord(run, sched.doc, 'manual', Date.now() - startedAt);
                        persistRun(file);
                        return sendJson(response, 200, { ok: true, runId: file.runId, run });
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
                    const record = {
                        id,
                        name,
                        cron,
                        input: typeof body?.input === 'string' ? body.input : '',
                        steps,
                        doc,
                        status: 'active',
                    };
                    // Anchor the saved task from NOW, not from a leftover value: a re-save
                    // with a changed cron must not fire on the old rhythm.
                    ensureScheduleAnchor(record);
                    next.push(record);
                    writeJson(schedulesFile(), next);
                    armScheduler(ctx);
                    return sendJson(response, 200, { ok: true, schedules: next.map(scheduleSummary) });
                }
                catch (err) {
                    return sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/schedules',
            // GET for a plain read, POST for the board (which sends a JSON body like
            // the other panel calls). Accepting both keeps the older GET clients and
            // the same-origin JSON client working.
            handler: (request, response) => {
                if (request.method !== 'GET' && request.method !== 'POST') {
                    response.writeHead(405, { allow: 'GET, POST' });
                    response.end();
                    return;
                }
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                const list = loadSchedules()
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(scheduleSummary);
                sendJson(response, 200, { schedules: list });
            },
        }));
        // --- run history: immutable per-run records ---------------------------
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/runs',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 32 * 1024));
                    const runs = listRuns({
                        ...(typeof body?.workflowKey === 'string' ? { workflowKey: body.workflowKey } : {}),
                        ...(typeof body?.workflowId === 'string' ? { workflowId: body.workflowId } : {}),
                        ...(typeof body?.nodeId === 'string' ? { nodeId: body.nodeId } : {}),
                        ...(typeof body?.scheduleId === 'string' ? { scheduleId: body.scheduleId } : {}),
                        ...(typeof body?.limit === 'number' ? { limit: body.limit } : {}),
                        ...(typeof body?.search === 'string' ? { search: body.search } : {}),
                    });
                    sendJson(response, 200, { runs });
                }
                catch (err) {
                    sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/run-detail',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 16 * 1024));
                    const runId = typeof body?.runId === 'string' ? body.runId : '';
                    const run = loadRun(runId);
                    if (run === undefined)
                        return sendJson(response, 404, { error: 'run not found' });
                    sendJson(response, 200, { run });
                }
                catch (err) {
                    sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        // The canvas runs manually in the browser, so its runs arrive here to be
        // stored exactly like scheduled ones — otherwise history only knows crons.
        disposers.push(webServer.register({
            kind: 'exact',
            path: '/dsh-node-flow/record-run',
            handler: async (request, response) => {
                if (rejectNonPost(request, response))
                    return;
                const rejection = routeRejection(ctx, request);
                if (rejection !== undefined)
                    return rejectUntrusted(response, rejection);
                try {
                    const body = (await readJsonBody(request, 1024 * 1024));
                    const doc = body?.doc !== null && typeof body?.doc === 'object' ? body.doc : null;
                    const workflowName = typeof body?.workflowName === 'string' && body.workflowName.trim().length > 0
                        ? body.workflowName.trim()
                        : (doc?.name ?? 'Untitled workflow');
                    const rawNodes = Array.isArray(body?.nodes) ? body.nodes : [];
                    const nodes = rawNodes.map((raw) => {
                        const node = (raw ?? {});
                        const status = node.status === 'error' ? 'error' : node.status === 'skipped' ? 'skipped' : 'ok';
                        return {
                            id: String(node.id ?? ''),
                            kind: String(node.kind ?? 'unknown'),
                            ...(typeof node.label === 'string' && node.label.length > 0 ? { label: node.label } : {}),
                            status,
                            ms: Math.max(0, Math.floor(Number(node.ms)) || 0),
                            ...(node.output === undefined ? {} : { output: node.output }),
                            ...(typeof node.error === 'string' && node.error.length > 0 ? { error: node.error } : {}),
                            ...(Array.isArray(node.logs) ? { logs: node.logs.map((line) => String(line)) } : {}),
                            ...(Array.isArray(node.attempts)
                                ? {
                                    attempts: node.attempts
                                        .map((attempt) => attempt)
                                        .map((attempt) => ({
                                        attempt: Math.max(1, Math.floor(Number(attempt.attempt)) || 1),
                                        status: attempt.status === 'error' ? 'error' : 'ok',
                                        ms: Math.max(0, Math.floor(Number(attempt.ms)) || 0),
                                        ...(typeof attempt.error === 'string' && attempt.error.length > 0 ? { error: attempt.error } : {}),
                                    })),
                                }
                                : {}),
                        };
                    });
                    if (nodes.length === 0)
                        return sendJson(response, 400, { error: 'a run needs at least one node result' });
                    const failed = nodes.filter((node) => node.status === 'error').length;
                    const run = {
                        runId: newRunId(),
                        workflowName,
                        workflowKey: workflowKeyOf(workflowName),
                        trigger: 'manual',
                        startedAt: typeof body?.startedAt === 'string' && body.startedAt.length > 0
                            ? body.startedAt
                            : new Date().toISOString(),
                        durationMs: Math.max(0, Math.floor(Number(body?.durationMs)) || 0),
                        status: failed > 0 ? 'error' : 'ok',
                        failed,
                        doc,
                        nodes,
                        ...(body?.output === undefined ? {} : { output: body.output }),
                    };
                    persistRun(run);
                    sendJson(response, 200, { ok: true, runId: run.runId });
                }
                catch (err) {
                    sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) });
                }
            },
        }));
        // Give pre-anchor records a future anchor, then deliver anything already
        // overdue (the host may have been stopped across occurrences) and arm.
        backfillScheduleAnchors();
        driveSchedules(ctx);
        // Re-arm listeners the user had enabled before this host started.
        try {
            restoreListeners(ctx);
        }
        catch {
            /* a broken listeners.json must never block activation */
        }
        // Record what this host can actually do (and prove the program runtime
        // works) without blocking activation.
        void writeHealthFile(ctx);
        return () => {
            if (scheduleTimer)
                clearTimeout(scheduleTimer);
            // Listener scripts are host-owned: kill them, keep their `enabled` flags.
            stopAllListeners();
            for (const dispose of disposers.splice(0))
                dispose();
        };
    });
}
