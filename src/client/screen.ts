/**
 * The game is ALWAYS landscape. If the device is held in portrait, the whole UI root
 * is rotated 90° so the game still fills the screen sideways. Native builds will also
 * lock orientation (Capacitor config); on Android browsers we try the Screen
 * Orientation API after entering fullscreen.
 *
 * All pointer input must go through `toLocal` so touches map correctly when rotated.
 */
let rotated = false;

export const isRotated = () => rotated;

/** Convert viewport (client) coordinates to coordinates inside the landscape root. */
export function toLocal(clientX: number, clientY: number): { x: number; y: number } {
  return rotated ? { x: clientY, y: window.innerWidth - clientX } : { x: clientX, y: clientY };
}

/** Convert a vector (e.g. drag delta) from viewport to landscape-root space. */
export function vecToLocal(dx: number, dy: number): { x: number; y: number } {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

export function setupLandscape(root: HTMLElement, onChange: () => void) {
  const apply = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    rotated = h > w;
    root.style.width = `${rotated ? h : w}px`;
    root.style.height = `${rotated ? w : h}px`;
    root.style.transform = rotated ? 'rotate(90deg) translateY(-100%)' : '';
    root.classList.toggle('rotated', rotated);
    onChange();
  };
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 50));
  apply();
}

/** Best effort: fullscreen + OS-level landscape lock (works on Android Chrome; iOS ignores it). */
export async function enterImmersive() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* not allowed */
  }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    /* not supported */
  }
}
