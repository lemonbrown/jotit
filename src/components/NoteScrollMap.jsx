import { MINIMAP_WIDTH } from '../hooks/useScrollMap'

export default function NoteScrollMap({ containerRef, canvasRef, viewportStyle, onPointerDown }) {
  return (
    <div
      ref={containerRef}
      className="relative shrink-0 select-none border-l border-zinc-800/60 bg-zinc-950/60"
      style={{ width: MINIMAP_WIDTH }}
      onPointerDown={onPointerDown}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block"
        style={{ imageRendering: 'pixelated', width: '100%', height: '100%' }}
      />
      <div
        className="pointer-events-none absolute left-0 right-0 border-y border-zinc-500/25 bg-zinc-400/10"
        style={{ top: viewportStyle.top, height: viewportStyle.height }}
      />
    </div>
  )
}
