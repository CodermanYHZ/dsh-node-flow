/**
 * Workspace picker for the canvas toolbar.
 *
 * A native `<select>` cannot look like a host control: the closed state is a
 * system widget and the popup is drawn by the OS, so the pill ended up
 * oversized and off-style. This is a plain button plus a small menu instead —
 * the button names the Workspace in use, the menu lists every registered one
 * with its directory and its runner-session state, and everything is coloured
 * from the host's alias tokens via the canvas variables.
 *
 * @module components/WorkspacePicker
 */
/** One Workspace row plus the state of its node-mode runner session. */
export interface WorkspaceOption {
    id: string;
    title: string;
    path: string | null;
    runner: {
        sessionId: string;
        title: string;
        live: boolean;
        visible: boolean | null;
    } | null;
}
export declare function WorkspacePicker({ options, value, error, onChange, }: {
    options: WorkspaceOption[];
    value: string | null;
    error: string;
    onChange: (id: string | null, title: string | null) => void;
}): import("react").JSX.Element;
