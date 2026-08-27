/**
 * Full-screen overlay hosting the workflow canvas in "node mode".
 *
 * Rendered only while the user is in node mode (toggled by the sidebar entry);
 * the close button returns to the normal GUI. Applies the selected theme
 * (dark/light) to the overlay and loads the saved preference on mount.
 *
 * @module components/Overlay
 */
export declare function Overlay({ onClose }: {
    onClose: () => void;
}): import("react").JSX.Element;
