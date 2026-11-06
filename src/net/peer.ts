import Peer, { DataConnection } from 'peerjs';
import type { Link } from './link';

/**
 * Real connections: phones talk directly to each other over WebRTC. A free public PeerJS service only
 * introduces them at the start, using the lobby code. Nothing here needs a server of our own, so the
 * game keeps running from GitHub Pages.
 */
const PREFIX = 'ovra-game-';
/** No letters that are easy to mix up (0/O, 1/I). */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Connections drop big messages, so long ones go in pieces. */
const CHUNK = 12000;

export const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

function wrap(conn: DataConnection, peer: Peer | null): Link {
  const parts: string[] = [];
  const link: Link = {
    onMessage: () => {},
    onClose: () => {},
    send(msg) {
      if (!conn.open) return;
      const text = JSON.stringify(msg);
      if (text.length <= CHUNK) {
        void conn.send(text);
        return;
      }
      for (let i = 0; i < text.length; i += CHUNK) void conn.send((i + CHUNK < text.length ? '+' : '.') + text.slice(i, i + CHUNK));
    },
    close() {
      conn.close();
      peer?.destroy();
    },
  };
  conn.on('data', (raw) => {
    const s = raw as string;
    if (s[0] === '+') {
      parts.push(s.slice(1));
      return;
    }
    if (s[0] === '.') {
      parts.push(s.slice(1));
      const whole = parts.join('');
      parts.length = 0;
      link.onMessage(JSON.parse(whole));
      return;
    }
    link.onMessage(JSON.parse(s));
  });
  conn.on('close', () => link.onClose());
  conn.on('error', () => link.onClose());
  return link;
}

export interface HostPeer {
  code: string;
  onLink: (link: Link) => void;
  close(): void;
}

/** Open a lobby. Resolves once the phones can find it by its code. */
export function hostPeer(): Promise<HostPeer> {
  const attempt = (tries: number): Promise<HostPeer> =>
    new Promise((resolve, reject) => {
      const code = newCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
      const host: HostPeer = { code, onLink: () => {}, close: () => peer.destroy() };
      peer.on('open', () => resolve(host));
      peer.on('connection', (conn) => conn.on('open', () => host.onLink(wrap(conn, null))));
      // The introducing service can drop while the match itself carries on fine: reconnect quietly.
      peer.on('disconnected', () => {
        if (!peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && tries > 0) {
          peer.destroy();
          attempt(tries - 1).then(resolve, reject);
        } else reject(new Error(friendly(err.type)));
      });
    });
  return attempt(4);
}

/** Join a lobby by its code. */
export function joinPeer(code: string, timeoutMs = 15000): Promise<Link> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    let done = false;
    const fail = (why: string) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('Could not reach that game. Check the code and try again'), timeoutMs);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
      conn.on('open', () => {
        done = true;
        clearTimeout(timer);
        resolve(wrap(conn, peer));
      });
    });
    peer.on('error', (err) => {
      clearTimeout(timer);
      fail(friendly(err.type));
    });
  });
}

function friendly(type: string): string {
  if (type === 'peer-unavailable') return 'No game with that code';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return 'Could not reach the connection service. Check your internet';
  if (type === 'browser-incompatible' || type === 'webrtc') return 'This browser cannot connect to other players';
  return `Connection failed (${type})`;
}
