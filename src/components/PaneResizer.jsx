// visible=true: always shows a zinc line (used between editor panes, no border-r on siblings)
// visible=false: transparent hit area (used next to NoteGrid whose border-r is the visual separator)
export default function PaneResizer({ onMouseDown, visible = false }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="hidden md:block shrink-0 w-2 cursor-col-resize relative group"
    >
      <div
        className={[
          'absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors duration-100',
          visible
            ? 'bg-zinc-800 group-hover:bg-blue-500'
            : 'bg-transparent group-hover:bg-blue-500',
        ].join(' ')}
      />
    </div>
  )
}
