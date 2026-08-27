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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-node-flow";
export declare const inject: readonly ["webServer"];
export declare function apply(ctx: Context): void;
