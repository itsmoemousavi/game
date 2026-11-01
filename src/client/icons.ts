import type { ItemId } from '../sim';

/**
 * Hand-made 24×24 SVG icons for items (original artwork, no external assets).
 * Each returns markup that fills its container.
 */
const svg = (body: string, bg: string) =>
  `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="${bg}"/>${body}</svg>`;

const ICONS: Record<ItemId | 'tp' | 'shop', string> = {
  healingSalve: svg(
    '<path d="M9 4h6v3l3 4v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8l3-4z" fill="#d1fae5" stroke="#065f46" stroke-width="1"/><path d="M7 13h10v6a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" fill="#22c55e"/><path d="M11 14.5h2v1.5h1.5v2H13v1.5h-2V18H9.5v-2H11z" fill="#fff"/>',
    '#14532d',
  ),
  swiftBoots: svg(
    '<path d="M7 4h5v8l6 3c1.5.8 2 2 2 3.5V20H5v-3l2-1z" fill="#d6c7a1" stroke="#5b4a2a" stroke-width="1"/><path d="M3 9h4M2 12h5M3 15h4" stroke="#fde68a" stroke-width="1.5" stroke-linecap="round"/>',
    '#3f3f46',
  ),
  ironBlade: svg(
    '<path d="M17.5 3.5l3 3-10 10-3-3z" fill="#e5e7eb" stroke="#475569" stroke-width="1"/><path d="M6 14l4 4-2 1.5-3.5-3.5z" fill="#a16207"/><path d="M4 18l2 2-1.5 1.5-2-2z" fill="#78350f"/>',
    '#1e293b',
  ),
  vitalStone: svg(
    '<path d="M12 20s-7-4.3-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.7 12 20 12 20z" fill="#ef4444" stroke="#7f1d1d" stroke-width="1"/><path d="M9 10.5a2 2 0 0 1 2-1.5" stroke="#fecaca" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
    '#450a0a',
  ),
  manaCrystal: svg(
    '<path d="M12 3l5 6-5 12-5-12z" fill="#60a5fa" stroke="#1e3a8a" stroke-width="1"/><path d="M12 3l-5 6h10z" fill="#bfdbfe"/><path d="M12 9v12" stroke="#1d4ed8" stroke-width="0.8"/>',
    '#172554',
  ),
  quickGloves: svg(
    '<path d="M7 20v-7l-1.5-3a1 1 0 0 1 1.8-.9L9 11V5a1 1 0 0 1 2 0v5-6a1 1 0 0 1 2 0v6-5a1 1 0 0 1 2 0v6-4a1 1 0 0 1 2 0v8c0 3-2 5-5 5H9z" fill="#f59e0b" stroke="#78350f" stroke-width="1"/><path d="M3 6l2 1M3 9.5h2" stroke="#fde68a" stroke-width="1.3" stroke-linecap="round"/>',
    '#422006',
  ),
  guardPlate: svg(
    '<path d="M12 3l7 3v5c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6z" fill="#94a3b8" stroke="#1e293b" stroke-width="1"/><path d="M12 3v18" stroke="#475569" stroke-width="1"/><path d="M8 9h8" stroke="#e2e8f0" stroke-width="1.2"/>',
    '#0f172a',
  ),
  focusLens: svg(
    '<circle cx="10.5" cy="10.5" r="6" fill="#a5f3fc" stroke="#155e75" stroke-width="1.5"/><path d="M15 15l5.5 5.5" stroke="#155e75" stroke-width="2.5" stroke-linecap="round"/><path d="M10.5 7v3.5l2.5 1.5" stroke="#0e7490" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
    '#083344',
  ),
  arcaneAmplifier: svg(
    '<circle cx="12" cy="12" r="5" fill="#c084fc" stroke="#581c87" stroke-width="1"/><circle cx="12" cy="12" r="8.5" fill="none" stroke="#e9d5ff" stroke-width="1" stroke-dasharray="2 2"/><path d="M12 9.5v5M9.5 12h5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>',
    '#3b0764',
  ),
  lifedrinker: svg(
    '<path d="M7 4h10l-1 7a4 4 0 0 1-8 0z" fill="#be123c" stroke="#4c0519" stroke-width="1"/><path d="M12 15v4M8.5 20h7" stroke="#fda4af" stroke-width="1.5" stroke-linecap="round"/><path d="M9 7h6" stroke="#fecdd3" stroke-width="1"/>',
    '#4c0519',
  ),
  crownOfAscension: svg(
    '<path d="M4 17l1.5-9 4 4L12 6l2.5 6 4-4L20 17z" fill="#facc15" stroke="#713f12" stroke-width="1"/><path d="M4 17.5h16v2.5H4z" fill="#eab308" stroke="#713f12" stroke-width="1"/><circle cx="12" cy="13.5" r="1.3" fill="#ef4444"/>',
    '#422006',
  ),
  observerWard: svg(
    '<path d="M2.5 12S6.5 6 12 6s9.5 6 9.5 6-4 6-9.5 6-9.5-6-9.5-6z" fill="#fef08a" stroke="#713f12" stroke-width="1"/><circle cx="12" cy="12" r="3" fill="#713f12"/><circle cx="13" cy="11" r="0.9" fill="#fff"/>',
    '#3f3a0a',
  ),
  sentryWard: svg(
    '<path d="M2.5 12S6.5 6 12 6s9.5 6 9.5 6-4 6-9.5 6-9.5-6-9.5-6z" fill="#bfdbfe" stroke="#1e3a8a" stroke-width="1"/><circle cx="12" cy="12" r="3" fill="#1d4ed8"/><path d="M12 2.5v2.5M12 19v2.5M4 4l2 2M20 4l-2 2" stroke="#93c5fd" stroke-width="1.2" stroke-linecap="round"/>',
    '#172554',
  ),
  twinBlades: svg(
    '<path d="M16 3l3 3-9 9-3-3z" fill="#e5e7eb" stroke="#334155" stroke-width="0.9"/><path d="M8 3L5 6l9 9 3-3z" fill="#cbd5e1" stroke="#334155" stroke-width="0.9"/><path d="M5 16l3 3-2 2-3-3zM19 16l-3 3 2 2 3-3z" fill="#a16207"/>',
    '#1e293b',
  ),
  titanHeart: svg(
    '<path d="M12 21s-8-4.8-8-10.6A4.5 4.5 0 0 1 12 7.5a4.5 4.5 0 0 1 8 2.9C20 16.2 12 21 12 21z" fill="#dc2626" stroke="#450a0a" stroke-width="1"/><path d="M6.5 12h3l1.5-3 2 6 1.5-3h3" stroke="#fee2e2" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
    '#3f0d0d',
  ),
  archmageStaff: svg(
    '<path d="M7 21L16 8" stroke="#a16207" stroke-width="2" stroke-linecap="round"/><circle cx="17" cy="6.5" r="3.2" fill="#c084fc" stroke="#3b0764" stroke-width="1"/><path d="M17 1.8v1.6M21.7 6.5h-1.6M20.3 3.2l-1.1 1.1" stroke="#e9d5ff" stroke-width="1.1" stroke-linecap="round"/>',
    '#2e1065',
  ),
  wardedCloak: svg(
    '<path d="M12 3c3 0 6 1.5 7 3l-2 14H7L5 6c1-1.5 4-3 7-3z" fill="#0ea5e9" stroke="#0c4a6e" stroke-width="1"/><path d="M12 8l3 1.3v2.4c0 2.3-1.4 3.9-3 4.6-1.6-.7-3-2.3-3-4.6V9.3z" fill="#e0f2fe" stroke="#0c4a6e" stroke-width="0.8"/>',
    '#082f49',
  ),
  shadowStep: svg(
    '<path d="M4 18c2-1 3.5-1 5 0M8 13c2-1 3.5-1 5 0" stroke="#a5b4fc" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.7"/><path d="M13 6h4l2 5-3 2v5h-3v-5l-2-2z" fill="#818cf8" stroke="#1e1b4b" stroke-width="1"/><circle cx="16" cy="4" r="1.6" fill="#c7d2fe"/>',
    '#1e1b4b',
  ),
  tp: svg(
    '<path d="M6 5h11a2 2 0 0 1 0 4H8v10H6a2 2 0 0 1 0-4" fill="#e0f2fe" stroke="#0c4a6e" stroke-width="1"/><path d="M8 9h9v8a2 2 0 0 1-2 2H8z" fill="#bae6fd" stroke="#0c4a6e" stroke-width="1"/><circle cx="12.5" cy="13.5" r="2.2" fill="none" stroke="#0284c7" stroke-width="1.2"/><circle cx="12.5" cy="13.5" r="0.8" fill="#0284c7"/>',
    '#0c4a6e',
  ),
  shop: svg(
    '<path d="M4 6h2l2 9h10l2-7H7" fill="none" stroke="#fde68a" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="9.5" cy="18.5" r="1.4" fill="#fde68a"/><circle cx="16.5" cy="18.5" r="1.4" fill="#fde68a"/>',
    '#6b4e16',
  ),
};

export const itemIcon = (id: ItemId | 'tp' | 'shop') => ICONS[id];
