/** Launch sites. Pure data, shared by the terrain (which levels the ground under the pad) and the flight scene. */
export interface LaunchSite {
  id: string;
  name: string;
  /** Degrees east / north. */
  lon: number;
  lat: number;
  /** Height of the levelled pad above sea level (m). */
  height: number;
  /** Compass heading (degrees) the rocket's +X faces on the pad: east is 90. */
  heading: number;
}

export const LAUNCH_SITES: readonly LaunchSite[] = [{ id: 'ksc', name: 'Kennedy Space Center, Florida', lon: -80.6043, lat: 28.6084, height: 4, heading: 90 }];

export const DEFAULT_SITE = LAUNCH_SITES[0]!;

/** Radius (m) of the ground that is levelled exactly under a pad, and the distance over which it blends back into the terrain. */
export const PAD_FLAT_RADIUS = 300;
export const PAD_BLEND_RADIUS = 2500;
