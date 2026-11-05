import { GameMap, LANE_IDS, LANE_WIDTH, Vec2 } from '../sim';

/**
 * The painted ground of the map, baked once into a canvas: grass with patches of moss and dry
 * grass, dirt roads with soft edges, a river with muddy banks and shallows, stone-paved bases,
 * forest floor under the trees, trails, rocks and the Warden's house floor. The 3D view lays
 * it over the terrain; the 2D view and the minimap draw it directly.
 */
export const PX_PER_UNIT_BAKED = 6;

function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, k = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, k);
  const b = hash(x0 + 1, y0, k);
  const c = hash(x0, y0 + 1, k);
  const d = hash(x0 + 1, y0 + 1, k);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x: number, y: number, k = 0) => noise(x, y, k) * 0.55 + noise(x * 2.1, y * 2.1, k + 1) * 0.3 + noise(x * 4.3, y * 4.3, k + 2) * 0.15;
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** A soft round blot of one colour, stamped many times (much quicker than a gradient per stamp). */
function softStamp(r: number, g: number, b: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.65)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  return c;
}

export function bakeMap(map: GameMap): HTMLCanvasElement {
  const px = PX_PER_UNIT_BAKED;
  const W = map.size * px;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  let g = c.getContext('2d')!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = (pts: Vec2[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x * px, p.y * px) : g.moveTo(p.x * px, p.y * px)));
  };

  // 1. Grass: a low-resolution colour field (2 px per meter), smoothed when scaled up.
  {
    const R = map.size * 2;
    const field = document.createElement('canvas');
    field.width = field.height = R;
    const fg = field.getContext('2d')!;
    const img = fg.createImageData(R, R);
    const grass = [44, 56, 32];
    const lush = [36, 52, 30];
    const moss = [30, 42, 28];
    const dry = [60, 60, 38];
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < R; x++) {
        const mx = x / 2;
        const my = y / 2;
        let col = mix(grass, lush, fbm(mx / 9, my / 9));
        col = mix(col, dry, Math.max(0, fbm(mx / 13, my / 13, 5) - 0.56) * 1.7);
        col = mix(col, moss, Math.max(0, fbm(mx / 6, my / 6, 9) - 0.58) * 1.7);
        const grain = (hash(x, y, 3) - 0.5) * 10;
        const o = (y * R + x) * 4;
        img.data[o] = col[0] + grain;
        img.data[o + 1] = col[1] + grain;
        img.data[o + 2] = col[2] + grain * 0.6;
        img.data[o + 3] = 255;
      }
    }
    fg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(field, 0, 0, W, W);
  }

  // 2. Forest floor: dark, needle-strewn ground under every tree, and each tree's soft shadow
  // falling away from the sun (drawn from one stamp: thousands of trees, must stay quick).
  {
    const stamp = softStamp(20, 26, 14);
    for (const t of map.trees) {
      const r = 3 * t.s * px;
      g.globalAlpha = 0.72;
      g.drawImage(stamp, t.x * px - r, t.y * px - r, r * 2, r * 2);
      const sw = 3.4 * t.s * px;
      g.globalAlpha = 0.5;
      g.drawImage(stamp, (t.x - 2.2 * t.s) * px - sw, (t.y - 1.5 * t.s) * px - sw * 0.8, sw * 2, sw * 1.6);
    }
    g.globalAlpha = 1;
  }

  // 3. Trails through the woods and jungle paths: worn earth, no hard edges.
  g.strokeStyle = 'rgba(92,76,50,0.5)';
  g.lineWidth = 5 * px;
  for (const p of map.forestPaths) {
    path(p);
    g.stroke();
  }

  // 4. Roads: a soft worn verge, the dirt road, darker ruts and scattered pebbles.
  const roads = LANE_IDS.map((id) => map.lanes[id]);
  const strokeRoads = (style: string, width: number) => {
    g.strokeStyle = style;
    g.lineWidth = width * px;
    for (const r of roads) {
      path(r);
      g.stroke();
    }
  };
  // A worn verge, then earth laid down in irregular patches so the edge isn't a clean line.
  strokeRoads('rgba(58,50,34,0.4)', 11.5);
  strokeRoads('rgb(70,58,40)', 7.5);
  {
    const dark = softStamp(58, 46, 32);
    const pale = softStamp(104, 88, 62);
    const grassy = softStamp(46, 56, 32);
    let k = 0;
    for (const r of roads) {
      for (let i = 0; i < r.length - 1; i++) {
        const a = r[i];
        const b = r[i + 1];
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / l;
        const ny = (b.x - a.x) / l;
        for (let d = 0; d < l; d += 0.8) {
          k++;
          const x = a.x + ((b.x - a.x) * d) / l;
          const y = a.y + ((b.y - a.y) * d) / l;
          // Earth spilling over the edge, on either side.
          const side = hash(k, 1, 61) < 0.5 ? -1 : 1;
          const off = (3.7 + hash(k, 2, 62) * 1.8) * side;
          const rad = (0.9 + hash(k, 3, 63) * 1.9) * px;
          g.globalAlpha = 0.55;
          g.drawImage(hash(k, 9, 69) < 0.34 ? grassy : dark, (x + nx * off) * px - rad, (y + ny * off) * px - rad, rad * 2, rad * 2);
          // Lighter, worn-down earth down the middle where everybody walks.
          const mid = (hash(k, 4, 64) - 0.5) * 5;
          const rm = (1 + hash(k, 5, 65) * 2) * px;
          g.globalAlpha = 0.18;
          g.drawImage(pale, (x + nx * mid) * px - rm, (y + ny * mid) * px - rm, rm * 2, rm * 2);
          // A dark wheel-worn scuff now and then.
          if (hash(k, 6, 66) < 0.16) {
            const sc = (hash(k, 7, 67) < 0.5 ? -1.9 : 1.9) + (hash(k, 8, 68) - 0.5) * 0.7;
            g.globalAlpha = 0.32;
            const rs = 0.5 * px;
            g.drawImage(dark, (x + nx * sc) * px - rs * 2.4, (y + ny * sc) * px - rs, rs * 4.8, rs * 2);
          }
        }
      }
    }
    g.globalAlpha = 1;
  }

  // 5. River: muddy banks, then shallows, then deep water down the middle, with ripples.
  // Painted on its own layer, then wiped off the side lanes: the river ends at each side lane's
  // edge (the lane is dry high ground), so no water colour may spill onto the road.
  const rw = map.riverWidth;
  const main = g;
  const layer = document.createElement('canvas');
  layer.width = layer.height = W;
  g = layer.getContext('2d')!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#332c20';
  g.lineWidth = (rw + 4) * px;
  path(map.riverPath);
  g.stroke();
  g.strokeStyle = '#24323a';
  g.lineWidth = rw * px;
  path(map.riverPath);
  g.stroke();
  g.strokeStyle = '#1a2a33';
  g.lineWidth = rw * 0.6 * px;
  path(map.riverPath);
  g.stroke();
  g.strokeStyle = 'rgba(170,210,215,0.12)';
  g.lineWidth = 0.35 * px;
  for (let i = 0; i < map.riverPath.length - 1; i += 2) {
    const a = map.riverPath[i];
    const b = map.riverPath[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    const off = (hash(i, 1) - 0.5) * rw * 0.7;
    g.beginPath();
    g.moveTo((a.x + nx * off) * px, (a.y + ny * off) * px);
    g.lineTo((a.x + (b.x - a.x) * 0.6 + nx * off) * px, (a.y + (b.y - a.y) * 0.6 + ny * off) * px);
    g.stroke();
  }
  const dryLanes = () => {
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000';
    g.lineWidth = LANE_WIDTH * px;
    for (const id of ['top', 'bot'] as const) {
      path(map.lanes[id]);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  };
  dryLanes();
  main.drawImage(layer, 0, 0);
  g = main;

  // 5b. Slopes and curbs. Where the bank is a slope (river cells reaching the bank), sandy
  // gravel runs down to the water; where it's a curb, a band of grey stones.
  {
    const n = map.grid;
    const cs = map.cell * px;
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const i = cy * n + cx;
        if (map.cliff[i]) {
          const v = hash(cx, cy, 41);
          const l = 44 + v * 20;
          g.fillStyle = `rgb(${l},${l - 3},${l - 9})`;
          g.beginPath();
          g.ellipse((cx + 0.5) * cs, (cy + 0.5) * cs, cs * 0.62, cs * 0.55, v * 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // Slopes: river-level cells that touch normal ground get a sandy fill.
    for (let cy = 1; cy < n - 1; cy++) {
      for (let cx = 1; cx < n - 1; cx++) {
        const i = cy * n + cx;
        if (map.height[i] !== 0 || !map.walkable[i]) continue;
        const near = [i - 1, i + 1, i - n, i + n].some((k) => map.height[k] >= 1 && !map.cliff[k]);
        if (!near) continue;
        const grad = g.createRadialGradient((cx + 0.5) * cs, (cy + 0.5) * cs, 0, (cx + 0.5) * cs, (cy + 0.5) * cs, cs * 1.4);
        grad.addColorStop(0, 'rgba(72,64,48,0.8)');
        grad.addColorStop(1, 'rgba(72,64,48,0)');
        g.fillStyle = grad;
        g.fillRect((cx - 1) * cs, (cy - 1) * cs, cs * 3, cs * 3);
      }
    }
    // Lanes wade across: a gravel ford where each road meets the water.
    g.strokeStyle = 'rgba(70,62,46,0.4)';
    g.lineWidth = 8 * px;
    for (const r of roads) {
      path(r);
      g.stroke();
    }
    g = layer.getContext('2d')!;
    g.clearRect(0, 0, W, W);
    g.strokeStyle = 'rgba(40,80,92,0.35)';
    g.lineWidth = rw * 0.5 * px;
    path(map.riverPath);
    g.stroke();
    dryLanes();
    main.drawImage(layer, 0, 0);
    g = main;
  }

  // 6. Bridges (also built in 3D): planks across the river on stone footings.
  for (const b of map.bridges) {
    g.save();
    g.translate(b.x * px, b.y * px);
    g.rotate(b.angle);
    g.fillStyle = '#3d3a35';
    g.fillRect((-b.length / 2) * px, (-b.width / 2 - 0.6) * px, b.length * px, (b.width + 1.2) * px);
    g.fillStyle = '#6b5236';
    g.fillRect((-b.length / 2) * px, (-b.width / 2) * px, b.length * px, b.width * px);
    g.strokeStyle = 'rgba(30,20,12,0.6)';
    g.lineWidth = 0.15 * px;
    for (let x = -b.length / 2; x <= b.length / 2; x += 0.9) {
      g.beginPath();
      g.moveTo(x * px, (-b.width / 2) * px);
      g.lineTo(x * px, (b.width / 2) * px);
      g.stroke();
    }
    g.restore();
  }

  // 7. Bases: irregular flagstones (offset rows, varied widths) on the plateaus.
  const n = map.grid;
  const cs = map.cell * px;
  const raised = (x: number, y: number) => {
    const cx = Math.floor(x / map.cell);
    const cy = Math.floor(y / map.cell);
    return cx >= 0 && cy >= 0 && cx < n && cy < n && map.height[cy * n + cx] === 2 && map.walkable[cy * n + cx] === 1;
  };
  g.fillStyle = 'rgba(30,28,24,0.95)';
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) if (raised((cx + 0.5) * map.cell, (cy + 0.5) * map.cell)) g.fillRect(cx * cs, cy * cs, cs + 0.5, cs + 0.5);
  const rowH = 1.45;
  for (let row = 0; row * rowH < map.size; row++) {
    let x = -hash(row, 0, 31) * 2;
    const y = row * rowH;
    for (let k = 0; x < map.size; k++) {
      const w = 1.3 + hash(row, k, 32) * 1.5;
      if (raised(x + w / 2, y + rowH / 2)) {
        const v = hash(row, k, 33);
        // Worn in big patches: darker and greener where few people walk.
        const wear = fbm(x / 14, y / 14, 35);
        const l = 46 + v * 15 + wear * 24;
        const warm = hash(row, k, 34) * 6;
        g.fillStyle = `rgb(${l + warm},${l - 2},${l - 12})`;
        g.beginPath();
        if (g.roundRect) g.roundRect((x + 0.09) * px, (y + 0.09) * px, (w - 0.18) * px, (rowH - 0.18) * px, 0.25 * px);
        else g.rect((x + 0.09) * px, (y + 0.09) * px, (w - 0.18) * px, (rowH - 0.18) * px);
        g.fill();
        if (v > 0.62 || wear < 0.4) {
          g.fillStyle = 'rgba(50,62,34,0.42)'; // moss creeping along the joints
          g.fillRect(x * px, (y + rowH - 0.3) * px, w * (0.3 + v * 0.6) * px, 0.26 * px);
        }
        if (hash(row, k, 36) > 0.86) {
          g.strokeStyle = 'rgba(14,12,10,0.5)'; // a crack
          g.lineWidth = 0.06 * px;
          g.beginPath();
          g.moveTo((x + 0.2) * px, (y + 0.3) * px);
          g.lineTo((x + w * 0.5) * px, (y + rowH * 0.56) * px);
          g.lineTo((x + w - 0.2) * px, (y + rowH * 0.42) * px);
          g.stroke();
        }
      }
      x += w;
    }
  }
  // Ward hills: rocky grass.
  for (const h of map.hills) {
    const grad = g.createRadialGradient(h.x * px, h.y * px, 0, h.x * px, h.y * px, 5.5 * px);
    grad.addColorStop(0, 'rgba(120,112,84,0.55)');
    grad.addColorStop(1, 'rgba(120,112,84,0)');
    g.fillStyle = grad;
    g.fillRect((h.x - 6) * px, (h.y - 6) * px, 12 * px, 12 * px);
  }
  // Cliff lips: dark edge where any raised ground meets lower ground.
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const hgt = map.height[cy * n + cx];
      if (hgt <= 1) continue;
      const lower = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && map.height[y * n + x] < hgt;
      g.fillStyle = 'rgba(20,16,10,0.5)';
      const e = cs * 0.22;
      if (lower(cx, cy + 1)) g.fillRect(cx * cs, (cy + 1) * cs - e, cs, e);
      if (lower(cx + 1, cy)) g.fillRect((cx + 1) * cs - e, cy * cs, e, cs);
      if (lower(cx, cy - 1)) g.fillRect(cx * cs, cy * cs, cs, e * 0.6);
      if (lower(cx - 1, cy)) g.fillRect(cx * cs, cy * cs, e * 0.6, cs);
    }
  }

  // 7b. Buildings stand in worn earth and their own soft shade, so they sit in the ground.
  {
    const earth = softStamp(46, 38, 26);
    const shade = softStamp(10, 10, 8);
    for (const b of map.structures) {
      const r = (b.tier === 'shrine' ? 8.5 : b.tier === 'barracks' ? 6 : b.tier === 'fountain' ? 5.5 : 4.2) * px;
      g.globalAlpha = 0.55;
      g.drawImage(earth, b.pos.x * px - r * 1.25, b.pos.y * px - r * 1.25, r * 2.5, r * 2.5);
      g.globalAlpha = 0.6;
      g.drawImage(shade, b.pos.x * px - r, b.pos.y * px - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }

  // 8. The Warden's house: flagstone floor and stone wall ring with a doorway.
  {
    const h = map.house;
    const mid = (h.inner + h.outer) / 2;
    const doorAng = Math.atan2(h.door.y, h.door.x);
    const gap = Math.asin(Math.min(1, h.doorHalf / mid));
    g.fillStyle = '#35332d';
    g.beginPath();
    g.arc(h.x * px, h.y * px, mid * px, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 0.12 * px;
    for (let r = 2.2; r < h.inner; r += 2.2) {
      g.beginPath();
      g.arc(h.x * px, h.y * px, r * px, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineCap = 'butt';
    g.strokeStyle = '#26241f';
    g.lineWidth = (h.outer - h.inner) * px;
    g.beginPath();
    g.arc(h.x * px, h.y * px, mid * px, doorAng + gap, doorAng - gap + Math.PI * 2);
    g.stroke();
    g.lineCap = 'round';
  }

  // 8b. Fountain yard walls (only the stretches standing on open ground): dark footing under the stone.
  g.fillStyle = '#26241f';
  for (let i = 0; i < n * n; i++) {
    if (!map.fountainWall[i]) continue;
    const cx = i % n;
    const cy = (i - cx) / n;
    g.fillRect(cx * map.cell * px, cy * map.cell * px, map.cell * px + 1, map.cell * px + 1);
  }

  // 9. Pebbles and small rocks on open ground (not on roads or water).
  for (let i = 0; i < 2600; i++) {
    const x = hash(i, 0, 21) * map.size;
    const y = hash(i, 0, 22) * map.size;
    const cx = Math.floor(x / map.cell);
    const cy = Math.floor(y / map.cell);
    if (!map.walkable[cy * n + cx] || Math.abs(x - y) < 28) continue; // not in the river
    const r = (0.15 + hash(i, 1, 23) * 0.35) * px;
    const l = 70 + hash(i, 2, 24) * 40;
    g.fillStyle = `rgba(${l * 0.72},${l * 0.7},${l * 0.64},0.6)`;
    g.beginPath();
    g.ellipse(x * px, y * px, r, r * 0.75, hash(i, 3, 25) * 3, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}
