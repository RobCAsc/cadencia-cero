import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { CadenceSource } from '../../input/CadenceSource';
import type { TrainingProgram } from '../../sim/program';
import { HIIT_30_30 } from '../../sim/programs/hiit-30-30';
import { RideSim } from '../../sim/RideSim';
import type { RideSummary, SimEvent, SimState } from '../../sim/types';
import { gameAudio } from '../audio';
import { formatMMSS } from '../format';
import { gapToPx, hordeScale } from '../gapMapping';
import { CueBanner } from '../hud/CueBanner';
import { Hud } from '../hud/Hud';
import { ResistanceControl } from '../hud/ResistanceControl';
import { Atmosphere } from '../atmosphere';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { releaseWakeLock } from '../wakeLock';

const PLAYER_COLOR = 0x2ecc71;
const HORDE_COLORS = [0xc0392b, 0xa93226, 0x922b21, 0xb03a2e, 0x943126];

/**
 * La escena del ride. Posee un RideSim nuevo por sesión, lo avanza una vez por
 * frame y dibuja TODO como función del estado del sim: el render nunca guarda
 * verdad propia sobre el juego.
 */
export class RideScene extends Phaser.Scene {
  private sim!: RideSim;
  private atmosphere!: Atmosphere;
  private player!: Phaser.GameObjects.Rectangle;
  private horde!: Phaser.GameObjects.Container;
  private hordeParts: Phaser.GameObjects.Rectangle[] = [];
  private hud!: Hud;
  private banner!: CueBanner;
  private resistanceCtl!: ResistanceControl;
  private vignette!: Phaser.GameObjects.Rectangle;
  private finishedShown = false;
  private bobPhase = 0;
  private shambleT = 0;

  constructor() {
    super('RideScene');
  }

  create(): void {
    const program =
      (this.registry.get('selectedProgram') as TrainingProgram | undefined) ?? HIIT_30_30;
    this.sim = new RideSim(program);
    this.bobPhase = 0;
    this.shambleT = 0;

    this.atmosphere = new Atmosphere(this);

    this.player = this.add
      .rectangle(RENDER.playerX, RENDER.groundY, RENDER.playerW, RENDER.playerH, PLAYER_COLOR)
      .setOrigin(0.5, 1);

    this.horde = this.add.container(0, RENDER.groundY);
    this.hordeParts = [];
    const offsets = [-85, -60, -38, -18, 0];
    const sizes: ReadonlyArray<readonly [number, number]> = [
      [30, 58],
      [36, 66],
      [28, 54],
      [34, 70],
      [32, 62],
    ];
    offsets.forEach((offset, i) => {
      const [w, h] = sizes[i] ?? [30, 60];
      const rect = this.add
        .rectangle(offset, 0, w, h, HORDE_COLORS[i % HORDE_COLORS.length])
        .setOrigin(0.5, 1);
      rect.setData('baseX', offset);
      this.horde.add(rect);
      this.hordeParts.push(rect);
    });

    this.hud = new Hud(this);
    this.banner = new CueBanner(this, (finalPip) => gameAudio.playPip(finalPip));
    this.resistanceCtl = new ResistanceControl(this, (delta) => this.adjustResistance(delta));

    // Viñeta roja persistente cuando la salud llega a 0; el ride sigue igual.
    this.vignette = this.add
      .rectangle(RENDER.width / 2, RENDER.height / 2, RENDER.width, RENDER.height, 0xe74c3c)
      .setAlpha(0)
      .setDepth(20);
    this.finishedShown = false;

    const source = this.registry.get('cadenceSource') as CadenceSource;
    const unsubscribe = source.onSample((sample) => this.sim.pushCadence(sample));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    for (const event of this.sim.update(dt)) this.handleEvent(event, false);
    this.draw(this.sim.state, dt);
  }

  adjustResistance(delta: number): void {
    this.sim.setResistance(this.sim.state.resistanceLevel + delta);
  }

  /**
   * Herramienta dev: avanza al siguiente segmento por el camino real del sim
   * (muestras sintéticas + update), sin API especial. Si el rider "está parado",
   * los catches del salto se aplican de verdad.
   */
  fastForwardToNextSegment(): void {
    const start = this.sim.state.segment.index;
    let guard = 0;
    while (
      this.sim.state.phase === 'riding' &&
      this.sim.state.segment.index === start &&
      guard++ < 20000
    ) {
      this.sim.pushCadence({ rpm: this.sim.state.cadenceRpm, timestampMs: performance.now() });
      for (const event of this.sim.update(0.1)) this.handleEvent(event, true);
    }
  }

  private handleEvent(event: SimEvent, fastForward: boolean): void {
    switch (event.type) {
      case 'caught':
        // Durante el salto dev el estado se aplica igual, sin el show.
        if (!fastForward) {
          this.cameras.main.shake(500, 0.01);
          this.cameras.main.flash(300, 192, 0, 0);
          gameAudio.playCatch();
          this.hud.pulseHealth();
        }
        break;
      case 'segmentChanged':
        if (event.segment.kind === 'surge') {
          this.banner.showNotice('¡¡OLEADA!!', 2500, UI.danger);
        } else if (event.segment.cueResistance !== undefined) {
          this.banner.showNotice(`Resistencia → ${event.segment.cueResistance}`, 4000, UI.info);
        }
        break;
      case 'healthDepleted':
        this.vignette.setAlpha(0.16);
        break;
      case 'finished':
        this.showFinished(event.summary);
        break;
      default:
        break; // staleCadence y surgeWarning se leen del estado en la HUD/banner
    }
  }

  private showFinished(summary: RideSummary): void {
    if (this.finishedShown) return;
    this.finishedShown = true;
    releaseWakeLock(); // sesión terminada: la pantalla ya puede dormirse
    gameAudio.playFinish();

    const cx = RENDER.width / 2;
    // El dim se traga los clics para que la HUD de abajo quede inerte.
    this.add
      .rectangle(cx, RENDER.height / 2, RENDER.width, RENDER.height, 0x05050a, 0.78)
      .setDepth(30)
      .setInteractive();
    this.add
      .text(cx, 170, '¡SOBREVIVISTE!', {
        fontFamily: FONT_SANS,
        fontSize: '64px',
        fontStyle: 'bold',
        color: UI.good,
      })
      .setOrigin(0.5)
      .setDepth(31);
    this.add
      .text(
        cx,
        330,
        [
          `Distancia:       ${(summary.distanceM / 1000).toFixed(2)} km`,
          `Tiempo:          ${formatMMSS(summary.durationSec)}`,
          `Veces alcanzado: ${summary.timesCaught}`,
          `Cadencia media:  ${Math.round(summary.avgCadenceRpm)} rpm`,
        ].join('\n'),
        { fontFamily: FONT_MONO, fontSize: '30px', color: UI.textBright, lineSpacing: 14 },
      )
      .setOrigin(0.5)
      .setDepth(31);

    const button = this.add
      .rectangle(cx, 520, 260, 76, UI.button)
      .setDepth(31)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(cx, 520, 'Volver', { fontFamily: FONT_SANS, fontSize: '32px', color: UI.textBright })
      .setOrigin(0.5)
      .setDepth(32);
    button.on('pointerover', () => button.setFillStyle(UI.buttonHover));
    button.on('pointerout', () => button.setFillStyle(UI.button));
    button.on('pointerdown', () => this.scene.start('StartScene'));
  }

  private draw(state: SimState, dt: number): void {
    this.atmosphere.update(state.playerSpeedKph / 3.6, dt);

    // Bob acoplado a la cadencia: una oscilación por pedalada.
    this.bobPhase += (state.cadenceRpm / 60) * Math.PI * 2 * dt;
    this.player.y = RENDER.groundY - 3 * (0.5 + 0.5 * Math.sin(this.bobPhase));

    this.shambleT += dt;
    const px = gapToPx(state.gapM);
    this.horde.x = RENDER.playerX - 30 - px;
    const scale = hordeScale(state.gapM);
    this.horde.setScale(scale, state.caughtGraceSec > 0 ? scale * 0.92 : scale);
    this.horde.setAlpha(state.gapM > 100 ? 0.85 : 1);
    this.hordeParts.forEach((rect, i) => {
      const baseX = rect.getData('baseX') as number;
      rect.x = baseX + 2.5 * Math.sin(this.shambleT * 2.1 + i * 1.7);
      rect.y = -Math.abs(2 * Math.sin(this.shambleT * 5 + i * 1.3));
    });

    this.hud.update(state);
    this.banner.update(state);
    this.resistanceCtl.update(state.resistanceLevel);
  }
}
