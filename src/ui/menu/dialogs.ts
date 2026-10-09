import { REVISION } from 'three/webgpu';
import type { AppContext } from '../../core/scene-manager';
import { APP_NAME, APP_VERSION } from '../../version';
import { h } from '../kit/dom';
import { openModal } from '../kit/modal';

export function openAbout(ctx: AppContext): void {
  const row = (k: string, v: string) => [h('dt', { text: k }), h('dd', { text: v })];
  openModal({
    title: 'About',
    content: h(
      'div',
      null,
      h('p', { style: 'margin:0 0 1.25rem;color:var(--text-dim)', text: 'A real-scale spaceflight simulator that runs entirely in your browser. Build a rocket, reach orbit, and travel the solar system.' }),
      h(
        'dl',
        { class: 'kv' },
        ...row('Version', `${APP_NAME} ${APP_VERSION}`),
        ...row('Renderer', ctx.rendererLabel),
        ...row('Engine', `three.js r${REVISION}`),
        ...row('Typefaces', 'Inter, JetBrains Mono (SIL OFL)'),
        ...row('Earth data', 'NASA Visible Earth heightmap and Natural Earth populated places (public domain).'),
        ...row('Storage', 'Saves and settings stay in this browser.'),
      ),
    ),
  });
}
