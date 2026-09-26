/* The workshop: one continuous Three.js diorama behind the homepage.
 *
 * Five stations sit side by side along +X (hero workshop, shelf, writing,
 * work, intercom). Page scroll position maps to a float index between
 * stations, and the camera lerps between poses — each snap section reads as
 * walking into the next room. DOM content stays on top; the canvas is
 * decoration: pointer-events none, aria-hidden.
 *
 * Everything is primitives + CanvasTexture labels — no model files. Theme
 * palettes come from the page's data-theme attribute.
 */
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

const GAP = 16; // distance between stations
const ORANGE = 0xff5a1f;
const SHOPIFY = 0x95bf47;
const GREY = 0x5b574f;

interface Palette {
  bg: number;
  floor: number;
  plinth: number;
  plinthDark: number;
  ink: number;
  panel: number;
  paper: number;
  paperInk: string;
  hemi: number;
  key: number;
}

const LIGHT: Palette = {
  bg: 0xefebe3,
  floor: 0xe6e0d5,
  plinth: 0xf6f3ec,
  plinthDark: 0xd9d2c4,
  ink: 0x141311,
  panel: 0x141311, // code-panel chrome is an ink edge in light mode
  paper: 0xfbf9f4,
  paperInk: '#8a857b',
  hemi: 0.9,
  key: 1.6,
};

const DARK: Palette = {
  bg: 0x171410,
  floor: 0x211d17,
  plinth: 0x2c2721,
  plinthDark: 0x1d1a15,
  ink: 0xece6da,
  panel: 0x0e0d0b,
  paper: 0x2e2921,
  paperInk: '#a39a8c',
  hemi: 0.45,
  key: 1.1,
};

/* ————— canvas textures ————— */

function codeTexture (dark: boolean, accent = '#ff8a5c'): THREE.CanvasTexture
{
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = dark ? '#141311' : '#f8f3ea';
  g.fillRect(0, 0, 256, 160);
  // title bar dots
  const dot = dark ? '#8a857b' : '#b3aa98';
  ['#ff5a1f', dot, dot].forEach((col, i) =>
  {
    g.fillStyle = col;
    g.beginPath();
    g.arc(18 + i * 16, 14, 4, 0, 7);
    g.fill();
  });
  // fake code lines — darker, lower-key hues on the light card
  const ink = dark ? '#e9e4da' : '#2a2723';
  const blue = dark ? '#9ec5e0' : '#4a7ba6';
  const green = dark ? '#c7d98f' : '#7a9440';
  const lines = [
    [0.12, 0.5, accent], [0.28, 0.55, blue], [0.28, 0.4, green],
    [0.44, 0.3, ink], [0.28, 0.45, accent], [0.12, 0.35, ink],
    [0.12, 0.6, dot], [0.28, 0.3, blue],
  ];
  lines.forEach(([indent, len, col], i) => {
    g.fillStyle = col as string;
    g.fillRect(16 + (indent as number) * 100, 34 + i * 15, (len as number) * 140, 5);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paperTexture(ink: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 200;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf9f4';
  g.fillRect(0, 0, 160, 200);
  g.fillStyle = ink;
  for (let i = 0; i < 9; i++) {
    const w = 60 + ((i * 37) % 70);
    g.fillRect(16, 26 + i * 18, w, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ————— builders ————— */

const box = (
  w: number, h: number, d: number, color: number,
  x = 0, y = 0, z = 0,
): THREE.Mesh => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 }),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

function plinth(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = box(w, h, d, color);
  m.castShadow = false;
  return m;
}

interface ThemedPanel
{
  frame: THREE.MeshStandardMaterial;
  face: THREE.MeshBasicMaterial;
}

function codePanel (w = 3.2, h = 2, themed?: ThemedPanel[]): THREE.Group
{
  const g = new THREE.Group();
  const frame = box(w, h, 0.12, 0x141311);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.16, h - 0.16),
    new THREE.MeshBasicMaterial({ map: codeTexture(true) }),
  );
  face.position.z = 0.065;
  g.add(frame, face);
  themed?.push({
    frame: frame.material as THREE.MeshStandardMaterial,
    face: face.material as THREE.MeshBasicMaterial,
  });
  return g;
}

/* Vendored brand SVGs (simpleicons, CC0) extruded into real 3D logos. SVG y
   runs downward, so the group is flipped and scaled to ~unit height. */
function loadLogo (url: string, color: number): Promise<THREE.Group>
{
  return new Promise((resolve, reject) =>
  {
    new SVGLoader().load(
      url,
      (data) =>
      {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.55,
          metalness: 0.15,
        });
        for (const path of data.paths) {
          for (const shape of SVGLoader.createShapes(path)) {
            const mesh = new THREE.Mesh(
              new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }),
              mat,
            );
            mesh.castShadow = true;
            group.add(mesh);
          }
        }
        // Normalize the 24×24 viewBox to ~1 unit, center on origin. The
        // offset lives on an inner group — callers set position on the wrap.
        group.scale.set(0.05, -0.05, 0.05);
        const box3 = new THREE.Box3().setFromObject(group);
        group.position.sub(box3.getCenter(new THREE.Vector3()));
        const wrap = new THREE.Group();
        wrap.add(group);
        resolve(wrap);
      },
      undefined,
      () => reject(new Error(`logo load failed: ${url}`)),
    );
  });
}

/* The hero centerpiece: a chunky intercom unit on its plinth — body, speaker
   grille dots, orange talk button, handset block parked alongside. */
function intercomUnit(pal: Palette): THREE.Group {
  const g = new THREE.Group();
  const body = box(2.2, 3.0, 0.9, pal.plinth, 0, 0, 0);
  g.add(body);
  // grille: 3x4 dots
  const dotMat = new THREE.MeshStandardMaterial({ color: pal.plinthDark, roughness: 0.9 });
  for (let r = 0; r < 4; r++) {
    for (let cIdx = 0; cIdx < 3; cIdx++) {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12), dotMat);
      dot.rotation.x = Math.PI / 2;
      dot.position.set(-0.5 + cIdx * 0.5, 1.0 - r * 0.34, 0.48);
      g.add(dot);
    }
  }
  // orange talk button
  const btn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.16, 20),
    new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.5, emissive: ORANGE, emissiveIntensity: 0.25 }),
  );
  btn.rotation.x = Math.PI / 2;
  btn.position.set(0, -0.85, 0.5);
  g.add(btn);
  // handset block on the side
  const handset = box(0.5, 2.4, 0.6, pal.ink, -1.5, -0.1, 0);
  g.add(handset);
  return g;
}

function paper(ink: string): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.4, 0.03),
    [
      new THREE.MeshStandardMaterial({ color: 0xfbf9f4 }),
      new THREE.MeshStandardMaterial({ color: 0xfbf9f4 }),
      new THREE.MeshStandardMaterial({ color: 0xfbf9f4 }),
      new THREE.MeshStandardMaterial({ color: 0xfbf9f4 }),
      new THREE.MeshStandardMaterial({ map: paperTexture(ink) }),
      new THREE.MeshStandardMaterial({ color: 0xfbf9f4 }),
    ],
  );
  m.castShadow = true;
  return m;
}

/* ————— stations ————— */

interface Station {
  cam: [number, number, number];
  look: [number, number, number];
  animated: THREE.Object3D[];
}

function buildStations (
  scene: THREE.Scene,
  pal: Palette,
  themed: ThemedPanel[],
): Station[]
{
  const stations: Station[] = [];
  const at = (i: number) => i * GAP;

  // 0 — hero workshop: intercom on a plinth, floating code panels, module cubes
  {
    const g = new THREE.Group();
    g.position.x = at(0);
    const p = plinth(3.4, 0.9, 2.6, pal.plinth);
    p.position.y = 0.45;
    g.add(p);
    const unit = intercomUnit(pal);
    unit.position.y = 0.9 + 1.5;
    g.add(unit);
    const left = codePanel(3.2, 2, themed);
    left.position.set(-4.6, 3.2, -0.8);
    left.rotation.y = 0.5;
    left.rotation.x = -0.06;
    const right = codePanel(2.6, 1.6, themed);
    right.position.set(4.4, 2.6, -1.2);
    right.rotation.y = -0.55;
    g.add(left, right);
    // the stack he works in — real logos extruded, standing on the floor
    const logos: [string, number][] = [
      ['/logos/svelte.svg', 0xff3e00],
      ['/logos/nodedotjs.svg', 0x5fa04e],
      ['/logos/typescript.svg', 0x3178c6],
      ['/logos/shopify.svg', 0x95bf47],
      ['/logos/linux.svg', 0xfcc624],
    ];
    logos.forEach(([url, col], i) =>
    {
      loadLogo(url, col)
        .then((logo) =>
        {
          logo.position.set(-2.7 + i * 1.35, 0.62, 3.1);
          logo.rotation.y = -0.12;
          g.add(logo);
        })
        .catch(() =>
        {
          /* logo failed to load — the row just has a gap */
        });
    });
    scene.add(g);
    stations.push({ cam: [at(0), 3.4, 12.4], look: [at(0), 1.4, 0], animated: [left, right, unit] });
  }

  // 1 — shelf room: kind-colored project boxes on a long plank
  {
    const g = new THREE.Group();
    g.position.x = at(1);
    const plank = plinth(11, 0.5, 3, pal.plinthDark);
    plank.position.set(2.5, 0.25, -3.5);
    g.add(plank);
    const specs: [number, number, number, number][] = [
      [SHOPIFY, 1.5, 2.4, 1.5], [ORANGE, 1.2, 1.7, 1.2], [0x141311, 1.3, 2.0, 1.3], [GREY, 1.1, 1.4, 1.1],
    ];
    specs.forEach(([col, w, h, d], i) => {
      const x = -0.5 + i * 2.1;
      const b = box(w, h, d, col, x, 0.5 + h / 2, -3.5);
      g.add(b);
      const band = box(w + 0.02, 0.24, d + 0.02, pal.plinth, x, 0.5 + h - 0.12, -3.5);
      g.add(band);
    });
    scene.add(g);
    stations.push({ cam: [at(1) + 1, 2.6, 11], look: [at(1) + 1.5, 1.2, -1], animated: [] });
  }

  // 2 — writing room: papers lifting off a low plinth
  {
    const g = new THREE.Group();
    g.position.x = at(2);
    const p = plinth(4.2, 0.6, 3, pal.plinth);
    p.position.set(4.6, 0.3, -2.6);
    g.add(p);
    const sheets: THREE.Object3D[] = [];
    for (let i = 0; i < 5; i++) {
      const s = paper(pal.paperInk);
      s.position.set(2.6 + i * 0.85, 2.3 + i * 0.5, -2.9 + (i % 2) * 0.5);
      s.rotation.set(-0.25 + i * 0.08, 0.3 - i * 0.15, 0.12 - i * 0.05);
      sheets.push(s);
      g.add(s);
    }
    scene.add(g);
    stations.push({ cam: [at(2) + 1, 2.8, 10.6], look: [at(2) + 1.4, 1.7, 0], animated: sheets });
  }

  // 3 — work room: pillars like a bar-chart timeline
  {
    const g = new THREE.Group();
    g.position.x = at(3);
    const heights = [1.4, 2.3, 3.1, 1.9];
    heights.forEach((h, i) => {
      const col = i === 2 ? ORANGE : pal.plinth;
      const pillar = plinth(1.4, h, 1.7, col);
      pillar.position.set(-2.6 + i * 1.9, h / 2, -4.5);
      g.add(pillar);
    });
    scene.add(g);
    stations.push({ cam: [at(3), 3.4, 12], look: [at(3), 1.1, -2], animated: [] });
  }

  // 4 — intercom room: the orange beacon
  {
    const g = new THREE.Group();
    g.position.x = at(4);
    const beacon = box(1.6, 4.4, 1.6, ORANGE, 0, 2.2, -4.5);
    (beacon.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(ORANGE);
    (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
    g.add(beacon);
    const p = plinth(3, 0.7, 3, pal.plinth);
    p.position.set(0, 0.35, -4.5);
    g.add(p);
    const glow = new THREE.PointLight(ORANGE, 26, 18);
    glow.position.set(0, 3.4, -2.2);
    g.add(glow);
    scene.add(g);
    stations.push({ cam: [at(4), 3, 12.5], look: [at(4), 1.9, -2], animated: [beacon] });
  }

  return stations;
}

/* ————— driver ————— */

export function initWorkshop(canvas: HTMLCanvasElement): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

  const hemi = new THREE.HemisphereLight(0xfff6ea, 0x6b6154, LIGHT.hemi);
  const key = new THREE.DirectionalLight(0xffffff, LIGHT.key);
  key.position.set(-6, 10, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -50;
  key.shadow.camera.right = 50;
  scene.add(hemi, key);

  let pal = LIGHT;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 60),
    new THREE.MeshStandardMaterial({ color: LIGHT.floor, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(32, 0, -6);
  floor.receiveShadow = true;
  scene.add(floor);

  const themed: ThemedPanel[] = [];
  const stations = buildStations(scene, pal, themed);

  // Theme sync — read the page attribute, repaint on change. Code panels get
  // their texture regenerated so they read as light cards in light mode.
  const applyTheme = () => {
    pal = document.documentElement.dataset.theme === 'dark' ? DARK : LIGHT;
    const dark = pal === DARK;
    scene.background = new THREE.Color(pal.bg);
    scene.fog = new THREE.Fog(pal.bg, 18, 46);
    (floor.material as THREE.MeshStandardMaterial).color.setHex(pal.floor);
    hemi.intensity = pal.hemi;
    key.intensity = pal.key;
    themed.forEach(({ frame, face }) =>
    {
      frame.color.setHex(pal.panel);
      face.map?.dispose();
      face.map = codeTexture(dark);
      face.needsUpdate = true;
    });
    if (reduced) renderer.render(scene, camera);
  };
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // Scroll driver: which room is in the viewport → station index. Rooms are
  // min-height 100svh but content can make them taller, so map by offsetTop,
  // not by scrollY/innerHeight — the pose lands on the room you're in even
  // when a section overshoots the viewport.
  const last = stations.length - 1;
  let tops: number[] = [];
  const measure = () => {
    tops = Array.from(document.querySelectorAll<HTMLElement>('.room, .intercom'))
      .map((el) => el.offsetTop)
      .sort((a, b) => a - b)
      .slice(0, stations.length);
  };
  measure();
  const targetFor = () => {
    const y = window.scrollY + window.innerHeight * 0.45;
    let i = 0;
    while (i < tops.length - 1 && tops[i + 1] <= y) i += 1;
    return Math.min(i, last);
  };

  let current = targetFor();
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const mouse = { x: 0, y: 0 };
  // Narrow viewports see less horizontally — pull the camera back so the
  // stations read at a similar size and don't crowd the DOM text.
  let zoom = 1;
  const computeZoom = () => {
    zoom = THREE.MathUtils.clamp(0.95 / camera.aspect, 1, 2.2);
  };

  const pose = (t: number) => {
    const i = Math.min(Math.floor(t), last - 1);
    const f = THREE.MathUtils.smoothstep(t - i, 0, 1);
    const a = stations[i];
    const b = stations[Math.min(i + 1, last)];
    pos.set(
      THREE.MathUtils.lerp(a.cam[0], b.cam[0], f),
      THREE.MathUtils.lerp(a.cam[1], b.cam[1], f),
      THREE.MathUtils.lerp(a.cam[2], b.cam[2], f) * zoom,
    );
    look.set(
      THREE.MathUtils.lerp(a.look[0], b.look[0], f),
      THREE.MathUtils.lerp(a.look[1], b.look[1], f),
      THREE.MathUtils.lerp(a.look[2], b.look[2], f),
    );
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    computeZoom();
    if (reduced) {
      pose(current);
      camera.position.copy(pos);
      camera.lookAt(look);
      renderer.render(scene, camera);
    }
    measure();
  };
  resize();
  window.addEventListener('resize', resize);

  if (reduced) {
    // No animation loop — snap straight to the room being viewed.
    const render = () => {
      current = targetFor();
      pose(current);
      camera.position.copy(pos);
      camera.lookAt(look);
      renderer.render(scene, camera);
    };
    render();
    window.addEventListener('scroll', render, { passive: true });
    return;
  }

  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  const timer = new THREE.Timer();
  const tick = () => {
    timer.update();
    const t = timer.getElapsed();
    current += (targetFor() - current) * 0.075;
    pose(current);
    // Gentle idle float on registered props + pointer parallax.
    stations.forEach((s, si) =>
      s.animated.forEach((o, oi) => {
        o.position.y += Math.sin(t * 0.9 + si * 2 + oi) * 0.0016;
        o.rotation.z += Math.sin(t * 0.5 + oi) * 0.0004;
      }),
    );
    camera.position.set(pos.x + mouse.x * 0.7, pos.y - mouse.y * 0.4, pos.z);
    camera.lookAt(look);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}
