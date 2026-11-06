/**
 * Workspace picker for the canvas toolbar.
 *
 * A native `<select>` cannot look like a host control: the closed state is a
 * system widget and the popup is drawn by the OS, so the pill ended up
 * oversized and off-style. This is a plain button plus a small menu instead —
 * the button names the Workspace in use, the menu lists every registered one
 * with its directory and its runner-session state, and everything is coloured
 * from the host's alias tokens via the canvas variables.
 *
 * @module components/WorkspacePicker
 */

import { useEffect, useRef, useState } from 'react'

/** One Workspace row plus the state of its node-mode runner session. */
export interface WorkspaceOption {
  id: string
  title: string
  path: string | null
  runner: { sessionId: string; title: string; live: boolean; visible: boolean | null } | null
}

const FOLDER_PATH = 'M3 5.5a2 2 0 0 1 2-2h3.2c.5 0 1 .2 1.4.6l1 1h6.4a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
const CHECK_PATH = 'M4.5 9.5 7 12l4.5-5'

function FolderIcon() {
  return (
    <svg
      className="wf-ws__icon"
      viewBox="0 0 20 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={FOLDER_PATH} />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      className="wf-ws__chevron"
      viewBox="0 0 12 12"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 4.5 3 3 3-3" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      className="wf-ws__check"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={CHECK_PATH} />
    </svg>
  )
}

export function WorkspacePicker({
  options,
  value,
  error,
  onChange,
}: {
  options: WorkspaceOption[]
  value: string | null
  error: string
  onChange: (id: string | null, title: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find((option) => option.id === value)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const runnerLive = selected?.runner?.live === true
  const label = selected?.title ?? (error !== '' ? '工作区不可用' : '选择工作区')

  return (
    <div className="wf-ws" ref={rootRef}>
      <button
        type="button"
        className={`wf-ws__button${error !== '' ? ' wf-ws__button--error' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          error !== ''
            ? `工作区不可用：${error}`
            : `${selected?.path ?? ''}\nAgent 节点在该工作区的运行会话下执行`
        }
        onClick={() => setOpen((previous) => !previous)}
      >
        <FolderIcon />
        <span className="wf-ws__label">{label}</span>
        {runnerLive && <span className="wf-ws__dot" aria-label="运行会话已就绪" />}
        <ChevronIcon />
      </button>

      {open && (
        <div className="wf-ws__menu" role="listbox" aria-label="执行工作区">
          {error !== '' && <div className="wf-ws__error">{error}</div>}
          {options.length === 0 && <div className="wf-ws__empty">还没有工作区，先在侧边栏添加一个。</div>}
          {options.map((option) => {
            const active = option.id === value
            const live = option.runner?.live === true
            const archived = option.runner?.visible === false
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`wf-ws__row${active ? ' wf-ws__row--active' : ''}`}
                onClick={() => {
                  onChange(option.id, option.title)
                  setOpen(false)
                }}
              >
                <span className="wf-ws__rowCheck">{active ? <CheckIcon /> : null}</span>
                <span className="wf-ws__rowText">
                  <span className="wf-ws__rowTitle">{option.title}</span>
                  <span className="wf-ws__rowPath">{option.path ?? '（未知路径）'}</span>
                </span>
                <span className={`wf-ws__rowState${live ? ' wf-ws__rowState--live' : ''}`}>
                  {live ? '运行会话已就绪' : archived ? '会话已归档' : '首次运行将创建会话'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
