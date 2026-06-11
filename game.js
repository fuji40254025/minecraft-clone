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
};
const TRANS = new Set([5, 7, 9]);
const HOTBAR = [1, 2, 3, 4, 6, 8, 7, 9, 10];

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
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF' && locked()) {
    player.fly = !player.fly;
    player.vel.y = 0;
  }
  if (/^Digit[1-9]$/.test(e.code)) selectSlot(parseInt(e.code.slice(5), 10) - 1);
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
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }

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
function locked() { return document.pointerLockElement === renderer.domElement; }

document.getElementById('playBtn').addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('現在の世界を削除して新しい世界を生成しますか？')) {
    localStorage.removeItem('mc_seed');
    localStorage.removeItem('mc_edits');
    location.reload();
  }
});

document.addEventListener('pointerlockchange', () => {
  const on = locked();
  overlay.style.display = on ? 'none' : 'flex';
  document.getElementById('crosshair').style.display = on ? 'block' : 'none';
  document.getElementById('hotbar').style.display = on ? 'flex' : 'none';
  document.getElementById('hud').style.display = on ? 'block' : 'none';
  if (!on) { keys.clear(); stopMining(); }
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
      return { x, y, z, id, px, py, pz };
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
  const hit = raycast();
  if (!hit || hit.id === 11) return; // 岩盤は壊せない
  setBlock(hit.x, hit.y, hit.z, 0);
  sfx(170, 55, 0.12, 'square', 0.12);
}

function doPlace() {
  const hit = raycast();
  if (!hit || hit.px === null) return;
  const cur = getBlock(hit.px, hit.py, hit.pz);
  if (cur !== 0 && cur !== 5) return;
  if (blockIntersectsPlayer(hit.px, hit.py, hit.pz)) return;
  setBlock(hit.px, hit.py, hit.pz, HOTBAR[player.sel]);
  sfx(95, 150, 0.07, 'sine', 0.14);
}

function doPick() {
  const hit = raycast();
  if (!hit) return;
  const i = HOTBAR.indexOf(hit.id);
  if (i >= 0) selectSlot(i);
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
  selectSlot((player.sel + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length);
});

/* ----- ターゲットのハイライト枠 ----- */
const hlGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
const hlBox = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({ color: 0x111111 }));
hlBox.visible = false;
scene.add(hlBox);

function updateHighlight() {
  const hit = locked() ? raycast() : null;
  if (hit) {
    hlBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    hlBox.visible = true;
  } else {
    hlBox.visible = false;
  }
}

/* ===================== 手持ちブロック表示 ===================== */
let heldMesh = null;
function updateHeld() {
  if (heldMesh) {
    camera.remove(heldMesh);
    heldMesh.geometry.dispose();
    heldMesh = null;
  }
  const id = HOTBAR[player.sel];
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
  camera.add(heldMesh);
}

/* ===================== ホットバーUI ===================== */
const hotbarEl = document.getElementById('hotbar');
const itemnameEl = document.getElementById('itemname');
let nameTimer = null;

(function buildHotbarUI() {
  HOTBAR.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const c2 = cv.getContext('2d');
    c2.imageSmoothingEnabled = false;
    const tile = tileFor(id, 0); // 側面タイルをアイコンに
    c2.drawImage(atlasCanvas, (tile % 4) * 16, ((tile / 4) | 0) * 16, 16, 16, 0, 0, 32, 32);
    slot.appendChild(num);
    slot.appendChild(cv);
    hotbarEl.appendChild(slot);
  });
})();

function selectSlot(i) {
  player.sel = i;
  [...hotbarEl.children].forEach((el, j) => el.classList.toggle('sel', j === i));
  updateHeld();
  itemnameEl.textContent = BLOCKS[HOTBAR[i]].name;
  itemnameEl.style.opacity = 1;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => itemnameEl.style.opacity = 0, 1200);
}
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

/* ===================== 昼夜サイクル ===================== */
const dayColor = new THREE.Color(0x87ceeb);
const nightColor = new THREE.Color(0x0b1228);
const skyColor = new THREE.Color();
let dayTime = DAY_LENGTH * 0.25; // 朝からスタート

function updateDayNight(dt) {
  dayTime = (dayTime + dt) % DAY_LENGTH;
  const sun = Math.sin(dayTime / DAY_LENGTH * Math.PI * 2); // 1=正午 -1=深夜
  const b = Math.max(0.22, Math.min(1, sun * 1.4 + 0.5));
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

/* ===================== メインループ ===================== */
const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (locked()) physics(dt);
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
loop();
