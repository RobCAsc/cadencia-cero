// Una línea de texto pedida al rider: el canvas de Phaser no tiene teclado,
// así que se usa un <input> del DOM sobre el lienzo (en la tablet abre el
// teclado nativo). Devuelve el texto o undefined si cancela.

export interface TextPromptOptions {
  title: string;
  placeholder?: string;
  initial?: string;
  maxLength?: number;
  okLabel?: string;
}

export function promptText(opts: TextPromptOptions): Promise<string | undefined> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(5,6,14,0.82);font:16px system-ui,"Segoe UI",sans-serif;color:#ecf0f1;';
    const panel = document.createElement('div');
    panel.style.cssText =
      'width:min(560px,90vw);padding:22px 24px;background:#1f2433;border:2px solid #3a4256;border-radius:6px;display:flex;flex-direction:column;gap:14px;';
    const title = document.createElement('div');
    title.textContent = opts.title;
    title.style.cssText = 'font-size:20px;font-weight:600;';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = opts.initial ?? '';
    input.placeholder = opts.placeholder ?? '';
    input.maxLength = opts.maxLength ?? 80;
    input.autocomplete = 'off';
    input.style.cssText =
      'font:18px system-ui,"Segoe UI",sans-serif;padding:10px 12px;border-radius:4px;border:1px solid #3a4256;background:#0b0e18;color:#ecf0f1;outline:none;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = opts.okLabel ?? 'Guardar';
    for (const [b, bg] of [
      [cancel, '#2c3e50'],
      [ok, '#1e8449'],
    ] as const) {
      b.style.cssText = `font:16px system-ui,"Segoe UI",sans-serif;padding:10px 18px;border:0;border-radius:4px;color:#ecf0f1;background:${bg};`;
    }
    row.append(cancel, ok);
    panel.append(title, input, row);
    overlay.append(panel);

    const finish = (value: string | undefined) => {
      overlay.remove();
      resolve(value === undefined ? undefined : value.trim() || undefined);
    };
    cancel.addEventListener('click', () => finish(undefined));
    ok.addEventListener('click', () => finish(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(undefined);
      e.stopPropagation(); // que el panel dev no lea las teclas
    });
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) finish(undefined);
    });
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}
