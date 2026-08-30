import type Phaser from 'phaser';
import type { FakeCadenceSource } from '../input/FakeCadenceSource';
import type { RideScene } from '../game/scenes/RideScene';

const MAX_RPM = 130;

/**
 * Overlay DOM de desarrollo: el "sensor" mientras no hay hardware.
 * DOM y no canvas a propósito: un <input type=range> nativo da arrastre
 * preciso y foco de teclado gratis, y mantiene el utillaje de la fuente falsa
 * fuera de la capa de render. Solo se monta en dev o con ?dev=1.
 */
export class DevPanel {
  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLSpanElement;
  private readonly emitToggle: HTMLInputElement;

  constructor(
    private readonly game: Phaser.Game,
    private readonly fake: FakeCadenceSource,
  ) {
    const root = document.getElementById('dev-panel');
    if (!root) throw new Error('falta #dev-panel en index.html');

    root.innerHTML = `
      <strong>Panel dev</strong>
      <label>Cadencia <input id="dev-cadence" type="range" min="0" max="${MAX_RPM}" step="1" value="0" /></label>
      <span id="dev-readout">0 rpm</span>
      <label><input id="dev-emit" type="checkbox" checked /> Emitir muestras</label>
      <button id="dev-skip" type="button">Saltar segmento</button>
      <span class="hint">&uarr;/&darr; cadencia &middot; &larr;/&rarr; resistencia &middot; 0 parar &middot; S se&ntilde;al</span>
    `;
    root.classList.add('visible');

    this.slider = root.querySelector<HTMLInputElement>('#dev-cadence') as HTMLInputElement;
    this.readout = root.querySelector<HTMLSpanElement>('#dev-readout') as HTMLSpanElement;
    this.emitToggle = root.querySelector<HTMLInputElement>('#dev-emit') as HTMLInputElement;
    const skip = root.querySelector<HTMLButtonElement>('#dev-skip') as HTMLButtonElement;

    this.slider.addEventListener('input', () => this.setCadence(Number(this.slider.value)));
    this.emitToggle.addEventListener('change', () => this.fake.setEmitting(this.emitToggle.checked));
    skip.addEventListener('click', () => {
      this.rideScene()?.fastForwardToNextSegment();
      skip.blur(); // que Espacio/Enter no lo re-dispare al seguir jugando
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private rideScene(): RideScene | undefined {
    if (!this.game.scene.isActive('RideScene')) return undefined;
    return this.game.scene.getScene('RideScene') as RideScene;
  }

  private setCadence(rpm: number): void {
    const clamped = Math.min(MAX_RPM, Math.max(0, Math.round(rpm)));
    this.fake.setCadence(clamped);
    this.slider.value = String(clamped);
    this.readout.textContent = `${clamped} rpm`;
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowUp':
        this.setCadence(this.fake.getCadence() + 5);
        e.preventDefault();
        break;
      case 'ArrowDown':
        this.setCadence(this.fake.getCadence() - 5);
        e.preventDefault();
        break;
      case 'ArrowLeft':
        this.rideScene()?.adjustResistance(-1);
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.rideScene()?.adjustResistance(1);
        e.preventDefault();
        break;
      case '0':
        this.setCadence(0);
        break;
      case 's':
      case 'S':
        this.emitToggle.checked = !this.emitToggle.checked;
        this.fake.setEmitting(this.emitToggle.checked);
        break;
      default:
        break;
    }
  }
}
