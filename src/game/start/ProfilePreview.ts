import Phaser from 'phaser';
import { expandProgram, totalDurationSec, type TrainingProgram } from '../../sim/program';
import { formatMMSS } from '../format';
import { FONT_SANS, UI } from '../theme';

// El programa ES el perfil del antagonista: esta vista lo muestra literal —
// velocidad de la horda (alto) contra tiempo (ancho), un rectángulo por segmento.
const KIND_COLOR: Record<string, number> = {
  warmup: 0xf39c12,
  steady: 0x16a085,
  surge: 0xe74c3c,
  recover: 0x3498db,
  cooldown: 0x7f8c8d,
};

export class ProfilePreview {
  private readonly container: Phaser.GameObjects.Container;
  private readonly caption: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.container = scene.add.container(x, y);
    this.caption = scene.add.text(x, y + height + 12, '', {
      fontFamily: FONT_SANS,
      fontSize: '18px',
      color: UI.textMuted,
    });
  }

  show(program: TrainingProgram): void {
    this.container.removeAll(true);
    const segments = expandProgram(program);
    const total = totalDurationSec(segments);
    const maxKph = Math.max(...segments.map((s) => s.zombieSpeedKph));

    for (const seg of segments) {
      const x = (this.width * seg.startSec) / total;
      const w = Math.max(2, (this.width * seg.durationSec) / total - 1);
      const h = Math.max(3, (this.height - 8) * (seg.zombieSpeedKph / maxKph));
      this.container.add(
        this.scene.add
          .rectangle(x, this.height - h, w, h, KIND_COLOR[seg.kind] ?? 0xffffff)
          .setOrigin(0, 0),
      );
    }
    this.container.add(
      this.scene.add.rectangle(0, this.height, this.width, 2, 0x3a4152).setOrigin(0, 0),
    );

    const waves = segments.filter((s) => s.kind === 'surge').length;
    const parts = [
      formatMMSS(total),
      waves > 0 ? `${waves} oleada${waves === 1 ? '' : 's'}` : '',
      `horda máx ${maxKph} km/h`,
    ].filter((p) => p !== '');
    this.caption.setText(parts.join(' · '));
  }
}
