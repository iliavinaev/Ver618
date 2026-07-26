// ============================================================================
// SKYWATCH · SIMULATION ENGINE (pure, deterministic, UI-agnostic)
// ----------------------------------------------------------------------------
// No React, no Leaflet, no DOM. The engine owns the air-defence model so the
// same logic drives the live animation, Monte-Carlo, and headless tests, and
// so results are reproducible from a seed.
//
// Geometry is in geographic coordinates (lat/lng); the UI projects to pixels.
// Time is REAL seconds. Everything here is illustrative / UNCLASSIFIED and is a
// training/analysis aid, not validated operational analysis.
// ============================================================================

import { kmBetween, destPoint, bearingTo, weatherEffects, crosswindPkMul, SALVO } from './operational';
import {
  ALT_BANDS, FAMILY_ALT, fatigueFactor, saturationFactor, misclassifyProb,
  weaponReliability, SEASONS, temperatureEffects, icingPenalty, windAloftKmh,
  buildRoute, resolveShotPk, radarHorizonKm, effectiveDetectKm,
} from './tacticalModel';

// ---- Deterministic RNG (mulberry32). Same seed => same run. ----
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Engageability (single source of truth) ----
export const ENGAGE_CLASS_KEYS = ['ballistic', 'cruise', 'owa', 'glide', 'male'];

export function normFam(family) {
  return (family === 'male' || family === 'tactical' || family === 'recon' || family === 'unknown') ? 'owa' : family;
}

// Physical capability: can this system EVER engage this class (hard envelope)?
export function physCapable(def, cls) {
  if (!def || def.isEW) return false;
  if (cls === 'ballistic') return def.tbmFootprintKm > 0;
  if (def.can && def.can.length) {
    if (def.can.includes(cls)) return true;
    if (cls === 'cruise' && (def.cat === 'MANPADS' || def.cat === 'GUN_LASER' || def.role === 'VSHORAD' || def.id === 'manpads' || def.id === 'gepard')) return true;
    return false;
  }
  if (def.cat === 'GUN_LASER' || def.cat === 'MANPADS' || def.cat === 'INTERCEPTOR') return cls !== 'ballistic';
  return true;
}

export function defaultCan(def) {
  return ENGAGE_CLASS_KEYS.filter(k => physCapable(def, k));
}

// Doctrine-effective engageable set for a placed battery (override if present).
export function effectiveCan(batt, def) {
  if (Array.isArray(batt.canOverride)) return batt.canOverride;
  return (def.can && def.can.length) ? def.can.filter(k => physCapable(def, k)) : defaultCan(def);
}

// Final gate: physically capable AND doctrine-allowed.
export function canEngage(def, family, batt) {
  if (!def || def.isEW) return false;
  const fam = normFam(family || 'owa');
  if (!physCapable(def, fam)) return false;
  if (batt && Array.isArray(batt.canOverride)) return batt.canOverride.includes(fam);
  if (def.can && def.can.length) return def.can.includes(fam);
  return true;
}

// ---- Build the initial simulation state from a plan ----
// plan = { batteries:[{uid,type,lat,lng,engage,canOverride}], defs:{type->def},
//          targets:[{id,lat,lng,maxHp,valueM,type}],
//          waves:[{type,family,from,target,count,spacingSec,startGH,kmh,dmg}],
//          origins:{id->{lat,lng}}, bounds:{n,s,w,e},
//          env:{season,night,coldStart,centralised,jamming,windKmh,wxPreset,salvoKey},
//          weather, costForType(type,family) }
export function initSim(plan, seed) {
  const rng = makeRng(seed >>> 0);
  const env = plan.env || {};
  const seasonObj = SEASONS[env.season] || SEASONS.autumn;
  const tEff = temperatureEffects(seasonObj.tempC);
  const helpers = { destPoint, bearingTo };

  const diagKm = kmBetween({ lat: plan.bounds.s, lng: plan.bounds.w }, { lat: plan.bounds.n, lng: plan.bounds.e });
  const ingressKm = Math.min(Math.max(diagKm * 0.55, 160), 1200);
  const AXIS_BEARING = { N: 180, NE: 225, E: 270, SE: 315, S: 0, NW: 135, W: 90, SW: 45 };

  // round-robin target assignment per wave (deterministic)
  const targetsById = {}; plan.targets.forEach(t => { targetsById[t.id] = t; });
  // battery targets (SEAD/DEAD) are added after batteries are built, below
  function wTargetFor(wave, i) {
    // a wave can aim at an AD battery: target id like 'bat_<uid>'
    if (wave.target && wave.target !== 'all') return targetsById[wave.target] || plan.targets[0] || null;
    if (!plan.targets.length) return null;
    return plan.targets[i % plan.targets.length];
  }
  // batteries first, so cruise missiles can route AROUND their coverage
  const bats = plan.batteries.map(b => {
    const baseDef = plan.defs[b.type];
    const ov = b.defOverride || null;
    // a selected variant overrides range / ABM footprint / cost; pkMul scales Pk
    const def = ov ? {
      ...baseDef,
      aeroRangeKm: ov.aeroRangeKm != null ? ov.aeroRangeKm : baseDef.aeroRangeKm,
      tbmFootprintKm: ov.tbmFootprintKm != null ? ov.tbmFootprintKm : baseDef.tbmFootprintKm,
      costM: ov.costM != null ? ov.costM : baseDef.costM,
      variantName: ov.variantName,
    } : baseDef;
    const launchers = Math.max(1, b.launchers || 1);
    const perLauncher = def.rounds || Infinity;
    const totalAmmo = perLauncher === Infinity ? Infinity : perLauncher * launchers;
    return {
      uid: b.uid, lat: b.lat, lng: b.lng, type: b.type, def, launchers,
      ammo: totalAmmo, maxAmmo: totalAmmo, reloadUntil: 0,
      channels: launchers, // simultaneous engagement channels scale with launchers
      isEW: def.isEW, engage: b.engage !== false, canOverride: b.canOverride,
      pkMul: ov && ov.pkMul != null ? ov.pkMul : 1,
      // radar: nominal detection range and antenna mast height (m). Bigger SAMs
      // sit on higher masts and see further; guns/MANPADS are low optical/short.
      detectKm: def.detectKm || def.aeroRangeKm || 0,
      mastM: def.mastM != null ? def.mastM : (def.tbmFootprintKm > 0 ? 25 : (def.aeroRangeKm >= 40 ? 12 : (def.aeroRangeKm >= 15 ? 6 : 3))),
      isRadar: def.isRadar || false,
      // command-and-information delay (seconds). reactDelaySec is the system's own
      // detect-to-launch reaction; c2DelaySec is the extra cost of routing the
      // engagement through a central command post. Total delay before this
      // battery may fire on a given track = reactDelaySec + c2DelaySec, measured
      // from the moment the battery first holds a usable track on it.
      reactDelaySec: b.reactDelaySec != null ? b.reactDelaySec : (def.reactDelaySec != null ? def.reactDelaySec : 0),
      c2DelaySec: b.c2DelaySec != null ? b.c2DelaySec : 0,
      firstSeen: {}, // trackIndex -> sim time (s) when first detected by this battery
      // SEAD/DEAD: a battery can itself be targeted. It has a small amount of
      // structural HP (radar, launchers, C2) and is disabled when it reaches 0.
      hp: b.hp != null ? b.hp : (def.tbmFootprintKm > 0 ? 3 : (def.aeroRangeKm >= 40 ? 2 : 1)),
      maxHp: b.hp != null ? b.hp : (def.tbmFootprintKm > 0 ? 3 : (def.aeroRangeKm >= 40 ? 2 : 1)),
      disabled: false, hitsTaken: 0,
      // self-defence: big SAMs (Patriot/SAMP-T) can auto-engage a threat closing
      // on themselves with the human out of the loop: zero command delay and a
      // higher Pk, but only inside a short self-defence radius.
      selfDefend: b.selfDefend != null ? b.selfDefend : (def.tbmFootprintKm > 0),
      selfDefendKm: b.selfDefendKm != null ? b.selfDefendKm : (def.tbmFootprintKm > 0 ? 20 : 0),
      shots: 0, kills: 0, costM: def.costM || 0,
      // sensors detect but never fire; fighters/AWACS fly a patrol loop.
      isSensor: !!def.isSensor,
      isFighter: !!def.isFighter,
      speedKmh: def.speedKmh || 0,
      patrol: (b.patrol && b.patrol.length >= 1) ? b.patrol.map(p => ({ lat: p.lat, lng: p.lng })) : null,
      patLeg: 0, patDir: 1, // current leg index and direction along the patrol loop
    };
  });
  // coverage points the cruise router tries to skirt (live SAM/gun rings)
  const threatRings = bats.filter(b => !b.isEW && b.engage !== false && (b.def.aeroRangeKm || 0) > 0)
    .map(b => ({ lat: b.lat, lng: b.lng, km: b.def.aeroRangeKm }));

  // register AD batteries as targetable points (SEAD/DEAD) BEFORE building tracks,
  // so a wave aimed at bat_<uid> routes to the battery, not a fallback city.
  bats.forEach(b => {
    const id = 'bat_' + b.uid;
    targetsById[id] = { id, lat: b.lat, lng: b.lng, name: (b.def.tag || b.def.name || 'SAM'), type: 'ad_site', maxHp: b.maxHp, valueM: Math.round((b.def.costM || 1) * 1000), _batUid: b.uid };
  });

  const tracks = [];
  plan.waves.forEach(r => {
    const origin = plan.origins[r.from];
    const altKey = FAMILY_ALT[r.family] || 'low';
    const altM = (ALT_BANDS[altKey] || ALT_BANDS.low).m;
    const rcs = r.family === 'cruise' ? 'small' : (r.family === 'owa' ? 'small' : (r.type === 'decoy' ? 'tiny' : 'medium'));
    // OWA (Shahed) arrive in small groups, not an even stream: pick a group size
    // and insert a longer gap between groups. Deterministic via rng.
    let groupRemaining = 0, groupGap = 0;
    for (let i = 0; i < r.count; i++) {
      const tgt = wTargetFor(r, i);
      if (!tgt) continue;
      let originPt;
      if (origin) {
        // Real adversary launch area (Russia, Belarus, sea boxes, Iran). Spawn
        // from HERE so threats always come from their true direction. We only
        // bound the *very longest* ingress so a far origin (e.g. Iran) still
        // enters the visible area, but never closer than a long stand-off so it
        // never appears on the friendly side of the target.
        originPt = { lat: origin.lat, lng: origin.lng };
        const realKm = kmBetween(originPt, { lat: tgt.lat, lng: tgt.lng });
        const maxIngress = Math.max(ingressKm, 900); // generous: keep true origins
        if (realKm > maxIngress) {
          const brg = bearingTo({ lat: tgt.lat, lng: tgt.lng }, originPt);
          originPt = destPoint(tgt.lat, tgt.lng, brg, maxIngress);
        }
      } else {
        // No named origin: synthesize one well outside the theatre along the axis
        const travel = AXIS_BEARING[r.from] != null ? AXIS_BEARING[r.from] : 270;
        const back = destPoint(tgt.lat, tgt.lng, (travel + 180) % 360, Math.max(ingressKm, 400));
        originPt = { lat: back.lat, lng: back.lng };
      }
      const jitterKm = (rng() - 0.4) * Math.min(120, diagKm * 0.10);
      // ENHANCED: a user-drawn route with per-point altitudes overrides the
      // automatic origin->target routing. The first point is the spawn, the
      // last is the impact; altitudes interpolate along the legs.
      let routeGeo, routeAlts = null;
      if (r.customPoints && r.customPoints.length >= 2) {
        routeGeo = r.customPoints.map(p => ({ lat: p.lat, lng: p.lng }));
        routeAlts = r.customPoints.map(p => (p.altM != null ? p.altM : altM));
        originPt = { lat: routeGeo[0].lat, lng: routeGeo[0].lng };
      } else {
        // route evasion comes from the threat's maneuver capability
        const evade = r.maneuver != null ? r.maneuver
          : (r.family === 'cruise' ? 1.0 : r.family === 'owa' ? 0.45 : r.family === 'glide' ? 0.2 : 0);
        routeGeo = buildRoute(originPt, { lat: tgt.lat, lng: tgt.lng }, r.family, jitterKm,
          { ...helpers, threatRings, evade, rng, kmh: r.kmh });
      }
      let kmh = r.family === 'ballistic' ? (r.kmh && r.kmh > 1500 ? r.kmh : 6500) : (r.kmh || 185);
      if (r.family === 'owa' || r.family === 'cruise') {
        const wAloft = windAloftKmh(env.windKmh || 0, altKey);
        kmh = Math.max(90, kmh + (rng() - 0.5) * wAloft * 0.5);
      }
      // spawn time: grouped for OWA, even spacing otherwise
      let spawnT;
      const baseSpacing = Math.max(2, r.spacingSec || 30);
      if (r.family === 'owa') {
        if (groupRemaining <= 0) { groupRemaining = 3 + Math.floor(rng() * 3); groupGap += baseSpacing * (4 + Math.floor(rng() * 5)); }
        spawnT = (r.startGH || 0) * 3600 + groupGap + (i % 1) * 0 + groupRemaining * 0;
        // within-group tight spacing
        spawnT = (r.startGH || 0) * 3600 + groupGap;
        groupGap += baseSpacing * (0.5 + rng() * 0.6); // tight inside the group
        groupRemaining--;
      } else {
        spawnT = (r.startGH || 0) * 3600 + i * baseSpacing;
      }
      // cruise speed = normal flight speed; terminal speed = faster dive onto
      // the target in the last phase. Defaults by family if not specified.
      const cruiseKmh = kmh;
      const terminalKmh = r.terminalKmh != null ? r.terminalKmh
        : (r.family === 'ballistic' ? kmh                     // already very fast
          : r.family === 'cruise' ? kmh * 1.15                // slight terminal accel
          : r.family === 'owa' ? kmh * 1.6                    // Shahed dives faster than it cruises
          : r.family === 'glide' ? kmh * 1.3
          : kmh * 1.2);
      tracks.push({
        pos: { lat: routeGeo[0].lat, lng: routeGeo[0].lng },
        routeGeo, routeAlts, leg: 1, tgtGeo: { lat: tgt.lat, lng: tgt.lng },
        family: r.family, type: r.type, altKey, altM: routeAlts ? routeAlts[0] : altM, rcs, kmh,
        cruiseKmh, terminalKmh, cruiseAltM: routeAlts ? routeAlts[0] : altM,
        gLimit: r.gLimit != null ? r.gLimit : (r.family === 'cruise' ? 5 : r.family === 'owa' ? 2.5 : r.family === 'ballistic' ? 0.5 : 4),
        dmg: r.dmg || 1, costM: plan.costForType ? plan.costForType(r.type, r.family) : 0.1, tgtId: tgt.id,
        isDecoy: r.type === 'decoy' || r.type === 'emit_decoy',
        mirv: r.mirv || 0, mirvSplitKm: r.mirvSplitKm || 0, mirvDone: false,
        spawnT, rolled: {}, done: false, trailGeo: [],
      });
    }
  });

  const tgtState = {};
  plan.targets.forEach(t => { tgtState[t.id] = { name: t.name, type: t.type || 'city', hp: t.maxHp || 3, maxHp: t.maxHp || 3, valueM: t.valueM || 200, dmgM: 0, hits: 0 }; });
  // register AD batteries in tgtState (targetsById already done above)
  bats.forEach(b => {
    const id = 'bat_' + b.uid;
    tgtState[id] = { name: (b.def.tag || b.def.name || 'SAM'), type: 'ad_site', hp: b.maxHp, maxHp: b.maxHp, valueM: Math.round((b.def.costM || 1) * 1000), dmgM: 0, hits: 0, _batUid: b.uid };
  });

  return {
    rng, bats, tracks, simT: 0, intercepts: [], hits: [],
    spentM: 0, killedM: 0, dmgM: 0, tgtState,
    allTargets: plan.targets.map(t => ({ lat: t.lat, lng: t.lng, id: t.id })),
    env, seasonObj, tEff, weather: plan.weather,
    pkProfile: plan.pkProfile, salvoKey: env.salvoKey || 'single',
    miss: { reliability: 0, tracklow: 0, saturation: 0, weather: 0, misclassified: 0 },
  };
}

// ---- Advance the simulation by dt real seconds (pure model, no rendering) ----
// Mutates sim. Returns nothing; the caller reads sim for state to render/report.
export function stepSim(sim, dtSec, nowMsForReload) {
  const rng = sim.rng;
  sim.simT += dtSec;
  const tms = sim.simT;
  const SAL = SALVO[sim.salvoKey] || SALVO.single;
  const now = nowMsForReload != null ? nowMsForReload : 0;

  // complete reloads (real-time gated by the caller's clock)
  sim.bats.forEach(b => { if (b.reloadUntil && now >= b.reloadUntil) { b.ammo = b.maxAmmo; b.reloadUntil = 0; } });

  // move fighters / AWACS along their patrol loop. A patrol with one point is a
  // loiter (stationary); with 2+ points the aircraft flies leg to leg and, at the
  // end, reverses direction (a racetrack back-and-forth). Position updates feed
  // both its radar coverage and its air-to-air engagement zone.
  sim.bats.forEach(b => {
    if (!b.isFighter || !b.patrol || b.disabled) return;
    if (b.patrol.length < 2 || !b.speedKmh) { // single-point loiter: sit on it
      if (b.patrol.length >= 1) { b.lat = b.patrol[0].lat; b.lng = b.patrol[0].lng; }
      return;
    }
    let stepKm = (b.speedKmh / 3600) * dtSec;
    // advance along legs, consuming stepKm, bouncing at the ends of the route
    let guard = 0;
    while (stepKm > 0 && guard++ < 50) {
      const nextIdx = b.patLeg + b.patDir;
      const wp = b.patrol[nextIdx];
      if (!wp) { b.patDir *= -1; continue; } // hit an end: reverse
      const d = kmBetween(b, wp);
      if (d <= stepKm) { b.lat = wp.lat; b.lng = wp.lng; b.patLeg = nextIdx; stepKm -= d; }
      else {
        const f = stepKm / d;
        b.lat += (wp.lat - b.lat) * f; b.lng += (wp.lng - b.lng) * f; stepKm = 0;
      }
    }
  });

  // mission-hours proxy for fatigue uses sim time
  const hoursInto = tms / 3600;
  const fatigue = fatigueFactor(hoursInto);

  sim.tracks.forEach((tr, _ti) => {
    if (tr.done || tms < tr.spawnT) return;
    let wp = tr.routeGeo[tr.leg] || tr.tgtGeo;
    let distKm = kmBetween(tr.pos, wp);
    // terminal phase: within a terminal range of the FINAL target the threat
    // accelerates to terminal speed and dives. dToTarget drives both.
    const dToTarget = kmBetween(tr.pos, tr.tgtGeo);
    const termRangeKm = tr.family === 'ballistic' ? 40 : tr.family === 'owa' ? 8 : tr.family === 'glide' ? 12 : 18;
    const inTerminal = (tr.leg >= tr.routeGeo.length - 1) && dToTarget <= termRangeKm;
    tr.inTerminal = inTerminal;
    const useKmh = inTerminal ? (tr.terminalKmh || tr.kmh) : (tr.cruiseKmh || tr.kmh);
    const stepKm = (useKmh / 3600) * dtSec;
    const Vms = (useKmh / 3.6);                         // m/s
    const nG = tr.gLimit != null ? tr.gLimit : 4;       // sustained g
    const turnRkm = (Vms * Vms) / (9.81 * Math.max(0.3, nG)) / 1000;
    // capture radius: a turn-limited missile need not pass exactly through a
    // mid waypoint; once within ~ its turn radius (or a step) it advances to the
    // next leg. This is what lets it round corners instead of teleporting.
    while (tr.leg < tr.routeGeo.length - 1 && distKm <= Math.max(stepKm * 1.2, Math.min(turnRkm, 50))) {
      tr.leg++; wp = tr.routeGeo[tr.leg] || tr.tgtGeo; distKm = kmBetween(tr.pos, wp);
    }
    const finalLeg = tr.leg >= tr.routeGeo.length - 1;
    // impact: only when on the final leg and within this step of the target
    if (finalLeg && stepKm >= distKm) {
      tr.pos = { lat: wp.lat, lng: wp.lng }; tr.done = true; tr.leakCounted = true;
      sim.hits.push({ lat: tr.pos.lat, lng: tr.pos.lng });
      if (!tr.isDecoy) {
        const ts = sim.tgtState[tr.tgtId];
        if (ts) {
          const dpt = Math.min(tr.dmg || 1, ts.hp); ts.hp -= dpt; ts.hits += 1;
          const dv = (ts.valueM / ts.maxHp) * dpt; ts.dmgM += dv; sim.dmgM += dv;
          // SEAD/DEAD: if this was an AD site, damage the battery and disable at 0
          if (ts._batUid) {
            const bat = sim.bats.find(b => b.uid === ts._batUid);
            if (bat) { bat.hp -= dpt; bat.hitsTaken += 1; if (bat.hp <= 0 && !bat.disabled) { bat.disabled = true; bat.engage = false; sim.adKilled = (sim.adKilled || 0) + 1; } }
          }
        }
      }
      return;
    }
    // ALWAYS move under the turn-rate limit (no teleport to waypoints). Turn
    // radius R = V^2/(g*n); max heading change this step is (g*n/V)*dt.
    if (stepKm > 0) {
      const desiredBrg = bearingTo(tr.pos, wp);
      const prevHeading = tr.heading != null ? tr.heading : desiredBrg;
      const maxRad = (9.81 * nG / Math.max(40, Vms)) * dtSec; // rad/step
      const maxDeg = maxRad * 180 / Math.PI;
      let diff = ((desiredBrg - prevHeading + 540) % 360) - 180; // [-180,180]
      const applied = Math.max(-maxDeg, Math.min(maxDeg, diff));
      const newHeading = (prevHeading + applied + 360) % 360;
      tr.pos = destPoint(tr.pos.lat, tr.pos.lng, newHeading, stepKm);
      tr.heading = newHeading;
      tr.turnRadiusKm = turnRkm;
    }
    // ENHANCED: interpolate altitude between the two waypoints of the current leg
    if (tr.routeAlts && tr.routeAlts.length >= 2) {
      const a0 = tr.routeAlts[tr.leg - 1] != null ? tr.routeAlts[tr.leg - 1] : tr.altM;
      const a1 = tr.routeAlts[tr.leg] != null ? tr.routeAlts[tr.leg] : a0;
      const legStart = tr.routeGeo[tr.leg - 1] || tr.routeGeo[0];
      const legEnd = tr.routeGeo[tr.leg] || tr.tgtGeo;
      const legLen = kmBetween(legStart, legEnd) || 1;
      const remain = kmBetween(tr.pos, legEnd);
      const f = Math.max(0, Math.min(1, 1 - remain / legLen));
      tr.altM = a0 + (a1 - a0) * f;
    }
    // terminal descent: in the terminal phase the threat always falls onto the
    // target, altitude ramps to ~0 as range closes, regardless of route profile.
    if (tr.inTerminal) {
      const termRangeKm = tr.family === 'ballistic' ? 40 : tr.family === 'owa' ? 8 : tr.family === 'glide' ? 12 : 18;
      const frac = Math.max(0, Math.min(1, dToTarget / termRangeKm)); // 1 far, 0 at target
      const fromAlt = tr.cruiseAltM != null ? tr.cruiseAltM : tr.altM;
      tr.altM = Math.min(tr.altM, fromAlt * frac); // monotone descent to 0
    }
    tr.trailGeo.push({ lat: tr.pos.lat, lng: tr.pos.lng }); if (tr.trailGeo.length > 18) tr.trailGeo.shift();

    // MIRV separation: at terminal range the bus releases independent blocks.
    // The track becomes block #1; the rest are spawned as new inbound tracks,
    // MIRV separation: at terminal range the bus releases independent blocks.
    // Blocks land in the footprint of the BUS'S OWN target, not across every
    // target in the scenario. They strike nearby targets only if those lie
    // within the MIRV footprint (a few tens of km), otherwise they fan around
    // the aim point. This prevents a Warsaw-bound bus seeding blocks on Kyiv.
    if (tr.mirv > 1 && !tr.mirvDone) {
      const dToTgt = kmBetween(tr.pos, tr.tgtGeo);
      if (dToTgt <= (tr.mirvSplitKm || 100)) {
        tr.mirvDone = true;
        if (!sim._newTracks) sim._newTracks = [];
        const FOOTPRINT_KM = 70; // MIRV blocks disperse over tens of km, not continents
        const allT = sim.allTargets || [];
        // targets that lie inside the footprint of this bus's aim point
        const nearby = allT.filter(t => kmBetween(t, tr.tgtGeo) <= FOOTPRINT_KM);
        for (let m = 1; m < tr.mirv; m++) {
          let dest;
          if (nearby.length > 1) {
            dest = nearby[m % nearby.length];
          } else {
            // fan blocks around the aim point within the footprint
            const fanBrg = (tr.heading || 0) + (m % 2 === 0 ? 1 : -1) * (18 + 10 * m);
            const spreadKm = 8 + (m / tr.mirv) * (FOOTPRINT_KM * 0.5);
            const pt = destPoint(tr.tgtGeo.lat, tr.tgtGeo.lng, fanBrg, spreadKm);
            dest = { lat: pt.lat, lng: pt.lng, id: tr.tgtId };
          }
          const releasePt = destPoint(tr.pos.lat, tr.pos.lng, (tr.heading || 0) + (m % 2 === 0 ? 20 : -20), 5);
          sim._newTracks.push({
            pos: { lat: releasePt.lat, lng: releasePt.lng },
            routeGeo: [{ lat: releasePt.lat, lng: releasePt.lng }, { lat: dest.lat, lng: dest.lng }],
            leg: 1, tgtGeo: { lat: dest.lat, lng: dest.lng },
            family: 'ballistic', type: tr.type, altKey: 'ballistic', altM: 30000, rcs: 'medium',
            kmh: tr.kmh * 0.92, dmg: Math.max(1, (tr.dmg || 1) - 1), costM: 0, tgtId: dest.id || tr.tgtId,
            isDecoy: false, mirv: 0, mirvSplitKm: 0, mirvDone: true, isBlock: true,
            spawnT: tms, rolled: {}, done: false, trailGeo: [],
          });
        }
        // the parent block keeps a reduced warhead
        tr.dmg = Math.max(1, (tr.dmg || 1) - 1); tr.isBlock = true;
      }
    }

    // ===== RADAR / DETECTION (separate from engagement) =====
    // A weapon can only engage what some radar SEES. Detection range is the
    // smaller of the radar's nominal range and the radar horizon for THIS
    // target's altitude (low movers hide behind the curvature). A radar inside
    // a hostile EW jamming footprint is blinded. We also count overlapping
    // sensors for track-quality fusion.
    let detected = false; let nSensors = 0;
    const targetAltM = tr.altM || (ALT_BANDS[tr.altKey] || ALT_BANDS.low).m;
    for (let si = 0; si < sim.bats.length; si++) {
      const s = sim.bats[si];
      if (s.disabled) continue; // a destroyed site has no radar
      const nominal = s.detectKm || 0; if (nominal <= 0) continue;
      // is this radar jammed? (zonal EW from hostile jammers, if any)
      let jammed = false;
      if (sim.jammers && sim.jammers.length) {
        for (const j of sim.jammers) { if (kmBetween(s, j) <= j.km) { jammed = true; break; } }
      }
      if (jammed) continue;
      const horizon = radarHorizonKm(s.mastM || 6, targetAltM);
      const range = Math.min(nominal, horizon);
      if (kmBetween(tr.pos, s) <= range) { detected = true; nSensors++; }
    }
    // global jamming flag (legacy/simple mode) degrades but doesn't fully blind
    tr._detected = detected; tr._nSensors = nSensors;
    if (detected) { tr.everDetected = true; }

    for (let bi = 0; bi < sim.bats.length; bi++) {
      const b = sim.bats[bi]; if (b.isEW || b.isSensor) continue; // sensors detect only
      if (b.disabled) continue; // destroyed site cannot fire
      if (!b.engage) continue;
      if (!detected) continue; // cannot shoot what no radar sees
      // SELF-DEFENCE: a big SAM (Patriot/SAMP-T) auto-engages a threat closing on
      // itself, human out of the loop. Inside the self-defence radius this gives
      // zero command delay and a Pk bonus. We detect "closing on itself" as the
      // threat being inside selfDefendKm and either aimed at this battery
      // (target id bat_<uid>) or physically very near.
      const dSelf = kmBetween(tr.pos, b);
      const aimedAtMe = tr.tgtId === ('bat_' + b.uid);
      const selfDef = b.selfDefend && b.selfDefendKm > 0 && dSelf <= b.selfDefendKm && (aimedAtMe || dSelf <= b.selfDefendKm * 0.6);
      // command-and-information delay: the battery must hold the track for
      // (reactDelaySec + c2DelaySec) before it is allowed to fire. Self-defence
      // bypasses this entirely (autonomous reaction).
      if (!selfDef) {
        const totalDelay = (b.reactDelaySec || 0) + (b.c2DelaySec || 0);
        if (totalDelay > 0) {
          if (b.firstSeen[_ti] == null) b.firstSeen[_ti] = tms;
          if (tms - b.firstSeen[_ti] < totalDelay) { sim.actionFrame = true; continue; }
        }
      }
      if (b.reloadUntil && now < b.reloadUntil) continue;
      if (!canEngage(b.def, tr.family, b)) continue;
      const ringKm = tr.family === 'ballistic' ? (b.def.tbmFootprintKm || 0) : (b.def.aeroRangeKm || 0);
      if (ringKm <= 0) continue;
      const dKm = kmBetween(tr.pos, b);
      if (dKm <= ringKm * 1.4) sim.actionFrame = true;
      if (tr.rolled[bi]) continue;
      if (dKm <= ringKm) {
        tr.rolled[bi] = true;
        if (b.ammo <= 0) continue;
        const mis = misclassifyProb(tr.altKey, tr.rcs, sim.env.night, sim.env.jamming);
        if (!tr.isDecoy && rng() < mis * 0.5) { sim.miss.misclassified++; continue; }
        const sN = SAL.shots;
        b.ammo -= sN; b.shots += sN; sim.spentM += sN * (b.costM || 0);
        let near = 0; for (const t2 of sim.tracks) { if (!t2.done && tms >= t2.spawnT && kmBetween(t2.pos, b) <= ringKm) near++; }
        const sat = saturationFactor(near, b.channels || 2);
        const optical = b.def.cat === 'GUN_LASER' || b.type === 'gepard' || b.type === 'mobile' || b.type === 'int_team' || b.type === 'manpads';
        const we = weatherEffects(sim.weather, optical ? 'gepard' : b.type, tr.family);
        let pk = resolveShotPk({
          basePk: ((sim.pkProfile(b.type) || {})[normFam(tr.family)] || 0) * (b.pkMul || 1),
          shots: sN, weatherPkMul: we.pkMul, crosswindMul: crosswindPkMul(sim.weather),
          nSensors: tr._nSensors || 1, altBandKey: tr.altKey, jammed: sim.env.jamming,
          fatigue, saturation: sat, icing: icingPenalty(sim.seasonObj.icing, b.type),
          optical, temperatureOpticalMul: sim.tEff.opticalMul,
          reliability: weaponReliability(b.type, b.def.lib),
        });
        // self-defence: autonomous point-defence engagement is tightly cued and
        // optimised, so it gets a Pk bonus (clamped just under certainty).
        if (selfDef) { pk = Math.min(0.97, pk * 1.25); tr._sdEngaged = true; }
        if (rng() < pk) {
          tr.done = true; tr.deadCounted = true; b.kills += 1; if (!tr.isDecoy) sim.killedM += tr.costM || 0;
          sim.intercepts.push({ lat: tr.pos.lat, lng: tr.pos.lng }); break;
        } else {
          if (sat < 0.8) sim.miss.saturation++;
          else if (tr.altKey === 'terrain' || tr.altKey === 'low') sim.miss.tracklow++;
          else if (we.pkMul < 0.85) sim.miss.weather++;
          else sim.miss.reliability++;
        }
      }
    }
  });
  // append any MIRV blocks released this step
  if (sim._newTracks && sim._newTracks.length) {
    for (const nt of sim._newTracks) sim.tracks.push(nt);
    sim._newTracks.length = 0;
  }
}

export function allResolved(sim) { return sim.tracks.every(t => t.done); }

// ---- Headless full run to completion (for Monte-Carlo / tests) ----
export function runToEnd(plan, seed, opts) {
  const dt = (opts && opts.dt) || 2;          // sim seconds per step
  const maxT = (opts && opts.maxT) || 28800;  // 8h sim cap (long Shahed raids need it)
  const sim = initSim(plan, seed);
  let t = 0;
  while (!allResolved(sim) && t < maxT) { stepSim(sim, dt, 0); t += dt; }
  // Any track still in flight when the (very long) cap is reached did NOT complete
  // its mission. It must NOT be counted as a target hit, or the report fabricates
  // impacts that never happened. Mark it resolved-but-unaccounted (a wash).
  sim.tracks.forEach(tr => { if (!tr.done) { tr.done = true; tr.unresolved = true; } });
  return summarize(sim);
}

export function summarize(sim) {
  const total = sim.tracks.length;
  const killed = sim.tracks.filter(t => t.deadCounted).length;
  const leaked = sim.tracks.filter(t => t.leakCounted).length;
  const unresolved = sim.tracks.filter(t => t.unresolved).length;
  const decoys = sim.tracks.filter(t => t.isDecoy).length;
  const realThreats = total - decoys;
  const realLeaked = sim.tracks.filter(t => !t.isDecoy && t.leakCounted).length;
  // resolved real threats = those that were either intercepted or leaked (not
  // still-flying); protection is measured against those, so an over-short run
  // does not silently inflate the protection rate.
  const resolvedReal = Math.max(0, realThreats - sim.tracks.filter(t => !t.isDecoy && t.unresolved).length);
  return {
    total, killed, leaked, unresolved, decoys, realThreats, realLeaked,
    rate: total ? killed / total : 0,
    protect: resolvedReal ? 1 - realLeaked / resolvedReal : 1,
    spentM: sim.spentM, killedM: sim.killedM, dmgM: sim.dmgM,
    miss: { ...sim.miss },
    tgtState: sim.tgtState, bats: sim.bats,
  };
}

// ---- Monte-Carlo with confidence intervals over N seeded runs ----
// run a batch of Monte-Carlo seeds and return the raw per-run summaries, so the
// caller can accumulate across chunks and keep the UI responsive between them.
export function monteCarloBatch(plan, seeds, opts) {
  const mcOpts = { dt: (opts && opts.dt) || 10, maxT: (opts && opts.maxT) || 14400 };
  return seeds.map(s => runToEnd(plan, s >>> 0, mcOpts));
}

// turn accumulated raw runs into the same stats shape as monteCarloCI
export function summarizeRuns(runs) {
  const pick = (f) => runs.map(f);
  const stat = (arr) => {
    const n = arr.length; if (!n) return { mean: 0, sd: 0, ci95: 0, lo: 0, hi: 0, p10: 0, p50: 0, p90: 0, min: 0, max: 0 };
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1);
    const sd = Math.sqrt(variance);
    const ci95 = 1.96 * (sd / Math.sqrt(n));
    const sorted = [...arr].sort((a, b) => a - b);
    const pctl = (p) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
    return { mean, sd, ci95, lo: mean - ci95, hi: mean + ci95, p10: pctl(0.1), p50: pctl(0.5), p90: pctl(0.9), min: sorted[0], max: sorted[n - 1] };
  };
  return {
    N: runs.length,
    interceptRate: stat(pick(r => r.rate)),
    protect: stat(pick(r => r.protect)),
    leaked: stat(pick(r => r.leaked)),
    realLeaked: stat(pick(r => r.realLeaked)),
    spentM: stat(pick(r => r.spentM)),
    killedM: stat(pick(r => r.killedM)),
    dmgM: stat(pick(r => r.dmgM)),
    exchange: stat(pick(r => (r.spentM > 0 ? r.killedM / r.spentM : 0))),
  };
}

export function monteCarloCI(plan, N, baseSeed, opts) {
  const runs = [];
  // Monte-Carlo only needs aggregate outcomes, not a smooth path, so a coarser
  // timestep (default 10s vs the 2s used for animation) runs ~5x faster with
  // negligible effect on aggregate intercept/leak statistics.
  const mcOpts = { dt: (opts && opts.dt) || 10, maxT: (opts && opts.maxT) || 14400 };
  for (let i = 0; i < N; i++) runs.push(runToEnd(plan, (baseSeed >>> 0) + i * 2654435761, mcOpts));
  const pick = (f) => runs.map(f);
  const stat = (arr) => {
    const n = arr.length; const mean = arr.reduce((a, b) => a + b, 0) / n;
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1);
    const sd = Math.sqrt(variance);
    const se = sd / Math.sqrt(n);
    const ci95 = 1.96 * se; // normal approximation
    const sorted = [...arr].sort((a, b) => a - b);
    const pctl = (p) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
    return { mean, sd, ci95, lo: mean - ci95, hi: mean + ci95, p10: pctl(0.1), p50: pctl(0.5), p90: pctl(0.9), min: sorted[0], max: sorted[n - 1] };
  };
  return {
    N,
    interceptRate: stat(pick(r => r.rate)),
    protect: stat(pick(r => r.protect)),
    leaked: stat(pick(r => r.leaked)),
    realLeaked: stat(pick(r => r.realLeaked)),
    spentM: stat(pick(r => r.spentM)),
    killedM: stat(pick(r => r.killedM)),
    dmgM: stat(pick(r => r.dmgM)),
    exchange: stat(pick(r => (r.spentM > 0 ? r.killedM / r.spentM : 0))),
  };
}
