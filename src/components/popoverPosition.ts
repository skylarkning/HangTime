/** Position a help panel using its measured height, with room to scroll if needed. */
export function placePopover(
  anchor: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  measuredHeight: number,
) {
  const edge = 12;
  const gap = 8;
  const width = Math.max(0, Math.min(340, viewport.width - edge * 2));
  const maxHeight = Math.max(0, viewport.height - edge * 2);
  const height = Math.min(measuredHeight, maxHeight);
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - height;
  const preferred = below + height <= viewport.height - edge ? below : above;
  return {
    width, maxHeight,
    left: Math.max(edge, Math.min(anchor.left, viewport.width - width - edge)),
    top: Math.max(edge, Math.min(preferred, viewport.height - height - edge)),
  };
}
