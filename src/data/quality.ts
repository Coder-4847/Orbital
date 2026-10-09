/**
 * Graphics quality presets. Pure data (no rendering imports) so settings, tests and renderers can share it.
 * Fields marked (future) are stored and persisted now but only consumed by later phases.
 */
export type QualityPresetId = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityValues {
  resolutionScale: number; // multiplies devicePixelRatio
  bloom: boolean;
  antialiasing: boolean; // MSAA on the HDR scene pass
  shadowQuality: 0 | 1 | 2 | 3; // (future) cascaded shadow map resolution
  cloudQuality: 0 | 1 | 2 | 3; // (future) cloud ray-march steps
  terrainDetail: 0 | 1 | 2 | 3; // (future) quadtree split distance
  particleScale: number; // (future) particle count multiplier
}

export const QUALITY_PRESETS: Record<QualityPresetId, QualityValues> = {
  low: { resolutionScale: 0.65, bloom: false, antialiasing: false, shadowQuality: 0, cloudQuality: 0, terrainDetail: 0, particleScale: 0.25 },
  medium: { resolutionScale: 0.85, bloom: true, antialiasing: false, shadowQuality: 1, cloudQuality: 1, terrainDetail: 1, particleScale: 0.5 },
  high: { resolutionScale: 1, bloom: true, antialiasing: true, shadowQuality: 2, cloudQuality: 2, terrainDetail: 2, particleScale: 1 },
  ultra: { resolutionScale: 1.25, bloom: true, antialiasing: true, shadowQuality: 3, cloudQuality: 3, terrainDetail: 3, particleScale: 1.5 },
};

export const QUALITY_PRESET_IDS = Object.keys(QUALITY_PRESETS) as QualityPresetId[];
