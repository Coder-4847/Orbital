import type { Settings } from '../save/settings';

/** Push DOM-level settings (UI scale, HUD opacity) into CSS variables. */
export function applyInterfaceSettings(s: Settings): void {
  const root = document.documentElement.style;
  root.setProperty('--ui-scale', String(s.interface.uiScale));
  root.setProperty('--hud-opacity', String(s.interface.hudOpacity));
}
