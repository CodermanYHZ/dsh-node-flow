/**
 * Full-screen overlay hosting the workflow canvas in "node mode".
 *
 * Rendered only while the user is in node mode (toggled by the sidebar entry);
 * the close button returns to the normal GUI. Applies the selected theme
 * (dark/light) to the overlay and loads the saved preference on mount.
 *
 * @module components/Overlay
 */

import { useEffect } from 'react'
import { Canvas } from './Canvas.js'
import { useCanvasStore } from '../store/canvas.js'

export function Overlay({ onClose }: { onClose: () => void }) {
  const theme = useCanvasStore((s) => s.theme)
  const setTheme = useCanvasStore((s) => s.setTheme)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dsh-node-flow:theme')
      if (saved === 'light' || saved === 'dark') setTheme(saved)
    } catch {
      /* ignore */
    }
  }, [setTheme])

  return (
    <div className="wf-overlay" data-theme={theme}>
      <div className="wf-overlay__body">
        <Canvas onExitNodeMode={onClose} />
      </div>
    </div>
  )
}
