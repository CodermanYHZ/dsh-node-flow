import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Inspector panel for the selected node — edits kind-specific fields.
 *
 * @module components/Inspector
 */
import { useEffect, useState } from 'react';
import { useCanvasStore } from '../store/canvas.js';
import { CodeEditor } from './CodeEditor.js';
import { CodeEditorModal } from './CodeEditorModal.js';
import expandArrowsIcon from '../assets/icons/expand-arrows-alt.svg';
/** Short deterministic hash so one schedule node can host several cron times. */
function hashCron(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++)
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
}
const KIND_LABELS = {
    trigger: 'Trigger',
    schedule: 'Schedule',
    agent: 'Sub-agent',
    if: 'If',
    switch: 'Switch',
    loop: 'Loop',
    while: 'While',
    code: 'Code',
    output: 'Output',
    note: 'Note',
};
export function Inspector() {
    const selectedId = useCanvasStore((s) => s.selectedId);
    const node = useCanvasStore((s) => s.nodes.find((n) => n.id === s.selectedId));
    const updateNodeData = useCanvasStore((s) => s.updateNodeData);
    const removeNode = useCanvasStore((s) => s.removeNode);
    const [codeExpanded, setCodeExpanded] = useState(false);
    const [agentModels, setAgentModels] = useState([]);
    // Load the available model routes once (for the agent-node model dropdown).
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch('/dsh-node-flow/models', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{}',
                });
                const data = (await res.json().catch(() => ({})));
                if (!cancelled)
                    setAgentModels(Array.isArray(data.models) ? data.models : []);
            }
            catch {
                if (!cancelled)
                    setAgentModels([]);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);
    if (!node) {
        return (_jsx("aside", { className: "wf-inspector wf-inspector--empty", children: _jsx("p", { children: "Select a node to configure it." }) }));
    }
    const d = node.data;
    const saveSchedule = async () => {
        if (!d.cron?.trim()) {
            alert('请先填写 Cron 表达式（例如 30 7 * * *）');
            return;
        }
        try {
            const store = useCanvasStore.getState();
            const steps = store.toSteps();
            const doc = store.exportDocument();
            const res = await fetch('/dsh-node-flow/schedule', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    id: `wf-${node.id}-${hashCron(d.cron)}`,
                    name: doc.name || 'scheduled workflow',
                    cron: d.cron,
                    input: d.text ?? '',
                    steps,
                    doc,
                }),
            });
            const data = (await res.json().catch(() => ({})));
            if (!res.ok)
                alert(data.error ?? '保存计划失败');
        }
        catch (err) {
            alert(err instanceof Error ? err.message : String(err));
        }
    };
    return (_jsxs("aside", { className: "wf-inspector", children: [_jsxs("header", { className: "wf-inspector__head", children: [_jsx("strong", { children: KIND_LABELS[d.kind] }), _jsx("button", { className: "wf-btn wf-btn--danger", onClick: () => removeNode(node.id), children: "Delete" })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "Label" }), _jsx("input", { value: d.label, onChange: (e) => updateNodeData(node.id, { label: e.target.value }) })] }), d.kind === 'note' && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u5907\u6CE8" }), _jsx("textarea", { rows: 5, placeholder: "\u8FD9\u4E2A\u5907\u6CE8\u4E0D\u4F1A\u53C2\u4E0E\u6267\u884C\uFF0C\u53EA\u505A\u8BF4\u660E", value: d.text ?? '', onChange: (e) => updateNodeData(node.id, { text: e.target.value }) })] })), d.kind === 'trigger' && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "Trigger text" }), _jsx("textarea", { rows: 4, placeholder: "\u8F93\u5165\u8981\u4EA4\u7ED9 agent \u7684\u4EFB\u52A1\u6587\u5B57\uFF08\u4F1A\u4F20\u5230\u4E0B\u6E38 agent\uFF09", value: d.text ?? '', onChange: (e) => updateNodeData(node.id, { text: e.target.value }) })] })), d.kind === 'schedule' && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u4EFB\u52A1\u6587\u5B57\uFF08\u53EF\u9009\uFF09" }), _jsx("textarea", { rows: 2, placeholder: "\u8FD9\u6761\u5B9A\u65F6\u4EFB\u52A1\u7684\u89E6\u53D1\u5185\u5BB9\uFF08\u53EF\u9009\uFF09", value: d.text ?? '', onChange: (e) => updateNodeData(node.id, { text: e.target.value }) })] }), _jsxs("div", { className: "wf-trigger-schedule", children: [_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u5B9A\u65F6 Cron (5\u6BB5)" }), _jsx("input", { placeholder: "30 7 * * *  (\u5206 \u65F6 \u65E5 \u6708 \u5468)", value: d.cron ?? '', onChange: (e) => updateNodeData(node.id, { cron: e.target.value }) })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u65F6\u533A" }), _jsx("input", { placeholder: "Asia/Shanghai\uFF08\u7559\u7A7A=\u7CFB\u7EDF\u65F6\u533A\uFF09", value: d.timezone ?? '', onChange: (e) => updateNodeData(node.id, { timezone: e.target.value }) })] }), _jsx("div", { className: "wf-trigger-schedule__actions", children: _jsx("button", { className: "wf-btn wf-btn--primary", onClick: () => void saveSchedule(), children: "\u4FDD\u5B58\u5B9A\u65F6" }) })] })] })), d.kind === 'agent' && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u6A21\u578B" }), _jsxs("select", { value: d.model ?? '', onChange: (e) => updateNodeData(node.id, { model: e.target.value }), children: [_jsx("option", { value: "", children: "\u5B98\u65B9\u9ED8\u8BA4\uFF08\u7EE7\u627F\uFF09" }), agentModels.map((m) => (_jsxs("option", { value: `${m.provider}|${m.id}`, children: [m.name, "\uFF08", m.provider, "\uFF09"] }, `${m.provider}|${m.id}`)))] })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "system prompt" }), _jsx("textarea", { rows: 3, value: d.prompt ?? '', onChange: (e) => updateNodeData(node.id, { prompt: e.target.value }) })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u8FD0\u884C\u8D85\u65F6\uFF08\u79D2\uFF0C\u7559\u7A7A=\u4E0D\u9650\u5236\uFF09" }), _jsx("input", { placeholder: "\u4F8B\u5982 60", value: d.timeout ?? '', onChange: (e) => updateNodeData(node.id, { timeout: e.target.value }) })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u5931\u8D25\u65F6\u884C\u4E3A" }), _jsxs("select", { value: d.onError ?? 'stop', onChange: (e) => updateNodeData(node.id, { onError: e.target.value }), children: [_jsx("option", { value: "stop", children: "\u505C\u6B62\u5206\u652F" }), _jsx("option", { value: "continue", children: "\u7EE7\u7EED\u7528\u7A7A\u503C" })] })] })] })), d.kind === 'if' && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "Condition" }), _jsx("input", { placeholder: "\u6BD4\u5982 result.ok === true\uFF1Btrue \u8D70\u4E0A\u8F93\u51FA\u3001false \u8D70\u4E0B\u8F93\u51FA", value: d.condition ?? '', onChange: (e) => updateNodeData(node.id, { condition: e.target.value }) })] })), d.kind === 'switch' && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u5224\u65AD\u8868\u8FBE\u5F0F\uFF08\u503C\uFF09" }), _jsx("input", { placeholder: "\u6BD4\u5982 result.kind", value: d.condition ?? '', onChange: (e) => updateNodeData(node.id, { condition: e.target.value }) })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "Case\uFF08\u9017\u53F7\u5206\u9694\uFF0C\u5BF9\u5E94\u53F3\u4FA7\u8F93\u51FA\u53E3\uFF09" }), _jsx("input", { placeholder: "a, b, c\uFF08default \u53E3\u515C\u5E95\uFF09", value: d.cases ?? '', onChange: (e) => updateNodeData(node.id, { cases: e.target.value }) })] })] })), d.kind === 'output' && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "Template" }), _jsx("textarea", { rows: 3, placeholder: "\u7559\u7A7A=\u76F4\u63A5\u663E\u793A\u4E0A\u4E00\u8282\u70B9\u7ED3\u679C\uFF1B\u6216\u586B \u7ED3\u679C: {{result}}", value: d.template ?? '', onChange: (e) => updateNodeData(node.id, { template: e.target.value }) })] })), d.kind === 'loop' && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u5FAA\u73AF\u65B9\u5F0F" }), _jsxs("select", { value: d.mode ?? 'items', onChange: (e) => updateNodeData(node.id, { mode: e.target.value }), children: [_jsx("option", { value: "items", children: "\u904D\u5386\u6570\u7EC4 (items)" }), _jsx("option", { value: "count", children: "\u56FA\u5B9A\u6B21\u6570 (count)" })] })] }), d.mode === 'count' ? (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u6B21\u6570" }), _jsx("input", { placeholder: "\u4F8B\u5982 5", value: d.count ?? '', onChange: (e) => updateNodeData(node.id, { count: e.target.value }) })] })) : (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u6570\u7EC4\u8868\u8FBE\u5F0F\uFF08\u7528 result \u8868\u793A\u4E0A\u6E38\u7ED3\u679C\uFF09" }), _jsx("input", { placeholder: "\u4F8B\u5982 JSON.parse(result)", value: d.itemsExpr ?? '', onChange: (e) => updateNodeData(node.id, { itemsExpr: e.target.value }) })] })), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u6B21\u6570\u4E0A\u9650 maxIters" }), _jsx("input", { placeholder: "100", value: d.maxIters ?? '', onChange: (e) => updateNodeData(node.id, { maxIters: e.target.value }) })] }), _jsxs("label", { className: "wf-field wf-field--checkbox", children: [_jsx("input", { type: "checkbox", checked: d.collect ?? false, onChange: (e) => updateNodeData(node.id, { collect: e.target.checked }) }), _jsx("span", { children: "\u6536\u96C6\u6BCF\u8F6E\u7ED3\u679C\u6210\u6570\u7EC4" })] })] })), d.kind === 'while' && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u7EE7\u7EED\u6761\u4EF6\uFF08\u7528 result \u8868\u793A\u5F53\u524D\u503C\uFF09" }), _jsx("input", { placeholder: "\u4F8B\u5982 Number(result) < 5", value: d.condition ?? '', onChange: (e) => updateNodeData(node.id, { condition: e.target.value }) })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u6B21\u6570\u4E0A\u9650 maxIters" }), _jsx("input", { placeholder: "100", value: d.maxIters ?? '', onChange: (e) => updateNodeData(node.id, { maxIters: e.target.value }) })] }), _jsxs("label", { className: "wf-field wf-field--checkbox", children: [_jsx("input", { type: "checkbox", checked: d.collect ?? false, onChange: (e) => updateNodeData(node.id, { collect: e.target.checked }) }), _jsx("span", { children: "\u6536\u96C6\u6BCF\u8F6E\u7ED3\u679C\u6210\u6570\u7EC4" })] })] })), d.kind === 'code' && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u8FD0\u884C\u8D85\u65F6\uFF08\u79D2\uFF0C\u7559\u7A7A=\u4E0D\u9650\u5236\uFF09" }), _jsx("input", { placeholder: "\u4F8B\u5982 30", value: d.timeout ?? '', onChange: (e) => updateNodeData(node.id, { timeout: e.target.value }) })] }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u5931\u8D25\u65F6\u884C\u4E3A" }), _jsxs("select", { value: d.onError ?? 'stop', onChange: (e) => updateNodeData(node.id, { onError: e.target.value }), children: [_jsx("option", { value: "stop", children: "\u505C\u6B62\u5206\u652F" }), _jsx("option", { value: "continue", children: "\u7EE7\u7EED\u7528\u7A7A\u503C" })] })] }), _jsxs("div", { className: "wf-codecard", children: [_jsxs("div", { className: "wf-codecard__head", children: [_jsx("span", { className: "wf-codecard__title", children: "Code" }), _jsxs("select", { className: "wf-codecard__lang", value: d.language ?? 'typescript', onChange: (e) => updateNodeData(node.id, { language: e.target.value, lastRun: undefined }), children: [_jsx("option", { value: "typescript", children: "TypeScript" }), _jsx("option", { value: "python", children: "Python" })] })] }), _jsxs("div", { className: "wf-codecard__editor", children: [_jsx(CodeEditor, { value: d.code ?? '', onChange: (v) => updateNodeData(node.id, { code: v, lastRun: undefined }), language: d.language ?? 'typescript' }), _jsx("button", { type: "button", className: "wf-ed-expand", onClick: () => setCodeExpanded(true), title: "\u5168\u5C4F\u7F16\u8F91", "aria-label": "\u5168\u5C4F\u7F16\u8F91\u4EE3\u7801", children: _jsx("img", { className: "wf-icon-image", src: expandArrowsIcon, alt: "", "aria-hidden": "true" }) })] })] })] })), codeExpanded && (_jsx(CodeEditorModal, { value: d.code ?? '', onChange: (v) => updateNodeData(node.id, { code: v, lastRun: undefined }), language: d.language ?? 'typescript', onClose: () => setCodeExpanded(false) })), d.lastRun && (_jsxs("div", { className: "wf-run", children: [d.kind !== 'output' && d.kind !== 'trigger' && d.lastRun.input !== undefined && d.lastRun.input !== '' && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u8F93\u5165 Input" }), _jsx("textarea", { className: "wf-run__box", readOnly: true, rows: 3, value: d.lastRun.input })] })), d.kind !== 'trigger' && d.kind !== 'schedule' && d.lastRun.value !== undefined && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u8F93\u51FA Output" }), _jsx("textarea", { className: "wf-run__box", readOnly: true, rows: 5, value: typeof d.lastRun.value === 'string'
                                    ? d.lastRun.value
                                    : JSON.stringify(d.lastRun.value) })] })), d.lastRun.logs && d.lastRun.logs.length > 0 && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u65E5\u5FD7 Logs" }), _jsx("pre", { className: "wf-result__logs", children: d.lastRun.logs.join('\n') })] })), d.lastRun.error && (_jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u9519\u8BEF Error" }), _jsx("pre", { className: "wf-result__error", children: d.lastRun.error })] }))] })), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "Notes" }), _jsx("input", { value: d.notes ?? '', onChange: (e) => updateNodeData(node.id, { notes: e.target.value }) })] })] }));
}
