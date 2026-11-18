/**
 * Workflow library drawer — saved workflows plus the shipped templates.
 *
 * Every saved row is one file under `$DSH_HOME/workflow-canvas/workflows/<id>.json`.
 * Clicking a row (or dropping it on the canvas) loads it; the toolbar's 保存
 * writes the canvas back to the same id. Each saved row's ⋯ menu renames or
 * deletes that file.
 *
 * Template rows come from the package's `examples/` directory and are read-only:
 * they show a 内置 badge, have no ⋯ menu, and load as an *unsaved* canvas so
 * 保存 creates a new workflow instead of overwriting the shipped file.
 *
 * @module components/WorkflowLibrary
 */
/** MIME type used when dragging a workflow row onto the canvas. */
export declare const WORKFLOW_DRAG_TYPE = "application/x-dsh-workflow";
/**
 * Load one workflow into the canvas.
 *
 * A template opens as an *unsaved* canvas (`workflowId = null`): Save then mints
 * a new file, so the shipped `examples/` copy can never be overwritten and a
 * plugin upgrade stays free to replace it.
 */
export declare function loadWorkflowFile(id: string): Promise<void>;
export declare function WorkflowLibrary(): import("react").JSX.Element;
