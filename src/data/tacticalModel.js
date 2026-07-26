// ============================================================================
// SKYWATCH · ADVANCED TACTICAL REALISM MODEL
// Grounded in publicly reported patterns from air defence over Ukraine.
// Everything here is illustrative, order-of-magnitude, UNCLASSIFIED. It is a
// training/analytic aid, not validated operational analysis.
//
// This module adds the detail layer the operational plan consumes:
//   - altitude bands and how they gate sensors/weapons
//   - terrain masking and radar horizon at low level
//   - route behaviour (low-level corridors, terrain following, axis fans)
//   - engagement error sources (track quality, salvo, fatigue, saturation,
//     classification error, weapon reliability, reaction latency)
//   - environment (temperature, season, icing, wind aloft) and its effects
//   - SEAD/ARM risk to emitting radars
//   - cost / value bookkeeping helpers
// ============================================================================

// ---- Altitude bands (metres AGL/MSL mix, representative) ----
export const ALT_BANDS = {
  terrain:   { key: 'terrain',   label: 'Terrain-following (<150 m)', m: 100,   maskRisk: 0.55 },
  low:       { key: 'low',       label: 'Low (150-600 m)',           m: 400,   maskRisk: 0.30 },
  medium:    { key: 'medium',    label: 'Medium (600-3000 m)',       m: 1800,  maskRisk: 0.10 },
  high:      { key: 'high',      label: 'High (3-12 km)',            m: 7000,  maskRisk: 0.02 },
  ballistic: { key: 'ballistic', label: 'Ballistic arc (apogee)',    m: 45000, maskRisk: 0.0  },
};

// Default altitude profile per threat family (what they typically fly).
export const FAMILY_ALT = {
  owa:       'low',       // Shahed often 1-2 km but drops to terrain near target
  cruise:    'terrain',   // Kalibr/Kh-101 sea-skim / terrain follow
  glide:     'medium',    // UMPK released mid-altitude, glides down
  ballistic: 'ballistic',
  male:      'medium',
  tactical:  'low',
  recon:     'medium',
  indirect:  'terrain',
  unknown:   'low',
};

// ---- Radar horizon at low level (the core reason cruise/Shahed leak) ----
// h in metres; returns detection range (km) limited by Earth curvature.
export function radarHorizonKm(radarMastM, targetAltM) {
  return 4.12 * (Math.sqrt(Math.max(1, radarMastM)) + Math.sqrt(Math.max(1, targetAltM)));
}
// Effective first-detection range given nominal sensor range, mast height,
// target altitude and terrain. Low + rough terrain dramatically shortens it.
export function effectiveDetectKm(nominalKm, mastM, targetAltM, terrainRough) {
  const horizon = radarHorizonKm(mastM, targetAltM);
  const rough = 1 - 0.25 * (terrainRough || 0); // rough terrain clutters low tracks
  return Math.max(2, Math.min(nominalKm, horizon) * rough);
}

// ---- Track quality: multi-sensor fusion improves Pk; single noisy track hurts ----
// nSensors covering the target, target altitude band, EW jamming present.
export function trackQuality(nSensors, altBandKey, jammed) {
  let q = 0.72 + 0.12 * Math.min(3, nSensors); // 1 sensor ~0.84, 3+ ~1.08
  if (altBandKey === 'terrain') q -= 0.14;      // low tracks are noisy but not crippling
  if (altBandKey === 'low') q -= 0.05;
  if (jammed) q -= 0.14;
  return Math.max(0.45, Math.min(1.08, q));
}

// ---- Crew fatigue over a long defended night (Pk + reaction degrade) ----
// hoursIntoMission across a multi-hour raid. Models sustained-ops degradation.
export function fatigueFactor(hoursInto) {
  // mild for first 2h, then accelerating; floors at ~0.78
  const f = 1 - Math.min(0.22, Math.max(0, (hoursInto - 2) * 0.045));
  return f;
}

// ---- Saturation: too many simultaneous tracks per battery degrade outcomes ----
// A battery can only prosecute so many engagements at once. Beyond that,
// reaction stretches and Pk per shot falls.
export function saturationFactor(simultaneousTracks, channelsPerBattery) {
  const ch = Math.max(1, channelsPerBattery || 2);
  if (simultaneousTracks <= ch) return 1;
  const over = simultaneousTracks - ch;
  return Math.max(0.45, 1 - over * 0.10);
}

// ---- Classification / identification error ----
// Probability a track is misclassified (decoy treated as real, or real as
// decoy / friendly). Worse at low altitude, at night, with small RCS, jammed.
export function misclassifyProb(altBandKey, rcs, night, jammed) {
  let p = 0.04;
  if (rcs === 'small' || rcs === 'low') p += 0.06;
  if (rcs === 'tiny') p += 0.10;
  if (altBandKey === 'terrain') p += 0.05;
  if (night) p += 0.03;
  if (jammed) p += 0.06;
  return Math.min(0.4, p);
}

// ---- Weapon reliability (duds, fly-outs, fuze failures) ----
// Representative per-family interceptor reliability. Even a "hit" can fail.
export const WEAPON_RELIABILITY = {
  patriot: 0.93, samp_t: 0.92, iris_t: 0.95, nasams: 0.94,
  gepard: 0.97, mobile: 0.96, int_team: 0.85, manpads: 0.88, ewnode: 1.0,
  lib: 0.90,
};
export function weaponReliability(type, isLib) {
  return WEAPON_RELIABILITY[type] != null ? WEAPON_RELIABILITY[type] : (isLib ? WEAPON_RELIABILITY.lib : 0.9);
}

// ---- Reaction latency (s) from detection to first shot ----
// Cold start and centralised C2 add delay; well-drilled decentralised crews are fast.
export function reactionLatencyS({ coldStart, centralised, fatigue }) {
  let t = 8;
  if (coldStart) t += 12;
  if (centralised) t += 8;
  t = t / Math.max(0.7, fatigue || 1);
  return t;
}

// ============================================================================
// ENVIRONMENT: temperature, season, icing, wind aloft
// ============================================================================
export const SEASONS = {
  summer: { key: 'summer', label: 'Summer',  tempC: 26,  icing: 0.0,  notes: 'Long warm nights, dust haze possible' },
  autumn: { key: 'autumn', label: 'Autumn',  tempC: 10,  icing: 0.1,  notes: 'Fog and low cloud common' },
  winter: { key: 'winter', label: 'Winter',  tempC: -8,  icing: 0.5,  notes: 'Battery cold-soak, icing, optics degraded' },
  spring: { key: 'spring', label: 'Spring',  tempC: 12,  icing: 0.15, notes: 'Variable, wind-driven fronts' },
};

// Temperature effects: extreme cold slows hydraulics/optics and saps EO range,
// extreme heat reduces air density (marginal). Returns multipliers.
export function temperatureEffects(tempC) {
  let opticalMul = 1, reactionMul = 1, droneEnduranceMul = 1;
  if (tempC <= -10) { opticalMul = 0.88; reactionMul = 1.15; droneEnduranceMul = 0.85; }
  else if (tempC <= 0) { opticalMul = 0.93; reactionMul = 1.08; droneEnduranceMul = 0.92; }
  else if (tempC >= 32) { opticalMul = 0.96; reactionMul = 1.02; }
  return { opticalMul, reactionMul, droneEnduranceMul };
}

// Icing degrades gun/EO SHORAD and interceptor drones specifically.
export function icingPenalty(icing, weaponType) {
  if (!icing) return 1;
  const optical = (weaponType === 'gepard' || weaponType === 'mobile' || weaponType === 'manpads' || weaponType === 'int_team');
  if (!optical) return 1 - 0.06 * icing;
  return 1 - 0.20 * icing;
}

// Wind aloft alters slow-mover groundspeed (ingress time) and drone control.
export function windAloftKmh(surfaceKmh, altBandKey) {
  const factor = altBandKey === 'high' ? 2.4 : altBandKey === 'medium' ? 1.7 : altBandKey === 'low' ? 1.2 : 1.0;
  return surfaceKmh * factor;
}

// ============================================================================
// ROUTING: how tracks actually move (not straight lines from a corner)
// ============================================================================
// Build a multi-leg route for a track: origin -> optional ingress waypoint(s)
// -> terminal run to target. Low-level movers fly a slightly indirect corridor;
// ballistic flies a near-straight depressed arc. Returns array of {lat,lng}.
export function buildRoute(origin, target, family, jitterKm, helpers) {
  const { destPoint, bearingTo, threatRings = [], evade = 0, rng } = helpers;
  const kmLocal = (a, b) => {
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const brg = bearingTo(origin, target);
  if (family === 'ballistic') {
    // Coriolis: while the warhead is in flight the Earth rotates beneath it,
    // so the ground track bows sideways (to the right in the N hemisphere).
    // Lateral deflection d ~= Omega * sin(lat) * V * t^2 (approx), but the
    // impact point is unchanged (guidance compensates), so we only bow the
    // PATH between launch and target, not move the endpoint.
    const distKm = kmLocal(origin, target);
    if (distKm < 60) return [origin, target];
    const OMEGA = 7.292e-5;            // Earth rotation rate, rad/s
    const midLat = (origin.lat + target.lat) / 2 * Math.PI / 180;
    const Vms = ((helpers.kmh && helpers.kmh > 1500 ? helpers.kmh : 6500) / 3.6);
    const tFlight = (distKm * 1000) / Vms;      // s
    // full lateral Coriolis deflection if uncompensated ~ 0.5 * f * V * t^2.
    // Guidance corrects it so the impact point is unchanged, but the ground
    // track still bows; we draw the bow at the mid-point as a fraction of it.
    const fCor = 2 * OMEGA * Math.sin(Math.abs(midLat));
    const fullDeflKm = 0.5 * fCor * Vms * tFlight * tFlight / 1000;
    let deflKm = fullDeflKm * 0.5;              // mid-arc bow ~ half of full
    deflKm = Math.max(0, Math.min(deflKm, distKm * 0.15)); // sanity clamp
    if (deflKm < 0.5) return [origin, target];
    // bow to the right of travel in N hemisphere, left in S
    const side = midLat >= 0 ? 90 : -90;
    const mid = destPoint((origin.lat + target.lat) / 2, (origin.lng + target.lng) / 2, (brg + side + 360) % 360, deflKm);
    // quarter points for a smooth arc
    const q1 = destPoint(origin.lat + (target.lat - origin.lat) * 0.25, origin.lng + (target.lng - origin.lng) * 0.25, (brg + side + 360) % 360, deflKm * 0.6);
    const q3 = destPoint(origin.lat + (target.lat - origin.lat) * 0.75, origin.lng + (target.lng - origin.lng) * 0.75, (brg + side + 360) % 360, deflKm * 0.6);
    return [origin, q1, mid, q3, target];
  }
  const perp = (brg + 90) % 360;
  const entry = destPoint(origin.lat, origin.lng, perp, jitterKm);

  // If there are defended rings and this family evades, build waypoints that
  // skirt the densest coverage instead of flying through it. Cruise evades
  // hard (evade~1.0), Shahed mildly (~0.45), ballistic not at all.
  if (evade > 0 && threatRings.length) {
    const legKm = kmLocal(entry, target);
    const N = Math.max(3, Math.min(6, Math.round(legKm / 90)));
    const pts = [entry];
    for (let k = 1; k < N; k++) {
      const f = k / N;
      let p = { lat: entry.lat + (target.lat - entry.lat) * f, lng: entry.lng + (target.lng - entry.lng) * f };
      let worst = null, worstPen = 0;
      for (const ring of threatRings) {
        const d = kmLocal(p, ring);
        const pen = (ring.km * 1.05) - d; // +ve => inside the ring
        if (pen > worstPen) { worstPen = pen; worst = ring; }
      }
      if (worst && f > 0.18 && f < 0.82) { // evade only mid-route; ingress and run-in stay true
        const away = bearingTo(worst, p);
        const shove = Math.min(worst.km * 0.9, worstPen + worst.km * 0.25) * evade;
        p = destPoint(p.lat, p.lng, away, shove);
        if (rng) p = destPoint(p.lat, p.lng, (away + 90) % 360, (rng() - 0.5) * 14);
      }
      pts.push(p);
    }
    pts.push(target);
    return pts;
  }

  // no defences to dodge: gentle off-axis mid waypoint (route deception)
  const mid = { lat: (origin.lat + target.lat) / 2, lng: (origin.lng + target.lng) / 2 };
  const midOff = destPoint(mid.lat, mid.lng, perp, jitterKm * 0.6);
  return [entry, midOff, target];
}

// ============================================================================
// COST / VALUE (illustrative $M) - re-exported convenience
// ============================================================================
export const THREAT_VALUE_M = {
  geran2: 0.1, geran1: 0.05, geran2_jet: 0.25, decoy: 0.01, emit_decoy: 0.02,
  kh101: 13, kalibr: 6.5, kh22: 1.0, iskander: 3.0, kn23: 3.0, kinzhal: 10,
  kab: 0.03, kub_bla: 0.12, lancet: 0.035, orlan10: 0.1, orlan30: 0.15,
  orion: 5, forpost: 6, altius: 12, sirius: 6,
};
export function threatValueM(type, family) {
  if (THREAT_VALUE_M[type] != null) return THREAT_VALUE_M[type];
  return ({ ballistic: 3.0, cruise: 6.5, glide: 0.03, owa: 0.1, male: 5, tactical: 0.03, recon: 0.08, indirect: 0.005, unknown: 0.1 })[family] || 0.1;
}

// ============================================================================
// MASTER ENGAGEMENT RESOLVER
// Combines base Pk, weather, track quality, fatigue, saturation, icing,
// temperature, salvo and reliability into a single shot outcome probability.
// Pure function so it can be used in both the animation and Monte-Carlo.
// ============================================================================
export function resolveShotPk(args) {
  const {
    basePk, shots,
    weatherPkMul = 1, crosswindMul = 1,
    nSensors = 1, altBandKey = 'low', jammed = false,
    fatigue = 1, saturation = 1, icing = 1, optical = false,
    temperatureOpticalMul = 1, reliability = 0.9,
  } = args;
  let pk = basePk;
  pk *= weatherPkMul;
  if (optical) pk *= crosswindMul * icing * temperatureOpticalMul;
  pk *= trackQuality(nSensors, altBandKey, jammed);
  pk *= fatigue;
  pk *= saturation;
  pk = pk * reliability; // even a guided hit can fail
  pk = Math.max(0, Math.min(0.98, pk));
  // salvo of independent shots
  return 1 - Math.pow(1 - pk, Math.max(1, shots));
}
