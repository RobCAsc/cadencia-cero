import type Phaser from 'phaser';

// Los refugios de la Ruta, vistos desde la carretera: cuando la salida cruza
// uno, aparece en el paisaje y pasa con él. Cada refugio tiene su dibujo,
// como en el mapa, pero grande y a contraluz de la noche, con algo encendido.
// Los que están junto al asfalto (el puente, la gasolinera, la estación, la
// frontera) van a la escala de la carretera y se pasan en segundos; los que
// están lejos (el faro, la presa, el monasterio…) van a la escala de la capa
// media y se ven venir durante un buen rato.

export type LandmarkLayer = 'near' | 'far';

/** Un refugio cerca de donde vas: su nombre y los metros hasta él (negativo si ya pasó). */
export interface Landmark {
  name: string;
  metersAhead: number;
}

export interface LandmarkPalette {
  /** Color de la silueta (un tono más claro que su capa). */
  silhouette: number;
  /** Color de lo encendido. */
  light: number;
  /** 0 de día … 1 en noche cerrada: cuánto lucen las luces. */
  night: number;
  /** Segundos vivos, para lo que gira o parpadea. */
  t: number;
}

const NEAR: ReadonlySet<string> = new Set(['El puente', 'La gasolinera', 'La estación', 'La frontera']);

export function landmarkLayer(name: string): LandmarkLayer {
  return NEAR.has(name) ? 'near' : 'far';
}

/** Medio ancho aproximado del dibujo, para saber si asoma en pantalla. */
export function landmarkHalfWidth(name: string): number {
  switch (name) {
    case 'El puente':
      return 360;
    case 'La presa':
      return 300;
    case 'La estación':
    case 'El puerto':
      return 240;
    default:
      return 200;
  }
}

/**
 * Dibuja el refugio con el pie en (x, groundY). Usa solo primitivas del
 * Graphics de Phaser: es el mismo lenguaje de todo el paisaje.
 */
export function drawLandmark(g: Phaser.GameObjects.Graphics, name: string, x: number, groundY: number, p: LandmarkPalette): void {
  const S = p.silhouette;
  const L = p.light;
  const n = p.night;
  switch (name) {
    case 'El puente': {
      // Un paso elevado: dos pilares y el tablero cruzando por encima de la carretera.
      g.fillStyle(S, 1);
      g.fillRect(x - 190, groundY - 160, 30, 160);
      g.fillRect(x + 160, groundY - 160, 30, 160);
      g.fillRect(x - 340, groundY - 196, 680, 30);
      g.fillRect(x - 340, groundY - 214, 680, 6); // el pretil
      for (let i = -320; i <= 320; i += 40) g.fillRect(x + i, groundY - 214, 3, 18);
      g.fillStyle(0x000000, 0.35);
      g.fillRect(x - 340, groundY - 166, 680, 8); // la sombra bajo el tablero
      // Una lámpara bajo el tablero, con su cono sobre el asfalto.
      g.fillStyle(L, 0.14 * n);
      g.fillTriangle(x, groundY - 168, x - 90, groundY + 40, x + 90, groundY + 40);
      g.fillStyle(L, n);
      g.fillCircle(x, groundY - 168, 3);
      break;
    }
    case 'La gasolinera': {
      // Marquesina sobre dos postes, dos surtidores, la tienda con luz y el cartel en alto.
      g.fillStyle(S, 1);
      g.fillRect(x - 120, groundY - 120, 6, 120);
      g.fillRect(x + 114, groundY - 120, 6, 120);
      g.fillRect(x - 150, groundY - 136, 300, 18);
      g.fillRect(x + 150, groundY - 90, 90, 90); // la tienda
      g.fillRect(x - 40, groundY - 36, 16, 36); // surtidores
      g.fillRect(x + 20, groundY - 36, 16, 36);
      g.fillRect(x - 200, groundY - 230, 6, 230); // el mástil del cartel
      g.fillStyle(L, 0.9 * n);
      g.fillRect(x - 232, groundY - 262, 70, 34); // el cartel encendido
      g.fillStyle(L, 0.55 * n);
      g.fillRect(x + 164, groundY - 78, 60, 40); // el escaparate
      g.fillStyle(L, 0.1 * n);
      g.fillRect(x - 150, groundY - 118, 300, 118); // la luz bajo la marquesina
      g.fillStyle(L, n);
      g.fillCircle(x - 60, groundY - 118, 2.5);
      g.fillCircle(x + 60, groundY - 118, 2.5);
      break;
    }
    case 'La estación': {
      // El edificio con su reloj, el andén con marquesina, ventanas encendidas.
      g.fillStyle(S, 1);
      g.fillRect(x - 220, groundY - 110, 440, 110);
      g.fillTriangle(x - 230, groundY - 110, x + 230, groundY - 110, x, groundY - 170);
      g.fillRect(x - 260, groundY - 70, 520, 8); // la marquesina del andén
      g.fillRect(x - 250, groundY - 70, 5, 70);
      g.fillRect(x + 245, groundY - 70, 5, 70);
      g.fillRect(x - 280, groundY - 4, 560, 4); // el borde del andén
      g.lineStyle(2, L, 0.9 * n);
      g.strokeCircle(x, groundY - 128, 12);
      g.lineBetween(x, groundY - 128, x, groundY - 136);
      g.lineBetween(x, groundY - 128, x + 6, groundY - 125);
      g.fillStyle(L, 0.6 * n);
      for (const wx of [-170, -110, 60, 120]) g.fillRect(x + wx, groundY - 90, 30, 34);
      g.fillStyle(L, 0.85 * n);
      g.fillRect(x - 24, groundY - 96, 48, 96); // la puerta, abierta y con luz
      break;
    }
    case 'La frontera': {
      // Un paso: dos postes, la barrera a rayas, la garita y las luces.
      g.fillStyle(S, 1);
      g.fillRect(x - 150, groundY - 140, 12, 140);
      g.fillRect(x + 138, groundY - 140, 12, 140);
      g.fillRect(x - 150, groundY - 140, 300, 10);
      g.fillRect(x + 170, groundY - 80, 60, 80); // la garita
      g.fillRect(x - 150, groundY - 84, 300, 8); // la barrera
      g.fillStyle(L, 0.85 * n);
      for (let i = -140; i < 140; i += 40) g.fillRect(x + i, groundY - 84, 20, 8);
      g.fillRect(x + 182, groundY - 68, 24, 22); // la ventana de la garita
      g.fillStyle(L, n);
      g.fillCircle(x - 144, groundY - 146, 4);
      g.fillCircle(x + 144, groundY - 146, 4);
      g.fillStyle(L, 0.12 * n);
      g.fillTriangle(x - 144, groundY - 146, x - 200, groundY + 20, x - 88, groundY + 20);
      g.fillTriangle(x + 144, groundY - 146, x + 88, groundY + 20, x + 200, groundY + 20);
      break;
    }
    case 'El faro': {
      // La torre en su roca y el haz girando sobre el mar.
      g.fillStyle(S, 1);
      g.fillEllipse(x, groundY + 6, 140, 40);
      g.fillPoints(
        [
          { x: x - 22, y: groundY },
          { x: x - 13, y: groundY - 190 },
          { x: x + 13, y: groundY - 190 },
          { x: x + 22, y: groundY },
        ],
        true,
      );
      g.fillRect(x - 18, groundY - 212, 36, 22); // la linterna
      g.fillTriangle(x - 22, groundY - 212, x + 22, groundY - 212, x, groundY - 228);
      g.fillStyle(S, 0.8);
      g.fillRect(x - 22, groundY - 120, 44, 5);
      const a = (p.t * 0.7) % (Math.PI * 2);
      const dx = Math.cos(a);
      const spread = 0.12;
      g.fillStyle(L, 0.16 * n);
      g.fillTriangle(
        x,
        groundY - 201,
        x + Math.cos(a - spread) * 520 * Math.max(0.25, Math.abs(dx)),
        groundY - 201 + Math.sin(a - spread) * 90,
        x + Math.cos(a + spread) * 520 * Math.max(0.25, Math.abs(dx)),
        groundY - 201 + Math.sin(a + spread) * 90,
      );
      g.fillStyle(L, n);
      g.fillCircle(x, groundY - 201, 4);
      break;
    }
    case 'La presa': {
      // El muro con su coronación curva, los contrafuertes y la fila de luces.
      g.fillStyle(S, 1);
      g.fillRect(x - 280, groundY - 120, 560, 120);
      g.beginPath();
      g.moveTo(x - 280, groundY - 120);
      g.lineTo(x - 280, groundY - 132);
      g.lineTo(x + 280, groundY - 132);
      g.lineTo(x + 280, groundY - 120);
      g.closePath();
      g.fillPath();
      g.fillStyle(0x000000, 0.25);
      for (let i = -240; i <= 240; i += 60) g.fillRect(x + i, groundY - 120, 10, 120);
      g.fillStyle(L, 0.9 * n);
      for (let i = -260; i <= 260; i += 40) g.fillCircle(x + i, groundY - 138, 2);
      break;
    }
    case 'El monasterio': {
      // El caserón, la torre con su campana y dos ventanas de arco encendidas.
      g.fillStyle(S, 1);
      g.fillRect(x - 130, groundY - 95, 260, 95);
      g.fillTriangle(x - 140, groundY - 95, x + 140, groundY - 95, x, groundY - 140);
      g.fillRect(x + 70, groundY - 175, 50, 175);
      g.fillTriangle(x + 64, groundY - 175, x + 126, groundY - 175, x + 95, groundY - 205);
      g.fillRect(x + 93, groundY - 228, 4, 22); // la cruz
      g.fillRect(x + 86, groundY - 220, 18, 4);
      g.fillStyle(L, 0.7 * n);
      for (const wx of [-70, -20]) {
        g.fillRect(x + wx, groundY - 62, 18, 30);
        g.fillCircle(x + wx + 9, groundY - 62, 9);
      }
      g.fillStyle(L, 0.5 * n);
      g.fillRect(x + 88, groundY - 165, 14, 22); // la ventana de la torre
      break;
    }
    case 'El puerto': {
      // Dos grúas, el casco de un barco y una luz en el mástil.
      g.fillStyle(S, 1);
      g.fillRect(x - 220, groundY - 4, 460, 4); // el muelle
      for (const cx of [x - 150, x + 40]) {
        g.fillRect(cx, groundY - 200, 12, 200);
        g.fillRect(cx - 40, groundY - 200, 140, 10);
        g.fillRect(cx + 90, groundY - 200, 4, 60);
        g.lineStyle(2, S, 1);
        g.lineBetween(cx + 6, groundY - 200, cx - 40, groundY - 160);
      }
      g.fillPoints(
        [
          { x: x + 120, y: groundY - 40 },
          { x: x + 330, y: groundY - 40 },
          { x: x + 310, y: groundY },
          { x: x + 140, y: groundY },
        ],
        true,
      );
      g.fillRect(x + 250, groundY - 70, 40, 30);
      g.fillRect(x + 200, groundY - 130, 4, 90);
      g.fillStyle(L, n * (0.6 + 0.4 * Math.abs(Math.sin(p.t * 2))));
      g.fillCircle(x + 202, groundY - 132, 3);
      g.fillStyle(L, 0.5 * n);
      g.fillRect(x + 258, groundY - 64, 10, 8);
      break;
    }
    case 'La isla': {
      // Agua, un monte, la palmera y una cabaña con luz.
      g.fillStyle(S, 0.5);
      g.fillRect(x - 400, groundY - 2, 800, 2);
      g.fillStyle(S, 1);
      g.fillEllipse(x, groundY + 10, 300, 70);
      g.lineStyle(5, S, 1);
      g.beginPath();
      g.moveTo(x - 40, groundY - 24);
      g.lineTo(x - 30, groundY - 110);
      g.strokePath();
      for (const [ax, ay] of [
        [-70, -140],
        [-10, -150],
        [20, -120],
        [-60, -100],
      ] as const) {
        g.lineStyle(4, S, 1);
        g.lineBetween(x - 30, groundY - 110, x + ax, groundY + ay);
      }
      g.fillStyle(S, 1);
      g.fillRect(x + 40, groundY - 50, 50, 30);
      g.fillTriangle(x + 34, groundY - 50, x + 96, groundY - 50, x + 65, groundY - 70);
      g.fillStyle(L, 0.8 * n);
      g.fillRect(x + 56, groundY - 44, 12, 12);
      g.fillStyle(L, 0.08 * n);
      g.fillRect(x + 20, groundY - 4, 90, 3);
      break;
    }
    case 'El observatorio': {
      // El cerro, la base y la cúpula con la rendija abierta al cielo.
      g.fillStyle(S, 1);
      g.fillEllipse(x, groundY + 40, 420, 120);
      g.fillRect(x - 70, groundY - 90, 140, 60);
      g.beginPath();
      g.arc(x, groundY - 90, 70, Math.PI, 0, false);
      g.fillPath();
      g.fillStyle(L, 0.7 * n);
      g.fillRect(x + 8, groundY - 158, 10, 66); // la rendija
      g.fillStyle(L, 0.5 * n);
      g.fillRect(x - 50, groundY - 70, 14, 12);
      break;
    }
    default: {
      // Un refugio cualquiera: una casa con la ventana encendida.
      g.fillStyle(S, 1);
      g.fillRect(x - 60, groundY - 70, 120, 70);
      g.fillTriangle(x - 70, groundY - 70, x + 70, groundY - 70, x, groundY - 120);
      g.fillRect(x + 25, groundY - 110, 12, 30); // la chimenea
      g.fillStyle(L, 0.8 * n);
      g.fillRect(x - 40, groundY - 52, 22, 20);
      g.fillStyle(L, 0.12 * n);
      g.fillTriangle(x - 29, groundY - 32, x - 80, groundY + 10, x + 20, groundY + 10);
      break;
    }
  }
}
