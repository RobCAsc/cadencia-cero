import Phaser from 'phaser';
import { RENDER } from '../../config';
import { SEASON_WEEKS, type SeasonReport } from '../../sim/progress';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTextButton } from '../uiButton';

// El informe de temporada: doce semanas cerradas, en los números que el pulso
// puede dar. Es el "fin de partida" que se repite: sin niveles, un ciclo.

const DEPTH = 55;
const PANEL_W = 840;
const PANEL_H = 540;
const GOLD = '#d9b06a';

export class SeasonPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, report: SeasonReport, onClose: () => void) {
    const cx = RENDER.width / 2;
    const cy = RENDER.height / 2;
    const top = cy - PANEL_H / 2;
    const dim = scene.add.rectangle(cx, cy, RENDER.width, RENDER.height, 0x05060e, 0.8).setDepth(DEPTH).setInteractive();
    const panel = scene.add.rectangle(cx, cy, PANEL_W, PANEL_H, UI.panel).setDepth(DEPTH).setStrokeStyle(2, 0xd9b06a);
    this.objects.push(dim, panel);
    const text = (x: number, y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => {
      const t = scene.add
        .text(x, y, value, { fontFamily: size >= 24 ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color, ...extra })
        .setDepth(DEPTH + 1);
      this.objects.push(t);
      return t;
    };

    text(cx, top + 40, `Temporada ${report.number}, cerrada`, 34, GOLD, { fontStyle: 'bold' }).setOrigin(0.5);
    text(cx, top + 78, `${SEASON_WEEKS} semanas. Lo que cambió, en lo que el pulso puede medir.`, 16, UI.textMuted).setOrigin(0.5);

    const left = cx - PANEL_W / 2 + 50;
    const col = cx + 20;
    const delta = (start: number | undefined, end: number | undefined, unit: string, lowerIsBetter: boolean): [string, string] => {
      if (start === undefined || end === undefined) return ['––', 'sin lecturas suficientes'];
      const d = end - start;
      const better = lowerIsBetter ? d < 0 : d > 0;
      return [`${end} ${unit}`, `${start} al empezar · ${d > 0 ? '+' : ''}${d}${better ? ' ✓' : ''}`];
    };
    const [restNow, restNote] = delta(report.restStartBpm, report.restEndBpm, 'bpm', true);
    const rows: Array<[string, string, string]> = [
      ['Salidas', `${report.rides}`, `${report.weeksMet} de ${SEASON_WEEKS} semanas cumplidas`],
      ['Cardio por semana', `${Math.round(report.activeMinPerWeek)} min`, 'la OMS pide 150'],
      ['Kilómetros', report.distanceKm.toFixed(0), 'en la Ruta'],
      ['Reposo antes de salir', restNow, restNote],
      ['Recuperación en 1 min', report.recoveryBpm !== undefined ? `${report.recoveryBpm} lpm` : '––', 'sube con la forma'],
      ['Precisión de zona', report.zonePrecision !== undefined ? `${Math.round(report.zonePrecision * 100)} %` : '––', 'dentro de lo que pedía el tramo'],
    ];
    rows.forEach(([label, value, note], i) => {
      const y = top + 124 + i * 54;
      text(left, y, label, 18, UI.textMuted);
      text(col, y - 6, value, 28, UI.textBright);
      text(col + 170, y + 2, note, 14, UI.textDim);
    });
    text(cx, top + PANEL_H - 108, 'Temporada nueva: la escalera de nuevo, y el volumen sigue desde donde lo dejaste.', 16, UI.info, { wordWrap: { width: PANEL_W - 80 }, align: 'center' }).setOrigin(0.5);
    const close = makeTextButton(scene, cx, top + PANEL_H - 50, 260, 54, 'A por la siguiente', () => this.close(onClose), DEPTH + 1, 22);
    this.objects.push(close.rect, close.label);
  }

  private close(onClose: () => void): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    onClose();
  }
}
