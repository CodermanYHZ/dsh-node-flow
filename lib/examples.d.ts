/**
 * Built-in workflow templates shipped as JSON beside the package.
 *
 * `examples/<id>.json` is the single source of truth: the host lists these next
 * to the user's own workflows and serves them read-only. A template is never
 * written back — opening one starts an unsaved canvas, so "save" creates a new
 * workflow instead of touching the shipped file (a package upgrade replaces
 * `examples/` wholesale, and anything written there would be lost).
 *
 * @module examples
 */
import type { WorkflowDocument } from './model.js';
/** One template row for the workflow library. */
export interface ExampleSummary {
    id: string;
    name: string;
    description?: string;
    nodeCount: number;
}
/** `examples/` beside the installed package (this module is emitted into `lib/`). */
export declare function examplesDir(): string;
/** True when `id` names a shipped template; templates are read-only. */
export declare function isExampleId(id: string): boolean;
/** Read one template document, or `undefined` when the id names no template. */
export declare function readExample(id: string): WorkflowDocument | undefined;
/** Every shipped template, sorted by name so the library order is stable. */
export declare function listExamples(): ExampleSummary[];
