/**
 * The player's identity, kept on their phone until there is a server to make ids truly unique.
 * The id never changes. Their name is what they chose in Settings → Profile, or `ovra-<id>` until they do.
 */
export const NAME_MAX = 14;
const ID_LENGTH = 6;
/** No 0/o, 1/i/l: an id should be easy to read out to a friend. */
const ID_LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const ID_DIGITS = '23456789';
const ID_KEY = 'ovra-user-id';
const NAME_KEY = 'ovra-display-name';
/** Where Play with Friend kept the name typed there before Profile existed. */
const OLD_NAME_KEY = 'ovra-name';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The phone's own storage. Asked for only when used: touching it can itself throw in some browsers. */
export const phoneStorage: Store = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

export interface Profile {
  /** The part after `ovra-`. */
  id: string;
  /** Empty until they choose one. */
  displayName: string;
}

/** Always a mix of letters and numbers. */
export function makeUserId(rand: () => number = Math.random): string {
  const all = ID_LETTERS + ID_DIGITS;
  const pick = (from: string) => from[Math.floor(rand() * from.length)];
  const chars = Array.from({ length: ID_LENGTH }, () => pick(all));
  // One guaranteed letter and one guaranteed number, at different random places.
  const a = Math.floor(rand() * ID_LENGTH);
  chars[a] = pick(ID_LETTERS);
  chars[(a + 1 + Math.floor(rand() * (ID_LENGTH - 1))) % ID_LENGTH] = pick(ID_DIGITS);
  return chars.join('');
}

export const defaultName = (p: Profile) => `ovra-${p.id}`;
/** What everyone sees: their chosen name, or the same value as their id. */
export const shownName = (p: Profile) => p.displayName || defaultName(p);

/** Browsers can refuse storage (private windows): the game still works, it just won't remember. */
const attempt = <T>(f: () => T, otherwise: T): T => {
  try {
    return f();
  } catch {
    return otherwise;
  }
};

export function loadProfile(store: Store): Profile {
  let id = attempt(() => store.getItem(ID_KEY), null);
  if (!id) {
    id = makeUserId();
    const fresh = id;
    attempt(() => store.setItem(ID_KEY, fresh), undefined);
  }
  let displayName = attempt(() => store.getItem(NAME_KEY), null);
  if (displayName === null) {
    displayName = (attempt(() => store.getItem(OLD_NAME_KEY), null) ?? '').trim().slice(0, NAME_MAX);
    const moved = displayName;
    attempt(() => {
      store.setItem(NAME_KEY, moved);
      store.removeItem(OLD_NAME_KEY);
    }, undefined);
  }
  return { id, displayName };
}

/** Blank, or typing their own id, means "no chosen name". */
export function setDisplayName(p: Profile, raw: string, store: Store) {
  const name = raw.trim().slice(0, NAME_MAX);
  p.displayName = name === defaultName(p) ? '' : name;
  attempt(() => store.setItem(NAME_KEY, p.displayName), undefined);
}
