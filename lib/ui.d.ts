/**
 * DSH web client half for dsh-node-flow.
 *
 * Runs inside the sandboxed `dsh-cordis-client-runner` closure. The guarded
 * client `ctx` only exposes client-side facades (slots / theme / host / harness),
 * so this half is fully self-contained: it renders the React Flow canvas from
 * its own Zustand store and stays mountable without waiting on any service.
 *
 * Presentation: the canvas is NOT an always-on floating window. Instead this
 * half injects a single "节点模式" entry row into the DSH sidebar (plain DOM +
 * self-healing, the same pattern the task-board plugin uses), and only when the
 * user toggles it does a full-screen overlay host the canvas. Closing the
 * overlay returns to the normal GUI.
 *
 * `react` / `react-dom` are externalized (resolved by the host ModuleLoader,
 * like the official dsh-client-* bundles); everything else is inlined.
 *
 * @module client
 */
export declare const name = "dsh-node-flow-ui";
export declare const inject: readonly [];
export declare function apply(): () => void;
