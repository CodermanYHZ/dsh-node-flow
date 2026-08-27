/**
 * Full-screen code editor modal — opened from the code node card's "展开"
 * button so editing has the whole node-mode surface to work in.
 *
 * @module components/CodeEditorModal
 */
export declare function CodeEditorModal({ value, onChange, language, onClose, }: {
    value: string;
    onChange: (v: string) => void;
    language: string;
    onClose: () => void;
}): import("react").ReactPortal;
