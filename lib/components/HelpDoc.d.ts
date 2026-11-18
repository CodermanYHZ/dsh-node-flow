/**
 * Usage / help + AI authoring guide for dsh-node-flow.
 *
 * Mounted through `overlayHost()` like the other page windows, so it covers the
 * node-mode page rather than the whole application window.
 *
 * Keep this document in step with the implementation: `/run` and `/run-agent`
 * are the only host routes a node calls, scheduled and listened runs walk the
 * same graph as the toolbar's Run, and every execution is stored as a run file.
 *
 * @module components/HelpDoc
 */
export declare function HelpDoc({ onClose }: {
    onClose: () => void;
}): import("react").ReactPortal;
