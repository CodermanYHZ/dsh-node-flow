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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Ids become file names, so keep them to a conservative character set. */
const EXAMPLE_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
/** `examples/` beside the installed package (this module is emitted into `lib/`). */
export function examplesDir() {
    return fileURLToPath(new URL('../examples/', import.meta.url));
}
function examplePath(id) {
    return EXAMPLE_ID_PATTERN.test(id) ? join(examplesDir(), `${id}.json`) : undefined;
}
/** True when `id` names a shipped template; templates are read-only. */
export function isExampleId(id) {
    const path = examplePath(id);
    return path !== undefined && existsSync(path);
}
/** Read one template document, or `undefined` when the id names no template. */
export function readExample(id) {
    const path = examplePath(id);
    if (path === undefined)
        return undefined;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return undefined;
    }
}
/** Every shipped template, sorted by name so the library order is stable. */
export function listExamples() {
    let entries;
    try {
        entries = readdirSync(examplesDir());
    }
    catch {
        /* a missing or unreadable examples directory just means no templates */
        return [];
    }
    const out = [];
    for (const entry of entries) {
        if (!entry.endsWith('.json'))
            continue;
        const id = entry.slice(0, -'.json'.length);
        const doc = readExample(id);
        if (doc === undefined)
            continue;
        out.push({
            id,
            name: typeof doc.name === 'string' && doc.name.trim() ? doc.name : id,
            ...(typeof doc.description === 'string' ? { description: doc.description } : {}),
            nodeCount: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
