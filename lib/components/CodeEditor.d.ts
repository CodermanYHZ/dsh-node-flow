/**
 * A lightweight, dependency-free code editor with line numbers and syntax
 * highlighting — a transparent <textarea> overlaid on a highlighted <pre>,
 * so the caret and typing behave like a normal editor while the visible text
 * is the colored token stream. This keeps the plugin's client bundle
 * self-contained (no Monaco/CodeMirror dependency).
 *
 * @module components/CodeEditor
 */
export declare function CodeEditor({ value, onChange, language, expanded, }: {
    value: string;
    onChange: (v: string) => void;
    language: string;
    expanded?: boolean;
}): import("react").JSX.Element;
