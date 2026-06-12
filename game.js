/* ========================================================================
   クラフトワールド — Minecraft風ボクセルゲーム
   無限地形生成 / 破壊・設置 / 物理 / 昼夜サイクル / localStorage保存
   ======================================================================== */
'use strict';

/* ===================== 定数 ===================== */
const CS = 16;            // チャンクサイズ
const MAXY = 80;          // 世界の高さ
const WATER = 24;         // 海面の高さ
const RD = 4;             // 描画距離（チャンク）
const GRAVITY = 28;
const JUMP_V = 9.2;
const WALK_SPEED = 5.6;
const FLY_SPEED = 12;
const REACH = 6.5;        // ブロックに届く距離
const DAY_LENGTH = 480;   // 昼夜1周（秒）

// タッチ端末判定（主入力が指＝スマホ・タブレット）
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
if (isTouch) document.body.classList.add('touch');

/* ===================== シード・乱数・ノイズ ===================== */
let seed = parseFloat(localStorage.getItem('mc_seed'));
if (!seed) {
  seed = Math.floor(Math.random() * 1e6) + 1;
  localStorage.setItem('mc_seed', seed);
}

function rand2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 13.7) * 43758.5453123;
  return n - Math.floor(n);
}

function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = rand2(xi, zi), b = rand2(xi + 1, zi);
  const c = rand2(xi, zi + 1), d = rand2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/* ===================== ブロック定義 ===================== */
// タイル番号（4x4アトラス）: 0草上 1草横 2土 3石 4砂 5水 6原木横 7原木上
//                            8葉 9木材 10ガラス 11レンガ 12岩盤 13丸石
const BLOCKS = {
  1:  { name: '草ブロック', top: 0, bottom: 2, side: 1 },
  2:  { name: '土',        all: 2 },
  3:  { name: '石',        all: 3 },
  4:  { name: '砂',        all: 4 },
  5:  { name: '水',        all: 5, trans: true, fluid: true },
  6:  { name: '原木',      top: 7, bottom: 7, side: 6 },
  7:  { name: '葉',        all: 8, trans: true },
  8:  { name: '木材',      all: 9 },
  9:  { name: 'ガラス',    all: 10, trans: true },
  10: { name: 'レンガ',    all: 11 },
  11: { name: '岩盤',      all: 12 },
  12: { name: '丸石',      all: 13 },
  13: { name: '作業台',    top: 14, bottom: 9, side: 15 },
};
const TRANS = new Set([5, 7, 9]);

/* ----- アイテム（非ブロック、ID100以降） ----- */
const ITEMS = {
  100: { name: '棒' },
  101: { name: '木の剣', dmg: 3 },
  102: { name: '石の剣', dmg: 5 },
};
function nameOf(id) { return id >= 100 ? ITEMS[id].name : BLOCKS[id].name; }

// 破壊時のドロップ（未定義=ブロック自身、0=なし）
const DROPS = { 1: 2, 3: 12, 7: 0, 11: 0 };
function dropOf(id) { const d = DROPS[id]; return d === undefined ? id : d; }

/* ----- クラフトレシピ（形合わせ・0=空マス） ----- */
const RECIPES = [
  { p: [[6]],               out: { id: 8,   n: 4 } }, // 原木 → 木材×4
  { p: [[8], [8]],          out: { id: 100, n: 4 } }, // 木材を縦2 → 棒×4
  { p: [[8, 8], [8, 8]],    out: { id: 13,  n: 1 } }, // 木材2×2 → 作業台
  { p: [[8], [8], [100]],   out: { id: 101, n: 1 } }, // 木の剣（要作業台）
  { p: [[12], [12], [100]], out: { id: 102, n: 1 } }, // 石の剣（要作業台）
];

function tileFor(id, dy) {
  const b = BLOCKS[id];
  if (b.all !== undefined) return b.all;
  return dy === 1 ? b.top : dy === -1 ? b.bottom : b.side;
}
function isSolid(id) { return id !== 0 && id !== 5; }

/* ===================== テクスチャアトラス（手描き生成） ===================== */
const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = 64; atlasCanvas.height = 64;
(function makeAtlas() {
  const ctx = atlasCanvas.getContext('2d');

  function noiseTile(t, r, g, b, vary, alpha) {
    const tx = (t % 4) * 16, ty = ((t / 4) | 0) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = 1 + (Math.random() * 2 - 1) * vary;
      ctx.fillStyle = `rgba(${(r*v)|0},${(g*v)|0},${(b*v)|0},${alpha===undefined?1:alpha})`;
      ctx.fillRect(tx + x, ty + y, 1, 1);
    }
  }
  function over(t, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect((t % 4) * 16 + x, ((t / 4) | 0) * 16 + y, w, h);
  }

  noiseTile(0, 106, 170, 64, .13);                 // 0 草（上面）
  noiseTile(1, 134, 96, 67, .15);                  // 1 草（側面）= 土ベース
  for (let x = 0; x < 16; x++) {                   //   上端に草のフチ
    const d = 3 + ((Math.random() * 2) | 0);
    for (let y = 0; y < d; y++) {
      const v = 1 + (Math.random() * 2 - 1) * .15;
      ctx.fillStyle = `rgb(${(100*v)|0},${(160*v)|0},${(60*v)|0})`;
      ctx.fillRect(16 + x, y, 1, 1);
    }
  }
  noiseTile(2, 134, 96, 67, .15);                  // 2 土
  noiseTile(3, 127, 127, 127, .10);                // 3 石
  noiseTile(4, 219, 207, 163, .07);                // 4 砂
  noiseTile(5, 52, 95, 200, .10, .72);             // 5 水
  for (let i = 0; i < 10; i++)                     //   さざ波
    over(5, (Math.random()*13)|0, (Math.random()*15)|0, 3, 1, 'rgba(140,180,255,.5)');
  noiseTile(6, 104, 82, 49, .12);                  // 6 原木（側面）
  for (const x of [2, 6, 11, 14])                  //   樹皮の縦線
    over(6, x, 0, 1, 16, 'rgba(40,28,12,.45)');
  noiseTile(7, 104, 82, 49, .10);                  // 7 原木（切り口）
  over(7, 3, 3, 10, 10, '#b08d57');
  over(7, 5, 5, 6, 6, '#9a7846');
  over(7, 7, 7, 2, 2, '#7a5c33');
  noiseTile(8, 58, 124, 40, .22);                  // 8 葉
  const lctx = ctx;
  for (let i = 0; i < 22; i++)                     //   透かし穴
    lctx.clearRect(32 + ((Math.random()*16)|0), ((Math.random()*16)|0), 1, 1);
  noiseTile(9, 160, 130, 80, .07);                 // 9 木材
  for (const y of [3, 7, 11, 15])
    over(9, 0, y, 16, 1, 'rgba(60,42,20,.5)');
  // 10 ガラス
  ctx.clearRect(32, 32, 16, 16);
  over(10, 0, 0, 16, 1, 'rgba(210,230,250,.9)'); over(10, 0, 15, 16, 1, 'rgba(210,230,250,.9)');
  over(10, 0, 0, 1, 16, 'rgba(210,230,250,.9)'); over(10, 15, 0, 1, 16, 'rgba(210,230,250,.9)');
  for (let i = 0; i < 5; i++)
    over(10, 3 + i, 8 - i, 1, 1, 'rgba(230,240,255,.65)');
  noiseTile(11, 150, 75, 62, .10);                 // 11 レンガ
  for (const y of [0, 4, 8, 12])
    over(11, 0, y, 16, 1, 'rgba(200,195,185,.85)');
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 4 : 10;
    over(11, off, row * 4, 1, 4, 'rgba(200,195,185,.85)');
  }
  noiseTile(12, 58, 58, 58, .30);                  // 12 岩盤
  noiseTile(13, 110, 110, 110, .22);               // 13 丸石
  for (let i = 0; i < 7; i++)
    over(13, (Math.random()*12)|0, 48 % 16 + ((Math.random()*12)|0) - 48 % 16, 3, 3, 'rgba(70,70,70,.4)');
  noiseTile(14, 160, 130, 80, .07);                // 14 作業台（上面）
  over(14, 0, 0, 16, 2, 'rgba(90,60,30,.8)'); over(14, 0, 14, 16, 2, 'rgba(90,60,30,.8)');
  over(14, 0, 0, 2, 16, 'rgba(90,60,30,.8)'); over(14, 14, 0, 2, 16, 'rgba(90,60,30,.8)');
  over(14, 5, 5, 6, 6, 'rgba(210,180,130,.55)');
  noiseTile(15, 150, 118, 70, .08);                // 15 作業台（側面）
  over(15, 0, 0, 16, 2, 'rgba(90,60,30,.8)');
  over(15, 2, 4, 4, 5, 'rgba(70,45,20,.75)');      // 工具の影
  over(15, 10, 4, 4, 5, 'rgba(70,45,20,.75)');
})();

/* ===================== 地形生成 ===================== */
const colCache = new Map();
function column(x, z) {
  const k = x + ',' + z;
  let c = colCache.get(k);
  if (c) return c;
  if (colCache.size > 150000) colCache.clear();
  const n1 = noise2(x * 0.012, z * 0.012);
  const n2 = noise2(x * 0.05 + 100, z * 0.05 + 100);
  const n3 = noise2(x * 0.16 + 200, z * 0.16 + 200);
  let h = Math.floor(14 + n1 * n1 * 32 + n2 * 8 + n3 * 3);
  if (h < 2) h = 2;
  if (h > MAXY - 12) h = MAXY - 12;
  let tree = false, th = 0;
  if (h > WATER + 1 && rand2(x * 3.31 + 777, z * 3.31 - 777) < 0.02) {
    tree = true;
    th = 4 + ((rand2(x + 55, z + 99) * 2) | 0);
  }
  c = { h, tree, th, leafTop: undefined };
  colCache.set(k, c);
  return c;
}

function genBlock(x, y, z) {
  if (y < 0 || y >= MAXY) return 0;
  if (y === 0) return 11; // 岩盤
  const c = column(x, z), h = c.h;
  if (y <= h) {
    if (y === h) return h <= WATER + 1 ? 4 : 1;
    if (y >= h - 3) return h <= WATER + 1 ? 4 : 2;
    return 3;
  }
  // 幹
  if (c.tree && y <= h + c.th) return 6;
  // 葉（近傍5x5の木から）
  if (c.leafTop === undefined) {
    let lt = -1;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const cc = column(x + dx, z + dz);
      if (cc.tree) lt = Math.max(lt, cc.h + cc.th + 2);
    }
    c.leafTop = lt;
  }
  if (y <= c.leafTop) {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const cc = column(x + dx, z + dz);
      if (!cc.tree) continue;
      const ty = cc.h + cc.th;
      const ax = Math.abs(dx), az = Math.abs(dz);
      const ad = Math.max(ax, az);
      if (y === ty - 1 || y === ty) {
        if (ad <= 2 && !(ax === 2 && az === 2 && rand2(x + y * 7, z - y * 7) < 0.5)) return 7;
      } else if (y === ty + 1) {
        if (ad <= 1) return 7;
      } else if (y === ty + 2) {
        if (ax + az <= 1) return 7;
      }
    }
  }
  if (y <= WATER) return 5;
  return 0;
}

/* ===================== ワールド（編集差分 + 生成） ===================== */
const edits = new Map();
let maxEditY = 0;
try {
  const saved = JSON.parse(localStorage.getItem('mc_edits') || '[]');
  for (const [k, v] of saved) {
    edits.set(k, v);
    const y = parseInt(k.split(',')[1], 10);
    if (y > maxEditY) maxEditY = y;
  }
} catch (e) { /* 破損データは無視 */ }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('mc_edits', JSON.stringify([...edits])); } catch (e) {}
  }, 800);
}

function getBlock(x, y, z) {
  const e = edits.get(x + ',' + y + ',' + z);
  if (e !== undefined) return e;
  return genBlock(x, y, z);
}

function setBlock(x, y, z, id) {
  if (y < 1 || y >= MAXY) return;
  edits.set(x + ',' + y + ',' + z, id);
  if (y > maxEditY) maxEditY = y;
  scheduleSave();
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  buildChunk(cx, cz);
  const lx = x - cx * CS, lz = z - cz * CS;
  if (lx === 0) buildChunk(cx - 1, cz);
  if (lx === CS - 1) buildChunk(cx + 1, cz);
  if (lz === 0) buildChunk(cx, cz - 1);
  if (lz === CS - 1) buildChunk(cx, cz + 1);
}

/* ===================== Three.js セットアップ ===================== */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 320);
camera.rotation.order = 'YXZ';
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.id = 'game';
document.body.appendChild(renderer.domElement);

const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestFilter;
atlasTex.generateMipmaps = false;

const matOpaque = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true });
const matTrans = new THREE.MeshBasicMaterial({
  map: atlasTex, vertexColors: true, transparent: true,
  alphaTest: 0.08, side: THREE.DoubleSide,
});

scene.fog = new THREE.Fog(0x87ceeb, RD * CS * 0.55, RD * CS * 0.95);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ===================== チャンクメッシュ生成 ===================== */
// 面定義: dir / 4頂点 / 明るさ
const FACES = [
  { dir: [-1, 0, 0], shade: 0.62, corners: [
    { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [1, 0, 0], shade: 0.62, corners: [
    { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [0, -1, 0], shade: 0.48, corners: [
    { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { dir: [0, 1, 0], shade: 1.0, corners: [
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { dir: [0, 0, -1], shade: 0.8, corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
    { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { dir: [0, 0, 1], shade: 0.8, corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
    { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];

function pushFace(buf, face, x, y, z, tile, shadeMul) {
  const base = buf.pos.length / 3;
  const col = tile % 4, row = (tile / 4) | 0;
  for (const c of face.corners) {
    buf.pos.push(x + c.pos[0], y + c.pos[1], z + c.pos[2]);
    buf.uv.push((col + c.uv[0]) / 4, 1 - (row + 1 - c.uv[1]) / 4);
    const s = face.shade * (shadeMul === undefined ? 1 : shadeMul);
    buf.col.push(s, s, s);
  }
  buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
}

const chunks = new Map(); // 'cx,cz' -> { meshes: [] }

function disposeChunk(ch) {
  for (const m of ch.meshes) {
    scene.remove(m);
    m.geometry.dispose();
  }
  ch.meshes.length = 0;
}

function makeMesh(buf, mat) {
  if (buf.idx.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  g.setIndex(buf.idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  scene.add(m);
  return m;
}

function buildChunk(cx, cz) {
  const key = cx + ',' + cz;
  let ch = chunks.get(key);
  if (ch) disposeChunk(ch);
  else { ch = { meshes: [] }; chunks.set(key, ch); }

  const opq = { pos: [], uv: [], col: [], idx: [] };
  const trn = { pos: [], uv: [], col: [], idx: [] };

  for (let lx = 0; lx < CS; lx++) for (let lz = 0; lz < CS; lz++) {
    const wx = cx * CS + lx, wz = cz * CS + lz;
    const c = column(wx, wz);
    const yTop = Math.min(MAXY, Math.max(c.h + 14, WATER + 2, maxEditY + 2));
    for (let y = 0; y < yTop; y++) {
      const id = getBlock(wx, y, wz);
      if (id === 0) continue;
      const isTrans = TRANS.has(id);
      for (const face of FACES) {
        const n = getBlock(wx + face.dir[0], y + face.dir[1], wz + face.dir[2]);
        let visible;
        if (isTrans) visible = n === 0 || (TRANS.has(n) && n !== id);
        else visible = n === 0 || TRANS.has(n);
        if (!visible) continue;
        const tile = tileFor(id, face.dir[1]);
        pushFace(isTrans ? trn : opq, face, wx, y, wz, tile);
      }
    }
  }
  const m1 = makeMesh(opq, matOpaque);
  const m2 = makeMesh(trn, matTrans);
  if (m1) ch.meshes.push(m1);
  if (m2) ch.meshes.push(m2);
}

/* ----- チャンクの読み込み・破棄 ----- */
let buildQueue = [];
let lastPCX = null, lastPCZ = null;

function refreshChunks(pcx, pcz) {
  buildQueue = [];
  for (let dx = -RD; dx <= RD; dx++) for (let dz = -RD; dz <= RD; dz++) {
    const cx = pcx + dx, cz = pcz + dz;
    if (!chunks.has(cx + ',' + cz)) buildQueue.push([cx, cz, dx * dx + dz * dz]);
  }
  buildQueue.sort((a, b) => a[2] - b[2]);
  // 遠いチャンクを破棄
  for (const [key, ch] of chunks) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > RD + 1) {
      disposeChunk(ch);
      chunks.delete(key);
    }
  }
}

function updateChunks() {
  const pcx = Math.floor(player.pos.x / CS), pcz = Math.floor(player.pos.z / CS);
  if (pcx !== lastPCX || pcz !== lastPCZ) {
    lastPCX = pcx; lastPCZ = pcz;
    refreshChunks(pcx, pcz);
  }
  let n = 0;
  while (buildQueue.length && n < 2) {
    const [cx, cz] = buildQueue.shift();
    if (!chunks.has(cx + ',' + cz)) { buildChunk(cx, cz); n++; }
  }
}

/* ===================== プレイヤー ===================== */
const player = {
  pos: new THREE.Vector3(8.5, 0, 8.5),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  onGround: false,
  fly: false,
  sel: 0,
};
player.pos.y = column(8, 8).h + 2;

function collides(px, py, pz) {
  const x0 = Math.floor(px - 0.3), x1 = Math.floor(px + 0.3);
  const y0 = Math.floor(py), y1 = Math.floor(py + 1.79);
  const z0 = Math.floor(pz - 0.3), z1 = Math.floor(pz + 0.3);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        if (isSolid(getBlock(x, y, z))) return true;
  return false;
}

function moveAxis(axis, d) {
  if (d === 0) return;
  const step = 0.05;
  const n = Math.ceil(Math.abs(d) / step);
  const inc = d / n;
  for (let i = 0; i < n; i++) {
    player.pos[axis] += inc;
    if (collides(player.pos.x, player.pos.y, player.pos.z)) {
      player.pos[axis] -= inc;
      if (axis === 'y') {
        if (d < 0) player.onGround = true;
        player.vel.y = 0;
      }
      return;
    }
  }
}

const keys = new Set();
const joy = { id: null, x: 0, y: 0 };   // バーチャルパッド入力（-1〜1）
const look = { id: null, x: 0, y: 0 };  // 視点ドラッグ中のタッチ
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF' && playing()) {
    player.fly = !player.fly;
    player.vel.y = 0;
  }
  if (/^Digit[1-9]$/.test(e.code)) selectSlot(parseInt(e.code.slice(5), 10) - 1);
  if (e.code === 'KeyE') {
    if (invOpen) closeInventory(true);
    else if (playing()) openInventory(false);
  }
  if (e.code === 'Escape' && invOpen) {
    closeInventory(false);
    if (!isTouch) setUIVisible(false);
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function inWater() {
  return getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.4), Math.floor(player.pos.z)) === 5;
}
function eyeInWater() {
  return getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 1.62), Math.floor(player.pos.z)) === 5;
}

function physics(dt) {
  const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw), rightZ = -Math.sin(player.yaw);
  let mx = 0, mz = 0;
  if (keys.has('KeyW')) { mx += fwdX; mz += fwdZ; }
  if (keys.has('KeyS')) { mx -= fwdX; mz -= fwdZ; }
  if (keys.has('KeyD')) { mx += rightX; mz += rightZ; }
  if (keys.has('KeyA')) { mx -= rightX; mz -= rightZ; }
  if (joy.x !== 0 || joy.y !== 0) {
    mx += fwdX * -joy.y + rightX * joy.x;
    mz += fwdZ * -joy.y + rightZ * joy.x;
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }

  const water = inWater();
  let speed = player.fly ? FLY_SPEED : WALK_SPEED;
  if (!player.fly && keys.has('ShiftLeft')) speed *= 0.45;
  if (water && !player.fly) speed *= 0.55;

  if (player.fly) {
    player.vel.y = 0;
    if (keys.has('Space')) player.vel.y = FLY_SPEED * 0.8;
    if (keys.has('ShiftLeft')) player.vel.y = -FLY_SPEED * 0.8;
  } else if (water) {
    player.vel.y -= GRAVITY * 0.18 * dt;
    if (player.vel.y < -3) player.vel.y = -3;
    if (keys.has('Space')) player.vel.y = 4;
  } else {
    player.vel.y -= GRAVITY * dt;
    if (player.vel.y < -50) player.vel.y = -50;
    if (keys.has('Space') && player.onGround) {
      player.vel.y = JUMP_V;
      player.onGround = false;
    }
  }

  player.onGround = false;
  moveAxis('x', mx * speed * dt);
  moveAxis('z', mz * speed * dt);
  moveAxis('y', player.vel.y * dt);

  // 奈落セーフティ
  if (player.pos.y < -20) {
    player.pos.y = column(Math.floor(player.pos.x), Math.floor(player.pos.z)).h + 3;
    player.vel.y = 0;
  }

  camera.position.set(player.pos.x, player.pos.y + 1.62, player.pos.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

/* ===================== マウス・ポインターロック ===================== */
const overlay = document.getElementById('overlay');
let touchPlaying = false; // スマホはポインターロックを使わない
let hintShown = false;
function locked() { return document.pointerLockElement === renderer.domElement; }
function playing() { return !invOpen && (locked() || (isTouch && touchPlaying)); }

function setUIVisible(on) {
  overlay.style.display = on ? 'none' : 'flex';
  document.getElementById('crosshair').style.display = on ? 'block' : 'none';
  document.getElementById('hotbar').style.display = on ? 'flex' : 'none';
  document.getElementById('hud').style.display = on ? 'block' : 'none';
  document.getElementById('hearts').style.display = on ? 'block' : 'none';
  document.getElementById('touchUI').style.display = (on && isTouch) ? 'block' : 'none';
  if (!on) { keys.clear(); stopMining(); }
  if (on && !hintShown) {
    hintShown = true;
    if (inv.every(s => !s)) showMsg('🌳 まずは木を殴って原木を集めよう！');
  }
}

document.getElementById('playBtn').addEventListener('click', () => {
  if (isTouch) {
    touchPlaying = true;
    setUIVisible(true);
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
  } else {
    renderer.domElement.requestPointerLock();
  }
});
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('現在の世界を削除して新しい世界を生成しますか？')) {
    localStorage.removeItem('mc_seed');
    localStorage.removeItem('mc_edits');
    location.reload();
  }
});

document.addEventListener('pointerlockchange', () => {
  if (invOpen) return; // インベントリを開くためのロック解除ではメニューを出さない
  setUIVisible(locked());
});

addEventListener('mousemove', e => {
  if (!locked()) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
});

/* ===================== レイキャスト・破壊・設置 ===================== */
const _dir = new THREE.Vector3();
function raycast() {
  camera.getWorldDirection(_dir);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  let px = null, py = null, pz = null;
  for (let t = 0; t < REACH; t += 0.04) {
    const x = Math.floor(ox + _dir.x * t);
    const y = Math.floor(oy + _dir.y * t);
    const z = Math.floor(oz + _dir.z * t);
    if (x === px && y === py && z === pz) continue;
    const id = getBlock(x, y, z);
    if (id !== 0 && id !== 5) {
      return { x, y, z, id, px, py, pz, t };
    }
    px = x; py = y; pz = z;
  }
  return null;
}

function blockIntersectsPlayer(bx, by, bz) {
  return bx + 1 > player.pos.x - 0.3 && bx < player.pos.x + 0.3 &&
         by + 1 > player.pos.y && by < player.pos.y + 1.8 &&
         bz + 1 > player.pos.z - 0.3 && bz < player.pos.z + 0.3;
}

function doBreak() {
  if (invOpen) return;
  // モブが照準上にいれば攻撃を優先
  const m = raycastMob();
  if (m) { hitMob(m); return; }
  const hit = raycast();
  if (!hit || hit.id === 11) return; // 岩盤は壊せない
  setBlock(hit.x, hit.y, hit.z, 0);
  const d = dropOf(hit.id);
  if (d) give(d, 1); // ドロップを持ち物へ
  sfx(170, 55, 0.12, 'square', 0.12);
}

function doPlace() {
  if (invOpen) return;
  const hit = raycast();
  if (!hit) return;
  if (hit.id === 13) { openInventory(true); return; } // 作業台を開く
  if (hit.px === null) return;
  const s = inv[player.sel];
  if (!s || s.id >= 100) return; // ブロックだけ設置できる
  const cur = getBlock(hit.px, hit.py, hit.pz);
  if (cur !== 0 && cur !== 5) return;
  if (blockIntersectsPlayer(hit.px, hit.py, hit.pz)) return;
  setBlock(hit.px, hit.py, hit.pz, s.id);
  s.n--;
  if (s.n <= 0) inv[player.sel] = null;
  slotsChanged();
  sfx(95, 150, 0.07, 'sine', 0.14);
}

function doPick() {
  const hit = raycast();
  if (!hit) return;
  for (let i = 0; i < 9; i++)
    if (inv[i] && inv[i].id === hit.id) { selectSlot(i); return; }
}

let mineTimer = null;
function stopMining() { clearInterval(mineTimer); mineTimer = null; }

addEventListener('mousedown', e => {
  if (!locked()) return;
  if (e.button === 0) {
    doBreak();
    stopMining();
    mineTimer = setInterval(doBreak, 240);
  } else if (e.button === 2) {
    doPlace();
    stopMining();
    mineTimer = setInterval(doPlace, 240);
  } else if (e.button === 1) {
    e.preventDefault();
    doPick();
  }
});
addEventListener('mouseup', stopMining);
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => {
  if (!locked()) return;
  selectSlot((player.sel + (e.deltaY > 0 ? 1 : -1) + 9) % 9);
});

/* ----- ターゲットのハイライト枠 ----- */
const hlGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
const hlBox = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({ color: 0x111111 }));
hlBox.visible = false;
scene.add(hlBox);

function updateHighlight() {
  const hit = playing() ? raycast() : null;
  if (hit) {
    hlBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    hlBox.visible = true;
  } else {
    hlBox.visible = false;
  }
}

/* ===================== 手持ちブロック表示 ===================== */
let heldMesh = null, heldShownId = -1;
function updateHeld() {
  const s = inv[player.sel];
  const id = s ? s.id : 0;
  heldShownId = id;
  if (heldMesh) {
    camera.remove(heldMesh);
    heldMesh.geometry.dispose();
    if (heldMesh.userData.ownMat) heldMesh.material.dispose();
    heldMesh = null;
  }
  if (!id) return;
  if (id < 100) {
    // ブロック：ミニキューブ
    const buf = { pos: [], uv: [], col: [], idx: [] };
    for (const face of FACES) {
      pushFace(buf, face, -0.5, -0.5, -0.5, tileFor(id, face.dir[1]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    g.setIndex(buf.idx);
    heldMesh = new THREE.Mesh(g, TRANS.has(id) ? matTrans : matOpaque);
    heldMesh.scale.setScalar(0.34);
    heldMesh.position.set(0.42, -0.38, -0.65);
    heldMesh.rotation.set(0.1, Math.PI / 5, 0);
  } else {
    // 道具：ドット絵スプライト
    const g = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: itemTexture(id), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide,
    });
    heldMesh = new THREE.Mesh(g, mat);
    heldMesh.userData.ownMat = true;
    heldMesh.scale.setScalar(0.55);
    heldMesh.position.set(0.45, -0.32, -0.62);
    heldMesh.rotation.set(0, -0.5, 0.5);
  }
  camera.add(heldMesh);
}

/* ===================== インベントリ＆クラフト ===================== */
const hotbarEl = document.getElementById('hotbar');
const itemnameEl = document.getElementById('itemname');
let nameTimer = null;

/* ----- アイテムのドット絵アイコン ----- */
const itemIconCache = {};
function itemCanvas(id) {
  if (itemIconCache[id]) return itemIconCache[id];
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const c = cv.getContext('2d');
  const px = (x, y, col) => { c.fillStyle = col; c.fillRect(x, y, 1, 1); };
  if (id === 100) { // 棒
    for (let i = 0; i < 9; i++) { px(4 + i, 11 - i, '#8a6432'); px(5 + i, 11 - i, '#6e4f26'); }
  } else if (id === 101 || id === 102) { // 剣
    const blade = id === 101 ? '#c8a05a' : '#9a9a9a';
    const edge = id === 101 ? '#e6c47e' : '#c8c8c8';
    for (let i = 0; i < 8; i++) { px(6 + i, 9 - i, blade); px(7 + i, 9 - i, edge); }
    px(5, 11, '#332211'); px(6, 10, '#332211'); px(7, 11, '#332211'); px(6, 12, '#332211'); // つば
    px(4, 12, '#6e4f26'); px(3, 13, '#6e4f26'); px(2, 14, '#55401e');                       // 柄
  }
  itemIconCache[id] = cv;
  return cv;
}
const itemTexCache = {};
function itemTexture(id) {
  if (!itemTexCache[id]) {
    const t = new THREE.CanvasTexture(itemCanvas(id));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    itemTexCache[id] = t;
  }
  return itemTexCache[id];
}
function drawIcon(c2, id) {
  c2.clearRect(0, 0, 32, 32);
  if (!id) return;
  c2.imageSmoothingEnabled = false;
  if (id < 100) {
    const tile = tileFor(id, 0);
    c2.drawImage(atlasCanvas, (tile % 4) * 16, ((tile / 4) | 0) * 16, 16, 16, 0, 0, 32, 32);
  } else {
    c2.drawImage(itemCanvas(id), 0, 0, 32, 32);
  }
}

/* ----- 持ち物（0〜8がホットバー、9〜26がカバン） ----- */
const INV_SIZE = 27;
const inv = new Array(INV_SIZE).fill(null);
try {
  const si = JSON.parse(localStorage.getItem('mc_inv') || 'null');
  if (si) si.forEach((v, i) => { if (v && i < INV_SIZE) inv[i] = { id: v[0], n: v[1] }; });
} catch (e) {}

let invSaveT = null;
function saveInvSoon() {
  clearTimeout(invSaveT);
  invSaveT = setTimeout(() => {
    try { localStorage.setItem('mc_inv', JSON.stringify(inv.map(s => s ? [s.id, s.n] : 0))); } catch (e) {}
  }, 600);
}

function slotsChanged() {
  updateHotbarUI();
  if (invOpen) renderInv();
  saveInvSoon();
}

function canHold(id, n) {
  let space = 0;
  for (const s of inv) {
    if (!s) space += 64;
    else if (s.id === id) space += 64 - s.n;
    if (space >= n) return true;
  }
  return false;
}

function give(id, n) {
  let left = n;
  for (let i = 0; i < INV_SIZE && left > 0; i++) {
    const s = inv[i];
    if (s && s.id === id && s.n < 64) { const a = Math.min(64 - s.n, left); s.n += a; left -= a; }
  }
  for (let i = 0; i < INV_SIZE && left > 0; i++) {
    if (!inv[i]) { const a = Math.min(64, left); inv[i] = { id, n: a }; left -= a; }
  }
  if (left > 0) showMsg('⚠ 持ち物がいっぱい！');
  slotsChanged();
}

/* ----- ホットバーUI ----- */
(function buildHotbarUI() {
  for (let i = 0; i < 9; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    slot.appendChild(num);
    slot.appendChild(cv);
    slot.appendChild(cnt);
    slot.addEventListener('pointerdown', e => {
      if (!isTouch) return;
      e.preventDefault();
      selectSlot(i);
    });
    hotbarEl.appendChild(slot);
  }
})();

function updateHotbarUI() {
  for (let i = 0; i < 9; i++) {
    const el = hotbarEl.children[i];
    const s = inv[i];
    drawIcon(el.querySelector('canvas').getContext('2d'), s ? s.id : 0);
    el.querySelector('.cnt').textContent = s && s.n > 1 ? s.n : '';
  }
  const cur = inv[player.sel];
  if ((cur ? cur.id : 0) !== heldShownId) updateHeld();
}

function selectSlot(i) {
  player.sel = i;
  [...hotbarEl.children].forEach((el, j) => el.classList.toggle('sel', j === i));
  updateHeld();
  const s = inv[i];
  if (s) showMsg(nameOf(s.id));
}

/* ----- インベントリ／クラフト画面 ----- */
let invOpen = false, craftSize = 2, curRecipe = null, selPick = null;
const craft = new Array(9).fill(null); // 3×3固定、2×2時は左上の4マスだけ使う
const invScreen = document.getElementById('invScreen');
const craftGridEl = document.getElementById('craftGrid');
const bagGridEl = document.getElementById('bagGrid');
const hotGridEl = document.getElementById('hotGrid');
const resultEl = document.getElementById('craftResult');

function makeISlot(onTap) {
  const d = document.createElement('div');
  d.className = 'islot';
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32;
  const cnt = document.createElement('span');
  cnt.className = 'cnt';
  d.appendChild(cv);
  d.appendChild(cnt);
  d.addEventListener('pointerdown', e => { e.preventDefault(); onTap(); });
  return d;
}
for (let i = 0; i < 9; i++) craftGridEl.appendChild(makeISlot(() => slotTap({ arr: 'craft', idx: i })));
for (let i = 9; i < 27; i++) {
  const idx = i;
  bagGridEl.appendChild(makeISlot(() => slotTap({ arr: 'inv', idx })));
}
for (let i = 0; i < 9; i++) {
  const idx = i;
  hotGridEl.appendChild(makeISlot(() => slotTap({ arr: 'inv', idx })));
}
resultEl.addEventListener('pointerdown', e => { e.preventDefault(); craftOnce(); });
document.getElementById('invClose').addEventListener('pointerdown', e => { e.preventDefault(); closeInventory(true); });

function getSlotRef(p) { return p.arr === 'inv' ? inv[p.idx] : craft[p.idx]; }
function setSlotRef(p, v) { if (p.arr === 'inv') inv[p.idx] = v; else craft[p.idx] = v; }

function slotTap(p) {
  if (selPick === null) {
    if (getSlotRef(p)) selPick = p;
  } else if (selPick.arr === p.arr && selPick.idx === p.idx) {
    selPick = null; // 同じ場所をタップで選択解除
  } else {
    const a = getSlotRef(selPick), b = getSlotRef(p);
    if (a && b && a.id === b.id) { // 同じアイテムは合体
      const add = Math.min(64 - b.n, a.n);
      b.n += add; a.n -= add;
      if (a.n <= 0) setSlotRef(selPick, null);
    } else { // 入れ替え
      setSlotRef(p, a);
      setSlotRef(selPick, b);
    }
    selPick = null;
    saveInvSoon();
  }
  updateHotbarUI();
  renderInv();
}

function gridMatrix() {
  const g = [];
  for (let r = 0; r < craftSize; r++) {
    const row = [];
    for (let c = 0; c < craftSize; c++) {
      const s = craft[r * 3 + c];
      row.push(s ? s.id : 0);
    }
    g.push(row);
  }
  return g;
}
function trimG(g) {
  let r0 = 99, r1 = -1, c0 = 99, c1 = -1;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++)
    if (g[r][c]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
  if (r1 < 0) return null;
  const out = [];
  for (let r = r0; r <= r1; r++) {
    const row = [];
    for (let c = c0; c <= c1; c++) row.push(g[r][c]);
    out.push(row);
  }
  return out;
}
function findRecipe() {
  const t = trimG(gridMatrix());
  if (!t) return null;
  outer: for (const R of RECIPES) {
    if (R.p.length !== t.length || R.p[0].length !== t[0].length) continue;
    for (let r = 0; r < t.length; r++)
      for (let c = 0; c < t[0].length; c++)
        if (R.p[r][c] !== t[r][c]) continue outer;
    return R;
  }
  return null;
}

function craftOnce() {
  if (!curRecipe) return;
  if (!canHold(curRecipe.out.id, curRecipe.out.n)) { showMsg('⚠ 持ち物がいっぱい！'); return; }
  for (let i = 0; i < 9; i++) {
    if (craft[i]) {
      craft[i].n--;
      if (craft[i].n <= 0) craft[i] = null;
    }
  }
  give(curRecipe.out.id, curRecipe.out.n);
  showMsg(nameOf(curRecipe.out.id) + ' をクラフトした！');
  sfx(300, 480, 0.1, 'sine', 0.12);
  renderInv();
}

function renderInv() {
  for (let i = 0; i < 9; i++) {
    const el = craftGridEl.children[i];
    const r = (i / 3) | 0, c = i % 3;
    el.style.display = (r < craftSize && c < craftSize) ? 'flex' : 'none';
    const s = craft[i];
    drawIcon(el.querySelector('canvas').getContext('2d'), s ? s.id : 0);
    el.querySelector('.cnt').textContent = s && s.n > 1 ? s.n : '';
    el.classList.toggle('sel2', selPick !== null && selPick.arr === 'craft' && selPick.idx === i);
  }
  const cells = [...bagGridEl.children, ...hotGridEl.children];
  for (let k = 0; k < cells.length; k++) {
    const idx = k < 18 ? k + 9 : k - 18;
    const el = cells[k];
    const s = inv[idx];
    drawIcon(el.querySelector('canvas').getContext('2d'), s ? s.id : 0);
    el.querySelector('.cnt').textContent = s && s.n > 1 ? s.n : '';
    el.classList.toggle('sel2', selPick !== null && selPick.arr === 'inv' && selPick.idx === idx);
  }
  curRecipe = findRecipe();
  drawIcon(resultEl.querySelector('canvas').getContext('2d'), curRecipe ? curRecipe.out.id : 0);
  resultEl.querySelector('.cnt').textContent = curRecipe && curRecipe.out.n > 1 ? curRecipe.out.n : '';
}

function openInventory(table) {
  if (invOpen) return;
  invOpen = true;
  craftSize = table ? 3 : 2;
  stopMining();
  document.getElementById('invTitle').textContent = table ? '🔨 作業台（3×3）' : '🎒 クラフト（2×2）';
  craftGridEl.classList.toggle('size2', !table);
  selPick = null;
  renderInv();
  invScreen.style.display = 'flex';
  if (isTouch) document.getElementById('touchUI').style.display = 'none';
  else if (locked()) document.exitPointerLock();
}

function closeInventory(relock) {
  if (!invOpen) return;
  // クラフト枠に残ったアイテムは持ち物へ戻す
  for (let i = 0; i < 9; i++) {
    if (craft[i]) { give(craft[i].id, craft[i].n); craft[i] = null; }
  }
  invOpen = false;
  selPick = null;
  invScreen.style.display = 'none';
  if (isTouch) {
    if (touchPlaying) document.getElementById('touchUI').style.display = 'block';
  } else if (relock) {
    renderer.domElement.requestPointerLock();
  }
  slotsChanged();
}

updateHotbarUI();
selectSlot(0);

/* ===================== 効果音 ===================== */
let audioCtx = null;
function sfx(f0, f1, dur, type, vol) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f1, audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

/* ===================== モブ（キャラクター） ===================== */
let curBright = 1; // 昼夜の明るさ（updateDayNightが更新）

const MOB_TYPES = {
  pig:      { name: 'ブタ',       hw: 0.35, hh: 1.0,  speed: 1.3, hp: 4 },
  sheep:    { name: 'ヒツジ',     hw: 0.40, hh: 1.25, speed: 1.2, hp: 4 },
  zombie:   { name: 'ゾンビ',     hw: 0.30, hh: 1.9,  speed: 1.5, hp: 6, hostile: true },
  skeleton: { name: 'スケルトン', hw: 0.30, hh: 1.9,  speed: 1.4, hp: 5, hostile: true, ranged: true },
  creeper:  { name: 'クリーパー', hw: 0.30, hh: 1.6,  speed: 1.7, hp: 5, hostile: true, creeper: true },
};
const MOBS = [];
const ANIMAL_CAP = 8, HOSTILE_CAP = 6;

/* ----- モブ用テクスチャ ----- */
function mobTex(draw) {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const c = cv.getContext('2d');
  draw(c);
  const tx = new THREE.CanvasTexture(cv);
  tx.magFilter = THREE.NearestFilter;
  tx.minFilter = THREE.NearestFilter;
  tx.generateMipmaps = false;
  return tx;
}
function texNoise(c, r, g, b, v) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const k = 1 + (Math.random() * 2 - 1) * v;
    c.fillStyle = `rgb(${(r*k)|0},${(g*k)|0},${(b*k)|0})`;
    c.fillRect(x, y, 1, 1);
  }
}
const MOB_TEX = {
  pigSkin: mobTex(c => texNoise(c, 238, 160, 160, .07)),
  pigFace: mobTex(c => {
    texNoise(c, 238, 160, 160, .07);
    c.fillStyle = '#000'; c.fillRect(3, 5, 2, 2); c.fillRect(11, 5, 2, 2); // 目
    c.fillStyle = '#e08888'; c.fillRect(5, 8, 6, 4);                       // 鼻
    c.fillStyle = '#a04848'; c.fillRect(6, 9, 1, 2); c.fillRect(9, 9, 1, 2);
  }),
  sheepWool: mobTex(c => texNoise(c, 228, 224, 216, .06)),
  sheepLeg: mobTex(c => texNoise(c, 214, 192, 158, .08)),
  sheepFace: mobTex(c => {
    texNoise(c, 214, 192, 158, .08);
    c.fillStyle = '#fff'; c.fillRect(0, 0, 16, 4);                         // 頭の毛
    c.fillStyle = '#000'; c.fillRect(3, 6, 2, 2); c.fillRect(11, 6, 2, 2); // 目
  }),
  zombieSkin: mobTex(c => texNoise(c, 96, 150, 80, .12)),
  zombieFace: mobTex(c => {
    texNoise(c, 96, 150, 80, .12);
    c.fillStyle = '#000'; c.fillRect(3, 5, 2, 2); c.fillRect(11, 5, 2, 2); // 目
    c.fillStyle = '#2a4a20'; c.fillRect(6, 10, 4, 2);                      // 口
  }),
  zombieShirt: mobTex(c => texNoise(c, 62, 118, 135, .15)),
  zombiePants: mobTex(c => texNoise(c, 70, 66, 150, .15)),
  skelSkin: mobTex(c => texNoise(c, 222, 222, 214, .06)),
  skelFace: mobTex(c => {
    texNoise(c, 222, 222, 214, .06);
    c.fillStyle = '#3a3a3a'; c.fillRect(3, 5, 3, 2); c.fillRect(10, 5, 3, 2); // 目
    c.fillStyle = '#555'; c.fillRect(5, 10, 6, 1);                            // 口
  }),
  skelBody: mobTex(c => {
    texNoise(c, 200, 200, 192, .07);
    c.fillStyle = 'rgba(70,70,64,.55)';
    for (const y of [3, 6, 9, 12]) c.fillRect(2, y, 12, 1);                   // あばら
  }),
  creeperSkin: mobTex(c => texCreeper(c)),
  creeperFace: mobTex(c => {
    texCreeper(c);
    c.fillStyle = '#000';
    c.fillRect(3, 4, 3, 3); c.fillRect(10, 4, 3, 3); // 目
    c.fillRect(6, 7, 4, 4);                          // 鼻〜口
    c.fillRect(5, 9, 2, 4); c.fillRect(9, 9, 2, 4);  // 口の端
  }),
};
function texCreeper(c) {
  const cols = ['#6dbf57', '#4e9a3d', '#86d36e', '#3e7a31'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    c.fillStyle = cols[(Math.random() * cols.length) | 0];
    c.fillRect(x, y, 1, 1);
  }
}

/* ----- 汎用AABB判定（モブ用） ----- */
function boxCollides(px, py, pz, hw, hh) {
  const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw);
  const y0 = Math.floor(py), y1 = Math.floor(py + hh - 0.01);
  const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        if (isSolid(getBlock(x, y, z))) return true;
  return false;
}

/* ----- モブ生成（箱モデル組み立て） ----- */
function spawnMob(type, x, y, z) {
  const T = MOB_TYPES[type];
  if (boxCollides(x, y, z, T.hw, T.hh)) return;
  const m = {
    type, pos: new THREE.Vector3(x, y, z),
    vy: 0, yaw: Math.random() * Math.PI * 2,
    state: 'idle', t: Math.random() * 2,
    hp: T.hp, kx: 0, kz: 0, flash: 0, hurtCd: 0,
    walkPhase: 0, onGround: false, dying: undefined,
    mats: [], legs: [], arms: [],
  };
  const g = new THREE.Group();
  const M = tex => { const mm = new THREE.MeshBasicMaterial({ map: tex }); m.mats.push(mm); return mm; };
  // faceTexありなら -z 面（正面）だけ顔テクスチャに
  const box = (w, h, d, px, py, pz, tex, faceTex) => {
    let mat;
    if (faceTex) { const s = M(tex), f = M(faceTex); mat = [s, s, s, s, s, f]; }
    else mat = M(tex);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(px, py, pz);
    g.add(mesh);
    return mesh;
  };

  if (type === 'pig') {
    box(0.62, 0.5, 1.0, 0, 0.62, 0.05, MOB_TEX.pigSkin);                      // 胴
    box(0.5, 0.5, 0.5, 0, 0.72, -0.62, MOB_TEX.pigSkin, MOB_TEX.pigFace);     // 頭
    for (const [lx, lz] of [[-0.18, -0.3], [0.18, -0.3], [-0.18, 0.32], [0.18, 0.32]])
      m.legs.push(box(0.2, 0.38, 0.2, lx, 0.19, lz, MOB_TEX.pigSkin));
  } else if (type === 'sheep') {
    box(0.72, 0.62, 1.05, 0, 0.88, 0.05, MOB_TEX.sheepWool);                  // 胴
    box(0.42, 0.42, 0.45, 0, 1.12, -0.68, MOB_TEX.sheepWool, MOB_TEX.sheepFace); // 頭
    for (const [lx, lz] of [[-0.2, -0.32], [0.2, -0.32], [-0.2, 0.36], [0.2, 0.36]])
      m.legs.push(box(0.18, 0.56, 0.18, lx, 0.28, lz, MOB_TEX.sheepLeg));
  } else if (type === 'zombie') {
    m.legs.push(box(0.24, 0.75, 0.24, -0.13, 0.375, 0, MOB_TEX.zombiePants));
    m.legs.push(box(0.24, 0.75, 0.24, 0.13, 0.375, 0, MOB_TEX.zombiePants));
    box(0.5, 0.62, 0.26, 0, 1.06, 0, MOB_TEX.zombieShirt);                    // 胴
    box(0.5, 0.5, 0.5, 0, 1.62, 0, MOB_TEX.zombieSkin, MOB_TEX.zombieFace);   // 頭
    m.arms.push(box(0.2, 0.2, 0.62, -0.35, 1.3, -0.28, MOB_TEX.zombieSkin));  // 前ならえの腕
    m.arms.push(box(0.2, 0.2, 0.62, 0.35, 1.3, -0.28, MOB_TEX.zombieSkin));
  } else if (type === 'skeleton') {
    m.legs.push(box(0.18, 0.78, 0.18, -0.12, 0.39, 0, MOB_TEX.skelSkin));
    m.legs.push(box(0.18, 0.78, 0.18, 0.12, 0.39, 0, MOB_TEX.skelSkin));
    box(0.46, 0.6, 0.22, 0, 1.08, 0, MOB_TEX.skelBody);                       // あばら胴
    box(0.46, 0.46, 0.46, 0, 1.62, 0, MOB_TEX.skelSkin, MOB_TEX.skelFace);    // 頭
    m.arms.push(box(0.14, 0.14, 0.6, -0.32, 1.28, -0.26, MOB_TEX.skelSkin));  // 細い腕
    m.arms.push(box(0.14, 0.14, 0.6, 0.32, 1.28, -0.26, MOB_TEX.skelSkin));
  } else if (type === 'creeper') {
    for (const [lx, lz] of [[-0.15, -0.2], [0.15, -0.2], [-0.15, 0.2], [0.15, 0.2]])
      m.legs.push(box(0.22, 0.3, 0.24, lx, 0.15, lz, MOB_TEX.creeperSkin));
    box(0.44, 0.76, 0.3, 0, 0.68, 0, MOB_TEX.creeperSkin);                    // 胴
    box(0.5, 0.5, 0.5, 0, 1.31, 0, MOB_TEX.creeperSkin, MOB_TEX.creeperFace); // 頭
  }

  m.group = g;
  g.position.copy(m.pos);
  scene.add(g);
  MOBS.push(m);
}

function removeMob(i) {
  const m = MOBS[i];
  m.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  scene.remove(m.group);
  MOBS.splice(i, 1);
}

/* ----- モブの物理移動 ----- */
function mobMove(m, axis, d, T) {
  if (d === 0) return false;
  const n = Math.ceil(Math.abs(d) / 0.05), inc = d / n;
  for (let i = 0; i < n; i++) {
    m.pos[axis] += inc;
    if (boxCollides(m.pos.x, m.pos.y, m.pos.z, T.hw, T.hh)) {
      m.pos[axis] -= inc;
      if (axis === 'y') {
        if (d < 0) m.onGround = true;
        m.vy = 0;
      }
      return true;
    }
  }
  return false;
}

/* ----- モブAI・更新 ----- */
function updateMob(m, dt) {
  const T = MOB_TYPES[m.type];

  if (m.dying !== undefined) { // 死亡演出（倒れて縮む）
    m.dying -= dt;
    m.group.rotation.z += dt * 6;
    m.group.scale.setScalar(Math.max(0.01, m.dying * 2));
    return;
  }

  m.t -= dt;
  m.hurtCd -= dt;
  let speed = 0;
  const dpx = player.pos.x - m.pos.x, dpz = player.pos.z - m.pos.z;
  const distP = Math.hypot(dpx, dpz);

  if (T.hostile && curBright < 0.45 && distP < 28) {
    m.yaw = Math.atan2(-dpx, -dpz);
    if (T.ranged) {
      // スケルトン：距離を保って弓を撃つ
      if (distP > 9) speed = T.speed;
      m.shootCd = (m.shootCd === undefined ? 1 : m.shootCd) - dt;
      if (distP < 15 && m.shootCd <= 0) {
        m.shootCd = 2.2;
        const from = new THREE.Vector3(m.pos.x, m.pos.y + 1.5, m.pos.z);
        const dir = new THREE.Vector3(
          player.pos.x - from.x,
          player.pos.y + 1.3 - from.y,
          player.pos.z - from.z).normalize();
        dir.y += distP * 0.012; // 山なり補正
        dir.normalize();
        shootArrow(from, dir);
        sfx(500, 900, 0.08, 'sine', 0.08);
      }
    } else if (T.creeper) {
      // クリーパー：接近して爆発
      if (distP > 2.0) {
        speed = T.speed;
        if (distP > 4) m.fuse = undefined; // 離れたら導火線リセット
      } else {
        m.fuse = (m.fuse === undefined ? 1.3 : m.fuse) - dt;
        if (m.fuse <= 0) {
          m.dying = 0.01;
          explode(m.pos.x, m.pos.y + 0.8, m.pos.z, 2.6);
          return;
        }
      }
    } else {
      // ゾンビ：突進して殴る
      speed = T.speed * 1.6;
      if (distP < 1.2 && m.hurtCd <= 0) {
        m.hurtCd = 1.0;
        damagePlayer(1, dpx / (distP || 1), dpz / (distP || 1));
      }
    }
  } else {
    // 放浪：歩く⇔立ち止まるを繰り返す
    if (m.t <= 0) {
      if (m.state === 'walk') { m.state = 'idle'; m.t = 1 + Math.random() * 2.5; }
      else { m.state = 'walk'; m.yaw = Math.random() * Math.PI * 2; m.t = 1.5 + Math.random() * 3; }
    }
    if (m.state === 'walk') speed = T.speed;
  }

  // ノックバック減衰
  m.kx -= m.kx * Math.min(1, dt * 5);
  m.kz -= m.kz * Math.min(1, dt * 5);

  // 重力・水の浮力
  const inW = getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y + 0.3), Math.floor(m.pos.z)) === 5;
  if (inW) m.vy = Math.min(m.vy + 12 * dt, 2.5);
  else { m.vy -= GRAVITY * dt; if (m.vy < -40) m.vy = -40; }

  const dx = -Math.sin(m.yaw) * speed * dt + m.kx * dt;
  const dz = -Math.cos(m.yaw) * speed * dt + m.kz * dt;
  const wasGround = m.onGround;
  m.onGround = false;
  const bx = mobMove(m, 'x', dx, T);
  const bz = mobMove(m, 'z', dz, T);
  mobMove(m, 'y', m.vy * dt, T);
  if ((bx || bz) && (wasGround || m.onGround)) m.vy = 8.2; // 段差ジャンプ

  // 歩行アニメ（脚を振る）
  if (speed > 0) m.walkPhase += dt * speed * 3.5;
  const sw = speed > 0 ? Math.sin(m.walkPhase) * 0.55 : 0;
  m.legs.forEach((l, i) => l.rotation.x = i % 2 ? sw : -sw);
  m.arms.forEach(a => a.rotation.x = Math.sin(m.walkPhase) * 0.12);

  m.group.position.copy(m.pos);
  m.group.rotation.y = m.yaw;

  // 昼夜の明るさ＋被弾フラッシュ＋クリーパーの点滅
  m.flash -= dt;
  const fusing = m.fuse !== undefined && m.fuse > 0;
  if (fusing) m.group.scale.setScalar(1 + (1.3 - m.fuse) * 0.18); // 膨らむ
  else m.group.scale.setScalar(1);
  for (const mat of m.mats) {
    if (m.flash > 0) mat.color.setRGB(1, 0.35, 0.35);
    else if (fusing && Math.floor(m.fuse * 10) % 2 === 0) mat.color.setRGB(1, 1, 1);
    else mat.color.setScalar(curBright);
  }
}

function updateMobs(dt) {
  for (let i = MOBS.length - 1; i >= 0; i--) {
    const m = MOBS[i];
    updateMob(m, dt);
    const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
    if ((m.dying !== undefined && m.dying <= 0) || d > 70 || m.pos.y < -15) removeMob(i);
  }
}

/* ----- スポーン ----- */
let spawnTimer = 0;
function trySpawn(dt) {
  spawnTimer -= dt;
  if (spawnTimer > 0) return;
  spawnTimer = 2.2;

  let animals = 0, hostiles = 0;
  for (const m of MOBS) MOB_TYPES[m.type].hostile ? hostiles++ : animals++;

  const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 16;
  const x = Math.floor(player.pos.x + Math.sin(a) * r);
  const z = Math.floor(player.pos.z + Math.cos(a) * r);
  const c = column(x, z);

  if (animals < ANIMAL_CAP && c.h > WATER + 1)
    spawnMob(Math.random() < 0.5 ? 'pig' : 'sheep', x + 0.5, c.h + 1, z + 0.5);

  if (curBright < 0.4 && hostiles < HOSTILE_CAP && c.h > WATER) {
    const roll = Math.random();
    spawnMob(roll < 0.45 ? 'zombie' : roll < 0.75 ? 'skeleton' : 'creeper', x + 0.5, c.h + 1, z + 0.5);
  }

  // 朝になったらゾンビは消滅
  if (curBright > 0.55)
    for (const m of MOBS)
      if (MOB_TYPES[m.type].hostile && m.dying === undefined) m.dying = 0.4;
}

/* ----- 攻撃（レイ vs モブAABB） ----- */
function rayAABB(o, d, minx, miny, minz, maxx, maxy, maxz) {
  let tmin = 0, tmax = REACH;
  const o3 = [o.x, o.y, o.z], d3 = [d.x, d.y, d.z];
  const mn = [minx, miny, minz], mx = [maxx, maxy, maxz];
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d3[i];
    let t1 = (mn[i] - o3[i]) * inv, t2 = (mx[i] - o3[i]) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  return tmin <= tmax ? tmin : null;
}

function raycastMob() {
  camera.getWorldDirection(_dir);
  const o = camera.position;
  const blockHit = raycast();
  let best = null, bt = blockHit ? blockHit.t : REACH;
  for (const m of MOBS) {
    if (m.dying !== undefined) continue;
    const T = MOB_TYPES[m.type];
    const t = rayAABB(o, _dir,
      m.pos.x - T.hw, m.pos.y, m.pos.z - T.hw,
      m.pos.x + T.hw, m.pos.y + T.hh, m.pos.z + T.hw);
    if (t !== null && t < bt) { bt = t; best = m; }
  }
  return best;
}

function hitMob(m) {
  const s = inv[player.sel];
  const dmg = s && s.id >= 100 && ITEMS[s.id].dmg ? ITEMS[s.id].dmg : 1; // 素手1／剣で強化
  m.hp -= dmg;
  m.flash = 0.18;
  let dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  m.kx = dx / l * 7; m.kz = dz / l * 7;
  m.vy = 4.5;
  m.hurtCd = Math.max(m.hurtCd, 0.4);
  sfx(220, 90, 0.12, 'square', 0.14);
  if (m.hp <= 0) {
    m.dying = 0.5;
    sfx(160, 40, 0.3, 'sawtooth', 0.12);
  }
}

/* ----- 矢（スケルトンの攻撃） ----- */
const ARROWS = [];
const arrowGeo = new THREE.BoxGeometry(0.07, 0.07, 0.55);
const arrowMat = new THREE.MeshBasicMaterial({ color: 0xd8d8c8 });

function shootArrow(from, dir) {
  const me = new THREE.Mesh(arrowGeo, arrowMat);
  me.position.copy(from);
  scene.add(me);
  ARROWS.push({ me, vel: dir.clone().multiplyScalar(17), life: 5 });
}

function updateArrows(dt) {
  for (let i = ARROWS.length - 1; i >= 0; i--) {
    const a = ARROWS[i];
    a.life -= dt;
    a.vel.y -= 9 * dt;
    const p = a.me.position;
    p.addScaledVector(a.vel, dt);
    a.me.lookAt(p.x + a.vel.x, p.y + a.vel.y, p.z + a.vel.z);
    let dead = a.life <= 0 || isSolid(getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
    if (!dead &&
        Math.abs(p.x - player.pos.x) < 0.45 && Math.abs(p.z - player.pos.z) < 0.45 &&
        p.y > player.pos.y && p.y < player.pos.y + 1.8) {
      const l = Math.hypot(a.vel.x, a.vel.z) || 1;
      damagePlayer(2, a.vel.x / l, a.vel.z / l);
      dead = true;
    }
    if (dead) { scene.remove(a.me); ARROWS.splice(i, 1); }
  }
}

/* ----- パーティクル ----- */
const PARTS = [];
const partGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);

function spawnParticles(x, y, z, n, color) {
  for (let i = 0; i < n; i++) {
    const mt = new THREE.MeshBasicMaterial({ color });
    const me = new THREE.Mesh(partGeo, mt);
    me.position.set(x, y, z);
    scene.add(me);
    PARTS.push({
      me,
      vx: (Math.random() - .5) * 9, vy: Math.random() * 8, vz: (Math.random() - .5) * 9,
      life: 0.7 + Math.random() * 0.4,
    });
  }
}

function updateParticles(dt) {
  for (let i = PARTS.length - 1; i >= 0; i--) {
    const p = PARTS[i];
    p.life -= dt;
    p.vy -= 20 * dt;
    p.me.position.x += p.vx * dt;
    p.me.position.y += p.vy * dt;
    p.me.position.z += p.vz * dt;
    if (p.life <= 0) {
      scene.remove(p.me);
      p.me.material.dispose();
      PARTS.splice(i, 1);
    }
  }
}

/* ----- 爆発（クリーパー） ----- */
function explode(ex, ey, ez, r) {
  sfx(70, 25, 0.5, 'sawtooth', 0.4);
  const touched = new Set();
  for (let x = Math.floor(ex - r); x <= Math.floor(ex + r); x++)
    for (let y = Math.max(1, Math.floor(ey - r)); y <= Math.min(MAXY - 1, Math.floor(ey + r)); y++)
      for (let z = Math.floor(ez - r); z <= Math.floor(ez + r); z++) {
        const dd = (x + 0.5 - ex) ** 2 + (y + 0.5 - ey) ** 2 + (z + 0.5 - ez) ** 2;
        if (dd > r * r) continue;
        const id = getBlock(x, y, z);
        if (id === 0 || id === 11) continue;
        edits.set(x + ',' + y + ',' + z, 0);
        if (y > maxEditY) maxEditY = y;
        const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
        touched.add(cx + ',' + cz);
        const lx = x - cx * CS, lz = z - cz * CS;
        if (lx === 0) touched.add((cx - 1) + ',' + cz);
        if (lx === CS - 1) touched.add((cx + 1) + ',' + cz);
        if (lz === 0) touched.add(cx + ',' + (cz - 1));
        if (lz === CS - 1) touched.add(cx + ',' + (cz + 1));
      }
  scheduleSave();
  for (const k of touched) {
    if (!chunks.has(k)) continue;
    const [cx, cz] = k.split(',').map(Number);
    buildChunk(cx, cz);
  }
  spawnParticles(ex, ey, ez, 26, 0x777777);
  // プレイヤーへの距離ダメージ
  const pd = Math.hypot(player.pos.x - ex, player.pos.y + 0.9 - ey, player.pos.z - ez);
  if (pd < r + 2.5) {
    const dmg = Math.max(1, Math.round((1 - pd / (r + 2.5)) * 7));
    const l = Math.hypot(player.pos.x - ex, player.pos.z - ez) || 1;
    damagePlayer(dmg, (player.pos.x - ex) / l * 2, (player.pos.z - ez) / l * 2);
  }
  // 巻き込まれたモブ
  for (const o of MOBS) {
    if (o.dying !== undefined) continue;
    const od = Math.hypot(o.pos.x - ex, o.pos.y + 0.5 - ey, o.pos.z - ez);
    if (od < r + 1.5) {
      o.hp -= 5;
      o.flash = 0.2;
      if (o.hp <= 0) o.dying = 0.4;
    }
  }
}

/* ----- プレイヤー体力 ----- */
let hp = 10, lastHurtT = -99, regenT = 0, gameT = 0;
const heartsEl = document.getElementById('hearts');
const hurtfxEl = document.getElementById('hurtfx');

function updateHearts() {
  heartsEl.innerHTML = '❤'.repeat(hp) + '<span class="e">' + '❤'.repeat(Math.max(0, 10 - hp)) + '</span>';
}
updateHearts();

function showMsg(text) {
  itemnameEl.textContent = text;
  itemnameEl.style.opacity = 1;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => itemnameEl.style.opacity = 0, 2500);
}

function damagePlayer(n, kx, kz) {
  hp -= n;
  lastHurtT = gameT;
  hurtfxEl.style.transition = 'none';
  hurtfxEl.style.opacity = 1;
  requestAnimationFrame(() => {
    hurtfxEl.style.transition = 'opacity .4s';
    hurtfxEl.style.opacity = 0;
  });
  sfx(140, 60, 0.2, 'sawtooth', 0.18);
  player.vel.y = 5;
  moveAxis('x', kx * 0.8);
  moveAxis('z', kz * 0.8);
  if (hp <= 0) {
    hp = 10;
    player.pos.set(8.5, column(8, 8).h + 2, 8.5);
    player.vel.set(0, 0, 0);
    showMsg('💀 やられてしまった！スポーン地点に戻ります');
  }
  updateHearts();
}

function regenHP(dt) {
  if (hp < 10 && gameT - lastHurtT > 6) {
    regenT += dt;
    if (regenT > 3) { regenT = 0; hp++; updateHearts(); }
  } else regenT = 0;
}

/* ===================== 昼夜サイクル ===================== */
const dayColor = new THREE.Color(0x87ceeb);
const nightColor = new THREE.Color(0x0b1228);
const skyColor = new THREE.Color();
let dayTime = DAY_LENGTH * 0.25; // 朝からスタート

function updateDayNight(dt) {
  dayTime = (dayTime + dt) % DAY_LENGTH;
  const sun = Math.sin(dayTime / DAY_LENGTH * Math.PI * 2); // 1=正午 -1=深夜
  const b = Math.max(0.22, Math.min(1, sun * 1.4 + 0.5));
  curBright = b;
  skyColor.copy(nightColor).lerp(dayColor, (b - 0.22) / 0.78);
  renderer.setClearColor(skyColor);
  scene.fog.color.copy(skyColor);
  matOpaque.color.setScalar(b);
  matTrans.color.setScalar(b);
}

function timeLabel() {
  const t = dayTime / DAY_LENGTH;
  if (t < 0.05 || t >= 0.95) return '🌅 朝';
  if (t < 0.45) return '☀️ 昼';
  if (t < 0.55) return '🌇 夕方';
  return '🌙 夜';
}

/* ===================== HUD ===================== */
const hudEl = document.getElementById('hud');
const waterfxEl = document.getElementById('waterfx');
let fps = 0, fpsFrames = 0, fpsTime = 0;

function updateHUD(dt) {
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
  }
  hudEl.innerHTML =
    `FPS: ${fps}<br>` +
    `XYZ: ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}<br>` +
    `${timeLabel()}　${player.fly ? '✈️ 飛行中' : ''}`;
  waterfxEl.style.display = eyeInWater() ? 'block' : 'none';
}

/* ===================== タッチ操作（スマホ対応） ===================== */
if (isTouch) {
  const joyBase = document.getElementById('joyBase');
  const joyStick = document.getElementById('joyStick');

  function joyMove(t) {
    const r = joyBase.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (t.clientX - cx) / (r.width / 2);
    let dy = (t.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    joy.x = dx; joy.y = dy;
    joyStick.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
  }

  joyBase.addEventListener('touchstart', e => {
    e.preventDefault();
    if (joy.id === null) {
      const t = e.changedTouches[0];
      joy.id = t.identifier;
      joyMove(t);
    }
  }, { passive: false });

  // 画面ドラッグで視点移動（パッド・ボタン以外のタッチ）
  renderer.domElement.addEventListener('touchstart', e => {
    if (!playing()) return;
    e.preventDefault();
    if (look.id === null) {
      const t = e.changedTouches[0];
      look.id = t.identifier;
      look.x = t.clientX; look.y = t.clientY;
    }
  }, { passive: false });

  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        e.preventDefault();
        joyMove(t);
      } else if (t.identifier === look.id) {
        e.preventDefault();
        player.yaw -= (t.clientX - look.x) * 0.0045;
        player.pitch -= (t.clientY - look.y) * 0.0045;
        player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
        look.x = t.clientX; look.y = t.clientY;
      }
    }
  }, { passive: false });

  const endTouch = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        joy.id = null; joy.x = 0; joy.y = 0;
        joyStick.style.transform = '';
      }
      if (t.identifier === look.id) look.id = null;
    }
  };
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);

  // 押している間リピートするボタン
  function bindHold(el, fn, repeat) {
    let iv = null;
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      fn();
      if (repeat) { clearInterval(iv); iv = setInterval(fn, 240); }
    }, { passive: false });
    const end = e => { e.preventDefault(); clearInterval(iv); iv = null; };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  // 押している間だけ仮想キーを押すボタン
  function bindKey(el, code) {
    el.addEventListener('touchstart', e => { e.preventDefault(); keys.add(code); }, { passive: false });
    const end = e => { e.preventDefault(); keys.delete(code); };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  bindHold(document.getElementById('btnBreak'), doBreak, true);
  bindHold(document.getElementById('btnPlace'), doPlace, true);
  bindKey(document.getElementById('btnJump'), 'Space');
  bindKey(document.getElementById('btnDown'), 'ShiftLeft');

  const btnFly = document.getElementById('btnFly');
  const btnDown = document.getElementById('btnDown');
  btnFly.addEventListener('touchstart', e => {
    e.preventDefault();
    player.fly = !player.fly;
    player.vel.y = 0;
    btnFly.classList.toggle('on', player.fly);
    btnDown.style.display = player.fly ? 'flex' : 'none';
  }, { passive: false });

  document.getElementById('btnInv').addEventListener('touchstart', e => {
    e.preventDefault();
    if (invOpen) closeInventory(false);
    else openInventory(false);
  }, { passive: false });

  document.getElementById('btnPause').addEventListener('touchstart', e => {
    e.preventDefault();
    if (invOpen) closeInventory(false);
    touchPlaying = false;
    setUIVisible(false);
  }, { passive: false });
}

/* ===================== メインループ ===================== */
const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  gameT += dt;
  if (playing()) {
    physics(dt);
    updateMobs(dt);
    updateArrows(dt);
    updateParticles(dt);
    trySpawn(dt);
    regenHP(dt);
  }
  updateChunks();
  updateHighlight();
  updateDayNight(dt);
  updateHUD(dt);
  renderer.render(scene, camera);
}

refreshChunks(Math.floor(player.pos.x / CS), Math.floor(player.pos.z / CS));
lastPCX = Math.floor(player.pos.x / CS);
lastPCZ = Math.floor(player.pos.z / CS);
// 足元周辺は先に同期生成（落下防止というよりすぐ見えるように）
for (let i = 0; i < 9 && buildQueue.length; i++) {
  const [cx, cz] = buildQueue.shift();
  buildChunk(cx, cz);
}
// 初期スポーン：周辺に動物を数匹
for (let i = 0; i < 5; i++) {
  const a = Math.random() * Math.PI * 2, r = 7 + Math.random() * 12;
  const x = Math.floor(8.5 + Math.sin(a) * r), z = Math.floor(8.5 + Math.cos(a) * r);
  const c = column(x, z);
  if (c.h > WATER + 1) spawnMob(i % 2 ? 'pig' : 'sheep', x + 0.5, c.h + 1, z + 0.5);
}
loop();
