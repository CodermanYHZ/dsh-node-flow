/**
 * Workflow library drawer — the list of saved workflows.
 *
 * Every row is one file under `$DSH_HOME/workflow-canvas/workflows/<id>.json`.
 * Clicking a row (or dropping it on the canvas) loads that file into the canvas;
 * the toolbar's 保存 writes the canvas back to the same id. Each row's ⋯ menu
 * renames or deletes that file.
 *
 * @module components/WorkflowLibrary
 */
/** MIME type used when dragging a workflow row onto the canvas. */
export declare const WORKFLOW_DRAG_TYPE = "application/x-dsh-workflow";
/** Load one workflow file into the canvas. */
export declare function loadWorkflowFile(id: string): Promise<void>;
export declare function WorkflowLibrary(): import("react").JSX.Element;
