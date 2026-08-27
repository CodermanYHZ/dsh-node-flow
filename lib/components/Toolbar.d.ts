/**
 * Toolbar — add nodes, run/export the workflow.
 *
 * `Run` walks the compiled step list in order and executes each node kind:
 * agent/code nodes hit the host routes; output/condition nodes are evaluated
 * locally. Results flow downstream through a `lastOutput` variable (the most
 * recent agent/code output), available to output (`{{result}}`) and condition
 * nodes.
 *
 * @module components/Toolbar
 */
export declare function Toolbar({ onExitNodeMode }: {
    onExitNodeMode?: () => void;
}): import("react").JSX.Element;
