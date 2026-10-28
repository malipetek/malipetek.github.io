/* The workshop: one continuous Three.js diorama behind the homepage.
 *
 * Stations sit side by side along +X. Each homepage room names its station
 * with data-station; scroll position picks the room, and the camera lerps
 * between station poses, so each section reads as walking into the next room.
 * DOM content stays on top; the canvas is decoration: pointer-events none,
 * aria-hidden.
 *
 * The hero station is the service drawn as a machine, seen near-isometric:
 * request → approval gate (a person) → agent at a terminal → review (a person)
 * → shipped to a cloud. Tickets ride the belt through all four. The step
 * order and names mirror STEPS in src/lib/offer.js.
 *
 * Drawn as line art: flat facet-shaded fills, crisp screen-space outlines
 * (fat-line edges for creases, an inverted hull for curved silhouettes), on a
 * dot-matrix floor shader. The dots under each ticket light up orange as it
 * travels, so the floor tracks the work moving through.
 *
 * Everything is primitives + CanvasTexture labels — no model files. Theme
 * palettes come from the page's data-theme attribute; every material is
 * shared per role, so a theme switch is a handful of uniform writes.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

const GAP = 26; // distance between stations — wide enough that the isometric hero sees no neighbours
const ORANGE = 0xff5a1f;
const SHOPIFY = 0x95bf47;
const GREY = 0x8a857b;
const LINE_PX = 1.15; // outline width in CSS pixels

type Role = 'fill' | 'fill2' | 'ink' | 'orange';

interface Palette {
  fill: number;
  fill2: number;
  ink: number;
  dot: number;
  paperInk: string;
}

const LIGHT: Palette = {
  fill: 0xffffff,
  fill2: 0xf1eee9,
  ink: 0x16140f,
  dot: 0xc9c2b6,
  paperInk: '#b9b2a6',
};

const DARK: Palette = {
  fill: 0x1b1915,
  fill2: 0x25221d,
  ink: 0xe6dfd2,
  dot: 0x3d3831,
  paperInk: '#5d574d',
};

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/* ————— materials ————— */

// Facet shading without lights: brightness from the world normal against one
// fixed direction. Top faces read as the pure fill, the two faces the
// isometric camera sees step down a few percent — the look of a technical
// illustration, not a render.
const FACET_VERT = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FACET_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vN;
  void main() {
    float l = clamp(dot(normalize(vN), normalize(vec3(-0.45, 1.0, 0.6))) / 0.82, 0.0, 1.0);
    gl_FragColor = vec4(uColor * (0.88 + 0.12 * l), 1.0);
    #include <colorspace_fragment>
  }
`;

// Inverted hull: back faces pushed out along the normal in screen space, so a
// sphere or cylinder gets a constant-width silhouette line at any distance.
const HULL_VERT = /* glsl */ `
  uniform vec2 uRes;
  uniform float uWidth;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec2 n = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy;
    clip.xy += normalize(n) / uRes * uWidth * 2.0 * clip.w;
    gl_Position = clip;
  }
`;
const HULL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }
`;

// The floor: a dot matrix in world space. Dots fade with distance from the
// camera's focus (and before they get small enough to alias), breathe on a
// slow diagonal wave, and turn orange under the tickets on the hero belt.
const FLOOR_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uDot;
  uniform vec3 uAccent;
  uniform vec2 uFocus;
  uniform float uTime;
  uniform vec3 uGlow[12];
  varying vec2 vP;
  void main() {
    const float S = 0.42;
    vec2 cell = (fract(vP / S) - 0.5) * S;
    float d = length(cell);
    float aa = fwidth(d) * 1.2;

    float glow = 0.0;
    for (int i = 0; i < 12; i++) {
      // Elongated behind the ticket (it travels +x), so each one leaves a trail.
      vec2 q = vP - uGlow[i].xy;
      float kx = q.x < 0.0 ? 0.3 : 1.6;
      glow += uGlow[i].z * exp(-(q.x * q.x * kx + q.y * q.y * 1.6));
    }
    glow = clamp(glow, 0.0, 1.0);

    float r = mix(0.028, 0.05, glow);
    float dotMask = 1.0 - smoothstep(r - aa, r + aa, d);
    // Drop dots before they shrink under a pixel, or the far floor moirés.
    // The larger axis catches grazing angles, where dots smear into streaks.
    vec2 fw = fwidth(vP);
    dotMask *= 1.0 - smoothstep(r * 0.6, r * 1.2, max(fw.x, fw.y));

    float far = 1.0 - smoothstep(7.0, 24.0, length(vP - uFocus));
    float wave = 0.72 + 0.28 * sin(dot(vP, vec2(0.55, 0.35)) - uTime * 0.7);

    // The floor is see-through: only the dots and the faint orange wash under
    // the tickets have alpha, so the page (and its rails) shows between them.
    vec3 dotCol = mix(uDot, uAccent, glow);
    float a = dotMask * max(far * wave, glow);
    float tint = glow * 0.07 * far;
    float outA = a + tint * (1.0 - a);
    vec3 col = (dotCol * a + uAccent * tint * (1.0 - a)) / max(outA, 1e-4);
    gl_FragColor = vec4(col, outA);
    #include <colorspace_fragment>
  }
`;

interface Kit {
  role: (r: Role | number) => THREE.ShaderMaterial;
  line: LineMaterial;
  hull: THREE.ShaderMaterial;
  floor: THREE.ShaderMaterial;
  glow: THREE.Vector3[];
  setPalette: (p: Palette) => void;
  setSize: (w: number, h: number) => void;
}

function makeKit(): Kit {
  const facet = (color: number) =>
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: FACET_VERT,
      fragmentShader: FACET_FRAG,
      // Fills sit a hair behind their own edges so outlines never z-fight.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

  const roles: Record<Role, THREE.ShaderMaterial> = {
    fill: facet(LIGHT.fill),
    fill2: facet(LIGHT.fill2),
    ink: facet(LIGHT.ink),
    orange: facet(ORANGE),
  };
  const fixed = new Map<number, THREE.ShaderMaterial>();
  const role = (r: Role | number) => {
    if (typeof r === 'string') return roles[r];
    if (!fixed.has(r)) fixed.set(r, facet(r));
    return fixed.get(r)!;
  };

  const line = new LineMaterial({ color: LIGHT.ink, linewidth: LINE_PX, worldUnits: false });

  const hull = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(LIGHT.ink) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uWidth: { value: LINE_PX },
    },
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    side: THREE.BackSide,
  });

  const glow = Array.from({ length: 12 }, () => new THREE.Vector3(0, 0, 0));
  const floor = new THREE.ShaderMaterial({
    uniforms: {
      uDot: { value: new THREE.Color(LIGHT.dot) },
      uAccent: { value: new THREE.Color(ORANGE) },
      uFocus: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uGlow: { value: glow },
    },
    vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    transparent: true,
  });

  return {
    role,
    line,
    hull,
    floor,
    glow,
    setPalette: (p) => {
      roles.fill.uniforms.uColor.value.setHex(p.fill);
      roles.fill2.uniforms.uColor.value.setHex(p.fill2);
      roles.ink.uniforms.uColor.value.setHex(p.ink);
      line.color.setHex(p.ink);
      hull.uniforms.uColor.value.setHex(p.ink);
      floor.uniforms.uDot.value.setHex(p.dot);
    },
    setSize: (w, h) => {
      line.resolution.set(w, h);
      hull.uniforms.uRes.value.set(w, h);
    },
  };
}

/* ————— canvas textures ————— */

function drawCode(c: HTMLCanvasElement, dark: boolean, accent = '#ff8a5c') {
  const g = c.getContext('2d')!;
  g.fillStyle = dark ? '#141311' : '#ffffff';
  g.fillRect(0, 0, 256, 160);
  // title bar dots
  const dot = dark ? '#8a857b' : '#cfc9bf';
  ['#ff5a1f', dot, dot].forEach((col, i) => {
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
}

function canvasTexture(w: number, h: number, draw: (c: HTMLCanvasElement) => void, repaint: (() => void)[]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paint = () => {
    draw(c);
    tex.needsUpdate = true;
  };
  paint();
  repaint.push(paint);
  return tex;
}

/* ————— builders ————— */

interface Ctx {
  kit: Kit;
  pal: () => Palette;
  repaint: (() => void)[];
}

/** A mesh in line-art: facet fill, crease edges, and optionally a hull for curved silhouettes. */
function part(
  ctx: Ctx,
  geo: THREE.BufferGeometry,
  role: Role | number,
  { edges = true, hull = false } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, ctx.kit.role(role));
  // Ink on ink needs no outline.
  if (role === 'ink') return m;
  if (edges) {
    const e = new LineSegments2(
      new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 28)),
      ctx.kit.line,
    );
    m.add(e);
  }
  if (hull) m.add(new THREE.Mesh(geo, ctx.kit.hull));
  return m;
}

const box = (
  ctx: Ctx, w: number, h: number, d: number, role: Role | number,
  x = 0, y = 0, z = 0,
): THREE.Mesh => {
  const m = part(ctx, new THREE.BoxGeometry(w, h, d), role);
  m.position.set(x, y, z);
  return m;
};

function cyl(ctx: Ctx, r: number, h: number, role: Role | number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = part(ctx, new THREE.CylinderGeometry(r, r, h, 32), role, { hull: true });
  m.position.set(x, y, z);
  return m;
}

function codePanel(ctx: Ctx, w = 3.2, h = 2): THREE.Group {
  const g = new THREE.Group();
  g.add(box(ctx, w, h, 0.12, 'ink'));
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.16, h - 0.16),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 160, (c) => drawCode(c, ctx.pal() === DARK), ctx.repaint),
    }),
  );
  face.position.z = 0.065;
  g.add(face);
  return g;
}

function paper(ctx: Ctx): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1.1, 1.4, 0.03);
  const fill = ctx.kit.role('fill');
  const face = new THREE.MeshBasicMaterial({
    map: canvasTexture(160, 200, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = hex(ctx.pal().fill);
      g.fillRect(0, 0, 160, 200);
      g.fillStyle = ctx.pal().paperInk;
      for (let i = 0; i < 9; i++) g.fillRect(16, 26 + i * 18, 60 + ((i * 37) % 70), 4);
    }, ctx.repaint),
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const m = new THREE.Mesh(geo, [fill, fill, fill, fill, face, fill]);
  m.add(new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo)), ctx.kit.line));
  return m;
}

/* ————— pipeline props (hero) ————— */

/** A turned profile (radius, height pairs, bottom to top) as one line-art solid. */
function lathe(ctx: Ctx, profile: [number, number][], role: Role | number, segments = 40): THREE.Mesh {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  return part(ctx, geo, role, { hull: true });
}

/** Ink line segments in the shared outline material; `pts` are pairs of points. */
function lines(ctx: Ctx, pts: number[]): LineSegments2 {
  return new LineSegments2(new LineSegmentsGeometry().setPositions(pts), ctx.kit.line);
}

/**
 * A person, as few shapes as will read as one: a turned body with shoulders
 * on a low base, a neck, a head. The human steps.
 */
function person(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  g.add(
    lathe(ctx, [
      [0, 0], [0.34, 0], [0.34, 0.07], [0.27, 0.11], // base
      [0.2, 0.2], [0.23, 0.6], [0.29, 0.78], // body widening to the shoulders
      [0.27, 0.86], [0.17, 0.93], [0.09, 0.95], [0, 0.95],
    ], 'ink'),
  );
  const neck = part(ctx, new THREE.CylinderGeometry(0.075, 0.09, 0.12, 20), 'ink');
  neck.position.y = 1.0;
  const head = part(ctx, new THREE.SphereGeometry(0.23, 32, 20), 'ink');
  head.position.y = 1.25;
  g.add(neck, head);
  return g;
}

/**
 * The agent: a screen-faced head with two lit eyes and an antenna, on a
 * block with a waist. Deliberately not a person.
 */
function agentBot(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  g.add(box(ctx, 0.62, 0.5, 0.54, 'fill2', 0, 0.25, 0));
  g.add(box(ctx, 0.72, 0.08, 0.62, 'fill', 0, 0.54, 0)); // the shoulder plate
  g.add(cyl(ctx, 0.08, 0.12, 'ink', 0, 0.63, 0));
  g.add(box(ctx, 0.86, 0.62, 0.66, 'fill', 0, 1.0, 0));
  // a dark visor the eyes light up on
  g.add(box(ctx, 0.66, 0.36, 0.02, 'ink', 0, 1.02, 0.335));
  for (const x of [-0.17, 0.17]) g.add(box(ctx, 0.13, 0.13, 0.02, 'orange', x, 1.03, 0.35));
  // ear bolts and an antenna
  for (const x of [-0.45, 0.45]) {
    const bolt = cyl(ctx, 0.08, 0.05, 'fill2', x, 1.0, 0);
    bolt.rotation.z = Math.PI / 2;
    g.add(bolt);
  }
  g.add(cyl(ctx, 0.025, 0.26, 'ink', 0.18, 1.44, 0));
  const tip = part(ctx, new THREE.SphereGeometry(0.07, 20, 14), 'orange', { edges: false, hull: true });
  tip.position.set(0.18, 1.6, 0);
  g.add(tip);
  return g;
}

/**
 * Serverless, drawn: a cloud with a flattish underside (a row of low, squashed
 * puffs) under taller crowns, and identical little instances under it.
 */
function cloud(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  // [x, y, z, radius, vertical squash]
  const puffs: [number, number, number, number, number][] = [
    // crowns
    [0, 0.2, 0, 0.6, 0.92], [0.24, 0.48, -0.12, 0.44, 0.9], [-0.42, 0.3, 0.1, 0.42, 0.9], [0.66, 0.08, 0, 0.46, 0.88],
    // the underside: low, wide puffs tucked into the crowns, so the bottom reads as one line
    [-0.78, -0.02, 0.04, 0.38, 0.72], [-0.3, -0.08, 0.1, 0.44, 0.66], [0.26, -0.1, 0.08, 0.46, 0.64], [0.86, -0.04, 0.04, 0.38, 0.72],
  ];
  for (const [x, y, z, r, squash] of puffs) {
    const p = part(ctx, new THREE.SphereGeometry(r, 36, 24), 'fill', { edges: false, hull: true });
    p.position.set(x, y, z);
    p.scale.set(1, squash, 1);
    g.add(p);
  }
  return g;
}

/** Mono caption lying on the floor beside a step. Repainted on theme change. */
function floorLabel(ctx: Ctx, no: string, text: string): THREE.Mesh {
  const tex = canvasTexture(512, 128, (c) => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 128);
    g.textBaseline = 'middle';
    g.font = "500 40px 'JetBrains Mono', ui-monospace, Menlo, monospace";
    g.fillStyle = '#ff5a1f';
    g.fillText(no, 8, 66);
    g.fillStyle = hex(ctx.pal().ink);
    g.font = "600 52px 'Bricolage Grotesque', system-ui, sans-serif";
    g.fillText(text, 90, 66);
  }, ctx.repaint);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.8),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* ————— the hero machine ————— */

/** Where a tracked ticket is, as the portal names a ticket's status. */
export type TrackStage = 'new' | 'approved' | 'in_progress' | 'review' | 'done' | 'declined';

/** The stages a board shows a station for; declined requests leave the machine. */
export const BOARD_STAGES = ['new', 'approved', 'in_progress', 'review', 'done'] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

/** One of the client's requests, as the board places it. */
export interface BoardItem {
  id: number;
  stage: TrackStage;
}

/** What the board reads every frame. The caller only has to change what these return. */
interface BoardFeed {
  items: () => BoardItem[];
  hovered: () => number | null;
}

const HERO_FOV = 26;

interface Machine {
  group: THREE.Group;
  cam: [number, number, number];
  look: [number, number, number];
  animated: THREE.Object3D[];
  tick: (t: number) => void;
  /** Board only: where each station's caption floats, in world space. */
  anchors?: Record<BoardStage, THREE.Vector3>;
  /** Board only: the meshes a pointer can pick, each with userData.id. */
  pickable?: () => THREE.Object3D[];
  /** Board only: where a ticket is now, or null when it is not on the machine. */
  ticketAt?: (id: number) => THREE.Vector3 | null;
}

/** Up to this many tickets pile up at one station; the caption counts the rest. */
const PILE = 6;

/**
 * The service drawn as a machine: request → approval gate (a person) → agent
 * at a terminal → review (a person) → shipped to a cloud, left to right along
 * +X, seen from the front-left so it climbs the screen.
 *
 * Without `board` it is the homepage's: six tickets ride the belt forever.
 * With `board` it is a client's own work: each request parked where it really
 * is — piled before the gate while it waits, past the gate approved, on the
 * bench while the agent works, with the reviewer, or lifted into the cloud —
 * and it glides there when its status changes, so progress is something you
 * watch happen.
 */
function heroMachine(ctx: Ctx, board?: BoardFeed): Machine {
    const g = new THREE.Group();
    const STEP_X = [-4.8, -1.6, 1.6, 4.8];
    const BELT_Z = 0.7;
    const PAD_Z = -1.35;
    const FACE = -Math.PI / 4; // turn a +Z face toward the camera

    // belt + rails
    g.add(box(ctx, 12.2, 0.3, 1.1, 'fill2', 0.2, 0.15, BELT_Z));
    for (const z of [BELT_Z - 0.6, BELT_Z + 0.6]) g.add(box(ctx, 12.2, 0.12, 0.1, 'ink', 0.2, 0.36, z));
    // a roller at each end, so the belt ends like a belt
    for (const x of [0.2 - 6.1, 0.2 + 6.1]) {
      const roller = cyl(ctx, 0.17, 1.3, 'fill', x, 0.17, BELT_Z);
      roller.rotation.x = Math.PI / 2;
      g.add(roller);
      const hub = cyl(ctx, 0.07, 1.36, 'ink', x, 0.17, BELT_Z);
      hub.rotation.x = Math.PI / 2;
      g.add(hub);
    }
    // seams across the belt surface
    const seams: number[] = [];
    for (let x = -5.6; x <= 6.0; x += 0.8) seams.push(x, 0.305, BELT_Z - 0.5, x, 0.305, BELT_Z + 0.5);
    g.add(lines(ctx, seams));

    // a pad per step, with its caption on the floor in front of the belt
    const captions: [string, string][] = [['01', 'REQUEST'], ['02', 'APPROVE'], ['03', 'BUILD'], ['04', 'SHIP']];
    STEP_X.forEach((x, i) => {
      // a plinth: a slab with a lipped top
      g.add(box(ctx, 2.3, 0.34, 2.0, 'fill', x, 0.17, PAD_Z));
      g.add(box(ctx, 2.1, 0.06, 1.8, 'fill2', x, 0.37, PAD_Z));
      const label = floorLabel(ctx, captions[i][0], captions[i][1]);
      label.position.set(x + 0.15, 0.02, BELT_Z + 1.35);
      g.add(label);
    });

    // 01 request — a letter and a chat bubble arriving
    const letter = box(ctx, 1.15, 0.78, 0.08, 'fill', STEP_X[0] - 0.35, 0.85, PAD_Z);
    letter.rotation.set(-0.25, FACE, 0);
    const seal = cyl(ctx, 0.13, 0.05, 'orange', 0, 0, 0.06);
    seal.rotation.x = Math.PI / 2;
    letter.add(seal);
    // the envelope's flap, drawn on its face
    letter.add(lines(ctx, [-0.56, 0.38, 0.045, 0, 0.02, 0.045, 0, 0.02, 0.045, 0.56, 0.38, 0.045]));
    const bubble = new THREE.Group();
    bubble.add(box(ctx, 1.05, 0.7, 0.3, 'fill'));
    bubble.add(box(ctx, 0.22, 0.22, 0.3, 'fill', -0.3, -0.38, 0).rotateZ(Math.PI / 4));
    for (const dx of [-0.26, 0, 0.26]) bubble.add(box(ctx, 0.12, 0.12, 0.05, 'ink', dx, 0, 0.17));
    bubble.position.set(STEP_X[0] + 0.5, 2.0, PAD_Z - 0.2);
    bubble.rotation.y = FACE;
    g.add(letter, bubble);

    // 02 approve — a person at a gate; the orange stamp only drops when a ticket is under it
    const gateX = STEP_X[1];
    for (const z of [BELT_Z - 0.75, BELT_Z + 0.75]) {
      g.add(box(ctx, 0.16, 2.1, 0.16, 'ink', gateX, 1.05, z));
      g.add(box(ctx, 0.36, 0.08, 0.36, 'ink', gateX, 0.04, z)); // a foot
    }
    g.add(box(ctx, 0.22, 0.2, 1.78, 'ink', gateX, 2.1, BELT_Z));
    // the stamp hangs from a housing under the beam: an orange body, a dark
    // rubber face, a handle on top
    g.add(cyl(ctx, 0.14, 0.2, 'ink', gateX, 1.92, BELT_Z));
    const stamp = new THREE.Group();
    stamp.position.set(gateX, 1.5, BELT_Z);
    stamp.add(cyl(ctx, 0.3, 0.36, 'orange', 0, 0.04, 0));
    stamp.add(cyl(ctx, 0.33, 0.08, 'ink', 0, -0.18, 0));
    stamp.add(cyl(ctx, 0.07, 0.16, 'ink', 0, 0.3, 0));
    const knob = part(ctx, new THREE.SphereGeometry(0.11, 20, 14), 'ink');
    knob.position.y = 0.42;
    stamp.add(knob);
    g.add(stamp);
    const approver = person(ctx);
    approver.position.set(gateX, 0.4, PAD_Z);
    g.add(approver);

    // 03 build — the agent at a terminal
    const term = codePanel(ctx, 2.1, 1.35);
    term.position.set(STEP_X[2] + 0.55, 1.35, PAD_Z - 0.45);
    term.rotation.y = FACE;
    g.add(box(ctx, 0.12, 0.62, 0.12, 'ink', STEP_X[2] + 0.55, 0.69, PAD_Z - 0.45));
    const foot = box(ctx, 0.7, 0.05, 0.42, 'ink', STEP_X[2] + 0.55, 0.425, PAD_Z - 0.45);
    foot.rotation.y = FACE;
    g.add(foot);
    // a keyboard between the agent and its screen
    const keys = new THREE.Group();
    keys.add(box(ctx, 0.9, 0.06, 0.32, 'fill'));
    for (let r = 0; r < 3; r++) keys.add(box(ctx, 0.74 - r * 0.08, 0.02, 0.05, 'fill2', 0, 0.04, -0.09 + r * 0.09));
    keys.position.set(STEP_X[2] + 0.05, 0.43, PAD_Z - 0.05);
    keys.rotation.y = FACE;
    g.add(keys);
    const bot = agentBot(ctx);
    bot.position.set(STEP_X[2] - 0.55, 0.4, PAD_Z + 0.35);
    bot.rotation.y = FACE;
    g.add(term, bot);

    // 04 ship — a second person checks it, then it lifts into the cloud
    const reviewer = person(ctx);
    reviewer.position.set(STEP_X[3] - 0.2, 0.4, PAD_Z);
    // the reviewer holds a clipboard: the checklist the work is read against
    const clipboard = box(ctx, 0.36, 0.46, 0.03, 'fill', 0.2, 0.86, 0.3);
    clipboard.rotation.set(-0.5, FACE, 0);
    clipboard.add(box(ctx, 0.14, 0.05, 0.03, 'ink', 0, 0.22, 0.01));
    clipboard.add(lines(ctx, [-0.12, 0.08, 0.02, 0.12, 0.08, 0.02, -0.12, -0.01, 0.02, 0.1, -0.01, 0.02, -0.12, -0.1, 0.02, 0.06, -0.1, 0.02]));
    reviewer.add(clipboard);
    g.add(reviewer);
    const sky = cloud(ctx);
    sky.position.set(7.4, 3.5, BELT_Z - 0.2);
    sky.scale.setScalar(1.25);
    g.add(sky);
    // identical instances under the cloud: scaling is more of the same box
    const instances: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const inst = box(ctx, 0.3, 0.3, 0.3, i === 1 ? 'orange' : 'ink', 6.75 + i * 0.44, 2.45, BELT_Z - 0.2);
      instances.push(inst);
      g.add(inst);
    }

    // tickets riding the belt; what they look like says which step they passed
    const START = -6.1;
    const LIFT = 5.9; // where the belt ends and the ticket rises
    const END = 7.4;
    const ticketGeo = new THREE.BoxGeometry(0.66, 0.12, 0.46);
    type Tk = { group: THREE.Group; stage: THREE.Mesh[]; mark: THREE.Mesh; x: number; goal: number; slot: number; lift: number; status: TrackStage };
    const makeTicket = (id = 0): Tk => {
      const stage = (['fill', 'ink', 'orange'] as const).map((r) => {
        const m = part(ctx, ticketGeo, r);
        m.userData.id = id;
        return m;
      });
      const t = new THREE.Group();
      t.add(...stage);
      const mark = cyl(ctx, 0.11, 0.03, 'orange', 0.16, 0.07, 0.08);
      t.add(mark);
      // the tear-off stub, as on a real ticket
      t.add(lines(ctx, [-0.17, 0.062, -0.2, -0.17, 0.062, -0.12, -0.17, 0.062, -0.06, -0.17, 0.062, 0.02, -0.17, 0.062, 0.08, -0.17, 0.062, 0.16]));
      g.add(t);
      return { group: t, stage, mark, x: START, goal: START, slot: 0, lift: 0, status: 'new' };
    };
    const loop = board ? [] : Array.from({ length: 6 }, () => makeTicket());

    /**
     * Put a ticket at belt position x, `up` above the belt and `off` toward the
     * camera, lighting the floor glow slot `glow`; returns how close it is to the gate.
     */
    const place = (tk: Tk, x: number, glow: number, up = 0, off = 0) => {
      const { group, stage, mark } = tk;
      const lift = Math.max(0, (x - LIFT) / (END - LIFT));
      group.position.set(x, 0.43 + lift * lift * 2.7 + up, BELT_Z - lift * 0.2 + off);
      group.scale.setScalar(1 - lift * 0.55);
      const s = x > STEP_X[3] ? 2 : x > STEP_X[2] ? 1 : 0;
      stage.forEach((m, k) => (m.visible = k === s));
      mark.visible = x > gateX && x <= STEP_X[2];
      // The floor glow follows the ticket; it brightens once approved and
      // fades as the ticket lifts off into the cloud.
      const approved = THREE.MathUtils.smoothstep(x, gateX - 0.3, gateX + 0.6);
      const enter = THREE.MathUtils.smoothstep(x, START, START + 0.8);
      // Centred just in front of the belt: the belt itself hides the floor.
      if (glow < ctx.kit.glow.length) ctx.kit.glow[glow].set(x, BELT_Z + 0.95, (0.35 + 0.65 * approved) * enter * (1 - lift));
      return Math.abs(x - gateX);
    };

    // Board: where each stage parks a ticket.
    const STAGE_X: Record<TrackStage, number> = {
      new: gateX - 1.25,
      approved: gateX + 0.95,
      // Just short of the build line: the shiver must not flip its look.
      in_progress: STEP_X[2] - 0.2,
      review: STEP_X[3],
      done: END,
      declined: gateX - 1.25,
    };
    const pool = new Map<number, Tk>();
    let primed = false;
    let last = 0;

    /** The board's tickets follow the feed: new ones appear, gone ones leave, moved ones glide. */
    const follow = (time: number) => {
      const dt = Math.min(0.1, Math.max(0, time - last));
      last = time;
      const piles = new Map<TrackStage, number>();
      const seen = new Set<number>();
      for (const item of board!.items()) {
        if (item.stage === 'declined') continue;
        seen.add(item.id);
        let tk = pool.get(item.id);
        if (!tk) {
          tk = makeTicket(item.id);
          // What is there on first paint is simply there; what arrives later rides in.
          tk.x = primed ? START : STAGE_X[item.stage];
          pool.set(item.id, tk);
        }
        const slot = piles.get(item.stage) ?? 0;
        piles.set(item.stage, slot + 1);
        tk.goal = STAGE_X[item.stage];
        tk.slot = slot;
        tk.status = item.stage;
      }
      for (const [id, tk] of pool) {
        if (seen.has(id)) continue;
        g.remove(tk.group);
        pool.delete(id);
      }
      primed = true;
      ctx.kit.glow.forEach((v) => v.set(0, 0, 0));

      const hovered = board!.hovered();
      let nearestGate = Infinity;
      let working = false;
      let waiting = false;
      let glow = 0;
      for (const [id, tk] of pool) {
        // Glide at a steady pace, so a change reads as travel.
        tk.x += Math.sign(tk.goal - tk.x) * Math.min(Math.abs(tk.goal - tk.x), dt * 2.4);
        const parked = Math.abs(tk.goal - tk.x) < 0.01;
        const busy = tk.status === 'in_progress' && parked;
        working ||= busy;
        waiting ||= tk.status === 'new';
        tk.lift += ((hovered === id ? 1 : 0) - tk.lift) * Math.min(1, dt * 12);
        tk.group.visible = tk.slot < PILE;
        // Piles stack upward; shipped ones fan out in the cloud instead.
        const shipped = tk.status === 'done';
        const up = (shipped ? 0 : tk.slot * 0.15) + tk.lift * 0.35;
        const off = shipped ? (tk.slot - 1) * 0.45 : 0;
        // Being worked on: the ticket shivers on the bench.
        const x = tk.x + (busy ? Math.sin(time * 9 + id) * 0.035 : 0);
        const gate = place(tk, x, tk.slot === 0 ? glow++ : 99, up, off);
        tk.group.rotation.y = tk.lift * 0.25;
        if (tk.status !== 'new') nearestGate = Math.min(nearestGate, gate);
      }
      bot.rotation.x = working ? Math.sin(time * 4.2) * 0.06 : 0;
      // Waiting at the gate: the stamp hangs ready, breathing.
      stamp.position.y = 1.5 - 0.72 * Math.max(0, 1 - nearestGate / 0.45) + (waiting ? Math.sin(time * 2) * 0.05 : 0);
    };

    const tick = (time: number) => {
      if (board) follow(time);
      else {
        let nearestGate = Infinity;
        loop.forEach((tk, i) => {
          const u = (time * 0.045 + i / loop.length) % 1;
          nearestGate = Math.min(nearestGate, place(tk, START + u * (END - START), i));
        });
        stamp.position.y = 1.5 - 0.72 * Math.max(0, 1 - nearestGate / 0.45);
      }
      instances.forEach((inst, i) => {
        inst.position.y = 2.45 + Math.sin(time * 1.3 + i * 1.1) * 0.07;
      });
    };
    tick(8); // a settled frame for reduced motion and first paint

    // Classic isometric direction (1 : 0.82 : 1), from the front-left.
    const LOOK: [number, number, number] = [-0.4, 0.9, 0];
    const D = 21;
    return {
      group: g,
      cam: [LOOK[0] - D, LOOK[1] + D * 0.82, LOOK[2] + D],
      look: LOOK,
      animated: [bubble, sky],
      tick,
      ...(board
        ? {
            // Each caption floats over the prop that stands for its step.
            anchors: {
              new: new THREE.Vector3(STEP_X[0] + 0.3, 2.9, PAD_Z),
              approved: new THREE.Vector3(gateX + 0.2, 2.75, BELT_Z),
              in_progress: new THREE.Vector3(STEP_X[2] - 0.2, 2.3, PAD_Z - 0.45),
              review: new THREE.Vector3(STEP_X[3] + 0.4, 1.85, PAD_Z),
              done: new THREE.Vector3(7.0, 2.2, BELT_Z + 0.6),
            },
            pickable: () => [...pool.values()].filter((tk) => tk.group.visible).flatMap((tk) => tk.stage.filter((m) => m.visible)),
            ticketAt: (id: number) => {
              const tk = pool.get(id);
              return tk && tk.group.visible ? tk.group.getWorldPosition(new THREE.Vector3()) : null;
            },
          }
        : {}),
    };
}

/* ————— stations ————— */

interface Station {
  /** Matches a room's data-station attribute. */
  name: string;
  cam: [number, number, number];
  look: [number, number, number];
  animated: THREE.Object3D[];
  /** Vertical field of view; narrow + far reads as isometric. Default 38. */
  fov?: number;
  /** Per-frame motion beyond the idle float (the hero belt). */
  tick?: (t: number) => void;
}

const DEFAULT_FOV = 38;

function buildStations(scene: THREE.Scene, ctx: Ctx): Station[] {
  const stations: Station[] = [];
  const at = (i: number) => i * GAP;

  // 0 — hero: the service as a machine (see heroMachine).
  {
    const hero = heroMachine(ctx);
    hero.group.position.x = at(0);
    scene.add(hero.group);
    stations.push({ name: 'hero', cam: hero.cam, look: hero.look, animated: hero.animated, fov: HERO_FOV, tick: hero.tick });
  }

  // 1 — how it works: the queue itself, tickets in a stack with one approved
  {
    const g = new THREE.Group();
    g.position.x = at(1);
    g.add(box(ctx, 3.4, 0.5, 2.6, 'fill2', 5.4, 0.25, -3.2));
    for (let i = 0; i < 7; i++) {
      const slab = box(ctx, 2.5, 0.2, 1.7, i === 4 ? 'orange' : 'fill', 5.4, 0.62 + i * 0.24, -3.2);
      slab.rotation.y = ((i * 37) % 9 - 4) * 0.035;
      g.add(slab);
    }
    scene.add(g);
    stations.push({ name: 'how', cam: [at(1), 3.2, 12], look: [at(1), 1.5, -1], animated: [] });
  }

  // 2 — shelf room: kind-colored project boxes on a long plank
  {
    const g = new THREE.Group();
    g.position.x = at(2);
    g.add(box(ctx, 11, 0.5, 3, 'fill2', 2.5, 0.25, -3.5));
    const specs: [Role | number, number, number, number][] = [
      [SHOPIFY, 1.5, 2.4, 1.5], ['orange', 1.2, 1.7, 1.2], ['ink', 1.3, 2.0, 1.3], [GREY, 1.1, 1.4, 1.1],
    ];
    specs.forEach(([col, w, h, d], i) => {
      const x = -0.5 + i * 2.1;
      g.add(box(ctx, w, h, d, col, x, 0.5 + h / 2, -3.5));
      g.add(box(ctx, w + 0.02, 0.24, d + 0.02, 'fill', x, 0.5 + h - 0.12, -3.5));
    });
    scene.add(g);
    stations.push({ name: 'shelf', cam: [at(2) + 1, 2.6, 11], look: [at(2) + 1.5, 1.2, -1], animated: [] });
  }

  // 3 — writing room: papers lifting off a low plinth
  {
    const g = new THREE.Group();
    g.position.x = at(3);
    g.add(box(ctx, 4.2, 0.6, 3, 'fill2', 4.6, 0.3, -2.6));
    const sheets: THREE.Object3D[] = [];
    for (let i = 0; i < 5; i++) {
      const s = paper(ctx);
      s.position.set(2.6 + i * 0.85, 2.3 + i * 0.5, -2.9 + (i % 2) * 0.5);
      s.rotation.set(-0.25 + i * 0.08, 0.3 - i * 0.15, 0.12 - i * 0.05);
      sheets.push(s);
      g.add(s);
    }
    scene.add(g);
    stations.push({ name: 'writing', cam: [at(3) + 1, 2.8, 10.6], look: [at(3) + 1.4, 1.7, 0], animated: sheets });
  }

  // 4 — work room: pillars like a bar-chart timeline
  {
    const g = new THREE.Group();
    g.position.x = at(4);
    [1.4, 2.3, 3.1, 1.9].forEach((h, i) => {
      g.add(box(ctx, 1.4, h, 1.7, i === 2 ? 'orange' : 'fill', -2.6 + i * 1.9, h / 2, -4.5));
    });
    scene.add(g);
    stations.push({ name: 'work', cam: [at(4), 3.4, 12], look: [at(4), 1.1, -2], animated: [] });
  }

  // 5 — library (knowledgebase + plugins): index cards filed in a tray
  {
    const g = new THREE.Group();
    g.position.x = at(5);
    g.add(box(ctx, 5.2, 0.5, 1.8, 'fill2', 4.4, 0.25, -3));
    for (let i = 0; i < 11; i++) {
      const h = 1.1 + ((i * 7) % 4) * 0.14;
      const card = box(ctx, 0.1, h, 1.3, i === 6 ? 'orange' : 'fill', 2.3 + i * 0.42, 0.5 + h / 2, -3);
      card.rotation.z = -0.08;
      g.add(card);
    }
    scene.add(g);
    stations.push({ name: 'library', cam: [at(5) + 1, 2.8, 11], look: [at(5) + 1.4, 1.5, -1], animated: [] });
  }

  // 6 — intercom room: the orange beacon
  {
    const g = new THREE.Group();
    g.position.x = at(6);
    const beacon = box(ctx, 1.6, 4.4, 1.6, 'orange', 0, 2.2, -4.5);
    g.add(beacon);
    g.add(box(ctx, 3, 0.7, 3, 'fill', 0, 0.35, -4.5));
    scene.add(g);
    stations.push({ name: 'talk', cam: [at(6), 3, 12.5], look: [at(6), 1.9, -2], animated: [beacon] });
  }

  return stations;
}

/* ————— driver ————— */

export function initWorkshop(canvas: HTMLCanvasElement): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Transparent canvas: the page background and rails sit behind it, and
  // only the props and floor dots paint over them.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 400);

  let pal = LIGHT;
  const kit = makeKit();
  const repaint: (() => void)[] = [];
  const ctx: Ctx = { kit, pal: () => pal, repaint };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 240), // deep enough that the isometric hero never sees an edge
    kit.floor,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(32, 0, -6);
  // First among the transparent pass, so the floor captions draw over it.
  floor.renderOrder = -1;
  scene.add(floor);

  const stations = buildStations(scene, ctx);
  // Web fonts may land after first paint; redraw the captions once they have.
  document.fonts?.ready.then(() => repaint.forEach((draw) => draw()));

  // Theme sync — read the page attribute, repaint on change.
  const applyTheme = () => {
    pal = document.documentElement.dataset.theme === 'dark' ? DARK : LIGHT;
    kit.setPalette(pal);
    repaint.forEach((draw) => draw());
    if (reduced) renderer.render(scene, camera);
  };
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // Scroll driver: which room is in the viewport → its station. Rooms name
  // their station with data-station, so adding a room to the page never
  // shifts every backdrop after it; an unnamed room keeps the previous one.
  // Mapped by offsetTop, not scrollY/innerHeight, so the pose lands on the
  // room you're in even when a section overshoots the viewport.
  const last = stations.length - 1;
  let rooms: { top: number; station: number }[] = [];
  const measure = () => {
    let previous = 0;
    rooms = Array.from(document.querySelectorAll<HTMLElement>('.room, .intercom'))
      .sort((a, b) => a.offsetTop - b.offsetTop)
      .map((el) => {
        const named = stations.findIndex((st) => st.name === (el.dataset.station ?? (el.classList.contains('intercom') ? 'talk' : '')));
        previous = named === -1 ? previous : named;
        return { top: el.offsetTop, station: previous };
      });
  };
  measure();
  const targetFor = () => {
    const y = window.scrollY + window.innerHeight * 0.45;
    let i = 0;
    while (i < rooms.length - 1 && rooms[i + 1].top <= y) i += 1;
    return rooms[i]?.station ?? 0;
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
    const mix = (x: number, y: number) => THREE.MathUtils.lerp(x, y, f);
    look.set(mix(a.look[0], b.look[0]), mix(a.look[1], b.look[1]), mix(a.look[2], b.look[2]));
    // Zoom scales the whole look→camera offset, so an angled (isometric)
    // pose pulls straight back instead of sliding sideways.
    pos.set(mix(a.cam[0], b.cam[0]), mix(a.cam[1], b.cam[1]), mix(a.cam[2], b.cam[2]))
      .sub(look)
      .multiplyScalar(zoom)
      .add(look);
    const fov = mix(a.fov ?? DEFAULT_FOV, b.fov ?? DEFAULT_FOV);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    kit.floor.uniforms.uFocus.value.set(look.x, look.z);
  };

  // Lens shift, not a camera move: wide screens slide the diorama right so
  // the left-aligned DOM text reads on clear floor; tall screens lift it into
  // the empty band under the header. Perspective stays identical.
  const frame = (w: number, h: number) => {
    const aspect = w / h;
    const dx = aspect >= 1.25 ? -w * THREE.MathUtils.clamp((aspect - 1.25) * 0.6, 0, 0.22) : 0;
    const dy = aspect < 0.9 ? h * 0.12 : 0;
    if (dx || dy) camera.setViewOffset(w, h, dx, dy, w, h);
    else camera.clearViewOffset();
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    kit.setSize(w, h);
    camera.aspect = w / h;
    frame(w, h);
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
    kit.floor.uniforms.uTime.value = t;
    // Gentle idle float on registered props + pointer parallax.
    stations.forEach((s, si) => {
      s.tick?.(t);
      s.animated.forEach((o, oi) => {
        o.position.y += Math.sin(t * 0.9 + si * 2 + oi) * 0.0016;
        o.rotation.z += Math.sin(t * 0.5 + oi) * 0.0004;
      });
    });
    camera.position.set(pos.x + mouse.x * 0.7, pos.y - mouse.y * 0.4, pos.z);
    camera.lookAt(look);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}

/* ————— board: a client's requests, in its own canvas ————— */

/** A point on screen, in CSS pixels from the canvas's top-left. */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface BoardOptions {
  /** The requests to show; read every frame. */
  items: () => BoardItem[];
  /** The pointer is over a ticket (its id), or left them (null). */
  onHover?: (id: number | null) => void;
  /** A ticket was clicked. */
  onPick?: (id: number) => void;
  /**
   * After each drawn frame: where each station's caption goes and where the
   * hovered ticket is, so DOM labels can ride on the scene.
   */
  onFrame?: (stations: Record<BoardStage, ScreenPoint>, hovered: (ScreenPoint & { id: number }) | null) => void;
}

export interface Board {
  /** Glide the camera toward a ticket (a click's "going in"), or back out with null. */
  focus: (id: number | null) => void;
  /** Hover a ticket from outside the scene, e.g. its row in a list. */
  hover: (id: number | null) => void;
  stop: () => void;
}

/**
 * The hero machine as a client's board, sized to `canvas`: every request they
 * have, parked at its real stage. Tickets can be hovered and clicked; station
 * captions are DOM, placed through `onFrame`. Pauses while the canvas is off
 * screen or the tab is hidden; reduced motion snaps instead of gliding.
 */
export function initBoard(canvas: HTMLCanvasElement, options: BoardOptions): Board {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(HERO_FOV, 1, 0.1, 400);
  let pal = LIGHT;
  const kit = makeKit();
  const repaint: (() => void)[] = [];
  const ctx: Ctx = { kit, pal: () => pal, repaint };

  let hovered: number | null = null;
  let outside: number | null = null;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), kit.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -1;
  scene.add(floor);
  const machine = heroMachine(ctx, { items: options.items, hovered: () => hovered ?? outside });
  scene.add(machine.group);
  document.fonts?.ready.then(() => repaint.forEach((draw) => draw()));

  const home = new THREE.Vector3(...machine.look).add(new THREE.Vector3(1.0, 0.85, 0.6));
  const look = home.clone();
  // More from the front than the homepage's isometric view: the belt runs
  // across a wide board instead of climbing it, and the stations spread out.
  const base = home.clone().add(new THREE.Vector3(-4.5, 12, 21));
  const mouse = { x: 0, y: 0 };
  let fit = 1;
  let dive = 0; // 0 = the whole machine, 1 = close on the focused ticket
  let focusId: number | null = null;
  let size = { w: 1, h: 1 };

  const anchors = machine.anchors!;
  const toScreen = (v: THREE.Vector3): ScreenPoint => {
    const p = v.clone().project(camera);
    return { x: ((p.x + 1) / 2) * size.w, y: ((1 - p.y) / 2) * size.h };
  };

  const render = () => {
    const target = focusId !== null ? machine.ticketAt!(focusId) : null;
    if (target) look.lerpVectors(home, target, dive);
    else look.copy(home);
    camera.position.copy(base).sub(home).multiplyScalar(fit * (1 - dive * 0.55)).add(look);
    camera.position.x += mouse.x * 0.5;
    camera.position.y -= mouse.y * 0.3;
    camera.lookAt(look);
    kit.floor.uniforms.uFocus.value.set(look.x, look.z);
    renderer.render(scene, camera);
    if (options.onFrame) {
      const stations = Object.fromEntries(BOARD_STAGES.map((s) => [s, toScreen(anchors[s])])) as Record<BoardStage, ScreenPoint>;
      const id = hovered ?? outside;
      const at = id !== null ? machine.ticketAt!(id) : null;
      options.onFrame(stations, at && id !== null ? { id, ...toScreen(at.add(new THREE.Vector3(0, 0.3, 0))) } : null);
    }
  };

  const applyTheme = () => {
    pal = document.documentElement.dataset.theme === 'dark' ? DARK : LIGHT;
    kit.setPalette(pal);
    repaint.forEach((draw) => draw());
    render();
  };
  applyTheme();
  const themeWatch = new MutationObserver(applyTheme);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const resize = () => {
    size = { w: Math.max(1, canvas.clientWidth), h: Math.max(1, canvas.clientHeight) };
    renderer.setSize(size.w, size.h, false);
    kit.setSize(size.w, size.h);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    // The machine is wide: narrower boxes pull back so all of it stays in frame.
    fit = THREE.MathUtils.clamp(1.6 / camera.aspect, 0.62, 1.3);
    render();
  };
  const sizeWatch = new ResizeObserver(resize);
  sizeWatch.observe(canvas);
  resize();

  // Picking: the pointer over a ticket hovers it; a click opens it.
  const ray = new THREE.Raycaster();
  const pick = (e: PointerEvent | MouseEvent): number | null => {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(machine.pickable!(), false)[0];
    return hit ? (hit.object.userData.id as number) : null;
  };
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
    mouse.y = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
    if (e.target !== canvas) return;
    const id = pick(e);
    if (id !== hovered) {
      hovered = id;
      canvas.style.cursor = id === null ? '' : 'pointer';
      options.onHover?.(id);
    }
  };
  const onLeave = () => {
    if (hovered === null) return;
    hovered = null;
    canvas.style.cursor = '';
    options.onHover?.(null);
  };
  const onClick = (e: MouseEvent) => {
    const id = pick(e);
    if (id !== null) options.onPick?.(id);
  };
  window.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  let visible = true;
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  seen.observe(canvas);

  const timer = new THREE.Timer();
  let frame = 0;
  let clock = 8;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    timer.update();
    const dt = Math.min(0.1, timer.getDelta());
    if (reduced) {
      // No glide, no idle motion: big steps settle everything at once.
      for (let i = 0; i < 60; i += 1) machine.tick((clock += 0.1));
      dive = focusId !== null ? 1 : 0;
    } else {
      clock += dt;
      machine.tick(clock);
      kit.floor.uniforms.uTime.value = clock;
      machine.animated.forEach((o, i) => {
        o.position.y += Math.sin(clock * 0.9 + i) * 0.0016;
      });
      dive += ((focusId !== null ? 1 : 0) - dive) * Math.min(1, dt * 6);
    }
    render();
  };
  loop();

  return {
    focus: (id) => {
      focusId = id;
    },
    hover: (id) => {
      outside = id;
    },
    stop: () => {
      cancelAnimationFrame(frame);
      themeWatch.disconnect();
      sizeWatch.disconnect();
      seen.disconnect();
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      renderer.dispose();
    },
  };
}
