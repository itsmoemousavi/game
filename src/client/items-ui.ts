import {
  BUILDS,
  Command,
  ITEMS,
  ITEM_IDS,
  ItemId,
  TELEPORT,
  Team,
  Unit,
  World,
  buyBlocker,
  priceFor,
  inShop,
  teleportTargets,
  tpBlocker,
} from '../sim';
import { TEAM_COLORS } from './renderer';
import { toLocal } from './screen';
import { itemIcon } from './icons';

/**
 * Item bar (6 slots + teleport slot), shop panel and teleport destination picker.
 *
 * Item slot tap: use a consumable (salve). While the shop is open, tapping an item sells it.
 * TP slot tap: with scrolls → choose a destination on the big map; with 0 scrolls →
 * open the shop (teleports are only bought there).
 */
export class ItemsUi {
  private slots: HTMLElement[] = [];
  private tpSlot: HTMLElement;
  private shop: HTMLElement;
  private picker: HTMLElement;
  private pickerCanvas: HTMLCanvasElement;
  private lastKey = '';
  private shopKey = '';
  /** Slot of the ward being placed, if any. */
  placingSlot: number | null = null;

  constructor(
    private root: HTMLElement,
    private send: (c: Command) => void,
    private ctx: () => { w: World; me: Unit; team: Team; terrain: HTMLCanvasElement } | null,
    /** Called when a ward slot is tapped (enter / leave ward placement mode). */
    private onWard: (slot: number | null) => void = () => {},
    /** Short hint message (e.g. "Go back to your base to buy"). */
    private onHint: (text: string) => void = () => {},
  ) {
    root.querySelectorAll<HTMLElement>('[data-item]').forEach((el) => this.slots.push(el));
    this.tpSlot = root.querySelector('#tp-slot')!;
    this.shop = root.querySelector('#shop')!;
    this.picker = root.querySelector('#tp-picker')!;
    this.pickerCanvas = root.querySelector('#tp-canvas')!;

    const tap = (el: Element, fn: (e: PointerEvent) => void) =>
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn(e as PointerEvent);
      });

    this.slots.forEach((el, i) =>
      tap(el, () => {
        const c = this.ctx();
        if (!c) return;
        const item = c.me.hero!.items[i];
        if (this.shopOpen) this.send({ type: 'sell', unitId: c.me.id, slot: i });
        else if (item?.id === 'observerWard' || item?.id === 'sentryWard' || ITEMS[item?.id ?? 'healingSalve'].active?.kind === 'blink') {
          this.placingSlot = this.placingSlot === i ? null : i;
          this.onWard(this.placingSlot);
          this.lastKey = '';
        } else this.send({ type: 'useItem', unitId: c.me.id, slot: i });
      }),
    );
    tap(this.tpSlot, () => {
      const c = this.ctx();
      if (!c) return;
      const h = c.me.hero!;
      // Teleports are only bought in the shop; with none left this opens the shop.
      if (h.tpCount > 0) this.openPicker();
      else this.toggleShop(true);
    });
    root.querySelector('#btn-shop')!.innerHTML = itemIcon('shop');
    this.tpSlot.querySelector('.lbl')!.innerHTML = itemIcon('tp');
    tap(root.querySelector('#btn-shop')!, () => this.toggleShop());
    tap(root.querySelector('#btn-quickbuy')!, () => {
      const c = this.ctx();
      if (!c) return;
      const next = nextRecommended(c.me);
      if (!next) return;
      if (!inShop(c.w, c.me)) this.onHint('Go back to your base to buy');
      else if (c.me.hero!.gold < ITEMS[next].cost) this.onHint(`Need ${Math.ceil(ITEMS[next].cost - c.me.hero!.gold)} more gold`);
      else this.send({ type: 'buy', unitId: c.me.id, itemId: next });
    });
    tap(root.querySelector('#shop-close')!, () => this.toggleShop(false));
    tap(root.querySelector('#shop-tp')!, () => {
      const c = this.ctx();
      if (c) this.send({ type: 'buyTp', unitId: c.me.id });
    });
    tap(root.querySelector('#tp-close')!, () => this.closePicker());
    tap(this.pickerCanvas, (e) => this.pickDestination(e));
    this.buildShop();
  }

  get shopOpen() {
    return !this.shop.classList.contains('hidden');
  }

  get pickerOpen() {
    return !this.picker.classList.contains('hidden');
  }

  toggleShop(open = !this.shopOpen) {
    this.shop.classList.toggle('hidden', !open);
    this.shopKey = '';
  }

  reset() {
    this.toggleShop(false);
    this.closePicker();
    this.lastKey = '';
    this.buildShop();
  }

  private buildShop() {
    const list = this.root.querySelector('#shop-items')!;
    const c = this.ctx();
    const build = c ? BUILDS[c.me.hero!.defId] : [];
    const order = [...new Set([...build, ...ITEM_IDS])];
    list.innerHTML = '';
    for (const id of order) {
      const d = ITEMS[id];
      const card = document.createElement('button');
      card.className = 'shop-item';
      card.dataset.buy = id;
      card.innerHTML = `<i>${itemIcon(id)}</i>
        <div><b>${d.name}</b>${build.includes(id) ? ' <em>★</em>' : ''}<small>${d.summary}</small></div>
        <span class="cost">${d.cost}</span>`;
      card.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c2 = this.ctx();
        if (c2) this.send({ type: 'buy', unitId: c2.me.id, itemId: id as ItemId });
      });
      list.appendChild(card);
    }
  }

  update() {
    const c = this.ctx();
    if (!c) return;
    const { w, me } = c;
    const h = me.hero!;
    const atShop = inShop(w, me);
    const placing = this.placingSlot !== null ? h.items[this.placingSlot] : null;
    if (this.placingSlot !== null && (!placing || (!placing.id.endsWith('Ward') && !ITEMS[placing.id].active))) {
      this.placingSlot = null; // used up / sold
      this.onWard(null);
    }
    const key = `${h.items.map((s) => (s ? s.id + s.count + ':' + Math.ceil(s.cooldown ?? 0) : '-')).join()}|${h.tpCount}|${Math.ceil(h.tpCooldown)}|${!!h.channel}|${atShop}|${this.shopOpen}|${this.placingSlot}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      h.items.forEach((s, i) => {
        const el = this.slots[i];
        const d = s ? ITEMS[s.id] : null;
        el.classList.toggle('empty', !d);
        el.classList.toggle('usable', !!d?.consumable || !!d?.active);
        const icd = Math.ceil(s?.cooldown ?? 0);
        el.querySelector('.cd')!.textContent = icd > 0 ? String(icd) : '';
        el.classList.toggle('selling', !!d && this.shopOpen);
        el.classList.toggle('placing', this.placingSlot === i);
        el.querySelector('.lbl')!.innerHTML = d ? itemIcon(d.id) : '';
        el.querySelector('.cnt')!.textContent = s && s.count > 1 ? String(s.count) : '';
        el.title = d ? `${d.name}: ${d.summary}${this.shopOpen ? ' (tap to sell for half price)' : ''}` : 'Empty slot';
      });
      this.tpSlot.querySelector('.cnt')!.textContent = String(h.tpCount);
      const cd = Math.ceil(h.tpCooldown);
      this.tpSlot.querySelector('.cd')!.textContent = cd > 0 ? String(cd) : '';
      this.tpSlot.classList.toggle('none', h.tpCount === 0);
      this.tpSlot.classList.toggle('channel', !!h.channel);
      this.tpSlot.title = `Teleport (${TELEPORT.cost} gold each). Tap to choose an allied building.`;
    }
    // Quick-buy button: next item of the recommended build.
    const next = nextRecommended(me);
    const qb = this.root.querySelector<HTMLElement>('#btn-quickbuy')!;
    const qk = `${next}|${atShop}|${h.gold >= (next ? ITEMS[next].cost : 0)}`;
    if (qb.dataset.key !== qk) {
      qb.dataset.key = qk;
      qb.classList.toggle('none', !next);
      if (next) {
        qb.querySelector('.lbl')!.innerHTML = itemIcon(next);
        qb.querySelector('.cost')!.textContent = String(ITEMS[next].cost);
        qb.title = `Quick-buy: ${ITEMS[next].name} (${ITEMS[next].cost})`;
        qb.classList.toggle('off', !atShop || h.gold < ITEMS[next].cost);
      }
    }
    if (this.shopOpen) {
      const sk = `${Math.floor(h.gold)}|${atShop}|${h.items.map((s) => s?.id ?? '-').join()}`;
      if (sk !== this.shopKey) {
        this.shopKey = sk;
        this.root.querySelector('#shop-gold')!.textContent = String(Math.floor(h.gold));
        this.root.querySelector('#shop-note')!.textContent = atShop
          ? 'Tap an item to buy · tap one of your items to sell it for half price'
          : 'Return to your base (fountain) to buy or sell';
        this.root.querySelector('#shop-tp')!.classList.toggle('off', !atShop || h.gold < TELEPORT.cost);
        this.root.querySelectorAll<HTMLElement>('[data-buy]').forEach((el) => {
          const id = el.dataset.buy as ItemId;
          const b = buyBlocker(w, me, id);
          el.classList.toggle('off', b !== null);
          // Owning the parts makes a combined item cheaper.
          const price = priceFor(h, id);
          el.querySelector('.cost')!.innerHTML = price < ITEMS[id].cost ? `<s>${ITEMS[id].cost}</s> ${price}` : String(price);
        });
      }
    }
    if (this.pickerOpen) this.drawPicker();
  }

  // ------------------------------------------------------------------ teleport picker

  private openPicker() {
    const c = this.ctx();
    if (!c || tpBlocker(c.me) === 'cooldown') return;
    this.picker.classList.remove('hidden');
    const rootH = this.root.clientHeight;
    const size = Math.round(Math.min(rootH * 0.82, this.root.clientWidth * 0.6));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.pickerCanvas.style.width = this.pickerCanvas.style.height = `${size}px`;
    this.pickerCanvas.width = this.pickerCanvas.height = Math.round(size * dpr);
    this.drawPicker();
  }

  closePicker() {
    this.picker.classList.add('hidden');
  }

  private drawPicker() {
    const c = this.ctx();
    if (!c) return;
    const g = this.pickerCanvas.getContext('2d')!;
    const S = this.pickerCanvas.width;
    const k = S / c.w.map.size;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(c.terrain, 0, 0, S, S);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, S, S);
    for (const h of c.w.units) {
      if (!h.hero || !h.alive || h.team !== c.team) continue;
      g.fillStyle = h === c.me ? '#ffe066' : TEAM_COLORS[h.team];
      g.beginPath();
      g.arc(h.x * k, h.y * k, S * 0.012, 0, Math.PI * 2);
      g.fill();
    }
    for (const s of teleportTargets(c.w, c.team)) {
      g.fillStyle = 'rgba(140,200,255,0.35)';
      g.beginPath();
      g.arc(s.x * k, s.y * k, S * 0.04, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = TEAM_COLORS[s.team];
      g.strokeStyle = '#fff';
      g.lineWidth = S * 0.004;
      g.beginPath();
      g.arc(s.x * k, s.y * k, S * 0.018, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  private pickDestination(e: PointerEvent) {
    const c = this.ctx();
    if (!c) return;
    const p = toLocal(e.clientX, e.clientY);
    const r = localRect(this.pickerCanvas);
    const wx = ((p.x - r.x) / r.w) * c.w.map.size;
    const wy = ((p.y - r.y) / r.h) * c.w.map.size;
    const best = teleportTargets(c.w, c.team)
      .map((s) => ({ s, d: Math.hypot(s.x - wx, s.y - wy) }))
      .sort((a, b) => a.d - b.d)[0];
    if (best && best.d < 14) {
      this.send({ type: 'teleport', unitId: c.me.id, targetId: best.s.id });
      this.closePicker();
    }
  }
}

/** Rectangle of `el` in landscape-root coordinates (handles CSS transforms and the portrait rotation). */
function localRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const a = toLocal(r.left, r.top);
  const b = toLocal(r.right, r.bottom);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Next item in the hero's recommended build that they don't own yet. */
export function nextRecommended(me: Unit): ItemId | null {
  const h = me.hero!;
  const seen = new Map<ItemId, number>();
  for (const id of BUILDS[h.defId]) {
    const want = (seen.get(id) ?? 0) + 1;
    seen.set(id, want);
    const owned = ITEMS[id].consumable ? (h.items.some((s) => s?.id === id) ? want : 0) : h.items.filter((s) => s?.id === id).length;
    if (owned < want) return id;
  }
  return null;
}
