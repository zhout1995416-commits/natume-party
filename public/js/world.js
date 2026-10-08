// 方块世界：地形生成、房屋与树的搭建、面剔除 + 环境光遮蔽的网格构建、按季节重新上色。
import * as THREE from 'three';

export const T = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, PATH: 5, LOG: 6, MUD: 7, PLANK: 8,
  THATCH: 9, COBBLE: 10, MLOG: 11, LEAF_A: 12, LEAF_B: 13, LEAF_C: 14, TLOG: 15, TLEAF: 16, WATER: 17,
};

export const R = 56;
const O = R + 4;
const W = 2 * O + 1;
const YMIN = -6;
const YMAX = 52;
const YH = YMAX - YMIN + 1;

export const RIVER_HALF = 2.3;
export const riverZ = (x) => 3 + 4 * Math.sin(x * 0.11) + 2 * Math.sin(x * 0.047 + 1.3);

// 房屋、枣树、小路的位置
export const HUT = { x0: -12, x1: -6, z0: -11, z1: -7, doorX: -9 };
const HUT_ZONE = { x0: -15, x1: -3, z0: -14, z1: -5 };
export const TREE = { x: 6, z: -3 };
const TREE_ZONE = { x0: 0, x1: 12, z0: -9, z1: 2 };
const PATH_X0 = -10, PATH_X1 = -8;

// ---------- 噪声与随机 ----------
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x, y, z) {
  return hash2(hash2(x, y) * 1e6 | 0, z);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += amp * vnoise(x * f, z * f); f *= 2; amp *= 0.5; }
  return s / 0.9375;
}
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

// ---------- 网格 ----------
class Grid {
  constructor() { this.data = new Uint8Array(W * YH * W); }
  inb(x, y, z) { return x >= -O && x <= O && z >= -O && z <= O && y >= YMIN && y <= YMAX; }
  i(x, y, z) { return ((x + O) * YH + (y - YMIN)) * W + (z + O); }
  get(x, y, z) { return this.inb(x, y, z) ? this.data[this.i(x, y, z)] : 0; }
  set(x, y, z, t) { if (this.inb(x, y, z)) this.data[this.i(x, y, z)] = t; }
}

const isLeaf = (t) => (t >= T.LEAF_A && t <= T.LEAF_C) || t === T.TLEAF;
const isOpaque = (t) => t !== T.AIR && t !== T.WATER;
// 叶子不遮挡非叶子方块（冬天枣树叶子隐藏后，树枝不会露出空洞）
const occludes = (a, b) => isOpaque(b) && (!isLeaf(b) || isLeaf(a));

// ---------- 地形 ----------
function baseHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = 0;
  const hills = fbm(x * 0.07 + 31, z * 0.07 - 17);
  h += Math.max(0, hills - 0.5) * 9 * smoothstep(13, 22, d);
  if (d > 22) {
    const m = fbm(x * 0.05 + 7, z * 0.05 + 3);
    const ridge = 1 - Math.abs(fbm(x * 0.09 - 5, z * 0.09 + 9) * 2 - 1);
    h += (d - 22) * (0.3 + m * 0.55) + ridge * 6 * smoothstep(22, 34, d);
  }
  return h;
}

function heightAt(x, z) {
  const rd = Math.abs(z - riverZ(x));
  if (rd < RIVER_HALF) return -1;
  const flat = Math.min(rectDist(HUT_ZONE, x, z), rectDist(TREE_ZONE, x, z));
  let h = Math.floor(baseHeight(x, z) * smoothstep(0, 7, flat));
  const valley = Math.floor((rd - RIVER_HALF) * 1.15);
  if (h > valley) h = Math.max(0, valley);
  return Math.min(h, YMAX - 10);
}

export function generateWorld() {
  const grid = new Grid();
  const rng = mulberry32(20261007);
  const heights = new Int16Array(W * W).fill(-99);
  const hIdx = (x, z) => (x + O) * W + (z + O);
  const getH = (x, z) => (x < -O || x > O || z < -O || z > O) ? -99 : heights[hIdx(x, z)];

  // 小路范围：从屋门向南穿过小桥
  const rzDoor = riverZ(HUT.doorX);
  const pathZ1 = Math.ceil(rzDoor + RIVER_HALF) + 5;
  const isPath = (x, z) => x >= PATH_X0 && x <= PATH_X1 && z >= HUT.z1 + 1 && z <= pathZ1;

  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      if (Math.hypot(x, z) > R + 0.5) continue;
      heights[hIdx(x, z)] = heightAt(x, z);
    }
  }

  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const h = getH(x, z);
      if (h === -99) continue;
      const rd = Math.abs(z - riverZ(x));
      const river = rd < RIVER_HALF;
      let minN = h;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = getH(x + dx, z + dz);
        minN = Math.min(minN, n === -99 ? YMIN : n);
      }
      const steep = h - minN >= 3 && h > 4;
      const rocky = h > 13 + fbm(x * 0.2, z * 0.2) * 8;
      for (let y = YMIN + 1; y <= h; y++) {
        const depth = h - y;
        let t;
        if (depth === 0) {
          if (river) t = T.SAND;
          else if (isPath(x, z)) t = T.PATH;
          else if (h <= 0 && rd < RIVER_HALF + 1.3) t = T.SAND;
          else if (steep || rocky) t = T.STONE;
          else t = T.GRASS;
        } else if (depth <= 2 && !steep && !rocky) t = river ? T.SAND : T.DIRT;
        else t = T.STONE;
        grid.set(x, y, z, t);
      }
      if (river) grid.set(x, 0, z, T.WATER);
    }
  }

  // ---- 山上的树 ----
  for (let x = -R + 2; x <= R - 2; x++) {
    for (let z = -R + 2; z <= R - 2; z++) {
      const d = Math.hypot(x, z);
      if (d < 17 || d > 47) continue;
      const h = getH(x, z);
      if (h < 0 || h > 30) continue;
      if (Math.abs(z - riverZ(x)) < RIVER_HALF + 2.5) continue;
      if (rectDist(HUT_ZONE, x, z) < 3 || rectDist(TREE_ZONE, x, z) < 3) continue;
      if (grid.get(x, h, z) !== T.GRASS) continue;
      if (rng() > 0.05) continue;
      let crowded = false;
      for (let dx = -2; dx <= 2 && !crowded; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (grid.get(x + dx, h + 3, z + dz) || grid.get(x + dx, h + 2, z + dz)) { crowded = true; break; }
      }
      if (crowded) continue;
      const kindR = rng();
      const leaf = kindR < 0.4 ? T.LEAF_C : kindR < 0.7 ? T.LEAF_A : T.LEAF_B;
      const th = 2 + Math.floor(rng() * 2);
      for (let y = 1; y <= th + 1; y++) grid.set(x, h + y, z, T.MLOG);
      const put = (dx, dy, dz) => { if (!grid.get(x + dx, h + dy, z + dz)) grid.set(x + dx, h + dy, z + dz, leaf); };
      if (leaf === T.LEAF_C) {
        // 松树：分层收窄
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const m = Math.abs(dx) + Math.abs(dz);
          if (m <= 3) put(dx, th, dz);
          if (m <= 2) put(dx, th + 1, dz);
          if (m <= 1) put(dx, th + 2, dz);
        }
        put(0, th + 3, 0);
      } else {
        // 阔叶树：圆团
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 2; dy++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (dy === 2 && (Math.abs(dx) === 2 || Math.abs(dz) === 2)) continue;
          if (rng() < 0.08) continue;
          put(dx, th + dy, dz);
        }
      }
    }
  }

  // ---- 茅草屋 ----
  const windows = [];
  const winSet = new Set([`${-11},2,${HUT.z1}`, `${-7},2,${HUT.z1}`, `${HUT.x0},2,${-9}`, `${HUT.x1},2,${-9}`]);
  for (let x = HUT.x0; x <= HUT.x1; x++) {
    for (let z = HUT.z0; z <= HUT.z1; z++) {
      const edgeX = x === HUT.x0 || x === HUT.x1;
      const edgeZ = z === HUT.z0 || z === HUT.z1;
      if (!edgeX && !edgeZ) continue;
      for (let y = 1; y <= 3; y++) {
        const key = `${x},${y},${z}`;
        if (x === HUT.doorX && z === HUT.z1 && y <= 2) continue;
        if (winSet.has(key)) { windows.push({ x, y, z, axis: edgeZ && !edgeX ? 'z' : 'x' }); continue; }
        grid.set(x, y, z, edgeX && edgeZ ? T.LOG : (y === 3 ? T.LOG : T.MUD));
      }
    }
  }
  for (let k = 0; k <= 3; k++) {
    for (let x = HUT.x0 - 1; x <= HUT.x1 + 1; x++) {
      for (let z = HUT.z0 - 1 + k; z <= HUT.z1 + 1 - k; z++) grid.set(x, 4 + k, z, T.THATCH);
    }
  }
  const chimney = { x: -7, z: -10 };
  for (let y = 4; y <= 8; y++) grid.set(chimney.x, y, chimney.z, T.COBBLE);

  // ---- 枣树 ----
  const tb = TREE;
  const trunk = [[0, 1, 0], [0, 2, 0], [0, 3, 0], [0, 4, 0], [1, 1, 0], [0, 1, 1],
    [0, 5, 0], [0, 6, 0], [-1, 4, 0], [-2, 5, 0], [1, 4, 0], [2, 5, 0], [2, 6, 1], [0, 5, -1], [0, 6, -2], [0, 5, 1], [0, 6, 2]];
  for (const [dx, dy, dz] of trunk) grid.set(tb.x + dx, dy, tb.z + dz, T.TLOG);
  const leafCenter = { x: tb.x, y: 7, z: tb.z };
  const rx = 4.2, ry = 2.7, rz = 3.8;
  const leafCells = [];
  for (let dx = -5; dx <= 5; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++) {
    const e = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2;
    if (e > 1) continue;
    const x = leafCenter.x + dx, y = leafCenter.y + dy, z = leafCenter.z + dz;
    if (grid.get(x, y, z)) continue;
    if (e > 0.62 && hash3(x, y, z) < 0.2) continue;
    grid.set(x, y, z, T.TLEAF);
    leafCells.push({ x, y, z, e, dx, dy, dz });
  }
  // 挂在树冠外侧的枣子和枣花
  const outer = leafCells.filter((c) => c.e > 0.6 && c.dy <= 1);
  const pick = (arr, n) => {
    const a = arr.slice(), out = [];
    while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]);
    return out;
  };
  const toSpot = (c, push) => {
    const len = Math.hypot(c.dx / rx, c.dy / ry, c.dz / rz) || 1;
    return {
      x: c.x + (c.dx / rx / len) * push,
      y: c.y + (c.dy / ry / len) * push * 0.6 - 0.25,
      z: c.z + (c.dz / rz / len) * push,
      v: hash3(c.x, c.y, c.z),
    };
  };
  const fruitSpots = pick(outer, 30).map((c) => toSpot(c, 0.62));
  const flowerSpots = pick(leafCells.filter((c) => c.e > 0.6), 46).map((c) => toSpot(c, 0.56));

  // ---- 草地上的小花、河边芦苇 ----
  const groundFlowers = [];
  for (let i = 0; i < 400 && groundFlowers.length < 150; i++) {
    const x = (rng() * 2 - 1) * 20, z = (rng() * 2 - 1) * 20;
    const xi = Math.round(x), zi = Math.round(z);
    if (Math.hypot(x, z) > 20) continue;
    if (getH(xi, zi) !== 0 || grid.get(xi, 0, zi) !== T.GRASS || grid.get(xi, 1, zi)) continue;
    if (Math.abs(z - riverZ(x)) < RIVER_HALF + 1.6) continue;
    if (Math.hypot(x - tb.x, z - tb.z) < 2) continue;
    groundFlowers.push({ x, z, c: rng(), s: 0.7 + rng() * 0.5, v: rng() });
  }
  // ---- 草丛（交叉草叶）：山谷里的草方块上，按噪声成片分布 ----
  const tufts = [];
  for (let x = -32; x <= 32; x++) {
    for (let z = -32; z <= 32; z++) {
      const h = getH(x, z);
      if (h < 0 || h > 8) continue;
      if (grid.get(x, h, z) !== T.GRASS || grid.get(x, h + 1, z)) continue;
      if (x >= HUT.x0 && x <= HUT.x1 && z >= HUT.z0 && z <= HUT.z1) continue;
      if (Math.abs(z - riverZ(x)) < RIVER_HALF + 1.2) continue;
      const n = fbm(x * 0.15 + 3, z * 0.15 - 8);
      const p = 0.1 + Math.max(0, n - 0.42) * 1.6;
      const k = rng() < p ? (rng() < 0.45 ? 2 : 1) : 0;
      for (let i = 0; i < k; i++) {
        tufts.push({ x: x + (rng() - 0.5) * 0.8, y: h + 0.5, z: z + (rng() - 0.5) * 0.8, s: 0.55 + rng() * 0.6, r: rng() * Math.PI, v: rng() });
      }
    }
  }
  // 打乱顺序：季节里只显示前一部分时，留下的草也是均匀分布的
  for (let i = tufts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [tufts[i], tufts[j]] = [tufts[j], tufts[i]]; }

  const reeds = [];
  for (let x = -26; x <= 26; x++) {
    for (const side of [-1, 1]) {
      if (rng() > 0.32) continue;
      const z = riverZ(x) + side * (RIVER_HALF + 0.2 + rng() * 0.9);
      if (x >= PATH_X0 - 1 && x <= PATH_X1 + 1) continue;
      const zi = Math.round(z);
      const h = getH(x, zi);
      if (h !== 0 || grid.get(x, 1, zi)) continue;
      reeds.push({ x: x + (rng() - 0.5) * 0.6, z, h: 1 + rng() * 0.8, v: rng() });
    }
  }

  // 桥的跨度
  let bz0 = Infinity, bz1 = -Infinity;
  for (let x = PATH_X0; x <= PATH_X1; x++) {
    bz0 = Math.min(bz0, riverZ(x) - RIVER_HALF);
    bz1 = Math.max(bz1, riverZ(x) + RIVER_HALF);
  }
  const bridge = { x0: PATH_X0 - 0.5, x1: PATH_X1 + 0.5, z0: Math.floor(bz0) - 0.5, z1: Math.ceil(bz1) + 0.5 };

  // 每一列最高的方块（含树），给相机做碰撞用
  const tops = new Int16Array(W * W).fill(-99);
  for (let x = -O; x <= O; x++) for (let z = -O; z <= O; z++) {
    for (let y = YMAX; y >= YMIN; y--) if (grid.get(x, y, z)) { tops[hIdx(x, z)] = y; break; }
  }
  const topAt = (x, z) => (x < -O || x > O || z < -O || z > O) ? -99 : tops[hIdx(x, z)];

  return {
    grid, getH, topAt, windows, chimney, fruitSpots, flowerSpots, groundFlowers, tufts, reeds, bridge,
    door: { x: HUT.doorX, z: HUT.z1 },
  };
}

// ---------- 纹理图集 ----------
const TILE = 16, TILES = 16;
export const TILE_ID = { NOISE: 0, STONE: 1, PLANK: 2, LOG: 3, LOGTOP: 4, THATCH: 5, LEAF: 6, MUD: 7, GRAVEL: 8, GRASS: 9 };

export function makeAtlas() {
  const cv = document.createElement('canvas');
  cv.width = TILE * TILES; cv.height = TILE;
  const g = cv.getContext('2d');
  const rnd = mulberry32(7);
  const px = (tile, x, y, v) => {
    const c = Math.max(0, Math.min(255, Math.round(v * 255)));
    g.fillStyle = `rgb(${c},${c},${c})`;
    g.fillRect(tile * TILE + x, y, 1, 1);
  };
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const r = rnd();
    px(0, x, y, 0.86 + r * 0.14);
    px(1, x, y, (fbm(x * 0.35, y * 0.35) > 0.55 ? 0.74 : 0.9) + rnd() * 0.1);
    px(2, x, y, (y % 4 === 0 ? 0.68 : 0.9 + rnd() * 0.08) * ((x === (y < 8 ? 5 : 11) && y % 4 !== 0) ? 0.78 : 1));
    px(3, x, y, (x % 4 === 1 ? 0.7 : 0.88 + rnd() * 0.12));
    const rr = Math.hypot(x - 7.5, y - 7.5);
    px(4, x, y, (Math.floor(rr) % 3 === 0 ? 0.72 : 0.92) + rnd() * 0.06);
    px(5, x, y, ((x + Math.floor(y / 3)) % 3 === 0 ? 0.72 : 0.92 + rnd() * 0.08));
    px(6, x, y, r < 0.18 ? 0.62 : 0.84 + rnd() * 0.16);
    px(7, x, y, r < 0.06 ? 0.75 : 0.93 + rnd() * 0.07);
    px(8, x, y, r < 0.3 ? 0.7 : 0.88 + rnd() * 0.12);
    px(9, x, y, r < 0.12 ? 0.78 : 0.9 + rnd() * 0.1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function tileFor(t, dir) {
  const top = dir === 2 || dir === 3;
  switch (t) {
    case T.GRASS: return dir === 2 ? TILE_ID.GRASS : TILE_ID.NOISE;
    case T.STONE: case T.COBBLE: return TILE_ID.STONE;
    case T.PATH: return TILE_ID.GRAVEL;
    case T.LOG: case T.MLOG: case T.TLOG: return top ? TILE_ID.LOGTOP : TILE_ID.LOG;
    case T.MUD: return TILE_ID.MUD;
    case T.PLANK: return TILE_ID.PLANK;
    case T.THATCH: return TILE_ID.THATCH;
    case T.LEAF_A: case T.LEAF_B: case T.LEAF_C: case T.TLEAF: return TILE_ID.LEAF;
    default: return TILE_ID.NOISE;
  }
}

// ---------- 季节配色 ----------
const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  spring: { grass: C('#7fd35b'), leafA: C('#8fd46a'), leafB: C('#a3df7c'), leafC: C('#4f9a46'), tleaf: C('#94d466'), thatch: C('#d8ad5a') },
  summer: { grass: C('#5cae3c'), leafA: C('#3f8a3a'), leafB: C('#4d9a42'), leafC: C('#2f7034'), tleaf: C('#4f9d3e'), thatch: C('#d6a852') },
  autumn: { grass: C('#a7a84c'), leafA: C('#e08a2c'), leafB: C('#c8442c'), leafC: C('#3a7a3c'), tleaf: C('#a6b842'), thatch: C('#c99b4a') },
  winter: { grass: C('#eef3f7'), leafA: C('#7a6a55'), leafB: C('#7a6a55'), leafC: C('#2f5f3c'), tleaf: C('#7a6a55'), thatch: C('#bf9a55') },
};
const FIXED = {
  dirt: C('#8a5d3b'), stone: C('#8d8f93'), sand: C('#dccb8e'), path: C('#ab9c80'), log: C('#6b4a2e'), logTop: C('#9c7a52'),
  mud: C('#e9dfc8'), plank: C('#b98a53'), cobble: C('#7b7b7d'), mlog: C('#5e4128'), tlog: C('#5b3b24'), tlogTop: C('#7d5a3a'),
  snow: C('#f2f6fa'), autumnYellow: C('#e8c23a'),
};
const SNOW_LINE = { spring: 25, summer: 99, autumn: 27, winter: -99 };

const tmp = new THREE.Color(), tmpSide = new THREE.Color();
function faceColor(t, dir, y, v, season, out) {
  const p = PALETTE[season];
  const snowy = dir === 2 && t !== T.WATER && (season === 'winter' ? t !== T.TLEAF : y >= SNOW_LINE[season] && (t === T.STONE || t === T.GRASS || t === T.DIRT));
  if (snowy && !(t === T.MUD)) { out.copy(FIXED.snow); return out; }
  switch (t) {
    case T.GRASS: out.copy(dir === 2 ? p.grass : tmpSide.copy(FIXED.dirt).lerp(season === 'winter' ? FIXED.snow : p.grass, season === 'winter' ? 0.45 : 0.6)); break;
    case T.DIRT: out.copy(FIXED.dirt); break;
    case T.STONE: out.copy(FIXED.stone); break;
    case T.SAND: out.copy(FIXED.sand); break;
    case T.PATH: out.copy(FIXED.path); break;
    case T.LOG: out.copy(dir === 2 || dir === 3 ? FIXED.logTop : FIXED.log); break;
    case T.MUD: out.copy(FIXED.mud); break;
    case T.PLANK: out.copy(FIXED.plank); break;
    case T.THATCH: out.copy(p.thatch); break;
    case T.COBBLE: out.copy(FIXED.cobble); break;
    case T.MLOG: out.copy(FIXED.mlog); break;
    case T.TLOG: out.copy(dir === 2 || dir === 3 ? FIXED.tlogTop : FIXED.tlog); break;
    case T.LEAF_A: out.copy(p.leafA); if (season === 'autumn' && v > 0.6) out.lerp(FIXED.autumnYellow, 0.6); break;
    case T.LEAF_B: out.copy(p.leafB); if (season === 'autumn' && v > 0.7) out.lerp(p.leafA, 0.5); break;
    case T.LEAF_C: out.copy(p.leafC); break;
    case T.TLEAF: out.copy(p.tleaf); if (season === 'autumn' && v > 0.55) out.lerp(FIXED.autumnYellow, 0.55); break;
    default: out.setRGB(1, 0, 1);
  }
  const k = 0.9 + v * 0.14;
  out.r *= k; out.g *= k; out.b *= k;
  return out;
}

// ---------- 网格构建 ----------
const DIRS = [
  { n: [1, 0, 0], c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
];
const FACE_SHADE = [0.84, 0.84, 1.0, 0.55, 0.74, 0.74];
const AO_CURVE = [0.52, 0.7, 0.86, 1.0];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const WATER_DROP = 0.22;

/**
 * 把网格里满足 filter 的方块转成一个 BufferGeometry（只生成外露的面，带顶点环境光遮蔽）。
 * 返回 { geometry, recolor(season) }。
 */
export function buildMesh(grid, filter, origin = [0, 0, 0]) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const meta = []; // 每个面：type, dir, y, v, ao0..ao3
  let vcount = 0;
  const d = grid.data;
  for (let x = -O; x <= O; x++) {
    for (let y = YMIN; y <= YMAX; y++) {
      const base = ((x + O) * YH + (y - YMIN)) * W;
      for (let z = -O; z <= O; z++) {
        const t = d[base + z + O];
        if (!t || !filter(t)) continue;
        const v = hash3(x, y, z);
        for (let f = 0; f < 6; f++) {
          const dir = DIRS[f];
          const nx = x + dir.n[0], ny = y + dir.n[1], nz = z + dir.n[2];
          const nb = grid.get(nx, ny, nz);
          if (t === T.WATER) { if (nb === T.WATER || occludes(t, nb)) continue; }
          else if (occludes(t, nb)) continue;
          const tile = tileFor(t, f);
          const u0 = (tile * TILE + 0.02) / (TILE * TILES), u1 = (tile * TILE + TILE - 0.02) / (TILE * TILES);
          const ao = [0, 0, 0, 0];
          for (let k = 0; k < 4; k++) {
            const c = dir.c[k];
            const off = [Math.sign(c[0]), Math.sign(c[1]), Math.sign(c[2])];
            const axes = [0, 1, 2].filter((a) => dir.n[a] === 0);
            const s1 = [nx, ny, nz], s2 = [nx, ny, nz];
            s1[axes[0]] += off[axes[0]];
            s2[axes[1]] += off[axes[1]];
            const cr = [nx, ny, nz];
            cr[axes[0]] += off[axes[0]]; cr[axes[1]] += off[axes[1]];
            const a = occludes(t, grid.get(s1[0], s1[1], s1[2])) ? 1 : 0;
            const b = occludes(t, grid.get(s2[0], s2[1], s2[2])) ? 1 : 0;
            const cc = occludes(t, grid.get(cr[0], cr[1], cr[2])) ? 1 : 0;
            ao[k] = t === T.WATER ? 3 : (a && b ? 0 : 3 - (a + b + cc));
          }
          for (let k = 0; k < 4; k++) {
            const c = dir.c[k];
            let py = y + c[1];
            if (t === T.WATER && c[1] > 0) py -= WATER_DROP;
            pos.push(x + c[0] - origin[0], py - origin[1], z + c[2] - origin[2]);
            nor.push(dir.n[0], dir.n[1], dir.n[2]);
            uv.push(UVS[k][0] ? u1 : u0, UVS[k][1] ? 0.998 : 0.002);
            col.push(1, 1, 1);
          }
          if (ao[0] + ao[2] < ao[1] + ao[3]) idx.push(vcount + 1, vcount + 2, vcount + 3, vcount + 1, vcount + 3, vcount);
          else idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
          vcount += 4;
          meta.push(t, f, y, v, ao[0], ao[1], ao[2], ao[3]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const colorAttr = new THREE.Float32BufferAttribute(col, 3);
  geometry.setAttribute('color', colorAttr);
  geometry.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geometry.computeBoundingSphere();

  const colors = colorAttr.array;
  function recolor(season) {
    const faces = meta.length / 8;
    for (let i = 0; i < faces; i++) {
      const m = i * 8;
      faceColor(meta[m], meta[m + 1], meta[m + 2], meta[m + 3], season, tmp);
      const shade = FACE_SHADE[meta[m + 1]];
      for (let k = 0; k < 4; k++) {
        const s = shade * AO_CURVE[meta[m + 4 + k]];
        const o = (i * 4 + k) * 3;
        colors[o] = tmp.r * s; colors[o + 1] = tmp.g * s; colors[o + 2] = tmp.b * s;
      }
    }
    colorAttr.needsUpdate = true;
  }
  return { geometry, recolor, faces: meta.length / 8 };
}

export const filters = {
  world: (t) => t !== T.WATER && t !== T.TLOG && t !== T.TLEAF,
  water: (t) => t === T.WATER,
  trunk: (t) => t === T.TLOG,
  leaves: (t) => t === T.TLEAF,
};
