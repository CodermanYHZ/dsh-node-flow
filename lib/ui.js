/**
 * DSH web client half for dsh-node-flow.
 *
 * Runs inside the sandboxed `dsh-cordis-client-runner` closure. The guarded
 * client `ctx` only exposes client-side facades (slots / theme / host / harness),
 * so this half is fully self-contained: it renders the React Flow canvas from
 * its own Zustand store and stays mountable without waiting on any service.
 *
 * Presentation: the canvas is NOT an always-on floating window. Instead this
 * half injects a single "节点模式" entry row into the DSH sidebar (plain DOM +
 * self-healing, the same pattern the task-board plugin uses), and only when the
 * user toggles it does a full-screen overlay host the canvas. Closing the
 * overlay returns to the normal GUI.
 *
 * `react` / `react-dom` are externalized (resolved by the host ModuleLoader,
 * like the official dsh-client-* bundles); everything else is inlined.
 *
 * @module client
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Overlay } from './components/Overlay.js';
import rfCss from '@xyflow/react/dist/style.css';
import canvasCss from './components/canvas.css';
export const name = 'dsh-node-flow-ui';
export const inject = [];
/** Idempotency attribute / selector for the injected sidebar entry row. */
const ENTRY_ATTR = 'data-dsh-node-flow-entry';
const ENTRY_SELECTOR = `[${ENTRY_ATTR}]`;
let overlayRoot = null;
let overlayEl = null;
let entry = null;
function ensureStyles() {
    if (document.getElementById('dsh-node-flow-styles'))
        return;
    const style = document.createElement('style');
    style.id = 'dsh-node-flow-styles';
    style.textContent = `${rfCss}\n${canvasCss}`;
    document.head.appendChild(style);
}
function syncEntryActive() {
    if (!entry)
        return;
    if (overlayEl) {
        entry.dataset.active = 'true';
        entry.style.background = 'rgba(59, 130, 246, 0.16)';
    }
    else {
        delete entry.dataset.active;
        entry.style.background = 'transparent';
    }
}
function openOverlay() {
    if (overlayEl)
        return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'dsh-node-flow-overlay';
    document.body.appendChild(overlayEl);
    overlayRoot = ReactDOM.createRoot(overlayEl);
    overlayRoot.render(React.createElement(Overlay, { onClose: closeOverlay }));
    syncEntryActive();
}
function closeOverlay() {
    if (overlayRoot) {
        overlayRoot.unmount();
        overlayRoot = null;
    }
    if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
    }
    syncEntryActive();
}
function toggleOverlay() {
    if (overlayEl)
        closeOverlay();
    else
        openOverlay();
}
/** Build the sidebar entry row (a plain button; no React tree in the shell). */
function createEntry() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(ENTRY_ATTR, '');
    btn.setAttribute('aria-label', '节点模式');
    btn.title = '打开工作流画布（节点模式）';
    btn.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:8px',
        'width:100%',
        'padding:8px 12px',
        'background:transparent',
        'border:none',
        'border-radius:8px',
        'color:#e2e8f0',
        'font-size:13px',
        'cursor:pointer',
        'text-align:left',
        'transition:background 0.15s',
    ].join(';');
    btn.innerHTML =
        '<span style="display:inline-flex;align-items:center;font-size:14px;line-height:1;">⬡</span>' +
            '<span>节点模式</span>';
    btn.addEventListener('mouseenter', () => {
        if (btn.dataset.active !== 'true')
            btn.style.background = 'rgba(148,163,184,0.12)';
    });
    btn.addEventListener('mouseleave', () => {
        if (btn.dataset.active !== 'true')
            btn.style.background = 'transparent';
    });
    btn.addEventListener('click', toggleOverlay);
    return btn;
}
/** The sidebar shell root, or undefined while not yet mounted. */
function sidebarRoot() {
    const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
    if (!column)
        return undefined;
    const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement;
    return logoOwner ?? column.firstElementChild;
}
/** The New Session button; a direct child on legacy shells, nested otherwise. */
function newSessionButton(root) {
    const nested = root.querySelector('button[class*="newSession"]');
    if (nested)
        return nested;
    for (const child of root.children) {
        if (child.tagName === 'BUTTON')
            return child;
    }
    return undefined;
}
/** Insert the entry just below the New Session row (before the workspace browser). */
function placeEntry(root) {
    if (!entry)
        return false;
    const button = newSessionButton(root);
    if (!button)
        return false;
    if (entry.parentElement !== root) {
        const row = button.closest('[class*="logoRow"]');
        const base = row !== null && row.parentElement === root ? row : button;
        root.insertBefore(entry, base.nextElementSibling);
    }
    return true;
}
/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * when a React re-render displaces the row. Returns a disposer.
 */
function mountEntry() {
    if (document.querySelector(ENTRY_SELECTOR))
        return () => { };
    entry = createEntry();
    let root;
    let placed = false;
    const tryPlace = () => {
        if (root !== undefined && !root.isConnected) {
            root = undefined;
            placed = false;
        }
        if (placed) {
            if (document.body.contains(entry))
                return;
            root = undefined;
            placed = false;
        }
        root ??= sidebarRoot();
        if (root === undefined)
            return;
        placed = placeEntry(root);
    };
    const waitObserver = new MutationObserver(() => {
        tryPlace();
    });
    waitObserver.observe(document.body, { childList: true, subtree: true });
    tryPlace();
    return () => {
        waitObserver.disconnect();
        entry?.remove();
        entry = null;
    };
}
export function apply() {
    ensureStyles();
    const disposeEntry = mountEntry();
    return () => {
        closeOverlay();
        disposeEntry();
    };
}
