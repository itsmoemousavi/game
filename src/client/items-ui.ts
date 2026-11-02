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
  ItemSlot,
  SELL_REFUND_WINDOW,
  buyBlocker,
  priceFor,
  inShop,
  sellPrice,
  blinkLockLeft,
  teleportTargets,
  tpBlocker,
} from '../sim';
import { TEAM_COLORS } from './renderer';
import { toLocal } from './screen';
import { itemIcon } from './icons';

/**
 * Item bar (6 slots + teleport slot), shop panel and teleport destination picker.
 *
 * Item slot (2 rows × 3): tap = use the item (salve, ward, blink…); press and hold = a
 * "Drop" button appears above it. While the shop is open, tapping an item picks it in the
 * shop (to sell or drop it with the buttons there). Dropped items are picked up again by
 * tapping them on the ground.
 *
 * Shop: category tabs, a grid of items and a detail panel. Tapping an item only selects it;
 * buying and selling happen with the big button in the detail panel, so scrolling the list
 * can never buy something by accident.
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
  private ownKey = '';
  private tab: ShopTab = 'build';
  /** Selected item in the shop: a shop item, or one of your own slots (to sell). */
  private sel: { kind: 'shop'; id: ItemId } | { kind: 'own'; slot: number } | null = null;
  private dropBtn: HTMLButtonElement;
  /** Slot whose "Drop" button is showing (after a long press), if any. */
  private dropSlot: number | null = null;
  /** Slot of the ward being placed, if any. */
  placingSlot: number | null = null;

  constructor(
    private root: HTMLElement,
    private send: (c: Command) => void,
    private ctx: () => { w: World; me: Unit; team: Team; terrain: HTMLCanvasElement } | null,
    /** Called when a ward slot is tapped (enter / leave ward placement mode). */
    private onWard: (slot: number | null) => void = () => {},
    /** Short hint message (e.g. "Go back to your base to buy"). */
    _onHint: (text: string) => void = () => {},
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

    // Item slots: a quick tap uses the item; press and hold shows a "Drop" button above it.
    this.dropBtn = document.createElement('button');
    this.dropBtn.id = 'item-drop';
    this.dropBtn.className = 'hidden';
    this.dropBtn.textContent = 'DROP';
    root.querySelector('#itembar')!.appendChild(this.dropBtn);
    tap(this.dropBtn, () => {
      const c = this.ctx();
      if (c && this.dropSlot !== null && c.me.hero!.items[this.dropSlot]) this.send({ type: 'dropItem', unitId: c.me.id, slot: this.dropSlot });
      this.hideDrop();
    });
    this.slots.forEach((el, i) => {
      let hold: ReturnType<typeof setTimeout> | null = null;
      let pointer: number | null = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = this.ctx();
        if (!c) return;
        const item = c.me.hero!.items[i];
        this.hideDrop();
        if (this.shopOpen) {
          if (item) this.select({ kind: 'own', slot: i });
          return;
        }
        if (!item) return;
        pointer = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* not supported */
        }
        hold = setTimeout(() => {
          hold = null;
          pointer = null;
          if (this.ctx()?.me.alive) this.showDrop(i);
        }, 450);
      });
      const release = (e: PointerEvent, cancelled: boolean) => {
        if (pointer !== e.pointerId) return;
        pointer = null;
        if (!hold) return; // long press: the Drop button is showing
        clearTimeout(hold);
        hold = null;
        if (cancelled) return;
        const c = this.ctx();
        const item = c?.me.hero!.items[i];
        if (!c || !item) return;
        if (item.id === 'observerWard' || item.id === 'sentryWard' || ITEMS[item.id].active?.kind === 'blink') {
          this.placingSlot = this.placingSlot === i ? null : i;
          this.onWard(this.placingSlot);
          this.lastKey = '';
        } else this.send({ type: 'useItem', unitId: c.me.id, slot: i });
      };
      el.addEventListener('pointerup', (e) => release(e as PointerEvent, false));
      el.addEventListener('pointercancel', (e) => release(e as PointerEvent, true));
    });
    // Any other tap hides the Drop button.
    window.addEventListener('pointerdown', (e) => {
      if (e.target !== this.dropBtn) this.hideDrop();
    });
    tap(this.tpSlot, () => {
      const c = this.ctx();
      if (!c) return;
      const h = c.me.hero!;
      // Teleports are only bought in the shop; with none left this opens the shop.
      if (h.tpCount > 0) this.openPicker();
      else this.toggleShop(true);
    });
    root.querySelector('#btn-shop')!.innerHTML = itemIcon('shop');
    root.querySelector('#btn-courier')!.innerHTML = `<span class="lbl">${itemIcon('courier')}</span>`;
    this.tpSlot.querySelector('.lbl')!.innerHTML = itemIcon('tp');
    tap(root.querySelector('#btn-shop')!, () => this.toggleShop());
    tap(root.querySelector('#shop-close')!, () => this.toggleShop(false));
    tap(root.querySelector('#shop-tp')!, () => {
      const c = this.ctx();
      if (c) this.send({ type: 'buyTp', unitId: c.me.id });
    });
    tap(root.querySelector('#tp-close')!, () => this.closePicker());
    tap(this.pickerCanvas, (e) => this.pickDestination(e));
    this.buildShop();
  }

  private showDrop(slot: number) {
    this.dropSlot = slot;
    const el = this.slots[slot];
    this.dropBtn.style.left = `${el.offsetLeft + el.offsetWidth / 2}px`;
    this.dropBtn.style.top = `${el.offsetTop}px`;
    this.dropBtn.classList.remove('hidden');
  }

  private hideDrop() {
    this.dropSlot = null;
    this.dropBtn.classList.add('hidden');
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
    this.lastKey = '';
    if (open) this.renderDetail();
  }

  reset() {
    this.hideDrop();
    this.toggleShop(false);
    this.closePicker();
    this.lastKey = '';
    this.buildShop();
  }

  private buildShop() {
    const tabs = this.root.querySelector<HTMLElement>('#shop-tabs')!;
    tabs.innerHTML = '';
    for (const t of SHOP_TABS) {
      const b = document.createElement('button');
      b.dataset.tab = t.id;
      b.innerHTML = `<span>${t.icon}</span>${t.name}`;
      onTap(b, () => {
        this.tab = t.id;
        this.renderGrid();
      });
      tabs.appendChild(b);
    }
    this.renderGrid();
    this.renderDetail();
  }

  private renderGrid() {
    const list = this.root.querySelector<HTMLElement>('#shop-items')!;
    const c = this.ctx();
    const build = c ? BUILDS[c.me.hero!.defId] : [];
    const ids = this.tab === 'build' ? [...new Set(build)] : ITEM_IDS.filter((id) => !ITEMS[id].noShop && categoryOf(id) === this.tab);
    this.root.querySelectorAll<HTMLElement>('#shop-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    list.innerHTML = '';
    list.scrollTop = 0;
    for (const id of ids) {
      const d = ITEMS[id];
      const card = document.createElement('button');
      card.className = 'shop-item';
      card.dataset.buy = id;
      card.innerHTML = `<i>${itemIcon(id)}</i><span class="cost">${d.cost}</span>`;
      // Select on a clean tap only: a finger that moved (scrolling) does nothing.
      onTap(card, () => this.select({ kind: 'shop', id: id as ItemId }), true);
      list.appendChild(card);
    }
    this.shopKey = '';
  }

  private select(sel: NonNullable<ItemsUi['sel']>) {
    this.sel = sel;
    this.ownKey = '';
    if (!this.shopOpen) this.toggleShop(true);
    this.renderDetail();
    this.shopKey = '';
  }

  /** Detail panel: the selected item, what it's made of, and the Buy / Sell button. */
  private renderDetail() {
    const box = this.root.querySelector<HTMLElement>('#shop-detail')!;
    const c = this.ctx();
    const sel = this.sel;
    if (!c || !sel) {
      box.innerHTML = '<p class="empty">Tap an item to see what it does.<br><br>Tap one of your items to sell or drop it.</p>';
      return;
    }
    const h = c.me.hero!;
    const slot: ItemSlot | null = sel.kind === 'own' ? h.items[sel.slot] : null;
    if (sel.kind === 'own' && !slot) {
      this.sel = null;
      this.renderDetail();
      return;
    }
    const id = sel.kind === 'own' ? slot!.id : sel.id;
    const d = ITEMS[id];
    const parts = (d.recipe ?? []).map((p) => `<span class="part" title="${ITEMS[p].name}">${itemIcon(p)}</span>`).join('');
    const usedIn = ITEM_IDS.filter((x) => ITEMS[x].recipe?.includes(id));
    box.innerHTML = `
      <div class="d-top"><i>${itemIcon(id)}</i><div><b>${d.name}</b><span class="d-cost">${d.cost} gold</span></div></div>
      <p class="d-sum">${d.summary}</p>
      ${parts ? `<div class="d-row"><small>Made from</small>${parts}</div>` : ''}
      ${usedIn.length ? `<div class="d-row"><small>Part of</small>${usedIn.map((x) => `<span class="part" title="${ITEMS[x].name}">${itemIcon(x)}</span>`).join('')}</div>` : ''}
      <div class="d-acts"><button id="shop-act"></button>${sel.kind === 'own' ? '<button id="shop-drop">DROP</button>' : ''}</div>
      <small id="shop-why"></small>`;
    onTap(box.querySelector('#shop-act')!, () => {
      const c2 = this.ctx();
      if (!c2 || !this.sel) return;
      if (this.sel.kind === 'own') {
        this.send({ type: 'sell', unitId: c2.me.id, slot: this.sel.slot });
        this.sel = null;
        this.lastKey = '';
        setTimeout(() => this.renderDetail(), 50);
      } else this.send({ type: 'buy', unitId: c2.me.id, itemId: this.sel.id });
      this.shopKey = '';
    });
    const drop = box.querySelector('#shop-drop');
    if (drop)
      onTap(drop, () => {
        const c2 = this.ctx();
        if (!c2 || this.sel?.kind !== 'own' || !c2.me.alive) return;
        this.send({ type: 'dropItem', unitId: c2.me.id, slot: this.sel.slot });
        this.sel = null;
        this.lastKey = '';
        setTimeout(() => this.renderDetail(), 50);
      });
    box.querySelectorAll<HTMLElement>('.part').forEach((el, i) => {
      const all = [...(d.recipe ?? []), ...usedIn];
      onTap(el, () => this.select({ kind: 'shop', id: all[i] }));
    });
    this.shopKey = '';
  }

  /** Your items, inside the shop (tap one to sell it). */
  private renderOwn(items: (ItemSlot | null)[]) {
    const row = this.root.querySelector<HTMLElement>('#shop-own')!;
    row.innerHTML = '<small>Your items</small><div class="own-grid"></div>';
    const grid = row.querySelector('.own-grid')!;
    items.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = s ? '' : 'empty';
      b.classList.toggle('picked', this.sel?.kind === 'own' && this.sel.slot === i);
      b.innerHTML = s ? itemIcon(s.id) : '';
      if (s) onTap(b, () => this.select({ kind: 'own', slot: i }), true);
      grid.appendChild(b);
    });
  }

  /** Buy / Sell button state (gold, distance to the shop, refund window). */
  private updateAction(w: World, me: Unit) {
    const btn = this.root.querySelector<HTMLButtonElement>('#shop-act');
    const why = this.root.querySelector<HTMLElement>('#shop-why');
    if (!btn || !why || !this.sel) return;
    const h = me.hero!;
    const atShop = !me.alive || inShop(w, me);
    if (this.sel.kind === 'own') {
      const s = h.items[this.sel.slot];
      if (!s) return;
      this.root.querySelector<HTMLButtonElement>('#shop-drop')?.toggleAttribute('disabled', !me.alive);
      if (ITEMS[s.id].noShop) {
        btn.className = 'sell';
        btn.innerHTML = 'SELL';
        btn.disabled = true;
        why.textContent = s.expiresAt !== undefined ? `Can't be sold. Crumbles in ${fmtTime(Math.max(0, s.expiresAt - w.time))}` : "Can't be sold";
        return;
      }
      const price = sellPrice(w, s);
      const left = Math.ceil(SELL_REFUND_WINDOW - (w.time - (s.boughtAt ?? -999)));
      btn.className = 'sell';
      btn.innerHTML = `SELL <b>+${price}</b>`;
      btn.disabled = !atShop;
      this.root.querySelector<HTMLButtonElement>('#shop-drop')?.toggleAttribute('disabled', !me.alive);
      why.textContent = !atShop ? 'Go back to your base to sell (or drop it here)' : left > 0 ? `Full refund for ${left} more s` : 'Sells for half price';
      return;
    }
    const id = this.sel.id;
    const price = priceFor(h, id);
    const b = buyBlocker(w, me, id);
    btn.className = 'buy';
    btn.innerHTML = `BUY <b>${price < ITEMS[id].cost ? `<s>${ITEMS[id].cost}</s> ` : ''}${price}</b>`;
    btn.disabled = b !== null;
    why.textContent =
      b === 'shop' ? 'Go back to your base to buy' : b === 'gold' ? `Need ${Math.ceil(price - h.gold)} more gold` : b === 'full' ? 'Your inventory is full' : price < ITEMS[id].cost ? 'Cheaper: you own some of its parts' : '';
  }

  update() {
    const c = this.ctx();
    if (!c) return;
    const { w, me } = c;
    const h = me.hero!;
    const atShop = inShop(w, me) || !me.alive;
    if (this.dropSlot !== null && (!h.items[this.dropSlot] || !me.alive)) this.hideDrop();
    const placing = this.placingSlot !== null ? h.items[this.placingSlot] : null;
    if (this.placingSlot !== null && (!placing || (!placing.id.endsWith('Ward') && !ITEMS[placing.id].active))) {
      this.placingSlot = null; // used up / sold
      this.onWard(null);
    }
    // Blink items are locked for a few seconds after an enemy hero hits you.
    const lock = Math.ceil(blinkLockLeft(w, me));
    const key = `${lock}|${h.items.map((s) => (s ? s.id + s.count + ':' + Math.ceil(s.cooldown ?? 0) : '-')).join()}|${h.tpCount}|${Math.ceil(h.tpCooldown)}|${!!h.channel}|${atShop}|${this.shopOpen}|${this.placingSlot}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      h.items.forEach((s, i) => {
        const el = this.slots[i];
        const d = s ? ITEMS[s.id] : null;
        el.classList.toggle('empty', !d);
        el.classList.toggle('usable', !!d?.consumable || !!d?.active);
        const locked = d?.active?.kind === 'blink' && lock > 0;
        const icd = Math.max(Math.ceil(s?.cooldown ?? 0), locked ? lock : 0);
        el.querySelector('.cd')!.textContent = icd > 0 ? String(icd) : '';
        el.classList.toggle('locked', locked);
        el.classList.toggle('selling', !!d && this.shopOpen);
        el.classList.toggle('placing', this.placingSlot === i);
        el.querySelector('.lbl')!.innerHTML = d ? itemIcon(d.id) : '';
        el.querySelector('.cnt')!.textContent = s && s.count > 1 ? String(s.count) : '';
        el.title = d ? `${d.name}: ${d.summary}${this.shopOpen ? ' (tap to pick it, then Sell or Drop)' : ' (hold to drop it)'}` : 'Empty slot';
      });
      this.tpSlot.querySelector('.cnt')!.textContent = String(h.tpCount);
      const cd = Math.ceil(h.tpCooldown);
      this.tpSlot.querySelector('.cd')!.textContent = cd > 0 ? String(cd) : '';
      this.tpSlot.classList.toggle('none', h.tpCount === 0);
      this.tpSlot.classList.toggle('channel', !!h.channel);
      this.tpSlot.title = `Teleport (${TELEPORT.cost} gold each). Tap to choose an allied building.`;
    }
    if (this.shopOpen) {
      const own = this.sel?.kind === 'own' ? h.items[this.sel.slot] : null;
      const sk = `${Math.floor(h.gold)}|${atShop}|${me.alive}|${h.items.map((s) => s?.id ?? '-').join()}|${own ? Math.ceil(w.time - (own.boughtAt ?? 0)) : ''}`;
      if (sk !== this.shopKey) {
        this.shopKey = sk;
        const open = atShop || !me.alive;
        this.root.querySelector('#shop-gold')!.textContent = String(Math.floor(h.gold));
        this.root.querySelector('#shop-note')!.textContent = open ? (me.alive ? '' : 'You can shop while dead') : 'Go back to your base to buy or sell';
        this.root.querySelector('#shop-tp')!.classList.toggle('off', !open || h.gold < TELEPORT.cost);
        this.root.querySelectorAll<HTMLElement>('[data-buy]').forEach((el) => {
          const id = el.dataset.buy as ItemId;
          el.classList.toggle('off', buyBlocker(w, me, id) !== null);
          el.classList.toggle('picked', this.sel?.kind === 'shop' && this.sel.id === id);
          // Owning the parts makes a combined item cheaper.
          const price = priceFor(h, id);
          el.querySelector('.cost')!.textContent = String(price);
          el.classList.toggle('cheaper', price < ITEMS[id].cost);
        });
        const ok = `${h.items.map((x) => x?.id ?? '-').join()}|${this.sel?.kind === 'own' ? this.sel.slot : ''}`;
        if (ok !== this.ownKey) {
          this.ownKey = ok;
          this.renderOwn(h.items);
        }
        this.updateAction(w, me);
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


type ShopTab = 'build' | 'consumable' | 'attack' | 'defense' | 'magic' | 'upgrade';
const SHOP_TABS: { id: ShopTab; name: string; icon: string }[] = [
  { id: 'build', name: 'For you', icon: '★' },
  { id: 'consumable', name: 'Supplies', icon: '✚' },
  { id: 'attack', name: 'Attack', icon: '⚔' },
  { id: 'defense', name: 'Defense', icon: '⛨' },
  { id: 'magic', name: 'Magic', icon: '✦' },
  { id: 'upgrade', name: 'Upgrades', icon: '▲' },
];

/** Shop tab for an item, from what it gives. */
function categoryOf(id: ItemId): ShopTab {
  const d = ITEMS[id];
  if (d.consumable) return 'consumable';
  if (d.recipe || d.active) return 'upgrade';
  const s = d.stats;
  if (s.damage || s.attackSpeedPct || s.lifestealPct) return 'attack';
  if (s.mana || s.manaRegen || s.spellAmpPct || s.cdrPct) return 'magic';
  return 'defense';
}

/**
 * Tap handler. With `cleanTapOnly`, the action fires on release and only if the finger
 * barely moved (so dragging to scroll a list never triggers it).
 */
function onTap(el: Element, fn: () => void, cleanTapOnly = false) {
  if (!cleanTapOnly) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    return;
  }
  let start: { x: number; y: number; id: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    const p = e as PointerEvent;
    e.stopPropagation();
    start = { x: p.clientX, y: p.clientY, id: p.pointerId };
  });
  el.addEventListener('pointerup', (e) => {
    const p = e as PointerEvent;
    e.stopPropagation();
    if (start && start.id === p.pointerId && Math.hypot(p.clientX - start.x, p.clientY - start.y) < 10) fn();
    start = null;
  });
  el.addEventListener('pointercancel', () => (start = null));
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
