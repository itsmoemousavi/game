import { describe, expect, it } from 'vitest';
import { defaultName, loadProfile, makeUserId, setDisplayName, shownName } from '../src/client/profile';

const memory = (start: Record<string, string> = {}) => {
  const m = new Map(Object.entries(start));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('player profile', () => {
  it('makes short ids that always mix letters and numbers', () => {
    for (let i = 0; i < 2000; i++) {
      const id = makeUserId();
      expect(id).toMatch(/^[a-z2-9]{6}$/);
      expect(id).toMatch(/[a-z]/);
      expect(id).toMatch(/[2-9]/);
    }
  });

  it('keeps the same id and name between visits, and shows the id until a name is chosen', () => {
    const store = memory();
    const p = loadProfile(store);
    expect(shownName(p)).toBe(`ovra-${p.id}`);
    setDisplayName(p, '  Moe ', store);
    expect(shownName(p)).toBe('Moe');
    const again = loadProfile(store);
    expect(again).toEqual({ id: p.id, displayName: 'Moe' });
  });

  it('goes back to the id when the name is cleared or set to the id', () => {
    const store = memory();
    const p = loadProfile(store);
    setDisplayName(p, 'Moe', store);
    setDisplayName(p, '   ', store);
    expect(shownName(p)).toBe(defaultName(p));
    setDisplayName(p, 'Moe', store);
    setDisplayName(p, defaultName(p), store);
    expect(p.displayName).toBe('');
  });

  it('limits names to 14 characters', () => {
    const store = memory();
    const p = loadProfile(store);
    setDisplayName(p, 'a'.repeat(30), store);
    expect(p.displayName).toHaveLength(14);
  });

  it('keeps the name typed in the old Play with Friend box', () => {
    const store = memory({ 'ovra-name': 'Moe' });
    expect(loadProfile(store).displayName).toBe('Moe');
    expect(store.getItem('ovra-name')).toBeNull();
    expect(loadProfile(store).displayName).toBe('Moe');
  });

  it('still works when the phone refuses storage', () => {
    const fail = () => {
      throw new Error('blocked');
    };
    const p = loadProfile({ getItem: fail, setItem: fail, removeItem: fail });
    expect(shownName(p)).toMatch(/^ovra-[a-z2-9]{6}$/);
  });
});
