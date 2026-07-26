// ============================================================================
// OPERATIONAL THEATRE MODEL  (country-scale, km-true)
// Self-contained. Does NOT touch the tactical engine (App.jsx TT/CARDS/PK).
// All ranges in kilometres, all speeds in km/h, converted to screen px at
// runtime from the live Leaflet scale (km-per-pixel). Ballistic threats are
// modelled as launch -> predicted impact area -> intercept window EVENTS, not
// crawling sprites, because at country scale + time compression a TBM would
// cross the map in well under a second.
// ============================================================================

// ---- Theatre presets (lat/lng bounds) ----
export const THEATRES = {
  ukraine:   { key: 'ukraine',   label: 'Ukraine (national)',        n: 52.4, s: 44.2, w: 22.0, e: 40.3 },
  ukraine_c: { key: 'ukraine_c', label: 'Central Ukraine (Kyiv AO)', n: 51.6, s: 49.0, w: 28.8, e: 33.2 },
  ukraine_s: { key: 'ukraine_s', label: 'Southern Ukraine (Odesa-Mykolaiv)', n: 48.4, s: 45.0, w: 28.5, e: 34.5 },
  ukraine_e: { key: 'ukraine_e', label: 'Eastern Ukraine (Kharkiv-Dnipro)', n: 50.6, s: 47.4, w: 33.5, e: 38.6 },
};

// ---- Defended assets (real cities / value nodes; lat,lng) ----
// tier: strategic value weight. pop centres + energy + C2.
export const DEFENDED_PRESETS = {
  ukraine: [
    { id: 'kyiv',     name: 'KYIV',        lat: 50.4501, lng: 30.5234, tier: 'capital', kind: 'city',   value: 5 },
    { id: 'kharkiv',  name: 'KHARKIV',     lat: 49.9935, lng: 36.2304, tier: 'major',   kind: 'city',   value: 4 },
    { id: 'dnipro',   name: 'DNIPRO',      lat: 48.4647, lng: 35.0462, tier: 'major',   kind: 'city',   value: 4 },
    { id: 'odesa',    name: 'ODESA',       lat: 46.4825, lng: 30.7233, tier: 'major',   kind: 'port',   value: 4 },
    { id: 'lviv',     name: 'LVIV',        lat: 49.8397, lng: 24.0297, tier: 'major',   kind: 'city',   value: 3 },
    { id: 'zapor',    name: 'ZAPORIZHZHIA',lat: 47.8388, lng: 35.1396, tier: 'major',   kind: 'energy', value: 4 },
    { id: 'mykolaiv', name: 'MYKOLAIV',    lat: 46.9750, lng: 31.9946, tier: 'minor',   kind: 'port',   value: 3 },
    { id: 'kryvyi',   name: 'KRYVYI RIH',  lat: 47.9105, lng: 33.3918, tier: 'minor',   kind: 'energy', value: 3 },
    { id: 'vinn',     name: 'VINNYTSIA',   lat: 49.2331, lng: 28.4682, tier: 'minor',   kind: 'city',   value: 2 },
    { id: 'poltava',  name: 'POLTAVA',     lat: 49.5883, lng: 34.5514, tier: 'minor',   kind: 'energy', value: 2 },
    { id: 'cherkasy', name: 'CHERKASY',    lat: 49.4444, lng: 32.0598, tier: 'minor',   kind: 'energy', value: 2 },
    { id: 'ivano',    name: 'BURSHTYN TPP',lat: 49.1939, lng: 24.6394, tier: 'minor',   kind: 'energy', value: 3 },
  ],
};

// ---- Threat axes: where strikes enter, by weapon family. bearing in deg (compass, dir of travel). ----
// origin edge given as a fraction along the theatre border; resolved to lat/lng at runtime.
export const THREAT_AXES = {
  shahed_se:   { id: 'shahed_se',   label: 'OWA corridor SE (Shahed)',     family: 'owa',      from: { edge: 'SE' }, spreadKm: 90 },
  shahed_ne:   { id: 'shahed_ne',   label: 'OWA corridor NE (Shahed)',     family: 'owa',      from: { edge: 'NE' }, spreadKm: 90 },
  shahed_n:    { id: 'shahed_n',    label: 'OWA corridor N (Shahed)',      family: 'owa',      from: { edge: 'N'  }, spreadKm: 70 },
  cruise_blacksea: { id: 'cruise_blacksea', label: 'Cruise from Black Sea (Kalibr)', family: 'cruise', from: { edge: 'S' }, spreadKm: 120 },
  cruise_air_n:{ id: 'cruise_air_n',label: 'Air-launched cruise N (Kh-101)',family: 'cruise',   from: { edge: 'N'  }, spreadKm: 110 },
  ballistic_ne:{ id: 'ballistic_ne',label: 'Ballistic NE (Iskander/KN-23)', family: 'ballistic',from: { edge: 'NE' }, spreadKm: 60 },
  ballistic_n: { id: 'ballistic_n', label: 'Ballistic N (Iskander)',        family: 'ballistic',from: { edge: 'N'  }, spreadKm: 60 },
  kab_e:       { id: 'kab_e',       label: 'Glide-bomb belt E (UMPK)',      family: 'glide',    from: { edge: 'E'  }, spreadKm: 50 },
};

// ---- Real-world threat performance (km, km/h). class drives the engine mapping. ----
// rcs: classify difficulty. cruiseAlt_m affects radar-horizon detection.
export const THREAT_REAL = {
  shahed136:  { id: 'shahed136', name: 'Shahed-136 / Geran-2', family: 'owa',       speedKmh: 185,  cruiseAlt_m: 1500, rcs: 'medium', warhead_kg: 50,  ewVuln: false, dmg: 1 },
  shahed_jet: { id: 'shahed_jet',name: 'Geran-2 (jet)',        family: 'owa',       speedKmh: 370,  cruiseAlt_m: 2500, rcs: 'medium', warhead_kg: 50,  ewVuln: false, dmg: 1 },
  kalibr:     { id: 'kalibr',    name: 'Kalibr 3M14',          family: 'cruise',    speedKmh: 850,  cruiseAlt_m: 50,   rcs: 'small',  warhead_kg: 450, ewVuln: false, dmg: 2 },
  kh101:      { id: 'kh101',     name: 'Kh-101',               family: 'cruise',    speedKmh: 740,  cruiseAlt_m: 50,   rcs: 'small',  warhead_kg: 400, ewVuln: false, dmg: 2 },
  iskander:   { id: 'iskander',  name: 'Iskander-M',           family: 'ballistic', speedKmh: 7000, apogee_km: 50,     rcs: 'medium', warhead_kg: 480, ewVuln: false, dmg: 3 },
  kn23:       { id: 'kn23',      name: 'KN-23 (Hwasong-11)',   family: 'ballistic', speedKmh: 6500, apogee_km: 50,     rcs: 'medium', warhead_kg: 500, ewVuln: false, dmg: 3 },
  kinzhal:    { id: 'kinzhal',   name: 'Kh-47M2 Kinzhal',      family: 'ballistic', speedKmh: 12000,apogee_km: 40,     rcs: 'medium', warhead_kg: 480, ewVuln: false, dmg: 3, hypersonic: true },
  umpk:       { id: 'umpk',      name: 'FAB+UMPK glide bomb',  family: 'glide',     speedKmh: 700,  releaseKm: 60,     rcs: 'medium', warhead_kg: 250, ewVuln: true,  dmg: 2 },
};

// ---- Friendly batteries: real engagement / detection radius (km). reloadS in real seconds. ----
// tbmFootprintKm = self-defence radius vs ballistic (much smaller than aero range).
export const BATTERY_REAL = {
  patriot:  { id: 'patriot',  name: 'Patriot PAC-3',  nation: 'US',    aeroRangeKm: 160, tbmFootprintKm: 25, detectKm: 180, rounds: 8,  reloadS: 8,  role: 'LR-SAM/ABM',  costM: 4.0, can: ['ballistic','cruise','owa','glide','male'] },
  samp_t:   { id: 'samp_t',   name: 'SAMP/T',         nation: 'FR/IT', aeroRangeKm: 120, tbmFootprintKm: 25, detectKm: 160, rounds: 8,  reloadS: 8,  role: 'LR-SAM/ABM',  costM: 3.0, can: ['ballistic','cruise','owa','glide','male'] },
  iris_t:   { id: 'iris_t',   name: 'IRIS-T SLM',     nation: 'DE',    aeroRangeKm: 40,  tbmFootprintKm: 0,  detectKm: 70,  rounds: 12, reloadS: 5,  role: 'MR-SAM',      costM: 0.5, can: ['cruise','owa','glide','male'] },
  nasams:   { id: 'nasams',   name: 'NASAMS-2',       nation: 'NO/US', aeroRangeKm: 30,  tbmFootprintKm: 0,  detectKm: 60,  rounds: 12, reloadS: 5,  role: 'MR-SAM',      costM: 1.2, can: ['cruise','owa','glide','male'] },
  gepard:   { id: 'gepard',   name: 'Gepard SHORAD',  nation: 'DE',    aeroRangeKm: 4,   tbmFootprintKm: 0,  detectKm: 12,  rounds: 40, reloadS: 3,  role: 'SHORAD/gun',  costM: 0.004, can: ['owa','glide','male','tactical','cruise'] },
  mobile:   { id: 'mobile',   name: 'Mobile fire group (ZU-23)', nation: 'UA', aeroRangeKm: 2.5, tbmFootprintKm: 0, detectKm: 6, rounds: 120, reloadS: 2, role: 'gun/C-UAS', costM: 0.001, can: ['owa','tactical','recon'] },
  int_team: { id: 'int_team', name: 'Interceptor drone team', tag: 'INT TEAM', nation: 'UA', aeroRangeKm: 15, tbmFootprintKm: 0, detectKm: 20, rounds: 8, reloadS: 20, role: 'C-UAS interceptors', costM: 0.005, can: ['owa','recon','male','tactical'] },
  manpads:  { id: 'manpads',  name: 'MANPADS team',   tag: 'MANPADS', nation: 'UA', aeroRangeKm: 5, tbmFootprintKm: 0, detectKm: 8, rounds: 6, reloadS: 10, role: 'VSHORAD', costM: 0.15, can: ['owa','glide','male','tactical'] },
  ewnode:   { id: 'ewnode',   name: 'EW suite',       nation: 'UA',    aeroRangeKm: 25,  tbmFootprintKm: 0,  detectKm: 35,  rounds: 0,  reloadS: 0,  role: 'EW (soft-kill)', isEW: true, costM: 0, can: ['owa','recon'] },
};

// ---- Probability of kill: weapon family x threat family (operational, illustrative) ----
// Real-world modifications/variants per system. Selecting a variant overrides
// the base fields (range, ABM footprint, Pk multiplier, cost, reload). Illustrative.
export const BATTERY_VARIANTS = {
  patriot: [
    { id: 'pac3_mse', name: 'PAC-3 MSE', aeroRangeKm: 120, tbmFootprintKm: 35, costM: 4.0, pkMul: 1.0,  note: 'Hit-to-kill, best ABM, shorter aero reach' },
    { id: 'pac2_gem', name: 'PAC-2 GEM-T', aeroRangeKm: 160, tbmFootprintKm: 20, costM: 2.5, pkMul: 0.92, note: 'Blast-frag, longer aero reach, weaker vs TBM' },
    { id: 'pac3_cri', name: 'PAC-3 CRI', aeroRangeKm: 100, tbmFootprintKm: 30, costM: 3.6, pkMul: 0.98, note: 'Compact hit-to-kill, more rounds per launcher' },
  ],
  samp_t: [
    { id: 'aster30b1', name: 'Aster 30 B1', aeroRangeKm: 120, tbmFootprintKm: 25, costM: 3.0, pkMul: 1.0,  note: 'Baseline, cruise + short-range TBM' },
    { id: 'aster30b1nt', name: 'Aster 30 B1NT', aeroRangeKm: 150, tbmFootprintKm: 35, costM: 3.4, pkMul: 1.05, note: 'New tech seeker, better TBM reach' },
  ],
  iris_t: [
    { id: 'slm', name: 'IRIS-T SLM', aeroRangeKm: 40, tbmFootprintKm: 0, costM: 0.5, pkMul: 1.0,  note: 'Medium-range, the common Ukraine variant' },
    { id: 'sls', name: 'IRIS-T SLS', aeroRangeKm: 12, tbmFootprintKm: 0, costM: 0.4, pkMul: 0.98, note: 'Short-range, point defence' },
    { id: 'slx', name: 'IRIS-T SLX', aeroRangeKm: 80, tbmFootprintKm: 0, costM: 0.8, pkMul: 1.02, note: 'Extended-range, higher ceiling' },
  ],
  nasams: [
    { id: 'amraam', name: 'NASAMS AMRAAM', aeroRangeKm: 30, tbmFootprintKm: 0, costM: 1.2, pkMul: 1.0,  note: 'AIM-120 baseline' },
    { id: 'amraam_er', name: 'NASAMS AMRAAM-ER', aeroRangeKm: 50, tbmFootprintKm: 0, costM: 1.5, pkMul: 1.0, note: 'Extended range, rocket-boosted' },
    { id: 'aim9x', name: 'NASAMS AIM-9X', aeroRangeKm: 20, tbmFootprintKm: 0, costM: 0.6, pkMul: 0.96, note: 'Short-range IR, cheaper per shot' },
  ],
  gepard: [
    { id: 'std', name: 'Gepard 35mm', aeroRangeKm: 4, tbmFootprintKm: 0, costM: 0.004, pkMul: 1.0, note: 'Twin 35mm, optical/radar' },
    { id: 'ahead', name: 'Gepard AHEAD', aeroRangeKm: 4.5, tbmFootprintKm: 0, costM: 0.008, pkMul: 1.15, note: 'Airburst rounds, better vs drones' },
  ],
};

export const OP_PK = {
  patriot: { ballistic: 0.80, cruise: 0.75, owa: 0.45, glide: 0.55 },
  samp_t:  { ballistic: 0.70, cruise: 0.78, owa: 0.50, glide: 0.55 },
  iris_t:  { ballistic: 0.05, cruise: 0.80, owa: 0.78, glide: 0.65 },
  nasams:  { ballistic: 0.05, cruise: 0.75, owa: 0.74, glide: 0.60 },
  gepard:  { ballistic: 0.0,  cruise: 0.15, owa: 0.72, glide: 0.20 },
  mobile:  { ballistic: 0.0,  cruise: 0.05, owa: 0.35, glide: 0.08 },
  int_team:{ ballistic: 0.0,  cruise: 0.05, owa: 0.68, glide: 0.10 },
  manpads: { ballistic: 0.0,  cruise: 0.10, owa: 0.50, glide: 0.15 },
  ewnode:  { ballistic: 0.0,  cruise: 0.0,  owa: 0.0,  glide: 0.0 },
};

// ============================================================================
// WEATHER MODEL
// ============================================================================
export const WEATHER_PRESETS = {
  clear:    { key: 'clear',    label: 'CAVOK / clear night',  vis_km: 10, cloudBase_m: 6000, precip: 'none',  metar: 'CAVOK' },
  haze:     { key: 'haze',     label: 'Haze / smoke',         vis_km: 4,  cloudBase_m: 3000, precip: 'none',  metar: 'BR HZ' },
  overcast: { key: 'overcast', label: 'Low overcast',         vis_km: 6,  cloudBase_m: 400,  precip: 'none',  metar: 'OVC004' },
  rain:     { key: 'rain',     label: 'Rain / drizzle',       vis_km: 3,  cloudBase_m: 700,  precip: 'rain',  metar: 'RA OVC007' },
  fog:      { key: 'fog',      label: 'Fog',                  vis_km: 0.6,cloudBase_m: 100,  precip: 'fog',   metar: 'FG OVC001' },
  snow:     { key: 'snow',     label: 'Snow showers',         vis_km: 1.5,cloudBase_m: 500,  precip: 'snow',  metar: 'SN OVC005' },
};

// Build a full weather state. windDir = FROM (compass deg), windKmh = wind speed.
export function makeWeather(presetKey, windDir, windKmh, night) {
  const p = WEATHER_PRESETS[presetKey] || WEATHER_PRESETS.clear;
  return { ...p, windDir: windDir ?? 225, windKmh: windKmh ?? 15, night: !!night };
}

// Effect of weather on an engagement. opticalWeapon = gun/EO interceptor/SHORAD.
// Returns multipliers + adjusted classify factor.
export function weatherEffects(w, weaponId, threatFamily) {
  let pkMul = 1, classifyMul = 1, reconMul = 1;
  const optical = (weaponId === 'gepard' || weaponId === 'mobile');
  // low visibility / precip degrades optical tracking + ID
  if (w.vis_km < 5) { classifyMul *= 1.4; if (optical) pkMul *= 0.80; reconMul *= 0.8; }
  if (w.vis_km < 1.5) { classifyMul *= 1.6; if (optical) pkMul *= 0.65; reconMul *= 0.6; }
  if (w.precip === 'rain' || w.precip === 'snow') { if (optical) pkMul *= 0.88; }
  if (w.night && optical) pkMul *= 0.92; // thermal partly offsets night
  // low cloud blocks high-diving glide bombs / masks high-alt EO
  if (threatFamily === 'glide' && w.cloudBase_m < 800) pkMul *= 0.85;
  return { pkMul, classifyMul, reconMul };
}

// Wind effect on a slow OWA threat's groundspeed. heading = threat dir of travel (deg).
// Headwind slows (longer in WEZ, longer ingress); tailwind speeds it up.
export function windGroundspeed(baseKmh, threatFamily, headingDeg, w) {
  if (threatFamily !== 'owa') return baseKmh; // only slow movers materially affected
  const rel = ((w.windDir - headingDeg + 180) % 360) - 180; // angle between wind-from and heading
  const along = Math.cos(rel * Math.PI / 180); // +1 tailwind-ish, -1 headwind
  // wind blows FROM windDir, so a wind opposing travel (rel near 0) is a headwind
  const headwindComponent = -along; // rel~0 => wind from ahead => slow down
  return Math.max(60, baseKmh + headwindComponent * w.windKmh);
}

// Crosswind penalty for FPV / interceptor drones
export function crosswindPkMul(w) {
  return w.windKmh > 30 ? 0.85 : (w.windKmh > 18 ? 0.92 : 1);
}

// ============================================================================
// DOCTRINE
// ============================================================================
export const SALVO = {
  single:       { key: 'single',       label: 'Shoot-look-shoot (1 round)',  shots: 1 },
  salvo2:       { key: 'salvo2',        label: 'Salvo (2 rounds)',            shots: 2 },
};
// combined kill probability for n independent shots
export function salvoPk(singlePk, shots) { return 1 - Math.pow(1 - singlePk, shots); }

export const C2_POSTURE = {
  centralised:   { key: 'centralised',   label: 'Centralised (tighter control, slower)', delayS: 18, fratricideMul: 0.6 },
  decentralised: { key: 'decentralised', label: 'Decentralised (faster, looser)',        delayS: 7,  fratricideMul: 1.0 },
};

// ============================================================================
// RADAR HORIZON  (km). h in metres. classic 4.12(sqrt(h_radar)+sqrt(h_tgt)).
// ============================================================================
export function radarHorizonKm(radarMastM, targetAltM) {
  return 4.12 * (Math.sqrt(Math.max(1, radarMastM)) + Math.sqrt(Math.max(1, targetAltM)));
}
// effective detection range vs a target = min(nominal detect, radar horizon for its altitude)
export function effectiveDetectKm(nominalDetectKm, radarMastM, targetAltM) {
  return Math.min(nominalDetectKm, radarHorizonKm(radarMastM, targetAltM));
}

// ============================================================================
// GEO / SCALE HELPERS
// ============================================================================
export function kmBetween(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// destination point given start, bearing (deg), distance (km)
export function destPoint(lat, lng, bearingDeg, distKm) {
  const R = 6371, br = bearingDeg * Math.PI / 180, la1 = lat * Math.PI / 180, lo1 = lng * Math.PI / 180;
  const dr = distKm / R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la1), Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 * 180 / Math.PI, lng: ((lo2 * 180 / Math.PI) + 540) % 360 - 180 };
}
// resolve an axis edge to an entry lat/lng + heading toward theatre centre
export function resolveAxis(axis, theatre) {
  const cx = (theatre.w + theatre.e) / 2, cy = (theatre.n + theatre.s) / 2;
  const edges = {
    N:  { lat: theatre.n, lng: cx }, S:  { lat: theatre.s, lng: cx },
    E:  { lat: cy, lng: theatre.e }, W:  { lat: cy, lng: theatre.w },
    NE: { lat: theatre.n, lng: theatre.e }, NW: { lat: theatre.n, lng: theatre.w },
    SE: { lat: theatre.s, lng: theatre.e }, SW: { lat: theatre.s, lng: theatre.w },
  };
  const o = edges[axis.from.edge] || edges.N;
  const heading = bearingTo(o, { lat: cy, lng: cx });
  return { origin: o, heading };
}
export function bearingTo(a, b) {
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ============================================================================
// MONTE-CARLO  (headless batch over the operational model)
// Inputs: defended list, battery list (with assigned target ids), wave spec,
// weather, doctrine. Runs N trials, returns distributions. No rendering.
// ============================================================================
export function monteCarlo({ batteries, threats, weather, salvoKey, n = 200 }) {
  const shots = (SALVO[salvoKey] || SALVO.single).shots;
  const results = { leakers: [], expended: [], killsByFam: {}, costExchange: [] };
  for (let t = 0; t < n; t++) {
    let leak = 0, rounds = 0, defValue = 0, threatValue = 0;
    threats.forEach(th => {
      const fam = th.family;
      threatValue += (th.cost || familyCost(fam));
      // layered engagement: each covering battery gets one attempt (range already filtered upstream into th.engagers)
      let survived = true;
      (th.engagers || []).forEach(bId => {
        if (!survived) return;
        const base = (OP_PK[bId] || {})[fam] || 0;
        const we = weatherEffects(weather, bId, fam);
        let pk = base * we.pkMul;
        if (bId === 'mobile' || bId === 'gepard') pk *= crosswindPkMul(weather);
        const eff = salvoPk(pk, (BATTERY_REAL[bId] && BATTERY_REAL[bId].rounds > 0) ? shots : 1);
        rounds += (BATTERY_REAL[bId] && BATTERY_REAL[bId].rounds > 0) ? shots : 0;
        if (Math.random() < eff) survived = false;
      });
      if (survived) { leak++; defValue += th.dmg || 1; results.killsByFam[fam] = results.killsByFam[fam] || 0; }
      else { results.killsByFam[fam] = (results.killsByFam[fam] || 0) + 1; }
    });
    results.leakers.push(leak);
    results.expended.push(rounds);
    results.costExchange.push(defValue);
  }
  return summarise(results, threats.length);
}
function familyCost(fam) {
  return { owa: 0.05, cruise: 6.5, ballistic: 3.0, glide: 0.03 }[fam] || 1;
}
function summarise(r, totalThreats) {
  const stat = arr => {
    const s = [...arr].sort((a, b) => a - b);
    const mean = s.reduce((x, y) => x + y, 0) / (s.length || 1);
    return { mean, p10: s[Math.floor(s.length * 0.1)], p50: s[Math.floor(s.length * 0.5)], p90: s[Math.floor(s.length * 0.9)], min: s[0], max: s[s.length - 1] };
  };
  return {
    trials: r.leakers.length,
    totalThreats,
    leakers: stat(r.leakers),
    expended: stat(r.expended),
    killsByFam: r.killsByFam,
    leakHist: histogram(r.leakers, totalThreats),
  };
}
function histogram(arr, maxv) {
  const h = {};
  arr.forEach(v => { h[v] = (h[v] || 0) + 1; });
  const out = [];
  for (let i = 0; i <= maxv; i++) out.push({ leakers: i, count: h[i] || 0 });
  return out;
}
