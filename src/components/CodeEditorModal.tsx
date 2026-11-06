/**
 * Expanded code editor — a window inside the node-mode page.
 *
 * Mounted through `overlayHost()` (see components/overlayHost.ts), so expanding
 * the editor fills the workflow surface while the DSH shell around it stays
 * visible, instead of covering the whole application window.
 *
 * @module components/CodeEditorModal
 */

import { createPortal } from 'react-dom'
import compressArrowsIcon from '../assets/icons/compress-arrows-alt.svg'
import { CodeEditor } from './CodeEditor.js'
import { overlayHost } from './overlayHost.js'

export function CodeEditorModal({
  value,
  onChange,
  language,
  onClose,
}: {
  value: string
  onChange: (v: string) => void
  language: string
  onClose: () => void
}) {
  return createPortal(
    // Colours come from the page this mounts into (`data-theme` on .wf-panel),
    // so the window carries no palette of its own.
    <div
      className="wf-editor-modal"
      role="dialog"
      aria-labelledby="wf-editor-modal-title"
    >
      <div className="wf-editor-modal__head">
        <div className="wf-editor-modal__heading">
          <span id="wf-editor-modal-title" className="wf-editor-modal__title">代码编辑器</span>
          <span className="wf-editor-modal__language">Python</span>
        </div>
        <button
          type="button"
          className="wf-editor-modal__collapse"
          onClick={onClose}
          title="收起编辑器"
          aria-label="收起全屏代码编辑器"
        >
          <img className="wf-icon-image" src={compressArrowsIcon} alt="" aria-hidden="true" />
        </button>
      </div>
      <div className="wf-editor-modal__body">
        <CodeEditor value={value} onChange={onChange} language={language} />
      </div>
    </div>,
    overlayHost(),
  )
}
