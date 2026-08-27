/**
 * Scheduled-task board — lists every saved schedule (cron workflow). Lets the
 * user view (load the workflow + its latest run result onto the canvas), run
 * once immediately, or cancel a schedule.
 *
 * @module components/ScheduleBoard
 */
export declare function ScheduleBoard({ onClose }: {
    onClose: () => void;
}): import("react").JSX.Element;
