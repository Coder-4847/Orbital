import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/builder/examples';
import { sphereHost } from '../src/flight/body-env';
import { Navigator } from '../src/flight/navigator';
import { captureFlight, restoreFlight, worldFor, type FlightSaveData } from '../src/save/flight-state';
import { Ephemeris } from '../src/physics/ephemeris';
import { length, sub } from '../src/physics/kepler';
import { run, worldAt } from './helpers/flight-env';

const LAT = (28.5 * Math.PI) / 180;
const KSC = { direction: [Math.cos(LAT), Math.sin(LAT), 0] as [number, number, number], headingDeg: 90 };

describe('saving a flight', () => {
  it('survives a round trip through JSON in the middle of a launch, with staging done, and then flies identically', () => {
    const w = worldAt();
    const craft = EXAMPLES[0]!.build();
    const v = w.launch(craft, KSC);
    v.throttle = 1;
    v.sas.enabled = true;
    w.stage();
    run(w, 25);
    expect(v.situation).toBe('flying');
    const nav = new Navigator(() => w);
    nav.addNode(w.ut + 600, { prograde: 50 });

    const text = JSON.stringify(captureFlight(w, { nodes: nav.nodes, target: 'moon', craft, initialFuel: 1234, camera: 'orbit' }));
    const data = JSON.parse(text) as FlightSaveData;
    const host = sphereHost(new Ephemeris());
    const w2 = worldFor(data, host);
    // the test world uses its own environment: borrow it so both worlds see the same planet
    w2.env = w.env;
    const extras = restoreFlight(data, w2);
    expect(extras.nodes).toHaveLength(1);
    expect(extras.target).toBe('moon');
    expect(extras.initialFuel).toBe(1234);
    expect(extras.craft?.parts.length).toBe(craft.parts.length);

    const a = w.active!;
    const b = w2.active!;
    expect(b.parts.length).toBe(a.parts.length);
    expect(length(sub(a.pos, b.pos))).toBeLessThan(1e-9);
    expect(b.parts.map((p) => p.fuel)).toEqual(a.parts.map((p) => p.fuel));
    expect(b.sas.enabled).toBe(true);
    expect(w2.ut).toBe(w.ut);

    run(w, 5);
    run(w2, 5);
    expect(length(sub(a.pos, b.pos))).toBeLessThan(0.05);
    expect(length(sub(a.vel, b.vel))).toBeLessThan(0.05);
  });

  it('rejects a broken or foreign save with a readable message', () => {
    const w = worldAt();
    const host = sphereHost(new Ephemeris());
    const base = captureFlight(w, { nodes: [], target: null, craft: null, initialFuel: 1, camera: 'pad' });
    expect(() => restoreFlight({ ...base, kind: 'other' } as never, worldFor(base, host))).toThrow(/does not contain a flight/);
    const bad = JSON.parse(JSON.stringify({ ...base, vessels: [{ ...captureFlight(worldAt(), { nodes: [], target: null, craft: null, initialFuel: 1, camera: 'pad' }).vessels[0] }] })) as FlightSaveData;
    w.launch(EXAMPLES[0]!.build(), KSC);
    const good = captureFlight(w, { nodes: [], target: null, craft: null, initialFuel: 1, camera: 'pad' });
    good.vessels[0]!.parts[0]!.def = 'part-from-the-future';
    expect(() => restoreFlight(good, worldFor(good, host))).toThrow(/no longer exists/);
    expect(bad.vessels).toHaveLength(1);
  });
});
