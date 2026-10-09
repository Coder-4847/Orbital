import { h } from './kit/dom';

/** Friendly full-screen message for when the game cannot start (no GPU API, storage blocked, unexpected crash). */
export function showFatal(title: string, paragraphs: string[], tips: string[] = [], detail?: string): void {
  document.getElementById('boot')?.remove();
  const card = h(
    'section',
    { class: 'fatal', role: 'alert' },
    h('h1', { text: title }),
    ...paragraphs.map((p) => h('p', { text: p })),
    tips.length ? h('ul', null, ...tips.map((t) => h('li', { text: t }))) : null,
    detail ? h('p', null, h('code', { text: detail })) : null,
  );
  const wrap = h('div', { class: 'boot' }, card);
  document.body.appendChild(wrap);
}

export function showGraphicsUnavailable(causes: unknown[]): void {
  const detail = causes.map((c) => (c instanceof Error ? c.message : String(c))).join(' | ');
  showFatal(
    'Orbital cannot start graphics on this device',
    ['Orbital needs WebGPU or WebGL 2 to draw its 3D world, and neither could be started.'],
    [
      'Use a recent version of Chrome, Edge, Firefox or Safari.',
      'Make sure hardware acceleration is enabled in your browser settings.',
      'Update your graphics drivers, then reload this page.',
    ],
    detail,
  );
}
