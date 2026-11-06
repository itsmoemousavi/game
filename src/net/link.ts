/** A two-way message connection between two players. Real ones use WebRTC (peer.ts); tests use pairs. */
export interface Link {
  send(msg: unknown): void;
  onMessage: (msg: unknown) => void;
  onClose: () => void;
  close(): void;
}

/** Two connected links, delivering in order (optionally after a delay). */
export function linkPair(delayMs = 0): [Link, Link] {
  const make = (): Link & { other?: Link; open: boolean } => ({
    open: true,
    onMessage: () => {},
    onClose: () => {},
    send(msg) {
      const other = this.other as (Link & { open: boolean }) | undefined;
      if (!this.open || !other?.open) return;
      const text = JSON.stringify(msg);
      if (delayMs > 0) setTimeout(() => other.open && other.onMessage(JSON.parse(text)), delayMs);
      else other.onMessage(JSON.parse(text));
    },
    close() {
      const other = this.other as (Link & { open: boolean }) | undefined;
      if (!this.open) return;
      this.open = false;
      this.onClose();
      if (other?.open) {
        other.open = false;
        other.onClose();
      }
    },
  });
  const a = make();
  const b = make();
  a.other = b;
  b.other = a;
  return [a, b];
}
