// Tipografías y colores compartidos de la UI placeholder.

export const FONT_MONO = 'Consolas, "Courier New", monospace';
export const FONT_SANS = 'system-ui, "Segoe UI", sans-serif';

/** Color por tipo de tramo, compartido por la vista previa del programa y la HUD. */
export const KIND_COLOR: Record<string, number> = {
  warmup: 0xf39c12,
  steady: 0x16a085,
  surge: 0xe74c3c,
  recover: 0x3498db,
  cooldown: 0x7f8c8d,
  push: 0xd9b06a,
};

/** Color por zona cardíaca: índice 0 = suave, 1..5 = Z1..Z5. */
export const ZONE_COLOR: readonly number[] = [0x3a4256, 0x5d6d7e, 0x3498db, 0x2ecc71, 0xf39c12, 0xe74c3c];

export const UI = {
  textBright: '#ecf0f1',
  textMuted: '#8a90a0',
  textDim: '#5d6470',
  good: '#2ecc71',
  warn: '#f39c12',
  danger: '#e74c3c',
  info: '#7ec8ff',
  panel: 0x1f2433,
  button: 0x2c3e50,
  buttonHover: 0x3a5068,
  buttonActive: 0x46627f,
} as const;
