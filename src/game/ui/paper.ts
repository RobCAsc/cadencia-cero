import Phaser from 'phaser';
import { FONT_MONO, FONT_SANS } from '../theme';

// El lenguaje visual del campamento y los paneles: papeles clavados en un
// tablón de madera, tinta, sellos de goma e iconos trazados por código. Es
// lo que un grupo de supervivientes tendría en una pared, y saca la
// información del "texto en una tabla" sin un solo asset.

export const PAPER = 0xe9e0c8;
export const PAPER_DARK = 0xd9cfb3;
export const WOOD = 0x4d3421;
export const WOOD_DARK = 0x3b2816;
export const WOOD_LIGHT = 0x6a4a30;
export const PIN = 0xc0392b;
export const INK = '#2a2420';
export const INK_MUTED = '#6d6356';
export const INK_DIM = '#9a8f80';
export const INK_RED = '#b23a2f';
export const INK_GREEN = '#2f6b3a';
export const INK_GOLD = '#8a6d1e';
export const INK_HEX = 0x2a2420;
export const INK_RED_HEX = 0xb23a2f;
export const INK_GREEN_HEX = 0x2f6b3a;
export const INK_GOLD_HEX = 0x8a6d1e;

export interface PaperOptions {
  /** Chinchetas en las esquinas de arriba. */
  pins?: boolean;
  /** Ligera inclinación (rad) para que no parezca una tabla. */
  tilt?: number;
  depth?: number;
  /** Papel más oscuro (una nota vieja). */
  dark?: boolean;
}

/** Un papel clavado: sombra, borde irregular, chinchetas. Devuelve el contenedor para inclinarlo entero. */
export function paper(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PaperOptions = {}): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y }).setDepth(opts.depth ?? 0);
  g.setRotation(opts.tilt ?? 0);
  // Sombra
  g.fillStyle(0x000000, 0.35);
  g.fillRect(6, 8, w, h);
  // El papel, con el borde de abajo un poco roto.
  g.fillStyle(opts.dark ? PAPER_DARK : PAPER, 1);
  const tear: Phaser.Types.Math.Vector2Like[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h - 6 },
  ];
  for (let px = w; px > 0; px -= 14) tear.push({ x: px - 7, y: h - 2 - ((px * 7) % 5) }, { x: px - 14, y: h - 6 + ((px * 3) % 4) });
  tear.push({ x: 0, y: h - 6 });
  g.fillPoints(tear, true);
  // Una línea de pliegue tenue.
  g.lineStyle(1, 0x000000, 0.06);
  g.lineBetween(12, h * 0.55, w - 12, h * 0.55 + 3);
  if (opts.pins ?? true) {
    for (const px of [16, w - 16]) {
      g.fillStyle(0x000000, 0.25);
      g.fillCircle(px + 2, 14, 6);
      g.fillStyle(PIN, 1);
      g.fillCircle(px, 12, 6);
      g.fillStyle(0xffffff, 0.35);
      g.fillCircle(px - 2, 10, 2);
    }
  }
  return g;
}

/** El tablón de madera: tablas, clavos y un marco. */
export function board(scene: Phaser.Scene, x: number, y: number, w: number, h: number, depth = 0): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y }).setDepth(depth);
  g.fillStyle(0x000000, 0.4);
  g.fillRect(8, 10, w, h);
  g.fillStyle(WOOD, 1);
  g.fillRect(0, 0, w, h);
  const planks = Math.max(3, Math.round(h / 90));
  for (let i = 0; i < planks; i++) {
    const py = (h / planks) * i;
    g.fillStyle(i % 2 === 0 ? WOOD_LIGHT : WOOD, 0.35);
    g.fillRect(0, py, w, h / planks);
    g.lineStyle(2, WOOD_DARK, 0.9);
    g.lineBetween(0, py, w, py);
    // Veta
    g.lineStyle(1, WOOD_DARK, 0.25);
    for (let k = 0; k < 3; k++) {
      const vy = py + 12 + k * (h / planks / 3.4);
      g.lineBetween(10 + k * 30, vy, w - 20 - k * 40, vy + 2);
    }
  }
  g.lineStyle(6, WOOD_DARK, 1);
  g.strokeRect(0, 0, w, h);
  for (const [nx, ny] of [
    [10, 10],
    [w - 10, 10],
    [10, h - 10],
    [w - 10, h - 10],
  ] as const) {
    g.fillStyle(0x1a1410, 1);
    g.fillCircle(nx, ny, 3);
  }
  return g;
}

/** Un sello de goma: texto en mayúsculas con marco, inclinado y un poco desgastado. */
export function stamp(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string = INK_RED,
  depth = 1,
  size = 16,
): Phaser.GameObjects.Container {
  const label = scene.add
    .text(0, 0, text.toUpperCase(), { fontFamily: FONT_SANS, fontSize: `${size}px`, fontStyle: 'bold', color })
    .setOrigin(0.5)
    .setLetterSpacing(2)
    .setAlpha(0.85);
  const pad = 10;
  const frame = scene.add.graphics();
  frame.lineStyle(3, Phaser.Display.Color.HexStringToColor(color).color, 0.8);
  frame.strokeRoundedRect(-label.width / 2 - pad, -label.height / 2 - 4, label.width + pad * 2, label.height + 8, 4);
  const c = scene.add.container(x, y, [frame, label]).setDepth(depth).setRotation(-0.08);
  return c;
}

/** Título de papel: mayúsculas, negrita, espaciado; lo más parecido a una plantilla. */
export function heading(scene: Phaser.Scene, x: number, y: number, text: string, size = 15, color: string = INK_MUTED, depth = 1): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text.toUpperCase(), { fontFamily: FONT_SANS, fontSize: `${size}px`, fontStyle: 'bold', color })
    .setLetterSpacing(3)
    .setDepth(depth);
}

/** Un número grande de tinta, en monoespaciada. */
export function bigNumber(scene: Phaser.Scene, x: number, y: number, text: string, size = 40, color: string = INK, depth = 1): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, { fontFamily: FONT_MONO, fontSize: `${size}px`, fontStyle: 'bold', color }).setDepth(depth);
}

export type IconName =
  | 'heart'
  | 'bike'
  | 'zombie'
  | 'clock'
  | 'sun'
  | 'flame'
  | 'map'
  | 'trophy'
  | 'pencil'
  | 'clipboard'
  | 'band'
  | 'skull'
  | 'check'
  | 'flag'
  | 'moon'
  | 'lung'
  | 'target'
  | 'road'
  | 'mountain'
  | 'bolt'
  | 'house'
  | 'compass'
  | 'snowflake'
  | 'arrowDown'
  | 'warning';

/**
 * Iconos trazados con líneas y círculos, tamaño `size` (alto), centrados en
 * (cx, cy). Dibujan sobre el Graphics que se les pasa, en el color dado.
 */
export function icon(g: Phaser.GameObjects.Graphics, name: IconName, cx: number, cy: number, size: number, color: number, alpha = 1): void {
  const s = size / 2;
  const lw = Math.max(1.5, size / 11);
  g.lineStyle(lw, color, alpha);
  g.fillStyle(color, alpha);
  switch (name) {
    case 'heart': {
      g.fillCircle(cx - s * 0.42, cy - s * 0.3, s * 0.48);
      g.fillCircle(cx + s * 0.42, cy - s * 0.3, s * 0.48);
      g.fillTriangle(cx - s * 0.88, cy - s * 0.1, cx + s * 0.88, cy - s * 0.1, cx, cy + s * 0.95);
      break;
    }
    case 'bike': {
      g.strokeCircle(cx - s * 0.6, cy + s * 0.35, s * 0.42);
      g.strokeCircle(cx + s * 0.6, cy + s * 0.35, s * 0.42);
      g.lineBetween(cx - s * 0.6, cy + s * 0.35, cx - s * 0.1, cy - s * 0.35);
      g.lineBetween(cx - s * 0.1, cy - s * 0.35, cx + s * 0.45, cy - s * 0.35);
      g.lineBetween(cx + s * 0.45, cy - s * 0.35, cx + s * 0.6, cy + s * 0.35);
      g.lineBetween(cx - s * 0.1, cy - s * 0.35, cx + s * 0.05, cy + s * 0.35);
      g.lineBetween(cx + s * 0.05, cy + s * 0.35, cx - s * 0.6, cy + s * 0.35);
      g.lineBetween(cx + s * 0.05, cy + s * 0.35, cx + s * 0.6, cy + s * 0.35);
      g.lineBetween(cx + s * 0.35, cy - s * 0.65, cx + s * 0.6, cy - s * 0.6);
      break;
    }
    case 'zombie': {
      g.fillCircle(cx + s * 0.15, cy - s * 0.62, s * 0.24);
      g.lineStyle(lw * 1.6, color, alpha);
      g.lineBetween(cx - s * 0.1, cy - s * 0.3, cx + s * 0.2, cy + s * 0.15); // torso inclinado
      g.lineStyle(lw, color, alpha);
      g.lineBetween(cx + s * 0.05, cy - s * 0.2, cx + s * 0.7, cy - s * 0.25); // brazos por delante
      g.lineBetween(cx + s * 0.05, cy - s * 0.05, cx + s * 0.65, cy - s * 0.02);
      g.lineBetween(cx + s * 0.2, cy + s * 0.15, cx - s * 0.2, cy + s * 0.9); // piernas
      g.lineBetween(cx + s * 0.2, cy + s * 0.15, cx + s * 0.55, cy + s * 0.9);
      break;
    }
    case 'clock': {
      g.strokeCircle(cx, cy, s * 0.85);
      g.lineBetween(cx, cy, cx, cy - s * 0.55);
      g.lineBetween(cx, cy, cx + s * 0.4, cy + s * 0.2);
      break;
    }
    case 'sun': {
      g.fillCircle(cx, cy, s * 0.42);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.lineBetween(cx + Math.cos(a) * s * 0.58, cy + Math.sin(a) * s * 0.58, cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9);
      }
      break;
    }
    case 'moon': {
      g.fillCircle(cx, cy, s * 0.8);
      g.fillStyle(0x000000, 0); // el mordisco se hace con el fondo: se dibuja aparte por el llamador
      break;
    }
    case 'flame': {
      g.fillTriangle(cx - s * 0.55, cy + s * 0.2, cx + s * 0.55, cy + s * 0.2, cx, cy - s * 0.95);
      g.fillCircle(cx, cy + s * 0.3, s * 0.58);
      break;
    }
    case 'map':
    case 'road': {
      g.beginPath();
      g.moveTo(cx - s * 0.9, cy + s * 0.7);
      g.lineTo(cx - s * 0.3, cy - s * 0.2);
      g.lineTo(cx + s * 0.3, cy + s * 0.3);
      g.lineTo(cx + s * 0.9, cy - s * 0.7);
      g.strokePath();
      g.fillCircle(cx + s * 0.9, cy - s * 0.7, s * 0.18);
      break;
    }
    case 'trophy': {
      g.fillRect(cx - s * 0.45, cy - s * 0.85, s * 0.9, s * 0.7);
      g.fillTriangle(cx - s * 0.45, cy - s * 0.15, cx + s * 0.45, cy - s * 0.15, cx, cy + s * 0.35);
      g.fillRect(cx - s * 0.1, cy + s * 0.3, s * 0.2, s * 0.35);
      g.fillRect(cx - s * 0.4, cy + s * 0.65, s * 0.8, s * 0.18);
      g.strokeCircle(cx - s * 0.6, cy - s * 0.5, s * 0.22);
      g.strokeCircle(cx + s * 0.6, cy - s * 0.5, s * 0.22);
      break;
    }
    case 'pencil': {
      g.lineStyle(lw * 2.2, color, alpha);
      g.lineBetween(cx - s * 0.6, cy + s * 0.6, cx + s * 0.5, cy - s * 0.5);
      g.lineStyle(lw, color, alpha);
      g.fillTriangle(cx - s * 0.6, cy + s * 0.6, cx - s * 0.85, cy + s * 0.85, cx - s * 0.85, cy + s * 0.6);
      break;
    }
    case 'clipboard': {
      g.strokeRect(cx - s * 0.6, cy - s * 0.7, s * 1.2, s * 1.6);
      g.fillRect(cx - s * 0.3, cy - s * 0.85, s * 0.6, s * 0.3);
      g.lineBetween(cx - s * 0.4, cy - s * 0.1, cx + s * 0.4, cy - s * 0.1);
      g.lineBetween(cx - s * 0.4, cy + s * 0.25, cx + s * 0.4, cy + s * 0.25);
      g.lineBetween(cx - s * 0.4, cy + s * 0.6, cx + s * 0.1, cy + s * 0.6);
      break;
    }
    case 'band': {
      g.strokeRoundedRect(cx - s * 0.4, cy - s * 0.9, s * 0.8, s * 1.8, s * 0.35);
      g.fillRoundedRect(cx - s * 0.26, cy - s * 0.42, s * 0.52, s * 0.84, s * 0.1);
      break;
    }
    case 'skull': {
      g.fillCircle(cx, cy - s * 0.15, s * 0.62);
      g.fillRect(cx - s * 0.36, cy + s * 0.2, s * 0.72, s * 0.5);
      g.fillStyle(0x000000, alpha);
      g.fillCircle(cx - s * 0.24, cy - s * 0.2, s * 0.17);
      g.fillCircle(cx + s * 0.24, cy - s * 0.2, s * 0.17);
      g.fillTriangle(cx - s * 0.08, cy + s * 0.15, cx + s * 0.08, cy + s * 0.15, cx, cy);
      for (const dx of [-0.2, -0.07, 0.07, 0.2]) g.fillRect(cx + s * dx - s * 0.03, cy + s * 0.45, s * 0.06, s * 0.22);
      break;
    }
    case 'check': {
      g.lineStyle(lw * 2, color, alpha);
      g.beginPath();
      g.moveTo(cx - s * 0.7, cy);
      g.lineTo(cx - s * 0.2, cy + s * 0.5);
      g.lineTo(cx + s * 0.75, cy - s * 0.55);
      g.strokePath();
      break;
    }
    case 'flag': {
      g.lineBetween(cx - s * 0.5, cy + s * 0.9, cx - s * 0.5, cy - s * 0.9);
      g.fillTriangle(cx - s * 0.5, cy - s * 0.9, cx + s * 0.7, cy - s * 0.5, cx - s * 0.5, cy - s * 0.1);
      break;
    }
    case 'lung': {
      g.strokeEllipse(cx - s * 0.4, cy + s * 0.1, s * 0.6, s * 1.2);
      g.strokeEllipse(cx + s * 0.4, cy + s * 0.1, s * 0.6, s * 1.2);
      g.lineBetween(cx, cy - s * 0.9, cx, cy);
      break;
    }
    case 'target': {
      g.strokeCircle(cx, cy, s * 0.85);
      g.strokeCircle(cx, cy, s * 0.5);
      g.fillCircle(cx, cy, s * 0.18);
      break;
    }
    case 'mountain': {
      g.fillTriangle(cx - s * 0.95, cy + s * 0.7, cx + s * 0.1, cy - s * 0.75, cx + s * 0.55, cy + s * 0.7);
      g.fillTriangle(cx + s * 0.05, cy + s * 0.7, cx + s * 0.6, cy - s * 0.2, cx + s * 0.95, cy + s * 0.7);
      break;
    }
    case 'bolt': {
      g.fillPoints(
        [
          { x: cx + s * 0.2, y: cy - s * 0.95 },
          { x: cx - s * 0.5, y: cy + s * 0.1 },
          { x: cx - s * 0.02, y: cy + s * 0.1 },
          { x: cx - s * 0.25, y: cy + s * 0.95 },
          { x: cx + s * 0.55, y: cy - s * 0.15 },
          { x: cx + s * 0.05, y: cy - s * 0.15 },
        ],
        true,
      );
      break;
    }
    case 'house': {
      g.fillRect(cx - s * 0.55, cy - s * 0.1, s * 1.1, s * 0.85);
      g.fillTriangle(cx - s * 0.75, cy - s * 0.05, cx + s * 0.75, cy - s * 0.05, cx, cy - s * 0.85);
      g.fillStyle(0x000000, alpha * 0.55);
      g.fillRect(cx - s * 0.14, cy + s * 0.25, s * 0.28, s * 0.5);
      break;
    }
    case 'compass': {
      g.strokeCircle(cx, cy, s * 0.85);
      g.fillTriangle(cx, cy - s * 0.8, cx - s * 0.2, cy, cx + s * 0.2, cy);
      g.fillStyle(color, alpha * 0.35);
      g.fillTriangle(cx, cy + s * 0.8, cx - s * 0.2, cy, cx + s * 0.2, cy);
      break;
    }
    case 'snowflake': {
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        g.lineBetween(cx - Math.cos(a) * s * 0.85, cy - Math.sin(a) * s * 0.85, cx + Math.cos(a) * s * 0.85, cy + Math.sin(a) * s * 0.85);
      }
      break;
    }
    case 'arrowDown': {
      g.lineBetween(cx, cy - s * 0.85, cx, cy + s * 0.8);
      g.lineBetween(cx - s * 0.6, cy + s * 0.2, cx, cy + s * 0.8);
      g.lineBetween(cx + s * 0.6, cy + s * 0.2, cx, cy + s * 0.8);
      break;
    }
    case 'warning': {
      g.lineStyle(lw * 1.4, color, alpha);
      g.strokeTriangle(cx - s * 0.9, cy + s * 0.75, cx + s * 0.9, cy + s * 0.75, cx, cy - s * 0.8);
      g.fillRect(cx - lw * 0.7, cy - s * 0.25, lw * 1.4, s * 0.55);
      g.fillCircle(cx, cy + s * 0.5, lw * 0.9);
      break;
    }
    default:
      break;
  }
}

/** Un icono suelto como objeto propio. */
export function iconObject(scene: Phaser.Scene, name: IconName, x: number, y: number, size: number, color: number, depth = 1, alpha = 1): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(depth);
  icon(g, name, x, y, size, color, alpha);
  return g;
}

export interface PaperPanel {
  left: number;
  top: number;
  cx: number;
  objects: Phaser.GameObjects.GameObject[];
}

/**
 * Un panel modal de papel: el fondo se atenúa y se traga los toques, y el
 * papel queda centrado con su título en tinta. Los que lo usan añaden lo suyo
 * a `objects` para destruirlo todo junto.
 */
export function paperPanel(scene: Phaser.Scene, w: number, h: number, depth: number, title: string, subtitle?: string): PaperPanel {
  const sw = scene.scale.width;
  const sh = scene.scale.height;
  const cx = sw / 2;
  const top = sh / 2 - h / 2;
  const left = cx - w / 2;
  const dim = scene.add.rectangle(cx, sh / 2, sw, sh, 0x05060e, 0.82).setDepth(depth).setInteractive();
  const sheet = paper(scene, left, top, w, h, { depth, tilt: 0 });
  const objects: Phaser.GameObjects.GameObject[] = [dim, sheet];
  objects.push(
    scene.add
      .text(cx, top + 40, title, { fontFamily: FONT_SANS, fontSize: '32px', fontStyle: 'bold', color: INK })
      .setOrigin(0.5)
      .setDepth(depth + 1),
  );
  if (subtitle) {
    objects.push(
      scene.add
        .text(cx, top + 74, subtitle, { fontFamily: FONT_SANS, fontSize: '15px', color: INK_MUTED, align: 'center', wordWrap: { width: w - 80 } })
        .setOrigin(0.5)
        .setDepth(depth + 1),
    );
  }
  return { left, top, cx, objects };
}

/** Una cara: contenta, neutra o agotada. Para "¿cómo fue?" sin palabras. */
export function face(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, mood: 'easy' | 'right' | 'hard', color: number, alpha = 1): void {
  g.lineStyle(Math.max(2, r / 8), color, alpha);
  g.strokeCircle(cx, cy, r);
  g.fillStyle(color, alpha);
  g.fillCircle(cx - r * 0.35, cy - r * 0.25, r * 0.1);
  g.fillCircle(cx + r * 0.35, cy - r * 0.25, r * 0.1);
  g.beginPath();
  if (mood === 'easy') g.arc(cx, cy + r * 0.05, r * 0.5, Math.PI * 0.15, Math.PI * 0.85, false);
  else if (mood === 'right') {
    g.moveTo(cx - r * 0.42, cy + r * 0.38);
    g.lineTo(cx + r * 0.42, cy + r * 0.38);
  } else {
    g.arc(cx, cy + r * 0.75, r * 0.5, Math.PI * 1.15, Math.PI * 1.85, false);
  }
  g.strokePath();
  if (mood === 'hard') {
    // Una gota de sudor.
    g.fillTriangle(cx + r * 0.7, cy - r * 0.55, cx + r * 0.85, cy - r * 0.2, cx + r * 0.55, cy - r * 0.2);
    g.fillCircle(cx + r * 0.7, cy - r * 0.2, r * 0.15);
  }
}

/** Marcas de conteo a tiza: grupos de cinco, el quinto cruzado. */
export function tally(g: Phaser.GameObjects.Graphics, x: number, y: number, count: number, h: number, color: number): number {
  const gap = h * 0.3;
  g.lineStyle(Math.max(2, h / 7), color, 1);
  let cx = x;
  for (let i = 0; i < count; i++) {
    const inGroup = i % 5;
    if (inGroup === 4) {
      g.lineBetween(cx - gap * 4.2, y + h * 0.15, cx + gap * 0.2, y + h * 0.85);
      cx += gap * 2;
    } else {
      g.lineBetween(cx, y, cx + 2, y + h);
      cx += gap;
    }
  }
  return cx;
}
