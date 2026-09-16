import type { WeeklyReview } from '../sim/progress';

// Compartir la semana como imagen, sin servidor: se dibuja en un canvas 2D y
// se entrega al menú de compartir de Android (Web Share con archivos). Si el
// navegador no lo soporta, se abre la imagen en una pestaña para guardarla.
// Compromiso público, que es lo que más pesa en un hábito.

const W = 1080;
const H = 1080;

function drawWeekImage(review: WeeklyReview, why: string | undefined): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#06081a');
  sky.addColorStop(0.7, '#131a38');
  sky.addColorStop(1, '#3a4468');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // Estrellas y luna, por código como todo lo demás.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 90; i++) ctx.fillRect(rnd() * W, rnd() * 600, 2, 2);
  ctx.fillStyle = '#e8e2c8';
  ctx.beginPath();
  ctx.arc(880, 170, 70, 0, Math.PI * 2);
  ctx.fill();
  // Siluetas de ciudad y carretera.
  ctx.fillStyle = '#0b0e20';
  for (let x = 0; x < W; x += 60) ctx.fillRect(x, 700 - rnd() * 140, 50, 400);
  ctx.fillStyle = '#06070f';
  ctx.fillRect(0, 860, W, 220);

  const text = (s: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = 'left') => {
    ctx.font = `${weight} ${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };
  const last = review.lastWeek;
  text('CADENCIA CERO', 70, 110, 34, '#8a90a0', 700);
  text('Mi semana', 70, 200, 76, '#ecf0f1', 700);
  text(last.met ? 'Semana cumplida' : 'Semana en marcha', 70, 260, 34, last.met ? '#2ecc71' : '#f39c12', 600);

  const rows: Array<[string, string]> = [
    ['Salidas', `${last.sessions}`],
    ['Minutos de cardio', `${Math.round(last.activeMin)}`],
    ['Kilómetros', last.distanceKm.toFixed(1).replace('.', ',')],
    ['Racha', review.streak >= 1 ? `${review.streak} ${review.streak === 1 ? 'semana' : 'semanas'}` : '–'],
  ];
  if (review.restLastWeekBpm !== undefined) rows.push(['Reposo antes de salir', `${review.restLastWeekBpm} bpm`]);
  rows.forEach(([label, value], i) => {
    const y = 360 + i * 84;
    text(label, 70, y, 34, '#8a90a0');
    text(value, W - 70, y, 54, '#ecf0f1', 700, 'right');
  });
  if (why) text(`«${why}»`, 70, 820, 30, '#d9b06a', 400);
  text('Pedaleo para que la horda no me alcance.', 70, 1010, 28, '#5d6470');
  return canvas;
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export type ShareOutcome = 'shared' | 'opened' | 'unavailable';

/** Comparte la semana como imagen. */
export async function shareWeek(review: WeeklyReview, why: string | undefined): Promise<ShareOutcome> {
  const blob = await toBlob(drawWeekImage(review, why));
  if (!blob) return 'unavailable';
  const file = new File([blob], 'mi-semana-cadencia-cero.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && (nav.canShare?.({ files: [file] }) ?? false)) {
    try {
      await nav.share({ files: [file], title: 'Mi semana en Cadencia Cero' });
      return 'shared';
    } catch {
      return 'unavailable'; // cancelado por el rider o bloqueado: nada que hacer
    }
  }
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  return opened ? 'opened' : 'unavailable';
}
