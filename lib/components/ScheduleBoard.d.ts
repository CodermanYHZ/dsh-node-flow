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
export declare function ScheduleBoard({ onClose }: {
    onClose: () => void;
}): import("react").ReactPortal;
