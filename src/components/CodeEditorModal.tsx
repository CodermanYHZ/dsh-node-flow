/**
 * Full-screen code editor modal — opened from the code node card's "展开"
 * button so editing has the whole node-mode surface to work in.
 *
 * @module components/CodeEditorModal
 */

import { createPortal } from 'react-dom'
import { useCanvasStore } from '../store/canvas.js'
import compressArrowsIcon from '../assets/icons/compress-arrows-alt.svg'
import { CodeEditor } from './CodeEditor.js'

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
  const theme = useCanvasStore((state) => state.theme)

  return createPortal(
    <div
      className="wf-editor-modal"
      data-theme={theme}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wf-editor-modal-title"
    >
      <div className="wf-editor-modal__head">
        <div className="wf-editor-modal__heading">
          <span id="wf-editor-modal-title" className="wf-editor-modal__title">代码编辑器</span>
          <span className="wf-editor-modal__language">
            {language === 'python' ? 'Python' : 'TypeScript'}
          </span>
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
    document.body,
  )
}
