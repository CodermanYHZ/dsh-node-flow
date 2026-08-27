/**
 * A single workflow node card rendered on the canvas.
 *
 * Most nodes render as a rounded square (icon on top, label + summary below);
 * the agent node stays a wider rounded rectangle. After a run, the node's
 * outer border turns green (success) or red (failure) — no checkmark — and an
 * amber border shows while running. The node's elapsed time appears in the
 * top-left corner, its run time in the bottom-right.
 *
 * IF and SWITCH nodes render extra source handles so the flow can branch:
 * IF → "true" / "false"; SWITCH → one per configured case, plus "default".
 *
 * @module nodes/WorkflowNodeView
 */
import { type NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../model.js';
export declare function WorkflowNodeView({ data, selected }: NodeProps<WorkflowNode>): import("react").JSX.Element;
