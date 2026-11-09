/** Visual and layout viewports differ when Android's keyboard overlays a page. */
export function measureMobileViewport(input: { layoutHeight: number; visualHeight?: number; visualTop?: number; scale?: number }) {
  const layout = Number.isFinite(input.layoutHeight) && input.layoutHeight > 0 ? input.layoutHeight : 1;
  // Pinch zoom must magnify the page, rather than relayout it into a smaller box.
  const zoomed = Number.isFinite(input.scale) && input.scale! > 1.02;
  const visual = !zoomed && Number.isFinite(input.visualHeight) && input.visualHeight! > 0 ? input.visualHeight! : layout;
  const height = Math.min(layout, visual);
  const top = !zoomed && Number.isFinite(input.visualTop) ? Math.max(0, Math.min(layout - height, input.visualTop!)) : 0;
  return { height, top, bottom: Math.max(0, layout - height - top), short: height <= 500 };
}
