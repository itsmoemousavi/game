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
  tpBuyBlocker,
  buyDestination,
  courierBlocker,
  courierFlying,
  courierSellPrice,
  CourierSlot,
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
  /** Selected in the shop: a shop item, the teleport scroll, one of your own slots, or a courier slot (to sell). */
  private sel: { kind: 'shop'; id: ItemId } | { kind: 'tp' } | { kind: 'own'; slot: number } | { kind: 'courier'; slot: number } | null = null;
  private dropBtn: HTMLButtonElement;
  /** Slot whose "Drop" button is showing (after a long press), if any. */
  private dropSlot: number | null = null;
  /** Which bar the Drop button belongs to. */
  private dropGroup: 'hero' | 'courier' = 'hero';
  private cslots: HTMLElement[] = [];
  private courierBtn: HTMLElement;
  private courierKey = '';
  private hint: (text: string) => void;
  /** Slot of the ward being placed, if any. */
  placingSlot: number | null = null;

  constructor(
    private root: HTMLElement,
    private send: (c: Command) => void,
    private ctx: () => { w: World; me: Unit; team: Team; terrain: HTMLCanvasElement } | null,
    /** Called when a ward slot is tapped (enter / leave ward placement mode). */
    private onWard: (slot: number | null) => void = () => {},
    /** Short hint message (e.g. "Go back to your base to buy"). */
    onHint: (text: string) => void = () => {},
  ) {
    this.hint = onHint;
    root.querySelectorAll<HTMLElement>('[data-item]').forEach((el) => this.slots.push(el));
    root.querySelectorAll<HTMLElement>('[data-cslot]').forEach((el) => this.cslots.push(el));
    this.courierBtn = root.querySelector('#btn-courier')!;
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
      if (c && this.dropSlot !== null) {
        if (this.dropGroup === 'hero' && c.me.hero!.items[this.dropSlot]) this.send({ type: 'dropItem', unitId: c.me.id, slot: this.dropSlot });
        if (this.dropGroup === 'courier' && c.me.hero!.courier.bag[this.dropSlot]) this.send({ type: 'dropCourier', unitId: c.me.id, slot: this.dropSlot });
      }
      this.hideDrop();
    });
    this.slots.forEach((el, i) => this.bindSlot(el, 'hero', i));
    this.cslots.forEach((el, i) => this.bindSlot(el, 'courier', i));
    tap(this.courierBtn, () => {
      const c = this.ctx();
      if (!c) return;
      const why = courierBlocker(c.me);
      if (why === 'empty') this.hint('Your courier is empty: buy something away from base and it goes on the courier');
      else if (why === 'busy') this.hint('Your courier is already on its way');
      else if (why === 'dead') this.hint("You can't send the courier while dead");
      else this.send({ type: 'courier', unitId: c.me.id });
    });
    // Any other tap hides the Drop button.
    window.addEventListener('pointerdown', (e) => {
      if (e.target !== this.dropBtn) this.hideDrop();
    });
    tap(this.tpSlot, () => {
      const c = this.ctx();
      if (!c) return;
      const h = c.me.hero!;
      // With no scrolls left this opens the shop with the scroll picked, one tap from buying.
      if (h.tpCount > 0) this.openPicker();
      else this.select({ kind: 'tp' });
    });
    root.querySelector('#btn-shop')!.innerHTML = itemIcon('shop');
    root.querySelector('#btn-courier')!.innerHTML = `<span class="lbl">${itemIcon('courier')}</span>`;
    this.tpSlot.querySelector('.lbl')!.innerHTML = itemIcon('tp');
    tap(root.querySelector('#btn-shop')!, () => this.toggleShop());
    tap(root.querySelector('#shop-close')!, () => this.toggleShop(false));
    tap(root.querySelector('#tp-close')!, () => this.closePicker());
    tap(this.pickerCanvas, (e) => this.pickDestination(e));
    this.buildShop();
  }

  /**
   * One slot of the item bar or the courier: tap = use (courier slot: show it in the shop),
   * press and hold = Drop button, drag onto another slot of the same bar = swap the two.
   */
  private bindSlot(el: HTMLElement, group: 'hero' | 'courier', i: number) {
    let hold: ReturnType<typeof setTimeout> | null = null;
    let pointer: number | null = null;
    let start = { x: 0, y: 0 };
    let ghost: HTMLElement | null = null;
    let target: HTMLElement | null = null;
    const list = () => (group === 'hero' ? this.slots : this.cslots);
    const itemAt = (k: number) => {
      const c = this.ctx();
      return c ? (group === 'hero' ? c.me.hero!.items[k] : c.me.hero!.courier.bag[k]) : null;
    };
    const endDrag = () => {
      ghost?.remove();
      ghost = null;
      el.classList.remove('dragging');
      target?.classList.remove('drop-target');
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = itemAt(i);
      this.hideDrop();
      if (this.shopOpen) {
        if (item) this.select(group === 'hero' ? { kind: 'own', slot: i } : { kind: 'courier', slot: i });
        return;
      }
      if (!item) return;
      pointer = e.pointerId;
      start = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* not supported */
      }
      hold = setTimeout(() => {
        hold = null;
        if (ghost) return;
        pointer = null;
        if (group === 'courier' || this.ctx()?.me.alive) this.showDrop(i, group);
      }, 450);
    });
    el.addEventListener('pointermove', (e) => {
      if (pointer !== e.pointerId) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) {
        if (hold) clearTimeout(hold);
        hold = null;
        el.classList.add('dragging');
        ghost = document.createElement('div');
        ghost.id = 'drag-ghost';
        ghost.innerHTML = el.querySelector('.lbl')?.innerHTML ?? '';
        this.root.appendChild(ghost);
      }
      if (!ghost) return;
      const p = toLocal(e.clientX, e.clientY);
      ghost.style.left = `${p.x}px`;
      ghost.style.top = `${p.y}px`;
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(group === 'hero' ? '[data-item]' : '[data-cslot]') ?? null;
      const t = under && under !== el && list().includes(under) ? under : null;
      if (t !== target) {
        target?.classList.remove('drop-target');
        t?.classList.add('drop-target');
        target = t;
      }
    });
    const release = (e: PointerEvent, cancelled: boolean) => {
      if (pointer !== e.pointerId) return;
      pointer = null;
      if (ghost) {
        const t = target;
        endDrag();
        const c = this.ctx();
        if (!cancelled && t && c) this.send({ type: 'swapItems', unitId: c.me.id, courier: group === 'courier', a: i, b: list().indexOf(t) });
        this.lastKey = '';
        this.courierKey = '';
        return;
      }
      if (!hold) return; // long press: the Drop button is showing
      clearTimeout(hold);
      hold = null;
      if (cancelled) return;
      const c = this.ctx();
      const item = itemAt(i);
      if (!c || !item) return;
      if (group === 'courier') {
        this.select({ kind: 'courier', slot: i });
        return;
      }
      const it = item as ItemSlot;
      if (it.id === 'observerWard' || it.id === 'sentryWard' || ITEMS[it.id].active?.kind === 'blink' || ITEMS[it.id].active?.kind === 'mire') {
        this.placingSlot = this.placingSlot === i ? null : i;
        this.onWard(this.placingSlot);
        this.lastKey = '';
      } else this.send({ type: 'useItem', unitId: c.me.id, slot: i });
    };
    el.addEventListener('pointerup', (e) => release(e as PointerEvent, false));
    el.addEventListener('pointercancel', (e) => release(e as PointerEvent, true));
  }

  private showDrop(slot: number, group: 'hero' | 'courier' = 'hero') {
    const c = this.ctx();
    const s = c && group === 'courier' ? c.me.hero!.courier.bag[slot] : null;
    if (s && (s.id === 'tp' || s.parts?.length)) return; // scrolls and combined items waiting for parts can't be dropped
    if (group === 'hero' && c?.me.hero!.items[slot]?.reserved) return;
    this.dropSlot = slot;
    this.dropGroup = group;
    const el = (group === 'hero' ? this.slots : this.cslots)[slot];
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
      b.innerHTML = `<span>${t.icon}</span><em>${t.name}</em>`;
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
    const card = (id: ItemId | 'tp', name: string, cost: number) => {
      const el = document.createElement('button');
      el.className = 'shop-item';
      if (id === 'tp') el.dataset.tp = '1';
      else el.dataset.buy = id;
      el.innerHTML = `<i>${itemIcon(id)}</i><span class="nm">${name}</span><span class="cost">${cost}</span>`;
      // Select on a clean tap only: a finger that moved (scrolling) does nothing.
      onTap(el, () => this.select(id === 'tp' ? { kind: 'tp' } : { kind: 'shop', id }), true);
      list.appendChild(el);
    };
    // The real name where it fits on the tile, otherwise the short one.
    const label = (id: ItemId) => (ITEMS[id].name.length <= 12 ? ITEMS[id].name : ITEMS[id].short);
    const heading = (text: string) => {
      const el = document.createElement('h4');
      el.textContent = text;
      list.appendChild(el);
    };
    // The teleport scroll is an ordinary item: same tile, same details, same Buy button.
    if (this.tab === 'build' || this.tab === 'consumable') card('tp', 'Teleport', TELEPORT.cost);
    if (this.tab === 'build' || this.tab === 'consumable') {
      for (const id of ids) card(id as ItemId, label(id as ItemId), ITEMS[id].cost);
    } else {
      const basics = ids.filter((id) => !ITEMS[id].recipe?.length);
      const combined = ids.filter((id) => ITEMS[id].recipe?.length);
      if (basics.length) heading('Basic');
      for (const id of basics) card(id as ItemId, label(id as ItemId), ITEMS[id].cost);
      if (combined.length) heading('Combined');
      for (const id of combined) card(id as ItemId, label(id as ItemId), ITEMS[id].cost);
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
      box.innerHTML = '<p class="empty">Tap an item to see what it does and buy it.<br><br>Tap one of your own items below to sell or drop it.</p>';
      return;
    }
    const h = c.me.hero!;
    if (sel.kind === 'tp') {
      box.innerHTML = `
        <div class="d-top"><i>${itemIcon('tp')}</i><div><b>Teleport Scroll</b><span class="d-cost">${TELEPORT.cost} gold</span></div></div>
        <p class="d-sum">Channel, then teleport to any allied building. Keep one with you to get back to a fight.</p>
        <div class="d-acts"><button id="shop-act"></button></div>
        <small id="shop-why"></small>`;
      onTap(box.querySelector('#shop-act')!, () => {
        const c2 = this.ctx();
        if (c2) this.send({ type: 'buyTp', unitId: c2.me.id });
        this.shopKey = '';
      });
      this.shopKey = '';
      return;
    }
    const slot: ItemSlot | CourierSlot | null = sel.kind === 'own' ? h.items[sel.slot] : sel.kind === 'courier' ? h.courier.bag[sel.slot] : null;
    if (sel.kind !== 'shop' && !slot) {
      this.sel = null;
      this.renderDetail();
      return;
    }
    const id = sel.kind === 'shop' ? sel.id : slot!.id;
    const mine = sel.kind !== 'shop';
    if (id === 'tp') {
      box.innerHTML = `
        <div class="d-top"><i>${itemIcon('tp')}</i><div><b>Teleport Scroll${slot!.count > 1 ? ` ×${slot!.count}` : ''}</b><span class="d-cost">${TELEPORT.cost} gold each</span></div></div>
        <p class="d-sum">Teleport to an allied building. On the courier: it goes into your TP slot when delivered.</p>
        <div class="d-acts"><button id="shop-act"></button></div>
        <small id="shop-why"></small>`;
    } else {
      const d = ITEMS[id];
      const parts = (d.recipe ?? []).map((p) => `<span class="part" title="${ITEMS[p].name}">${itemIcon(p)}</span>`).join('');
      const usedIn = ITEM_IDS.filter((x) => ITEMS[x].recipe?.includes(id));
      box.innerHTML = `
        <div class="d-top"><i>${itemIcon(id)}</i><div><b>${d.name}</b><span class="d-cost">${d.cost} gold</span></div></div>
        <p class="d-sum">${d.summary}</p>
        ${parts ? `<div class="d-row"><small>Made from</small>${parts}</div>` : ''}
        ${usedIn.length ? `<div class="d-row"><small>Part of</small>${usedIn.map((x) => `<span class="part" title="${ITEMS[x].name}">${itemIcon(x)}</span>`).join('')}</div>` : ''}
        <div class="d-acts"><button id="shop-act"></button>${mine ? '<button id="shop-drop">DROP</button>' : ''}</div>
        <small id="shop-why"></small>`;
    }
    onTap(box.querySelector('#shop-act')!, () => {
      const c2 = this.ctx();
      if (!c2 || !this.sel || this.sel.kind === 'tp') return;
      if (this.sel.kind === 'courier') {
        this.send({ type: 'sellCourier', unitId: c2.me.id, slot: this.sel.slot });
        this.sel = null;
        this.courierKey = '';
        setTimeout(() => this.renderDetail(), 50);
      } else if (this.sel.kind === 'own') {
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
        if (!c2 || !this.sel || this.sel.kind === 'shop' || this.sel.kind === 'tp') return;
        if (this.sel.kind === 'courier') this.send({ type: 'dropCourier', unitId: c2.me.id, slot: this.sel.slot });
        else if (c2.me.alive) this.send({ type: 'dropItem', unitId: c2.me.id, slot: this.sel.slot });
        else return;
        this.sel = null;
        this.lastKey = '';
        setTimeout(() => this.renderDetail(), 50);
      });
    box.querySelectorAll<HTMLElement>('.part').forEach((el, i) => {
      if (id === 'tp') return;
      const all = [...(ITEMS[id].recipe ?? []), ...ITEM_IDS.filter((x) => ITEMS[x].recipe?.includes(id))];
      onTap(el, () => this.select({ kind: 'shop', id: all[i] }));
    });
    this.shopKey = '';
  }

  /** Your items and your courier's, inside the shop (tap one to sell it). */
  private renderOwn(items: (ItemSlot | null)[], bag: (CourierSlot | null)[], tpCount: number) {
    const row = this.root.querySelector<HTMLElement>('#shop-own')!;
    row.innerHTML = '<small>Yours</small><div class="own-grid"></div><div class="own-tp"></div><small class="c">Courier</small><div class="own-grid courier"></div>';
    const [grid, cgrid] = row.querySelectorAll('.own-grid');
    const tp = document.createElement('button');
    tp.className = tpCount ? '' : 'empty';
    tp.classList.toggle('picked', this.sel?.kind === 'tp');
    tp.innerHTML = `${itemIcon('tp')}<b>${tpCount}</b>`;
    onTap(tp, () => this.select({ kind: 'tp' }), true);
    row.querySelector('.own-tp')!.appendChild(tp);
    items.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = s ? '' : 'empty';
      b.classList.toggle('picked', this.sel?.kind === 'own' && this.sel.slot === i);
      b.innerHTML = s ? itemIcon(s.id) : '';
      if (s) onTap(b, () => this.select({ kind: 'own', slot: i }), true);
      grid.appendChild(b);
    });
    bag.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = s ? '' : 'empty';
      b.classList.toggle('picked', this.sel?.kind === 'courier' && this.sel.slot === i);
      b.innerHTML = s ? itemIcon(s.id) : '';
      if (s) onTap(b, () => this.select({ kind: 'courier', slot: i }), true);
      cgrid.appendChild(b);
    });
  }

  /** Buy / Sell button state (gold, distance to the shop, refund window). */
  private updateAction(w: World, me: Unit) {
    const btn = this.root.querySelector<HTMLButtonElement>('#shop-act');
    const why = this.root.querySelector<HTMLElement>('#shop-why');
    if (!btn || !why || !this.sel) return;
    const h = me.hero!;
    const atShop = !me.alive || inShop(w, me);
    if (this.sel.kind === 'tp') {
      const b = tpBuyBlocker(w, me);
      btn.className = 'buy';
      btn.innerHTML = b === 'courierFull' ? 'COURIER FULL' : `BUY <b>${TELEPORT.cost}</b>`;
      btn.disabled = b !== null;
      const have = `You have ${h.tpCount}`;
      why.textContent =
        b === 'gold' ? `Need ${Math.ceil(TELEPORT.cost - h.gold)} more gold · ${have}` : b === 'courierFull' ? "Your courier's 3 slots are full" : atShop ? have : `${have} · goes on your courier`;
      return;
    }
    if (this.sel.kind === 'courier') {
      const s = h.courier.bag[this.sel.slot];
      if (!s) return;
      const price = courierSellPrice(w, s);
      const left = Math.ceil(SELL_REFUND_WINDOW - (w.time - (s.boughtAt ?? -999)));
      btn.className = 'sell';
      btn.innerHTML = `SELL <b>+${price}</b>`;
      btn.disabled = false;
      this.root.querySelector<HTMLButtonElement>('#shop-drop')?.toggleAttribute('disabled', s.id === 'tp' || !!s.parts?.length);
      const where = s.loaded ? 'On your courier' : 'Waiting at your base for the courier';
      const parts = s.parts?.length ? ` · combines with your ${s.parts.map((p) => ITEMS[p].name).join(' + ')} when delivered` : '';
      why.textContent = `${where}${parts} · ${left > 0 ? `full refund for ${left} more s` : 'sells for half price'}`;
      return;
    }
    if (this.sel.kind === 'own') {
      const s = h.items[this.sel.slot];
      if (!s) return;
      if (s.reserved) {
        btn.className = 'sell';
        btn.innerHTML = 'SELL';
        btn.disabled = true;
        this.root.querySelector<HTMLButtonElement>('#shop-drop')?.toggleAttribute('disabled', true);
        why.textContent = 'Promised to a combined item on your courier: it combines when the courier arrives';
        return;
      }
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
    const toCourier = buyDestination(w, me, id) === 'courier';
    btn.className = 'buy';
    btn.innerHTML = b === 'courierFull' ? 'COURIER FULL' : `BUY <b>${price < ITEMS[id].cost ? `<s>${ITEMS[id].cost}</s> ` : ''}${price}</b>`;
    btn.disabled = b !== null;
    const cheaper = price < ITEMS[id].cost ? 'Cheaper: you own some of its parts. ' : '';
    why.textContent =
      b === 'shop'
        ? "Can't be bought"
        : b === 'gold'
          ? `Need ${Math.ceil(price - h.gold)} more gold`
          : b === 'full'
            ? 'Your inventory and courier are full'
            : b === 'courierFull'
              ? "Your courier's 3 slots are full: send it, or sell something off it"
              : toCourier
                ? `${cheaper}Goes on your courier (tap the courier button to send it)`
                : cheaper;
  }

  update() {
    const c = this.ctx();
    if (!c) return;
    const { w, me } = c;
    const h = me.hero!;
    const atShop = inShop(w, me) || !me.alive;
    if (this.dropSlot !== null && this.dropGroup === 'hero' && (!h.items[this.dropSlot] || !me.alive)) this.hideDrop();
    if (this.dropSlot !== null && this.dropGroup === 'courier' && !h.courier.bag[this.dropSlot]) this.hideDrop();
    this.updateCourier(w, me);
    const placing = this.placingSlot !== null ? h.items[this.placingSlot] : null;
    if (this.placingSlot !== null && (!placing || (!placing.id.endsWith('Ward') && !ITEMS[placing.id].active))) {
      this.placingSlot = null; // used up / sold
      this.onWard(null);
    }
    // Blink items are locked for a few seconds after an enemy hero hits you.
    const lock = Math.ceil(blinkLockLeft(w, me));
    const key = `${lock}|${h.items.map((s) => (s ? s.id + s.count + ':' + Math.ceil(s.cooldown ?? 0) + (s.reserved ? 'r' : '') : '-')).join()}|${h.tpCount}|${Math.ceil(h.tpCooldown)}|${!!h.channel}|${atShop}|${this.shopOpen}|${this.placingSlot}`;
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
        el.classList.toggle('reserved', !!s?.reserved);
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
      const cs = this.sel?.kind === 'courier' ? h.courier.bag[this.sel.slot] : null;
      const bagKey = h.courier.bag.map((s) => (s ? `${s.id}${s.count}${s.loaded ? 'l' : ''}` : '-')).join();
      const sk = `${Math.floor(h.gold)}|${atShop}|${me.alive}|${h.items.map((s) => (s ? s.id + (s.reserved ? 'r' : '') : '-')).join()}|${bagKey}|${own ? Math.ceil(w.time - (own.boughtAt ?? 0)) : ''}|${cs ? Math.ceil(w.time - (cs.boughtAt ?? 0)) : ''}`;
      if (sk !== this.shopKey) {
        this.shopKey = sk;
        const open = atShop || !me.alive;
        this.root.querySelector('#shop-gold')!.textContent = String(Math.floor(h.gold));
        this.root.querySelector('#shop-note')!.textContent = open ? (me.alive ? '' : 'You can shop while dead') : 'Away from base: what you buy goes on your courier';
        this.root.querySelectorAll<HTMLElement>('[data-tp]').forEach((el) => {
          el.classList.toggle('off', tpBuyBlocker(w, me) !== null);
          el.classList.toggle('picked', this.sel?.kind === 'tp');
        });
        this.root.querySelectorAll<HTMLElement>('[data-buy]').forEach((el) => {
          const id = el.dataset.buy as ItemId;
          el.classList.toggle('off', buyBlocker(w, me, id) !== null);
          el.classList.toggle('picked', this.sel?.kind === 'shop' && this.sel.id === id);
          // Owning the parts makes a combined item cheaper.
          const price = priceFor(h, id);
          el.querySelector('.cost')!.textContent = String(price);
          el.classList.toggle('cheaper', price < ITEMS[id].cost);
        });
        const ok = `${h.items.map((x) => x?.id ?? '-').join()}|${bagKey}|${h.tpCount}|${this.sel?.kind ?? ''}${this.sel && (this.sel.kind === 'own' || this.sel.kind === 'courier') ? this.sel.slot : ''}`;
        if (ok !== this.ownKey) {
          this.ownKey = ok;
          this.renderOwn(h.items, h.courier.bag, h.tpCount);
        }
        this.updateAction(w, me);
      }
    }
    if (this.pickerOpen) this.drawPicker();
  }

  /** Courier slots (dim = waiting at the base) and the courier button's state. */
  private updateCourier(w: World, me: Unit) {
    const c = me.hero!.courier;
    const flying = courierFlying(w);
    const blocked = courierBlocker(me);
    const key = `${c.bag.map((s) => (s ? `${s.id}${s.count}${s.loaded ? 'l' : ''}` : '-')).join()}|${c.mode}|${flying}|${blocked}|${this.sel?.kind === 'courier' ? this.sel.slot : ''}`;
    if (key === this.courierKey) return;
    this.courierKey = key;
    c.bag.forEach((s, i) => {
      const el = this.cslots[i];
      el.classList.toggle('empty', !s);
      el.classList.toggle('waiting', !!s && !s.loaded);
      el.classList.toggle('picked', this.sel?.kind === 'courier' && this.sel.slot === i);
      el.querySelector('.lbl')!.innerHTML = s ? itemIcon(s.id) : '';
      el.querySelector('.cnt')!.textContent = s && s.count > 1 ? String(s.count) : '';
      const name = s ? (s.id === 'tp' ? 'Teleport Scroll' : ITEMS[s.id].name) : '';
      el.title = s ? `${name}: ${s.loaded ? 'on the courier' : 'waiting at your base'} (tap for details, hold to drop, drag to re-order)` : 'Empty courier slot';
    });
    const b = this.courierBtn;
    b.classList.toggle('empty', blocked === 'empty' && c.mode === 'home');
    b.classList.toggle('ready', blocked === null);
    b.classList.toggle('out', c.mode !== 'home');
    // Coming to the hero = straight arrow; heading back to base (to fetch items or go home) = curved U-turn arrow.
    const arrow =
      c.mode === 'deliver'
        ? '<svg viewBox="0 0 24 24"><path d="M4 12h14M12 5l7 7-7 7"/></svg>'
        : c.mode === 'fetch' || c.mode === 'return'
          ? '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
          : '';
    b.innerHTML = `<span class="lbl">${itemIcon('courier')}</span>${arrow ? `<span class="state">${arrow}</span>` : ''}`;
    b.title = `Courier (${flying ? 'flying' : 'walks along the lanes until 6:00'}): tap to send it with its items`;
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
    // Everything your team can see, like the minimap: buildings, creeps, then heroes on top.
    const seen = c.w.units.filter((u) => u.alive && !u.ward && u.kind !== 'neutral' && (u.team === c.team || c.w.canSee(c.team, u)));
    for (const u of seen) {
      if (u.kind === 'hero') continue;
      g.fillStyle = TEAM_COLORS[u.team];
      const r = u.kind === 'structure' ? S * 0.011 : S * 0.0045;
      g.fillRect(u.x * k - r, u.y * k - r, r * 2, r * 2);
    }
    for (const h of seen) {
      if (h.kind !== 'hero') continue;
      g.fillStyle = TEAM_COLORS[h.team];
      g.strokeStyle = h === c.me ? '#ffe066' : '#fff';
      g.lineWidth = S * 0.004;
      g.beginPath();
      g.arc(h.x * k, h.y * k, S * (h === c.me ? 0.015 : 0.012), 0, Math.PI * 2);
      g.fill();
      g.stroke();
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
const tabIcon = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SHOP_TABS: { id: ShopTab; name: string; icon: string }[] = [
  { id: 'build', name: 'For you', icon: tabIcon('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>') },
  { id: 'consumable', name: 'Supplies', icon: tabIcon('<path d="M9.5 3h5M10.5 3v5.5L5.6 17.2A2.5 2.5 0 0 0 7.8 21h8.4a2.5 2.5 0 0 0 2.2-3.8L13.5 8.5V3"/><path d="M8 15h8"/>') },
  { id: 'attack', name: 'Attack', icon: tabIcon('<path d="M4 4l10.5 10.5M4 4v4M4 4h4"/><path d="M20 4L9.5 14.5M20 4v4M20 4h-4"/><path d="M6.5 13.5l4 4M17.5 13.5l-4 4M5 19l2.5-2.5M19 19l-2.5-2.5"/>') },
  { id: 'defense', name: 'Defense', icon: tabIcon('<path d="M12 3l7.5 2.6v5.6c0 4.8-3.2 8.2-7.5 9.8-4.3-1.6-7.5-5-7.5-9.8V5.6z"/>') },
  { id: 'magic', name: 'Magic', icon: tabIcon('<path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z"/><path d="M19 3.5v3M17.5 5h3"/>') },
  { id: 'upgrade', name: 'Gear', icon: tabIcon('<path d="M7 3.5h6.5v8.2l5 2.3c1.3.6 2 1.7 2 3V19H3.5v-2.2L7 13z"/><path d="M3.5 19v1.5h17V19"/>') },
];

/** Shop tab for an item, from what it gives. */
function categoryOf(id: ItemId): ShopTab {
  const d = ITEMS[id];
  if (d.tab) return d.tab;
  if (d.consumable) return 'consumable';
  const s = d.stats;
  // Boots, item buttons, auras and the Crown share a tab.
  if (s.moveSpeedPct || d.active || d.aura || s.ultUpgrade) return 'upgrade';
  if (s.damage || s.attackSpeedPct || s.lifestealPct || s.critChance || s.cleavePct) return 'attack';
  if (s.mana || s.manaRegen || s.spellAmpPct || s.cdrPct || s.spellLifestealPct) return 'magic';
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
