import Phaser from 'phaser';
import { expandProgram, totalDurationSec, type TrainingProgram } from '../../sim/program';
import { zoneLabel } from '../../sim/zones';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, KIND_COLOR } from '../theme';
import { INK_DIM, INK_HEX, INK_MUTED } from '../ui/paper';

// El programa ES el perfil del antagonista: esta vista lo muestra literal en
// el cartel, a tinta: velocidad de la horda (alto) contra tiempo (ancho), un
// bloque por tramo con su color, y debajo de cada uno los minutos y la zona
// que pide, para leer la salida entera de un vistazo.

export class ProfilePreview {
  private readonly container: Phaser.GameObjects.Container;
  private readonly caption: Phaser.GameObjects.Text;
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    private readonly width: number,
    private readonly height: number,
    private readonly depth = 2,
  ) {
    this.container = scene.add.container(x, y).setDepth(depth);
    this.caption = scene.add
      .text(x, y + height + 30, '', { fontFamily: FONT_SANS, fontSize: '13px', color: INK_MUTED })
      .setDepth(depth);
  }

  show(program: TrainingProgram): void {
    this.container.removeAll(true);
    this.labels.forEach((l) => l.destroy());
    this.labels.length = 0;
    const segments = expandProgram(program);
    const total = totalDurationSec(segments);
    const maxKph = Math.max(...segments.map((s) => s.zombieSpeedKph));

    const g = this.scene.add.graphics();
    this.container.add(g);
    for (const seg of segments) {
      const x = (this.width * seg.startSec) / total;
      const w = Math.max(2, (this.width * seg.durationSec) / total - 1);
      const h = Math.max(4, (this.height - 8) * (seg.zombieSpeedKph / maxKph));
      g.fillStyle(KIND_COLOR[seg.kind] ?? 0xffffff, 0.9);
      g.fillRect(x, this.height - h, w, h);
      g.lineStyle(1, INK_HEX, 0.35);
      g.strokeRect(x, this.height - h, w, h);
      // Minutos y zona bajo cada tramo, si cabe.
      if (w >= 44) {
        const minutes = Math.round(seg.durationSec / 60);
        const label = this.scene.add
          .text(this.x + x + w / 2, this.y + this.height + 5, `${minutes}'\n${zoneLabel(seg.zoneMin, seg.zoneMax)}`, {
            fontFamily: FONT_MONO,
            fontSize: '11px',
            color: INK_DIM,
            align: 'center',
          })
          .setOrigin(0.5, 0)
          .setDepth(this.depth);
        this.labels.push(label);
      }
    }
    g.fillStyle(INK_HEX, 0.7);
    g.fillRect(0, this.height, this.width, 2);

    const waves = segments.filter((s) => s.kind === 'surge').length;
    const parts = [
      `${segments.length} tramos`,
      formatMMSS(total),
      waves > 0 ? `${waves} oleada${waves === 1 ? '' : 's'}` : '',
      `horda hasta ${Math.round(maxKph)} km/h`,
    ].filter((p) => p !== '');
    this.caption.setText(parts.join(' · '));
  }
}
