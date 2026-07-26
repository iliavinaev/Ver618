import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import {
  BATTERY_REAL, OP_PK,
  WEATHER_PRESETS, makeWeather, weatherEffects, crosswindPkMul,
  SALVO, salvoPk, kmBetween, destPoint, bearingTo,
} from './data/operational';
import { NATO_COUNTRIES, THREAT_ORIGINS } from './data/natoCapitals';
import { AD_LIBRARY } from './data/airDefense';
import { BATTERY_VARIANTS } from './data/operational';
import { monteCarloCI, monteCarloBatch, summarizeRuns, initSim, stepSim } from './data/simEngine';
import {
  ALT_BANDS, FAMILY_ALT, effectiveDetectKm, trackQuality, fatigueFactor,
  saturationFactor, misclassifyProb, weaponReliability, reactionLatencyS,
  SEASONS, temperatureEffects, icingPenalty, windAloftKmh, buildRoute,
  threatValueM, resolveShotPk,
} from './data/tacticalModel';

const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Esri, Maxar, Earthstar Geographics';
const BLUE = '#2f80d6', RED = '#d24a44', AMBER = '#d9a52f', GREEN = '#4f9d77', TEXT = '#dde3ea', MUT = '#93a1b0';
const FAM_COL = { ballistic: RED, cruise: '#e0726b', glide: '#c2873e', owa: AMBER, male: AMBER, tactical: AMBER, recon: '#c8924e', unknown: MUT };
const OP_BASE_COMP = 110;
// Simulation runs in REAL TIME at 1x: one wall-clock second = one second of
// flight. Shahed at ~185 km/h therefore takes >1 hour to cover 200 km, exactly
// as in reality. Playback speed (1x..600x) is a pure display accelerator.

// Human-readable threat label (Brave1 style: "Shahed-136", "Kalibr", ...)
const THREAT_LABEL = {
  geran2: 'Shahed-136', geran1: 'Shahed-131', geran2_jet: 'Shahed (jet)', decoy: 'Decoy', emit_decoy: 'Emitter decoy',
  kh101: 'Kh-101', kalibr: 'Kalibr', kh22: 'Kh-22', iskander: 'Iskander-M', kinzhal: 'Kinzhal', kn23: 'KN-23',
  kab: 'UMPK glide bomb', kub_bla: 'Kub-BLA', lancet: 'Lancet', orlan10: 'Orlan-10', orlan30: 'Orlan-30',
  orion: 'Orion', forpost: 'Forpost', altius: 'Altius', sirius: 'Sirius',
};
function threatLabel(type) { return THREAT_LABEL[type] || (type ? type.toUpperCase() : 'TRACK'); }

// Draw a Brave1-style moving threat marker: a small heading triangle plus a
// floating label with name, altitude (m) and speed (km/h).
function drawThreatMarker(ctx, x, y, headingDeg, col, tr) {
  const ang = (headingDeg - 90) * Math.PI / 180; // travel direction, screen space
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  // glow dot
  ctx.fillStyle = col; ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  // heading triangle (cursor)
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, 4); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill();
  ctx.restore();
  // label
  const label = threatLabel(tr.type);
  const spd = Math.round(tr.kmh);
  const alt = tr.altM >= 1000 ? (tr.altM / 1000).toFixed(1) + 'km' : Math.round(tr.altM) + 'm';
  ctx.save();
  ctx.font = '9px monospace'; ctx.textBaseline = 'middle';
  const t1 = `${label}`, t2 = `${alt} · ${spd}km/h`;
  const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 8;
  ctx.globalAlpha = 0.72; ctx.fillStyle = 'rgba(10,22,38,0.7)';
  ctx.fillRect(x + 9, y - 11, w, 22);
  ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fillText(t1, x + 13, y - 4);
  ctx.fillStyle = '#cdd6df'; ctx.fillText(t2, x + 13, y + 6);
  ctx.restore();
}
const UA_BOUNDS = { n: 52.4, s: 44.2, w: 22.0, e: 40.3 };

// default detect-to-launch reaction delay (seconds) by system, rough open-source
// estimates: long-range SAMs need a longer engagement sequence than short guns.
const defaultReactDelay = (type) => {
  if (type === 'patriot' || type === 'samp_t') return 10;
  if (type === 'iris_t' || type === 'nasams') return 7;
  if (type === 'gepard') return 4;
  if (type === 'manpads' || type === 'int_team') return 5;
  if (type === 'f16' || type === 'eurofighter' || type === 'f35') return 6; // fighter reaction once cued
  if (/^lib_/.test(type || '')) return 8;
  return 8;
};
const batColor = (id) => {
  if (id === 'ewnode') return '#93a1b0';
  if (id === 'radar_gbad' || id === 'awacs') return '#8fd0c4'; // sensors: teal
  if (id === 'f16' || id === 'eurofighter' || id === 'f35') return '#c99be0'; // fighters: violet
  if (id === 'patriot' || id === 'samp_t') return BLUE;
  if (id === 'iris_t' || id === 'nasams') return '#56a0e0';
  return '#7bb8d6';
};
const ORIGIN_SHORT = { ru_west: 'RU-W', ru_south: 'RU-S', ru_kaliningrad: 'KGD', ru_north: 'RU-N', by: 'BY', sea_black: 'BLK', sea_baltic: 'BAL', sea_north: 'N.SEA', sea_med: 'MED', iran: 'IRN' };
function originShort(id) { return ORIGIN_SHORT[id] || id; }
// Engageable threat classes a battery can be allowed/denied (doctrine).
const ENGAGE_CLASSES = [
  { key: 'ballistic', short: 'BAL', col: '#e0726b', bg: 'rgba(210,74,68,0.16)' },
  { key: 'cruise',    short: 'CRZ', col: '#e8bd55', bg: 'rgba(217,165,47,0.16)' },
  { key: 'owa',       short: 'OWA', col: '#5aa0e6', bg: 'rgba(47,128,214,0.16)' },
  { key: 'glide',     short: 'GLD', col: '#9b8cd0', bg: 'rgba(120,100,190,0.16)' },
  { key: 'male',      short: 'UAV', col: '#4f9d77', bg: 'rgba(79,157,119,0.16)' },
];
// Illustrative unit costs in $M (public order-of-magnitude, not authoritative)
const THREAT_COST_M = { geran2: 0.1, geran1: 0.05, geran2_jet: 0.25, decoy: 0.01, emit_decoy: 0.02, kh101: 13, kalibr: 6.5, kh22: 1.0, iskander: 3.0, kinzhal: 10, kab: 0.03, kub_bla: 0.12, lancet: 0.035, molniya: 0.005, orlan10: 0.1, orlan30: 0.15, orion: 5, forpost: 6, altius: 12, sirius: 6 };
const FAM_COST_M = { ballistic: 3.0, cruise: 6.5, glide: 0.03, owa: 0.1, male: 5, tactical: 0.03, recon: 0.08, indirect: 0.005, unknown: 0.1 };
function costForType(type, family) { if (THREAT_COST_M[type] != null) return THREAT_COST_M[type]; return FAM_COST_M[family] != null ? FAM_COST_M[family] : 0.1; }
// Impact-target types: HP = hits absorbed, valueM = illustrative replacement value
const TGT_TYPES = {
  city:   { code: 'CTY', label: 'City district', valueM: 400, hp: 4 },
  energy: { code: 'ENG', label: 'Energy node',   valueM: 250, hp: 3 },
  mil:    { code: 'C2',  label: 'Mil HQ / C2',   valueM: 150, hp: 3 },
  air:    { code: 'AIR', label: 'Airbase',       valueM: 500, hp: 4 },
  port:   { code: 'PRT', label: 'Port',          valueM: 300, hp: 4 },
};

// Recent strike patterns, generalised from public reporting of russian attacks
// on Ukraine (mass OWA nights, combined packages, ballistic pulses, glide-bomb
// pressure). Quantities are typical orders of magnitude, not specific events.
const STRIKE_PRESETS = [
  { id: 'mass_owa', label: 'Mass OWA night (~90 Shahed + decoys)', rows: [
    { type: 'geran2', from: 'ru_south', count: 40, spacingSec: 25, startGH: 0 },
    { type: 'decoy',  from: 'ru_south', count: 15, spacingSec: 30, startGH: 0 },
    { type: 'geran2', from: 'ru_west',  count: 25, spacingSec: 30, startGH: 0.5 },
    { type: 'geran2_jet', from: 'by',   count: 10, spacingSec: 40, startGH: 1 },
  ]},
  { id: 'combined', label: 'Combined strike (OWA + cruise + ballistic)', rows: [
    { type: 'decoy',  from: 'ru_south', count: 10, spacingSec: 25, startGH: 0 },
    { type: 'geran2', from: 'ru_south', count: 30, spacingSec: 25, startGH: 0 },
    { type: 'geran2', from: 'ru_west',  count: 20, spacingSec: 30, startGH: 0.5 },
    { type: 'kh101',  from: 'ru_north', count: 12, spacingSec: 45, startGH: 1.5 },
    { type: 'kalibr', from: 'sea_black', count: 8, spacingSec: 50, startGH: 1.7 },
    { type: 'iskander', from: 'ru_west', count: 4, spacingSec: 60, startGH: 2 },
    { type: 'kinzhal',  from: 'ru_west', count: 2, spacingSec: 90, startGH: 2.1 },
  ]},
  { id: 'ballistic', label: 'Ballistic pulse (border cities)', rows: [
    { type: 'iskander', from: 'ru_west', count: 6, spacingSec: 60, startGH: 0 },
    { type: 'kinzhal',  from: 'by',      count: 2, spacingSec: 90, startGH: 0.2 },
  ]},
  { id: 'glide', label: 'Glide-bomb pressure (frontline belt)', rows: [
    { type: 'kab', from: 'ru_south', count: 24, spacingSec: 90, startGH: 0 },
  ]},
  { id: 'naval_med', label: 'Sea-launched cruise (southern flank)', rows: [
    { type: 'kalibr', from: 'sea_med', count: 10, spacingSec: 45, startGH: 0 },
    { type: 'kalibr', from: 'sea_black', count: 8, spacingSec: 45, startGH: 0.3 },
  ]},
];

// Full situational scenarios: a named attack picture + a recommended defensive
// echelon. One click loads waves and suggested batteries (placed in a ring
// around the first target). The user can then adjust before locking.
const SCENARIOS = [
  { id: 'capital_mass', name: 'Capital under mass OWA night', desc: 'A saturating Shahed raid from two axes with decoys. Tests the cheap lower tier and interceptor economy.',
    targets: [ { lat: 50.45, lng: 30.52, type: 'city', name: 'Kyiv centre' }, { lat: 50.40, lng: 30.65, type: 'energy', name: 'CHP-5' }, { lat: 50.52, lng: 30.45, type: 'energy', name: 'CHP-6' } ],
    waves: [
      { type: 'geran2', from: 'ru_south', target: 'all', count: 36, spacingSec: 25, startGH: 0 },
      { type: 'decoy',  from: 'ru_south', target: 'all', count: 12, spacingSec: 30, startGH: 0 },
      { type: 'geran2', from: 'by',       target: 'all', count: 24, spacingSec: 30, startGH: 0.5 },
    ],
    laydown: ['int_team','int_team','gepard','manpads','nasams','iris_t'] },
  { id: 'ballistic_threat', name: 'Ballistic threat to the capital', desc: 'Short-notice ballistic pulse. Only ABM-capable batteries can engage; everything else is irrelevant here.',
    targets: [ { lat: 50.45, lng: 30.52, type: 'city', name: 'Kyiv' }, { lat: 50.27, lng: 30.55, type: 'mil', name: 'C2 node' } ],
    waves: [
      { type: 'iskander', from: 'ru_west', target: 'all', count: 6, spacingSec: 60, startGH: 0 },
      { type: 'kinzhal',  from: 'by',      target: 'all', count: 2, spacingSec: 90, startGH: 0.3 },
    ],
    laydown: ['patriot','patriot','samp_t'] },
  { id: 'combined_energy', name: 'Combined strike on energy grid', desc: 'Decoys, OWA, cruise and a ballistic finisher against energy nodes. The classic layered-defence problem.',
    targets: [ { lat: 50.45, lng: 30.52, type: 'energy', name: 'Kyiv grid' }, { lat: 49.99, lng: 36.23, type: 'energy', name: 'Kharkiv grid' }, { lat: 48.46, lng: 35.05, type: 'energy', name: 'Dnipro grid' } ],
    waves: [
      { type: 'decoy',  from: 'ru_south', target: 'all', count: 10, spacingSec: 25, startGH: 0 },
      { type: 'geran2', from: 'ru_south', target: 'all', count: 28, spacingSec: 25, startGH: 0 },
      { type: 'kh101',  from: 'ru_north', target: 'all', count: 12, spacingSec: 45, startGH: 1.2 },
      { type: 'kalibr', from: 'sea_black', target: 'all', count: 8, spacingSec: 50, startGH: 1.4 },
      { type: 'iskander', from: 'ru_west', target: 'all', count: 4, spacingSec: 60, startGH: 2 },
    ],
    laydown: ['patriot','iris_t','nasams','gepard','int_team','int_team'] },
  { id: 'southern_naval', name: 'Southern flank naval cruise raid', desc: 'Sea-launched Kalibr from the Black and Mediterranean Seas against a port. Mid-tier SAM problem.',
    targets: [ { lat: 46.48, lng: 30.73, type: 'port', name: 'Odesa port' }, { lat: 46.63, lng: 32.61, type: 'port', name: 'Mykolaiv' } ],
    waves: [
      { type: 'kalibr', from: 'sea_med',  target: 'all', count: 10, spacingSec: 45, startGH: 0 },
      { type: 'kalibr', from: 'sea_black', target: 'all', count: 8, spacingSec: 45, startGH: 0.3 },
    ],
    laydown: ['nasams','nasams','iris_t','gepard'] },
  { id: 'glide_frontline', name: 'Frontline glide-bomb pressure', desc: 'Continuous UMPK glide-bomb releases against a forward node. Short reaction time, low-altitude.',
    targets: [ { lat: 48.04, lng: 37.80, type: 'mil', name: 'Forward node' } ],
    waves: [
      { type: 'kab', from: 'ru_south', target: 'all', count: 24, spacingSec: 90, startGH: 0 },
    ],
    laydown: ['iris_t','nasams','gepard','manpads'] },
];

export default function OperationalPlan({ waves, resolveThreat, threatOptions, onClose }) {
  // ---- reference capitals (orientation only) ----
  const [capCodes, setCapCodes] = useState(['UA', 'PL']);
  const [showCountries, setShowCountries] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const capitals = useMemo(() => NATO_COUNTRIES.filter(c => capCodes.includes(c.code)), [capCodes]);

  // ---- impact targets: placed by the user; threats fly to THESE, never random ----
  const [targets, setTargets] = useState([]); // {id:'T1', lat, lng, name}
  const targetsRef = useRef(targets); targetsRef.current = targets;
  const tSeq = useRef(1);

  const bounds = useMemo(() => {
    const pts = [...capitals.map(c => ({ lat: c.lat, lng: c.lng })), ...targets];
    if (!pts.length) return UA_BOUNDS;
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
    const pad = pts.length > 1 ? 2.2 : 4;
    return { n: Math.max(...lats) + pad, s: Math.min(...lats) - pad, w: Math.min(...lngs) - pad, e: Math.max(...lngs) + pad };
  }, [capitals, targets]);

  // ---- laydown ----
  const [placeKind, setPlaceKind] = useState('target'); // 'target' | 'battery' | 'route' | 'launch'
  const [enhanced, setEnhanced] = useState(false);
  // routes the user draws in ENHANCED mode: each = {id,type,family,points:[{lat,lng,altM}],count,spacingSec,startGH,from}
  const [customRoutes, setCustomRoutes] = useState([]);
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [wpAltM, setWpAltM] = useState(1000); // altitude applied to the next clicked waypoint
  const [launchPoint, setLaunchPoint] = useState(null); // optional custom origin {lat,lng}
  const launchPointRef = useRef(launchPoint); launchPointRef.current = launchPoint;
  const enhancedRef = useRef(enhanced); enhancedRef.current = enhanced;
  const activeRouteRef = useRef(activeRouteId); activeRouteRef.current = activeRouteId;
  const wpAltRef = useRef(wpAltM); wpAltRef.current = wpAltM;
  const customRoutesRef = useRef(customRoutes); customRoutesRef.current = customRoutes;
  const [tgtType, setTgtType] = useState('city');
  const [placeMode, setPlaceMode] = useState('patriot');
  const [batteries, setBatteries] = useState([]);
  const [libDefs, setLibDefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skywatch_libdefs') || '{}'); } catch (e) { return {}; }
  }); // batteries added from the AD library / imported
  function persistLibDefs(next) { setLibDefs(next); try { localStorage.setItem('skywatch_libdefs', JSON.stringify(next)); } catch (e) {} }
  const allDefs = useMemo(() => ({ ...BATTERY_REAL, ...libDefs }), [libDefs]);
  // resolve the chosen variant's override fields for a placed battery
  function variantOverride(b) {
    const vs = BATTERY_VARIANTS[b.type]; if (!vs || !b.variant) return null;
    const v = vs.find(x => x.id === b.variant); if (!v) return null;
    return { aeroRangeKm: v.aeroRangeKm, tbmFootprintKm: v.tbmFootprintKm, costM: v.costM, pkMul: v.pkMul, variantName: v.name };
  }
  const [mapLocked, setMapLocked] = useState(false);
  const placeKindRef = useRef(placeKind); placeKindRef.current = placeKind;
  const tgtTypeRef = useRef('city'); tgtTypeRef.current = tgtType;

  // ---- environment / doctrine ----
  const [wxPreset, setWxPreset] = useState('clear');
  const [windKmh, setWindKmh] = useState(20);
  const [night, setNight] = useState(true);
  const [salvoKey, setSalvoKey] = useState('single');
  const [season, setSeason] = useState('autumn');
  const [coldStart, setColdStart] = useState(false);
  const [centralised, setCentralised] = useState(false);
  const [jamming, setJamming] = useState(false);
  const weather = useMemo(() => makeWeather(wxPreset, 45, windKmh, night), [wxPreset, windKmh, night]);
  const seasonRef = useRef('autumn'); seasonRef.current = season;
  const envRef = useRef({}); envRef.current = { season, coldStart, centralised, jamming, night };

  // ---- attack matrix: explicit threat -> origin -> target, never random ----
  const [planWaves, setPlanWaves] = useState(() => (waves || []).map((w, i) => ({ ...w, target: 'all', id: 'w' + i + '_' + Date.now() })));
  const tOpts = (threatOptions && threatOptions.length) ? threatOptions : [{ key: 'geran2', label: 'Geran-2 · owa' }];
  const [qa, setQa] = useState({ type: tOpts[0].key, from: 'ru_south', target: 'all', count: 10, spacingSec: 30, startGH: 0 });
  const matrix = useMemo(() => planWaves.map(w => {
    const meta = resolveThreat ? resolveThreat(w.type) : { family: 'owa', kmh: 185, dmg: 1 };
    // meta provides family defaults; an explicit per-wave kmh/terminalKmh wins
    return { ...meta, ...w, count: +w.count || 0, spacingSec: +w.spacingSec || 30, startGH: +w.startGH || 0,
      kmh: (w.kmh && +w.kmh > 0) ? +w.kmh : meta.kmh,
      terminalKmh: (w.terminalKmh && +w.terminalKmh > 0) ? +w.terminalKmh : undefined };
  }), [planWaves, resolveThreat]);
  const totalTracks = matrix.reduce((s, r) => s + r.count, 0) + customRoutes.filter(cr => cr.points && cr.points.length >= 2).reduce((s, cr) => s + (+cr.count || 1), 0);

  // ---- run state ----
  const [playSpeed, setPlaySpeed] = useState(30);
  const playSpeedRef = useRef(30); playSpeedRef.current = playSpeed;
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false); playingRef.current = playing;
  const [selBat, setSelBat] = useState(null); // uid of battery whose control panel is open
  const [libCat, setLibCat] = useState('SAM'); // which library category is shown in the AD picker
  const [patrolFor, setPatrolFor] = useState(null); // uid of fighter whose patrol is being drawn
  const patrolForRef = useRef(patrolFor); patrolForRef.current = patrolFor;
  const [liveAmmo, setLiveAmmo] = useState({}); // uid -> ammo, surfaced from sim for the panel
  const liveAmmoRef = useRef({}); liveAmmoRef.current = liveAmmo;
  const [showScenarios, setShowScenarios] = useState(false);
  const [savedScenarios, setSavedScenarios] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skywatch_scenarios') || '[]'); } catch (e) { return []; }
  });
  function persistSaved(list) { setSavedScenarios(list); try { localStorage.setItem('skywatch_scenarios', JSON.stringify(list)); } catch (e) {} }
  // Capture the entire current plan as a portable scenario object
  function serializePlan(name) {
    return {
      id: 'usr_' + Date.now(), name: name || ('Scenario ' + new Date().toLocaleString()), saved: Date.now(), user: true,
      capCodes, targets, batteries, planWaves,
      env: { season, wxPreset, windKmh, night, coldStart, centralised, jamming, salvoKey },
    };
  }
  function applyScenario(sc) {
    if (mapLocked) return;
    if (sc.capCodes) setCapCodes(sc.capCodes);
    if (sc.targets) { setTargets(sc.targets); tSeq.current = Math.max(1, ...sc.targets.map(t => parseInt((t.id || 'T0').slice(1)) || 0)) + 1; }
    if (sc.batteries) setBatteries(sc.batteries);
    if (sc.planWaves) setPlanWaves(sc.planWaves.map((w, i) => ({ ...w, id: 'w' + i + '_' + Date.now() })));
    else if (sc.waves) { /* built-in preset path handled by loadScenario */ }
    if (sc.env) {
      const e = sc.env;
      if (e.season) setSeason(e.season); if (e.wxPreset) setWxPreset(e.wxPreset);
      if (e.windKmh != null) setWindKmh(e.windKmh); if (e.night != null) setNight(e.night);
      if (e.coldStart != null) setColdStart(e.coldStart); if (e.centralised != null) setCentralised(e.centralised);
      if (e.jamming != null) setJamming(e.jamming); if (e.salvoKey) setSalvoKey(e.salvoKey);
    }
    setReport(null); setMc(null); setShowScenarios(false);
  }
  function saveCurrentScenario() {
    const name = (typeof window !== 'undefined' && window.prompt) ? window.prompt('Name this scenario:', 'My scenario ' + (savedScenarios.length + 1)) : null;
    if (name === null) return;
    persistSaved([serializePlan(name), ...savedScenarios]);
  }
  function deleteSaved(id) { persistSaved(savedScenarios.filter(s => s.id !== id)); }
  function exportScenario(sc) {
    try {
      const blob = new Blob([JSON.stringify(sc, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (sc.name || 'scenario').replace(/[^a-z0-9]+/gi, '_') + '.skywatch.json'; a.click();
    } catch (e) {}
  }
  function importScenarioFile(file) {
    const r = new FileReader();
    r.onload = () => { try { const sc = JSON.parse(r.result); sc.id = 'usr_' + Date.now(); sc.user = true; persistSaved([sc, ...savedScenarios]); } catch (e) { alert('Could not read scenario file.'); } };
    r.readAsText(file);
  }
  function downloadJSON(obj, filename) {
    try {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = filename; a.click();
    } catch (e) {}
  }
  // export the full systems library (base + any custom/imported), so it can be
  // shared, version-controlled and edited offline
  function exportLibrary() {
    downloadJSON({ kind: 'skywatch-library', version: 1, exported: Date.now(),
      baseSystems: BATTERY_REAL, customSystems: libDefs },
      'skywatch-library.skywatch-lib.json');
  }
  function importLibraryFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const incoming = data.customSystems || data.systems || data;
        // merge imported systems into the custom library (id-keyed)
        const merged = { ...libDefs };
        Object.keys(incoming).forEach(k => { if (incoming[k] && typeof incoming[k] === 'object') merged[k] = incoming[k]; });
        persistLibDefs(merged);
        alert('Library imported: ' + Object.keys(incoming).length + ' systems merged.');
      } catch (e) { alert('Could not read library file.'); }
    };
    r.readAsText(file);
  }
  // export EVERYTHING (library + all saved scenarios) as one shareable package
  function exportPackage() {
    downloadJSON({ kind: 'skywatch-package', version: 1, exported: Date.now(),
      library: { baseSystems: BATTERY_REAL, customSystems: libDefs },
      scenarios: savedScenarios },
      'skywatch-package.skywatch-pkg.json');
  }
  function importPackageFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (data.library && data.library.customSystems) {
          persistLibDefs({ ...libDefs, ...data.library.customSystems });
        }
        if (Array.isArray(data.scenarios) && data.scenarios.length) {
          const stamped = data.scenarios.map((s, i) => ({ ...s, id: 'pkg_' + Date.now() + '_' + i, user: true }));
          persistSaved([...stamped, ...savedScenarios]);
        }
        alert('Package imported.');
      } catch (e) { alert('Could not read package file.'); }
    };
    r.readAsText(file);
  }
  const [live, setLive] = useState({ inbound: 0, intercepted: 0, leaked: 0 });
  const [report, setReport] = useState(null);
  const [showFinal, setShowFinal] = useState(false);
  const [mc, setMc] = useState(null);
  const [mcProgress, setMcProgress] = useState(0);
  const [mcSeed, setMcSeed] = useState(0);
  const [runSeed, setRunSeed] = useState(0);
  const [running, setRunning] = useState(false);

  const mapDivRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null), defLayerRef = useRef(null), kmppRef = useRef(1), roRef = useRef(null);
  const canvasRef = useRef(null), rafRef = useRef(null), simRef = useRef(null);
  const placeRef = useRef(placeMode); placeRef.current = placeMode;
  const lockRef = useRef(false); lockRef.current = mapLocked;
  const defendedRef = useRef(targets); defendedRef.current = targets;
  const capitalsRef = useRef(capitals); capitalsRef.current = capitals;
  const activeOrigins = useMemo(() => {
    const ids = [...new Set(planWaves.map(w => w.from))];
    return THREAT_ORIGINS.filter(o => ids.includes(o.id));
  }, [planWaves]);
  const originsRef = useRef(activeOrigins); originsRef.current = activeOrigins;
  const routes = useMemo(() => planWaves.map(w => ({ from: w.from, target: w.target || 'all' })), [planWaves]);
  const routesRef = useRef(routes); routesRef.current = routes;

  // ---- map init ----
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomSnap: 0, worldCopyJump: false });
    L.tileLayer(ESRI_URL, { maxZoom: 19, attribution: ESRI_ATTR }).addTo(map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
    map.fitBounds([[UA_BOUNDS.s, UA_BOUNDS.w], [UA_BOUNDS.n, UA_BOUNDS.e]], { animate: false });
    defLayerRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    const recalc = () => {
      const c = map.getCenter(), p1 = map.latLngToContainerPoint(c);
      const east = map.containerPointToLatLng(L.point(p1.x + 100, p1.y));
      kmppRef.current = kmBetween({ lat: c.lat, lng: c.lng }, { lat: east.lat, lng: east.lng }) / 100;
      sizeCanvas();
    };
    map.on('click', (e) => {
      if (lockRef.current) return;
      // draw a fighter's patrol route: each click adds a waypoint to that fighter
      if (placeKindRef.current === 'patrol' && patrolForRef.current) {
        const uid = patrolForRef.current;
        setBatteries(prev => prev.map(x => x.uid === uid ? { ...x, patrol: [...(x.patrol || []), { lat: e.latlng.lat, lng: e.latlng.lng }] } : x));
        return;
      }
      // set a custom launch point
      if (placeKindRef.current === 'launch') {
        setLaunchPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
        setQa(q => ({ ...q, from: 'custom_launch' }));
        setPlaceKind('none');
        return;
      }
      // ENHANCED: place a waypoint with the current altitude into the active route
      if (enhancedRef.current && placeKindRef.current === 'route') {
        const rid = activeRouteRef.current;
        if (!rid) return; // need an active route first
        const alt = wpAltRef.current;
        // Ballistic and hypersonic weapons fly a fixed trajectory from launch to
        // target; the user cannot route them around like a cruise missile. For a
        // ballistic route we therefore accept only two points: the FIRST click is
        // the launch point, the trajectory then runs straight to the aim-point.
        // Further clicks just move the launch point rather than adding zig-zags.
        const rt = customRoutesRef.current.find(r => r.id === rid);
        const fam = rt && resolveThreat ? resolveThreat(rt.type).family : null;
        if (fam === 'ballistic') {
          setCustomRoutes(prev => prev.map(r => {
            if (r.id !== rid) return r;
            const pts = r.points.slice();
            const launch = { lat: e.latlng.lat, lng: e.latlng.lng, altM: 60000 };
            // keep an existing impact point (last) if present, else this is launch only
            if (pts.length >= 2) { pts[0] = launch; }         // move launch, keep impact
            else if (pts.length === 1) { pts.unshift(launch); } // had impact, add launch before
            else { pts.push(launch); }                         // first point = launch
            return { ...r, points: pts };
          }));
          return;
        }
        setCustomRoutes(prev => prev.map(r => r.id === rid
          ? { ...r, points: [...r.points, { lat: e.latlng.lat, lng: e.latlng.lng, altM: alt }] }
          : r));
        return;
      }
      if (placeKindRef.current === 'target') {
        const id = 'T' + (tSeq.current++);
        const tt = TGT_TYPES[tgtTypeRef.current] || TGT_TYPES.city;
        setTargets(prev => [...prev, { id, lat: e.latlng.lat, lng: e.latlng.lng, name: tt.label, type: tgtTypeRef.current, maxHp: tt.hp, valueM: tt.valueM }]);
        return;
      }
      if (placeRef.current === 'none') return;
      const bdef = allDefs[placeRef.current] || {};
      const seedCan = ENGAGE_CLASSES.map(c => c.key).filter(k => physCapable(bdef, k));
      setBatteries(prev => [...prev, { uid: 'b' + Date.now() + Math.floor(Math.random() * 999), type: placeRef.current, lat: e.latlng.lat, lng: e.latlng.lng, canOverride: seedCan }]);
    });
    map.on('moveend zoomend', recalc);
    map.on('move zoom', () => {
      sizeCanvas();
      // While the simulation is playing, the animation loop redraws every frame.
      // When it is NOT playing (planning or reviewing the report), nothing redraws
      // the canvas, so a frozen last frame would appear to slide across the map as
      // the user pans. Clear it so overlays stay anchored to the map instead.
      if (!playingRef.current) {
        const cv = canvasRef.current;
        if (cv) { const ctx = cv.getContext('2d'); if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); }
      }
    });
    mapRef.current = map;
    drawDefended();
    const fix = () => { try { map.invalidateSize(); recalc(); } catch (e) {} };
    try { roRef.current = new ResizeObserver(fix); roRef.current.observe(mapDivRef.current); } catch (e) {}
    setTimeout(fix, 120); setTimeout(fix, 400); setTimeout(fix, 900);
    return () => { try { cancelAnimationFrame(rafRef.current); roRef.current && roRef.current.disconnect(); map.remove(); } catch (e) {} mapRef.current = null; };
    // eslint-disable-next-line
  }, []);

  // Auto-fit ONLY when the reference-capital selection changes (region choice).
  // Placing targets/batteries must never re-zoom the map.
  const capKey = useMemo(() => capCodes.slice().sort().join(','), [capCodes]);
  const didFit = useRef(false);
  useEffect(() => {
    const m = mapRef.current; if (!m || lockRef.current) return;
    // skip the very first run (initial fitBounds already happens on map init)
    if (!didFit.current) { didFit.current = true; return; }
    const pts = capitalsRef.current.map(c => ({ lat: c.lat, lng: c.lng }));
    if (!pts.length) return;
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
    const pad = pts.length > 1 ? 2.2 : 4;
    m.fitBounds([[Math.min(...lats) - pad, Math.min(...lngs) - pad], [Math.max(...lats) + pad, Math.max(...lngs) + pad]], { animate: true });
    /* eslint-disable-next-line */
  }, [capKey]);
  useEffect(() => { drawDefended(); /* eslint-disable-next-line */ }, [capitals, targets, activeOrigins, routes, customRoutes, activeRouteId, launchPoint]);
  useEffect(() => { drawBatteries(); /* eslint-disable-next-line */ }, [batteries, mapLocked, libDefs]);

  function lockMap() {
    // "Lock" freezes the laydown (no placing/removing) but the map stays fully
    // interactive: the user can pan and zoom freely, even during the run.
    setMapLocked(true);
  }
  function unlockMap() {
    setMapLocked(false);
  }
  function sizeCanvas() {
    const cv = canvasRef.current, div = mapDivRef.current; if (!cv || !div) return;
    if (cv.width !== div.offsetWidth || cv.height !== div.offsetHeight) { cv.width = div.offsetWidth; cv.height = div.offsetHeight; }
  }
  function kmToPx(km) { return km / (kmppRef.current || 1); }

  // ---- live battery actions (work during the run) ----
  // Reload a battery: empties nothing, but after the system's real reload time
  // its ammo is restored. Delay is in real seconds, shown as a countdown.
  function reloadBattery(uid) {
    const def0 = (() => { const b = batteries.find(x => x.uid === uid); return b ? allDefs[b.type] : null; })();
    if (!def0) return;
    const reloadSec = Math.max(4, def0.reloadS || 8);
    const finishAt = performance.now() + (reloadSec * 1000) / (playSpeedRef.current || 1);
    setBatteries(prev => prev.map(b => b.uid === uid ? { ...b, reloadUntil: finishAt } : b));
    // mark on the live sim too
    const sim = simRef.current; if (sim) { const sb = sim.bats.find(b => b.uid === uid); if (sb) sb.reloadUntil = finishAt; }
  }
  function moveBattery(uid, lat, lng) {
    setBatteries(prev => prev.map(b => b.uid === uid ? { ...b, lat, lng } : b));
    const sim = simRef.current; if (sim) { const sb = sim.bats.find(b => b.uid === uid); if (sb) { sb.lat = lat; sb.lng = lng; } }
  }
  function toggleHideBattery(uid) {
    setBatteries(prev => prev.map(b => b.uid === uid ? { ...b, engage: b.engage === false ? true : false } : b));
    const sim = simRef.current; if (sim) { const sb = sim.bats.find(b => b.uid === uid); if (sb) sb.engage = !sb.engage; }
  }
  // pick a variant/modification; override the live sim battery immediately
  function setVariant(uid, variantId) {
    setBatteries(prev => prev.map(b => b.uid === uid ? { ...b, variant: variantId } : b));
    const sim = simRef.current;
    if (sim) {
      const b = batteries.find(x => x.uid === uid); if (!b) return;
      const vs = BATTERY_VARIANTS[b.type]; const v = vs && vs.find(x => x.id === variantId); if (!v) return;
      const sb = sim.bats.find(x => x.uid === uid);
      if (sb) {
        sb.def = { ...sb.def, aeroRangeKm: v.aeroRangeKm, tbmFootprintKm: v.tbmFootprintKm, costM: v.costM, variantName: v.name };
        sb.costM = v.costM; sb.pkMul = v.pkMul != null ? v.pkMul : 1;
      }
    }
  }

  function drawDefended() {
    const lg = defLayerRef.current, map = mapRef.current; if (!lg || !map) return;
    lg.clearLayers();
    // reference capitals (orientation only, faded)
    capitalsRef.current.forEach(c => {
      L.marker([c.lat, c.lng], { icon: L.divIcon({ className: '', iconSize: [8, 8], iconAnchor: [4, 4], html: `<div style="width:7px;height:7px;border:1px solid #56a0e0;background:rgba(86,160,224,0.25);transform:rotate(45deg)"></div>` }) }).addTo(lg);
      L.marker([c.lat, c.lng], { icon: L.divIcon({ className: '', iconSize: [120, 12], iconAnchor: [-5, 6], html: `<div style="font-family:monospace;font-size:8px;color:#7f93a6;white-space:nowrap;text-shadow:0 0 3px #000">${c.capital}</div>` }) }).addTo(lg);
    });
    // route corridors origin -> target (from current matrix), drawn under markers
    const org = {}; THREAT_ORIGINS.forEach(o => { org[o.id] = o; });
    (routesRef.current || []).forEach(rt => {
      const o = org[rt.from], tg = targetsRef.current.find(t => t.id === rt.target);
      if (!o) return;
      const dests = rt.target === 'all' ? targetsRef.current : (tg ? [tg] : []);
      dests.forEach(dd => L.polyline([[o.lat, o.lng], [dd.lat, dd.lng]], { color: RED, weight: 1, opacity: 0.28, dashArray: '3,6' }).addTo(lg));
    });
    // ENHANCED: user-drawn routes with per-point altitude
    (customRoutesRef.current || []).forEach(cr => {
      if (!cr.points || cr.points.length === 0) return;
      const active = cr.id === activeRouteRef.current;
      const col = active ? '#e8bd55' : '#d24a44';
      if (cr.points.length >= 2) {
        L.polyline(cr.points.map(p => [p.lat, p.lng]), { color: col, weight: active ? 2.5 : 1.6, opacity: 0.8, dashArray: active ? null : '4,5' }).addTo(lg);
      }
      cr.points.forEach((p, idx) => {
        const isLast = idx === cr.points.length - 1;
        const km = p.altM >= 1000 ? (p.altM / 1000).toFixed(p.altM >= 10000 ? 0 : 1) + 'km' : p.altM + 'm';
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [10, 10], iconAnchor: [5, 5], html: `<div style="width:8px;height:8px;background:${col};border:1px solid #0a1626;border-radius:50%"></div>` }) }).addTo(lg);
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [70, 12], iconAnchor: [-6, 6], html: `<div style="font-family:monospace;font-size:8px;color:${col};white-space:nowrap;text-shadow:0 0 3px #000">${idx === 0 ? 'LAUNCH ' : isLast ? 'IMPACT ' : 'WP' + idx + ' '}${km}</div>` }) }).addTo(lg);
      });
    });
    // custom launch point (optional origin)
    if (launchPointRef.current) {
      const lp = launchPointRef.current;
      L.marker([lp.lat, lp.lng], { icon: L.divIcon({ className: '', iconSize: [44, 14], iconAnchor: [22, 7], html: `<div style="font-family:monospace;font-size:8px;color:#e8bd55;text-align:center;text-shadow:0 0 3px #000"><div style="font-size:13px;line-height:1">⊕</div>LAUNCH</div>` }) }).addTo(lg);
    }
    // impact targets (the points that get hit)
    targetsRef.current.forEach(t => {
      const tc = (TGT_TYPES[t.type] || {}).code || '';
      L.marker([t.lat, t.lng], { icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div style="width:12px;height:12px;border:2px solid ${AMBER};background:rgba(217,165,47,0.25);transform:rotate(45deg)"></div>` }) }).addTo(lg);
      L.marker([t.lat, t.lng], { icon: L.divIcon({ className: '', iconSize: [110, 12], iconAnchor: [-8, 6], html: `<div style="font-family:monospace;font-size:9px;color:${AMBER};white-space:nowrap;text-shadow:0 0 3px #000">${t.id}·${tc} ${t.name}</div>` }) }).addTo(lg);
    });
    // active threat origins
    (originsRef.current || []).forEach(o => {
      L.marker([o.lat, o.lng], { icon: L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: `<div style="width:10px;height:10px;background:${RED};border:1px solid #0a1626;border-radius:50%;box-shadow:0 0 6px ${RED}"></div>` }) }).addTo(lg);
      L.marker([o.lat, o.lng], { icon: L.divIcon({ className: '', iconSize: [130, 12], iconAnchor: [-7, 6], html: `<div style="font-family:monospace;font-size:8px;color:${RED};white-space:nowrap;text-shadow:0 0 3px #000">${o.label}</div>` }) }).addTo(lg);
    });
  }
  function drawBatteries() {
    const lg = layerRef.current; if (!lg) return;
    lg.clearLayers();
    batteries.forEach(b => {
      const def = allDefs[b.type]; if (!def) return; const col = batColor(b.type);
      const laLive = liveAmmoRef.current[b.uid];
      const isDead = laLive && laLive.disabled;
      const hidden = b.engage === false;
      const ringOpacity = hidden ? 0.25 : 0.85;
      if (isDead) {
        // destroyed AD site: grey marker with a strike, no coverage rings
        L.marker([b.lat, b.lng], { interactive: true, icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: `<div style="font-family:monospace;font-size:14px;color:#7f93a6;line-height:1;text-shadow:0 0 3px #000">✕</div>` }) }).addTo(lg).on('click', () => setSelBat(b.uid));
        L.marker([b.lat, b.lng], { interactive: false, icon: L.divIcon({ className: '', iconSize: [160, 11], iconAnchor: [-8, 6], html: `<div style="font-family:monospace;font-size:8px;color:#7f93a6;white-space:nowrap;text-shadow:0 0 3px #000">${def.tag || def.name} · DESTROYED</div>` }) }).addTo(lg);
        return;
      }
      if (def.aeroRangeKm > 0) L.circle([b.lat, b.lng], { radius: def.aeroRangeKm * 1000, color: col, weight: 1.2, opacity: ringOpacity, fill: true, fillColor: col, fillOpacity: hidden ? 0.02 : 0.06 }).addTo(lg);
      if (def.tbmFootprintKm > 0) L.circle([b.lat, b.lng], { radius: def.tbmFootprintKm * 1000, color: BLUE, weight: 1, opacity: 0.9, dashArray: '4,4', fill: false }).addTo(lg);
      // SENSORS (radar / AWACS): draw the detection footprint as a dashed teal ring.
      if (def.isSensor && def.detectKm > 0) {
        L.circle([b.lat, b.lng], { radius: def.detectKm * 1000, color: '#8fd0c4', weight: 1, opacity: 0.7, dashArray: '3,6', fill: true, fillColor: '#8fd0c4', fillOpacity: 0.03 }).addTo(lg);
      }
      // FIGHTERS: draw ONLY the patrol route (clean violet line + waypoints). The
      // engagement radius is not a static blob here; it follows the aircraft in
      // flight (drawn on the canvas during the run), so planning stays readable.
      if (def.isFighter && !def.isSensor) {
        if (b.patrol && b.patrol.length >= 2) {
          L.polyline(b.patrol.map(p => [p.lat, p.lng]), { color: '#c99be0', weight: 1.8, opacity: 0.9, dashArray: '7,5' }).addTo(lg);
        }
        if (b.patrol && b.patrol.length >= 1) {
          b.patrol.forEach((p, i) => L.marker([p.lat, p.lng], { interactive: false, icon: L.divIcon({ className: '', iconSize: [10, 10], iconAnchor: [5, 5], html: `<div style="width:7px;height:7px;border:1.5px solid #c99be0;border-radius:50%;background:rgba(201,155,224,0.5)"></div>` }) }).addTo(lg));
        }
        // one small A2A reach ring at the aircraft's current (start) position, so
        // the user sees how far it can shoot; it will move with the jet in the run.
        if (def.aeroRangeKm > 0) L.circle([b.lat, b.lng], { radius: def.aeroRangeKm * 1000, color: '#c99be0', weight: 1, opacity: 0.5, dashArray: '3,5', fill: true, fillColor: '#c99be0', fillOpacity: 0.04 }).addTo(lg);
      }
      // self-defence ring (auto, human out of loop) for big SAMs with it enabled
      const isBigSAM = def.tbmFootprintKm > 0;
      const sdOn = b.selfDefend != null ? b.selfDefend : isBigSAM;
      if (isBigSAM && sdOn) {
        const sdKm = b.selfDefendKm != null ? b.selfDefendKm : 20;
        L.circle([b.lat, b.lng], { radius: sdKm * 1000, color: GREEN, weight: 1, opacity: 0.7, dashArray: '2,5', fill: false }).addTo(lg);
      }
      // interactive marker: draggable any time; click reloads during the run, removes when idle+unlocked
      const m = L.marker([b.lat, b.lng], { draggable: true, icon: L.divIcon({ className: '', iconSize: [13, 13], iconAnchor: [6, 6], html: `<div style="width:11px;height:11px;background:${hidden ? '#5d6b7a' : col};border:1.5px solid #0a1626;border-radius:50%;box-shadow:0 0 5px ${hidden ? 'transparent' : col}"></div>` }) });
      m.on('dragend', (e) => { const ll = e.target.getLatLng(); moveBattery(b.uid, ll.lat, ll.lng); });
      m.on('click', () => { setSelBat(b.uid); });
      m.addTo(lg);
      // live ammo bar under the marker (remaining interceptors)
      const la = liveAmmoRef.current[b.uid];
      const maxA = def.rounds || 0;
      const curA = la && la.ammo != null ? la.ammo : maxA;
      if (maxA > 0 && maxA !== Infinity && !def.isEW) {
        const frac = Math.max(0, Math.min(1, curA / maxA));
        const barCol = frac > 0.5 ? '#4f9d77' : frac > 0.25 ? '#d9a52f' : '#d24a44';
        const W = 26;
        L.marker([b.lat, b.lng], { interactive: false, icon: L.divIcon({ className: '', iconSize: [W, 5], iconAnchor: [W / 2, -8], html: `<div style="width:${W}px;height:4px;background:#16293c;border:0.5px solid #0a1626;border-radius:2px;overflow:hidden"><div style="width:${frac * 100}%;height:100%;background:${barCol}"></div></div>` }) }).addTo(lg);
      }
      const reloading = (la && la.reloadUntil ? la.reloadUntil : b.reloadUntil) && performance.now() < (la && la.reloadUntil ? la.reloadUntil : b.reloadUntil);
      const secLeft = reloading ? Math.ceil(((la && la.reloadUntil ? la.reloadUntil : b.reloadUntil) - performance.now()) / 1000) : 0;
      const ammoTag = (maxA > 0 && maxA !== Infinity && !def.isEW) ? ` · ${curA}/${maxA}` : '';
      const tag = `${def.tag || def.name}${ammoTag}${reloading ? ' · RELOAD ' + secLeft + 's' : ''}${hidden ? ' · HIDDEN' : ''}`;
      L.marker([b.lat, b.lng], { interactive: false, icon: L.divIcon({ className: '', iconSize: [160, 11], iconAnchor: [-8, 6], html: `<div style="font-family:monospace;font-size:8px;color:${reloading ? AMBER : hidden ? '#7f93a6' : col};white-space:nowrap;text-shadow:0 0 3px #000">${tag}</div>` }) }).addTo(lg);
    });
  }

  // ---- defence library binding ----
  const libOptions = useMemo(() => AD_LIBRARY
    .map((e, i) => ({ ...e, idx: i }))
    .filter(e => e.rangeKm > 0)
    .sort((a, b) => (a.cat === b.cat ? (b.rangeKm - a.rangeKm) : a.cat.localeCompare(b.cat))), []);
  function addFromLibrary(idxStr) {
    const idx = +idxStr; if (Number.isNaN(idx)) return;
    const e = AD_LIBRARY[idx]; if (!e || !e.rangeKm) return;
    const type = 'lib_' + idx;
    if (allDefs[type]) { setPlaceKind('battery'); setPlaceMode(type); return; }
    const abm = /patriot|samp\/t|arrow|thaad|sm-3|sm-6|david/i.test(e.name) || /bmd/i.test(e.cls || '');
    const reloadByCat = { GUN_LASER: 4, MANPADS: 10, INTERCEPTOR: 20, EW: 0, SHORAD: 6, MR_SAM: 8, LR_SAM: 12 };
    // engageable classes by category, following Ukrainian practice
    let can;
    if (e.cat === 'EW') can = ['owa', 'recon'];
    else if (e.cat === 'GUN_LASER') can = ['owa', 'glide', 'male', 'cruise'];
    else if (e.cat === 'MANPADS') can = ['owa', 'glide', 'male', 'cruise'];
    else if (e.cat === 'INTERCEPTOR') can = ['owa', 'male'];
    else if (abm) can = ['ballistic', 'cruise', 'owa', 'glide', 'male'];
    else can = ['cruise', 'owa', 'glide', 'male']; // generic SAM
    const def = {
      id: type, name: e.name, tag: e.name.length > 15 ? e.name.slice(0, 14) + '…' : e.name,
      aeroRangeKm: e.rangeKm, tbmFootprintKm: abm ? 25 : 0,
      detectKm: Math.min(Math.max(e.rangeKm * 1.3, e.rangeKm + 10), 400),
      rounds: e.cat === 'GUN_LASER' ? 40 : e.cat === 'MANPADS' ? 8 : e.cat === 'INTERCEPTOR' ? 10 : e.cat === 'EW' ? 0 : 12,
      costM: e.cat === 'GUN_LASER' ? 0.004 : e.cat === 'MANPADS' ? 0.15 : e.cat === 'INTERCEPTOR' ? 0.01 : e.cat === 'EW' ? 0 : (e.rangeKm >= 100 ? 4.0 : e.rangeKm >= 25 ? 0.8 : 0.4),
      reloadS: reloadByCat[e.cat] != null ? reloadByCat[e.cat] : 8, isEW: e.cat === 'EW', cat: e.cat, can, lib: true, nation: e.country || e.nation || '',
    };
    persistLibDefs({ ...libDefs, [type]: def });
    setPlaceKind('battery');
    setPlaceMode(type);
  }
  function pkProfile(type) {
    if (OP_PK[type]) return OP_PK[type];
    const d = allDefs[type] || {};
    if (d.isEW) return { ballistic: 0, cruise: 0, owa: 0, glide: 0 };
    if (d.cat === 'GUN_LASER') return OP_PK.gepard;
    if (d.cat === 'MANPADS') return { ballistic: 0, cruise: 0.10, owa: 0.50, glide: 0.15 };
    if (d.cat === 'INTERCEPTOR') return { ballistic: 0, cruise: 0.05, owa: 0.60, glide: 0.10 };
    if ((d.aeroRangeKm || 0) >= 100) return d.tbmFootprintKm > 0 ? OP_PK.patriot : { ballistic: 0.05, cruise: 0.70, owa: 0.50, glide: 0.50 };
    if ((d.aeroRangeKm || 0) >= 25) return OP_PK.iris_t;
    return OP_PK.nasams;
  }
  function pkFor(batType, family) {
    const fam = (family === 'male' || family === 'tactical' || family === 'recon' || family === 'unknown') ? 'owa' : family;
    const base = (pkProfile(batType) || {})[fam] || 0;
    const d = allDefs[batType] || {};
    const optical = d.cat === 'GUN_LASER' || batType === 'gepard' || batType === 'mobile' || batType === 'int_team' || batType === 'manpads';
    const we = weatherEffects(weather, optical ? 'gepard' : batType, fam);
    let pk = base * we.pkMul;
    if (optical) pk *= crosswindPkMul(weather);
    const shots = (d.rounds > 0) ? (SALVO[salvoKey] || SALVO.single).shots : 1;
    return salvoPk(pk, shots);
  }

  // Resolve the target(s) a wave aims at. 'all' spreads tracks round-robin across
  // every placed target; a specific id sends every track to that point. Never random.
  function wTargetFor(wave, i) {
    const ts = targetsRef.current; if (!ts.length) return null;
    if (wave.target && wave.target !== 'all') return ts.find(t => t.id === wave.target) || ts[0];
    return ts[i % ts.length];
  }
  function normFam(family) { return (family === 'male' || family === 'tactical' || family === 'recon' || family === 'unknown') ? 'owa' : family; }
  // Is a system PHYSICALLY able to engage this class at all (hard limit)?
  function physCapable(def, cls) {
    if (!def || def.isEW) return false;
    if (cls === 'ballistic') return def.tbmFootprintKm > 0;
    if (def.can && def.can.length) {
      // data-declared systems: physical envelope is their declared set plus same-tier inference
      if (def.can.includes(cls)) return true;
      // allow MANPADS/guns/int to physically take cruise if low/slow (UA practice), but not ballistic
      if ((cls === 'cruise') && (def.cat === 'MANPADS' || def.cat === 'GUN_LASER' || def.role === 'VSHORAD' || def.id === 'manpads' || def.id === 'gepard')) return true;
      return false;
    }
    // library-derived
    if (def.cat === 'GUN_LASER' || def.cat === 'MANPADS' || def.cat === 'INTERCEPTOR') return cls !== 'ballistic';
    return true; // SAMs can take aero classes; ballistic gated above
  }
  // Default allowed set = physically capable classes (doctrine can then deny some)
  function defaultCan(def) {
    return ENGAGE_CLASSES.map(c => c.key).filter(k => physCapable(def, k));
  }
  // Effective allowed set for a placed battery (override if user edited)
  function effectiveCan(b, def) {
    if (Array.isArray(b.canOverride)) return b.canOverride;
    return (def.can && def.can.length) ? def.can.filter(k => physCapable(def, k)) : defaultCan(def);
  }
  function toggleCan(i, b, def, cls) {
    setBatteries(prev => prev.map((x, j) => {
      if (j !== i) return x;
      const cur = Array.isArray(x.canOverride) ? x.canOverride : effectiveCan(x, def);
      const has = cur.includes(cls);
      const next = has ? cur.filter(c => c !== cls) : [...cur, cls];
      const sim = simRef.current; if (sim) { const sb = sim.bats.find(s => s.uid === x.uid); if (sb) sb.canOverride = next; }
      return { ...x, canOverride: next };
    }));
  }
  // toggle a class by uid (used by the live control panel)
  function toggleCanUid(uid, cls) {
    setBatteries(prev => prev.map(x => {
      if (x.uid !== uid) return x;
      const def = allDefs[x.type] || {};
      const cur = Array.isArray(x.canOverride) ? x.canOverride : effectiveCan(x, def);
      const next = cur.includes(cls) ? cur.filter(c => c !== cls) : [...cur, cls];
      const sim = simRef.current; if (sim) { const sb = sim.bats.find(s => s.uid === uid); if (sb) sb.canOverride = next; }
      return { ...x, canOverride: next };
    }));
  }
  function canEngage(type, family, batt) {
    const def = allDefs[type]; if (!def || def.isEW) return false;
    const fam = normFam(family || 'owa');
    if (!physCapable(def, fam)) return false;
    // doctrine override from the placed battery, if any
    if (batt && Array.isArray(batt.canOverride)) return batt.canOverride.includes(fam);
    if (def.can && def.can.length) return def.can.includes(fam) || physCapable(def, fam) && false || def.can.includes(fam);
    return true;
  }
  function engagersFor(tgt, family) {
    if (!tgt) return [];
    return batteries.filter(b => {
      const def = allDefs[b.type]; if (!def) return false;
      if (b.engage === false) return false;
      if (!canEngage(b.type, family, b)) return false;
      const dKm = kmBetween({ lat: b.lat, lng: b.lng }, { lat: tgt.lat, lng: tgt.lng });
      if (family === 'ballistic') return def.tbmFootprintKm > 0 && dKm <= def.tbmFootprintKm;
      return def.aeroRangeKm > 0 && dKm <= def.aeroRangeKm;
    }).map(b => b.type);
  }

  // ---- waves authoring ----
  function addCustomRoute() {
    const id = 'cr' + Date.now();
    const firstThreat = (threatOptions && threatOptions[0] && threatOptions[0].key) || 'geran2';
    setCustomRoutes(prev => [...prev, { id, type: firstThreat, from: 'custom', points: [], count: 1, spacingSec: 30, startGH: 0, target: 'manual' }]);
    setActiveRouteId(id);
    setPlaceKind('route');
  }
  function updateRoute(id, patch) { setCustomRoutes(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r)); }
  function deleteRoute(id) { setCustomRoutes(prev => prev.filter(r => r.id !== id)); if (activeRouteId === id) setActiveRouteId(null); }
  function undoWaypoint(id) { setCustomRoutes(prev => prev.map(r => r.id === id ? { ...r, points: r.points.slice(0, -1) } : r)); }
  function updateWaypoint(routeId, idx, patch) {
    setCustomRoutes(prev => prev.map(r => r.id !== routeId ? r : { ...r, points: r.points.map((p, j) => j === idx ? { ...p, ...patch } : p) }));
  }
  function removeWaypoint(routeId, idx) {
    setCustomRoutes(prev => prev.map(r => r.id !== routeId ? r : { ...r, points: r.points.filter((_, j) => j !== idx) }));
  }
  function addTypedWaypoint(routeId, lat, lng, altM) {
    if (!isFinite(lat) || !isFinite(lng)) return;
    setCustomRoutes(prev => prev.map(r => r.id !== routeId ? r : { ...r, points: [...r.points, { lat, lng, altM: altM != null ? altM : 1000 }] }));
  }

  function addWaveRow() {
    const cnt = Math.max(1, parseInt(qa.count) || 1);
    if (!qa.type) return;
    const w = {
      type: qa.type, from: qa.from || 'ru_south', target: qa.target || 'all',
      count: cnt, spacingSec: Math.max(2, parseInt(qa.spacingSec) || 30), startGH: Math.max(0, parseFloat(qa.startGH) || 0),
      id: 'w' + Date.now() + '_' + Math.floor(Math.random() * 999),
    };
    if (qa.kmh && +qa.kmh > 0) w.kmh = +qa.kmh;            // cruise speed override
    if (qa.terminalKmh && +qa.terminalKmh > 0) w.terminalKmh = +qa.terminalKmh; // terminal override
    setPlanWaves(p => [...p, w]);
  }
  function addPreset(p) { setPlanWaves(prev => [...prev, ...p.rows.map((r, i) => ({ ...r, target: 'all', id: 'p' + p.id + i + Date.now() }))]); }
  function loadScenario(sc) {
    if (mapLocked) return;
    // waves
    setPlanWaves(sc.waves.map((r, i) => ({ ...r, id: 's' + sc.id + i + Date.now() })));
    // place the scenario's own impact targets (so threat directions are well-defined)
    let placedTargets = targetsRef.current;
    if (sc.targets && sc.targets.length) {
      placedTargets = sc.targets.map((t, i) => {
        const tt = TGT_TYPES[t.type] || TGT_TYPES.city;
        return { id: 'T' + (i + 1), lat: t.lat, lng: t.lng, name: t.name || tt.label, type: t.type || 'city', maxHp: tt.hp, valueM: tt.valueM };
      });
      setTargets(placedTargets);
      tSeq.current = placedTargets.length + 1;
    }
    // recommended laydown: ring the first target
    const map = mapRef.current;
    const centre = placedTargets[0] || (capitalsRef.current[0] ? { lat: capitalsRef.current[0].lat, lng: capitalsRef.current[0].lng } : (map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : { lat: 50.45, lng: 30.52 }));
    const n = sc.laydown.length;
    const newBats = sc.laydown.map((type, i) => {
      const ang = (i / n) * 2 * Math.PI;
      const def = allDefs[type] || BATTERY_REAL[type];
      const rKm = Math.min(40, Math.max(8, (def && def.aeroRangeKm ? def.aeroRangeKm * 0.4 : 15)));
      const p = destPoint(centre.lat, centre.lng, (ang * 180 / Math.PI), rKm);
      const seedCan = ENGAGE_CLASSES.map(c => c.key).filter(k => physCapable(def, k));
      return { uid: 'sb' + i + Date.now() + Math.floor(Math.random() * 99), type, lat: p.lat, lng: p.lng, canOverride: seedCan };
    });
    setBatteries(newBats);
    // frame the map on the targets so the user sees the whole picture
    if (map && placedTargets.length) {
      const lats = placedTargets.map(t => t.lat), lngs = placedTargets.map(t => t.lng);
      const pad = 1.4;
      map.fitBounds([[Math.min(...lats) - pad, Math.min(...lngs) - pad], [Math.max(...lats) + pad, Math.max(...lngs) + pad]], { animate: false });
    }
    setReport(null); setMc(null); setShowScenarios(false);
  }

  // ---- Monte-Carlo ----
  // Assemble a portable plan for the pure engine from current state.
  function buildPlan() {
    const ORIGIN_BY_ID = {}; THREAT_ORIGINS.forEach(o => { ORIGIN_BY_ID[o.id] = o; });
    if (launchPoint) ORIGIN_BY_ID.custom_launch = { id: 'custom_launch', label: 'Custom launch point', lat: launchPoint.lat, lng: launchPoint.lng, group: 'CUSTOM' };
    return {
      defs: allDefs, pkProfile, costForType,
      bounds,
      origins: ORIGIN_BY_ID,
      targets: targets.map(t => ({ id: t.id, lat: t.lat, lng: t.lng, name: t.name, type: t.type, maxHp: t.maxHp, valueM: t.valueM })),
      batteries: batteries.map(b => ({ uid: b.uid, type: b.type, lat: b.lat, lng: b.lng, engage: b.engage, canOverride: b.canOverride, defOverride: variantOverride(b), launchers: b.launchers || 1, reactDelaySec: b.reactDelaySec != null ? b.reactDelaySec : defaultReactDelay(b.type), c2DelaySec: b.c2DelaySec != null ? b.c2DelaySec : 0, hp: b.hp, selfDefend: b.selfDefend, selfDefendKm: b.selfDefendKm, patrol: b.patrol })),
      waves: [
        ...matrix.map(r => ({ type: r.type, family: r.family, from: r.from, target: r.target || 'all', count: r.count, spacingSec: r.spacingSec, startGH: r.startGH, kmh: r.kmh, terminalKmh: r.terminalKmh, dmg: r.dmg, maneuver: r.maneuver, gLimit: r.gLimit, mirv: r.mirv, mirvSplitKm: r.mirvSplitKm })),
        ...customRoutes.filter(cr => cr.points && cr.points.length >= 2).map(cr => {
          const meta = resolveThreat ? resolveThreat(cr.type) : { family: 'owa', kmh: 185, dmg: 1 };
          return { type: cr.type, family: meta.family, from: cr.from || 'custom', target: (cr.target && cr.target !== 'manual') ? cr.target : 'all', count: +cr.count || 1, spacingSec: +cr.spacingSec || 30, startGH: +cr.startGH || 0, kmh: meta.kmh, dmg: meta.dmg, maneuver: meta.maneuver, gLimit: meta.gLimit, mirv: meta.mirv, mirvSplitKm: meta.mirvSplitKm, customPoints: cr.points };
        }),
      ],
      env: { season, night, coldStart, centralised, jamming, windKmh, wxPreset, salvoKey },
      weather,
    };
  }

  function runMC() {
    if (!batteries.length || !totalTracks || !targets.length) return;
    setRunning(true); setMc(null); setMcProgress(0);
    const plan = buildPlan();
    const base = (Date.now() & 0x7fffffff) >>> 0;
    const N = 160;                 // enough for tight CIs, ~coarse-dt runs
    const CHUNK = 16;              // seeds per animation frame
    const acc = [];
    let done = 0;
    const step = () => {
      try {
        const seeds = [];
        for (let i = 0; i < CHUNK && done + i < N; i++) seeds.push((base + (done + i) * 2654435761) >>> 0);
        const batch = monteCarloBatch(plan, seeds);
        for (const r of batch) acc.push(r);
        done += seeds.length;
        setMcProgress(Math.round((done / N) * 100));
        if (done < N) { setTimeout(step, 0); return; }
        setMc(summarizeRuns(acc)); setMcSeed(base);
      } catch (e) { console.error(e); }
      setRunning(false); setMcProgress(0);
    };
    setTimeout(step, 20);
  }

  // ---- animated run (step 3): drives the SHARED engine, renders its state ----
  function playAttack() {
    const map = mapRef.current, cv = canvasRef.current; if (!map || !cv || !batteries.length || !totalTracks || !targets.length) return;
    if (!mapLocked) lockMap();
    cancelAnimationFrame(rafRef.current);
    setReport(null);
    sizeCanvas();
    const plan = buildPlan();
    const seed = (Date.now() & 0x7fffffff) >>> 0;
    setRunSeed(seed);
    const sim = initSim(plan, seed);
    sim.lastNow = performance.now();
    simRef.current = sim;
    setLive({ inbound: sim.tracks.length, intercepted: 0, leaked: 0 });
    setPlaying(true);
    const ctx = cv.getContext('2d');
    const PX = (g) => { const p = map.latLngToContainerPoint([g.lat, g.lng]); return { x: p.x, y: p.y }; };
    const stepFn = (now) => {
      const sim = simRef.current; if (!sim) return;
      const baseSp = playSpeedRef.current || 1;
      const dtMs = Math.min(80, now - (sim.lastNow || now)); sim.lastNow = now;
      const flightSec = (dtMs / 1000) * baseSp;   // 1x = real time
      // ===== ENGINE: advance the pure simulation (no rendering inside) =====
      stepSim(sim, flightSec, now);
      const tms = sim.simT;
      // hard cap: ~8h sim-time (long-range Shahed raids can fly 4+ hours; a
      // track still airborne at the cap did NOT reach its target, so it must not
      // be scored as a hit, or the report would show impacts that never happened).
      if (tms > 28800) sim.tracks.forEach(t => { if (!t.done) { t.done = true; t.unresolved = true; } });
      // ===== RENDER: project engine state to the canvas =====
      const kmppNow = kmppRef.current || 1;
      ctx.clearRect(0, 0, cv.width, cv.height);
      sim.bats.forEach(b => {
        const bp = PX(b);
        const reloading = b.reloadUntil && now < b.reloadUntil;
        const hidden = b.engage === false;
        if (b.def.aeroRangeKm > 0) {
          ctx.beginPath(); ctx.arc(bp.x, bp.y, b.def.aeroRangeKm / kmppNow, 0, 7);
          if (b.isFighter) {
            // fighter A2A engagement ring follows the jet as it flies
            ctx.strokeStyle = b.disabled ? 'rgba(127,147,166,0.12)' : (b.ammo <= 0 ? 'rgba(217,165,47,0.16)' : 'rgba(201,155,224,0.22)');
            ctx.setLineDash([4, 5]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = hidden ? 'rgba(120,130,140,0.06)' : reloading ? 'rgba(217,165,47,0.10)' : 'rgba(86,160,224,0.10)';
            ctx.lineWidth = 1; ctx.stroke();
          }
        }
        // moving sensors/fighters: draw the search ring and, for fighters, an
        // aircraft marker at the live position so the patrol is visible in motion.
        if (b.isSensor && b.def.detectKm > 0) {
          ctx.beginPath(); ctx.arc(bp.x, bp.y, b.def.detectKm / kmppNow, 0, 7);
          ctx.strokeStyle = 'rgba(143,208,196,0.10)'; ctx.setLineDash([2, 7]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        }
        if (b.isFighter) {
          // aircraft marker with a velocity vector: the line points in the
          // direction of travel and its length scales with real speed, so faster
          // aircraft visibly show a longer vector. Track last position for heading.
          const dead = b.disabled;
          const prev = b._lastDraw || { lat: b.lat, lng: b.lng };
          const pv = PX(prev);
          let hx = bp.x - pv.x, hy = bp.y - pv.y;
          const hmag = Math.hypot(hx, hy);
          b._lastDraw = { lat: b.lat, lng: b.lng };
          // speed vector length in px: scale km/h so ~1000km/h reads as a clear arrow
          const vLenPx = Math.max(8, Math.min(34, (b.speedKmh || 0) / 1000 * 22));
          const dirx = hmag > 0.5 ? hx / hmag : 1, diry = hmag > 0.5 ? hy / hmag : 0;
          const col2 = dead ? '#7f93a6' : '#c99be0';
          // velocity vector
          if (!dead) {
            ctx.strokeStyle = col2; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.moveTo(bp.x, bp.y); ctx.lineTo(bp.x + dirx * vLenPx, bp.y + diry * vLenPx); ctx.stroke();
            // arrow head
            const ax = bp.x + dirx * vLenPx, ay = bp.y + diry * vLenPx;
            const perpx = -diry, perpy = dirx;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - dirx * 4 + perpx * 3, ay - diry * 4 + perpy * 3); ctx.lineTo(ax - dirx * 4 - perpx * 3, ay - diry * 4 - perpy * 3); ctx.closePath(); ctx.fillStyle = col2; ctx.fill();
            ctx.globalAlpha = 1;
          }
          // aircraft body: a small chevron rotated to heading
          ctx.save(); ctx.translate(bp.x, bp.y); ctx.rotate(Math.atan2(diry, dirx));
          ctx.fillStyle = dead ? '#7f93a6' : '#e3ccf0'; ctx.strokeStyle = '#0a1626'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 3.5); ctx.lineTo(-2, 0); ctx.lineTo(-4, -3.5); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.restore();
          // speed label
          if (!dead && b.speedKmh) { ctx.fillStyle = '#c99be0'; ctx.font = '7px monospace'; ctx.fillText(b.speedKmh + ' km/h', bp.x + 8, bp.y - 6); }
          if (b.ammo <= 0 && !dead) { ctx.fillStyle = '#d9a52f'; ctx.font = '7px monospace'; ctx.fillText('WINCHESTER', bp.x + 8, bp.y + 4); }
        }
      });
      sim.tracks.forEach(tr => {
        if (tms < tr.spawnT) return;
        // finished tracks fade their trail for ~0.8s so nothing vanishes abruptly
        if (tr.done) {
          if (!tr.doneAt) tr.doneAt = now;
          const age = now - tr.doneAt;
          if (age > 800 || !tr.trailGeo || tr.trailGeo.length < 2) return;
          const fade = 1 - age / 800;
          const col = FAM_COL[tr.family] || AMBER;
          ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.5 * fade;
          ctx.beginPath(); tr.trailGeo.forEach((g, i) => { const p = PX(g); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
          ctx.globalAlpha = 1;
          return;
        }
        const px = PX(tr.pos);
        // Track colour by DETECTION: a threat currently held by at least one radar
        // is shown GREEN (the defender has a firing picture); a threat that no
        // radar can see is RED (leaking through undetected). Decoys keep grey.
        const seen = !!tr._detected;
        const col = tr.isDecoy ? '#7f93a6' : (seen ? GREEN : RED);
        const altA = tr.altKey === 'terrain' ? 0.5 : tr.altKey === 'low' ? 0.6 : 0.72;
        ctx.strokeStyle = col; ctx.lineWidth = tr.family === 'ballistic' ? 2 : 1.4; ctx.globalAlpha = altA;
        ctx.beginPath(); tr.trailGeo.forEach((g, i) => { const p = PX(g); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
        ctx.globalAlpha = 1;
        if (tr.isDecoy) { ctx.fillStyle = '#7f93a6'; ctx.beginPath(); ctx.arc(px.x, px.y, 2, 0, 7); ctx.fill(); }
        else drawThreatMarker(ctx, px.x, px.y, tr.heading || 0, col, tr);
      });
      // intercept / impact flashes (engine stores them in geo; fade by wall clock)
      if (!sim._fx) sim._fx = { interc: [], hits: [] };
      while (sim.intercepts.length) { const p = sim.intercepts.shift(); sim._fx.interc.push({ ...p, t: now }); }
      while (sim.hits.length) { const p = sim.hits.shift(); sim._fx.hits.push({ ...p, t: now }); }
      sim._fx.interc = sim._fx.interc.filter(f => now - f.t < 520);
      sim._fx.interc.forEach(f => { const a = 1 - (now - f.t) / 520; const p = PX(f); ctx.strokeStyle = GREEN; ctx.globalAlpha = a; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (1 - a) * 12, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; });
      sim._fx.hits = sim._fx.hits.filter(f => now - f.t < 700);
      sim._fx.hits.forEach(f => { const a = 1 - (now - f.t) / 700; const p = PX(f); ctx.fillStyle = RED; ctx.globalAlpha = a * 0.8; ctx.beginPath(); ctx.arc(p.x, p.y, 3 + (1 - a) * 16, 0, 7); ctx.fill(); ctx.globalAlpha = 1; });
      const interc = sim.tracks.filter(t => t.deadCounted).length;
      const leak = sim.tracks.filter(t => t.leakCounted).length;
      if (!sim.lastBatDraw || now - sim.lastBatDraw > 500) {
        sim.lastBatDraw = now;
        try { drawBatteries(); } catch (e) {}
        const am = {}; sim.bats.forEach(b => { am[b.uid] = { ammo: b.ammo, reloadUntil: b.reloadUntil, shots: b.shots, kills: b.kills, disabled: b.disabled, hp: b.hp, maxHp: b.maxHp, hitsTaken: b.hitsTaken }; });
        setLiveAmmo(am);
      }
      setLive({ inbound: sim.tracks.length - interc - leak, intercepted: interc, leaked: leak, transit: baseSp > 1 ? baseSp : 0, spentM: sim.spentM, killedM: sim.killedM, dmgM: sim.dmgM });
      if (sim.tracks.every(t => t.done) && tms > 400) { setPlaying(false); buildReport(sim, tms); return; }
      rafRef.current = requestAnimationFrame(stepFn);
    };
    rafRef.current = requestAnimationFrame(stepFn);
  }
  function stopAttack() {
    cancelAnimationFrame(rafRef.current); setPlaying(false);
    const sim = simRef.current;
    if (sim) buildReport(sim, sim.simT, true);
    const cv = canvasRef.current; if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }
  function buildReport(sim, tms, aborted) {
    const byFam = {};
    sim.tracks.forEach(t => {
      const f = t.family; byFam[f] = byFam[f] || { total: 0, killed: 0, leaked: 0 };
      byFam[f].total++;
      if (t.deadCounted) byFam[f].killed++;
      if (t.leakCounted) byFam[f].leaked++;
    });
    const shots = {}; const kills = {}; const spendBySys = {};
    sim.bats.forEach(b => {
      const key = allDefs[b.type] ? (allDefs[b.type].tag || allDefs[b.type].name) : b.type;
      if (b.shots) { shots[key] = (shots[key] || 0) + b.shots; spendBySys[key] = (spendBySys[key] || 0) + b.shots * (b.costM || 0); }
      if (b.kills) kills[key] = (kills[key] || 0) + b.kills;
    });
    const total = sim.tracks.length, killed = sim.tracks.filter(t => t.deadCounted).length, leaked = sim.tracks.filter(t => t.leakCounted).length;
    const unresolved = sim.tracks.filter(t => t.unresolved).length;
    const spentM = sim.spentM || 0, killedM = sim.killedM || 0, dmgM = sim.dmgM || 0;
    const targetStatus = Object.entries(sim.tgtState || {}).map(([id, t]) => ({ id, name: t.name, type: t.type, hp: t.hp, maxHp: t.maxHp, hits: t.hits, dmgM: t.dmgM }));
    const decoys = sim.tracks.filter(t => t.isDecoy).length;
    const realThreats = total - decoys;
    const realLeaked = sim.tracks.filter(t => t.isDecoy === false && t.leakCounted).length;
    const realUnresolved = sim.tracks.filter(t => t.isDecoy === false && t.unresolved).length;
    const resolvedReal = Math.max(1, realThreats - realUnresolved);
    setReport({
      aborted: !!aborted, total, killed, leaked, unresolved, decoys, realThreats, realLeaked,
      rate: total ? killed / total : 0,
      protect: 1 - realLeaked / resolvedReal,
      byFam, shots, kills, spendBySys,
      miss: sim.miss || {},
      env: { season: (sim.seasonObj || {}).key, tempC: (sim.seasonObj || {}).tempC, icing: (sim.seasonObj || {}).icing, coldStart: sim.env.coldStart, centralised: sim.env.centralised, jamming: sim.env.jamming, night: sim.env.night },
      finance: { spentM, killedM, dmgM, exchange: spentM > 0 ? killedM / spentM : 0, perKillM: killed > 0 ? spentM / killed : 0, net: killedM - spentM - dmgM },
      targetStatus,
      batteries: batteries.length, targetCount: targets.length, capitalCount: capitals.length,
      adSites: { total: sim.bats.filter(b => !b.isEW).length, destroyed: sim.bats.filter(b => b.disabled).length, list: sim.bats.filter(b => b.disabled).map(b => (b.def.tag || b.def.name)) },
      seed: runSeed,
      weather: { preset: wxPreset, windKmh, night }, salvo: salvoKey, simSec: Math.round(tms / 1000),
    });
    setShowFinal(true);
  }
  function exportReport() {
    if (!report) return;
    const data = { tool: 'SKYWATCH OPERATIONAL PLAN', classification: 'PUBLIC // OPEN-SOURCE, ILLUSTRATIVE, NOT VALIDATED OA', when: new Date().toISOString(), matrix: matrix.map(r => ({ type: r.type, family: r.family, from: r.from, count: r.count, startGH: r.startGH, kmh: r.kmh })), report, monteCarlo: mc || null };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `skywatch_operational_report_${Date.now()}.json`; a.click();
  }


  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: '#0a1626', display: 'flex', flexDirection: 'column' }}>
      {showFinal && report && <FinalReport report={report} onClose={() => setShowFinal(false)} onExport={exportReport} />}
      {showCountries && (
        <div onClick={() => setShowCountries(false)} style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(4,10,18,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 96vw)', maxHeight: '86vh', overflow: 'hidden', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 6, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #243d52' }}>
              <span className="f-display" style={{ fontSize: 14, color: '#fff', letterSpacing: '0.04em' }}>SELECT COUNTRIES TO MODEL</span>
              <button onClick={() => setShowCountries(false)} className="f-mono" style={{ fontSize: 11, padding: '4px 10px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: TEXT, cursor: 'pointer' }}>DONE</button>
            </div>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #243d52', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={countrySearch} onChange={e => setCountrySearch(e.target.value)} placeholder="Search country or capital…" className="f-mono" style={{ flex: 1, minWidth: 160, fontSize: 11, padding: '6px 8px', background: '#0a1626', border: '1px solid #34516b', borderRadius: 3, color: '#fff' }} />
              <button onClick={() => setCapCodes(NATO_COUNTRIES.filter(c => c.euCore).map(c => c.code))} className="f-mono" style={{ fontSize: 9, padding: '5px 9px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: BLUE, cursor: 'pointer' }}>EUROPE</button>
              <button onClick={() => setCapCodes(NATO_COUNTRIES.map(c => c.code))} className="f-mono" style={{ fontSize: 9, padding: '5px 9px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: TEXT, cursor: 'pointer' }}>ALL</button>
              <button onClick={() => setCapCodes([])} className="f-mono" style={{ fontSize: 9, padding: '5px 9px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: MUT, cursor: 'pointer' }}>NONE</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {NATO_COUNTRIES.filter(c => { const q = countrySearch.toLowerCase(); return !q || c.name.toLowerCase().includes(q) || c.capital.toLowerCase().includes(q); }).map(c => {
                  const on = capCodes.includes(c.code);
                  return (
                    <button key={c.code} onClick={() => setCapCodes(p => on ? p.filter(x => x !== c.code) : [...p, c.code])} className="f-mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '5px 7px', textAlign: 'left', border: `1px solid ${on ? BLUE : '#243d52'}`, borderRadius: 3, background: on ? 'rgba(47,128,214,0.16)' : 'transparent', color: on ? '#fff' : TEXT, cursor: 'pointer' }}>
                      <span style={{ width: 12, color: on ? GREEN : '#33485c' }}>{on ? '✓' : ''}</span>
                      <span>{c.name}<br /><span style={{ color: MUT, fontSize: 8 }}>{c.capital}</span></span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="f-mono" style={{ fontSize: 8, color: MUT, padding: '8px 16px', borderTop: '1px solid #243d52' }}>{capCodes.length} selected. The map fits to these and marks their capitals. Pick a whole region (e.g. EUROPE) to model attacks across the continent.</div>
          </div>
        </div>
      )}
      {showScenarios && (
        <div onClick={() => setShowScenarios(false)} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(6,14,24,0.84)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(780px, 96vw)', maxHeight: '90vh', overflowY: 'auto', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 6 }}>
            <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderBottom: '1px solid #243d52' }}>
              <span className="f-display" style={{ fontSize: 18, color: BLUE, letterSpacing: '0.04em' }}>SCENARIO LIBRARY</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={saveCurrentScenario} disabled={mapLocked} className="f-mono" style={{ fontSize: 11, padding: '6px 12px', border: `1px solid ${mapLocked ? '#243d52' : GREEN}`, borderRadius: 3, background: mapLocked ? '#16293c' : 'rgba(79,157,119,0.14)', color: mapLocked ? MUT : GREEN, cursor: mapLocked ? 'not-allowed' : 'pointer' }}>+ SAVE CURRENT PLAN</button>
                <label className="f-mono" style={{ fontSize: 11, padding: '6px 12px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: TEXT, cursor: 'pointer' }}>
                  IMPORT<input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) importScenarioFile(e.target.files[0]); e.target.value = ''; }} />
                </label>
                <button onClick={() => setShowScenarios(false)} className="btn-riso btn-alt" style={{ padding: '6px 12px', fontSize: 11 }}>CLOSE</button>
              </div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 16, padding: '10px 12px', border: '1px solid #243d52', borderRadius: 4, background: '#0a1626' }}>
                <span className="f-mono" style={{ fontSize: 9, color: '#56a0e0', width: '100%', marginBottom: 2 }}>LIBRARIES &amp; PACKAGES (share with other operators)</span>
                <button onClick={exportLibrary} className="f-mono" style={{ fontSize: 10, padding: '5px 10px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: TEXT, cursor: 'pointer' }}>↓ EXPORT LIBRARY</button>
                <label className="f-mono" style={{ fontSize: 10, padding: '5px 10px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: TEXT, cursor: 'pointer' }}>
                  ↑ IMPORT LIBRARY<input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) importLibraryFile(e.target.files[0]); e.target.value = ''; }} />
                </label>
                <span style={{ width: 1, height: 18, background: '#243d52', margin: '0 3px' }} />
                <button onClick={exportPackage} className="f-mono" style={{ fontSize: 10, padding: '5px 10px', border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.12)', color: '#fff', cursor: 'pointer' }}>↓ EXPORT FULL PACKAGE</button>
                <label className="f-mono" style={{ fontSize: 10, padding: '5px 10px', border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.12)', color: '#fff', cursor: 'pointer' }}>
                  ↑ IMPORT PACKAGE<input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) importPackageFile(e.target.files[0]); e.target.value = ''; }} />
                </label>
                <span className="f-mono" style={{ fontSize: 8, color: MUT, width: '100%', marginTop: 3, lineHeight: 1.4 }}>Library = your defence systems and their coefficients. Package = library plus every saved scenario, as one file. {Object.keys(libDefs).length} custom systems, {savedScenarios.length} scenarios stored.</span>
              </div>
              {mapLocked && <div className="f-mono" style={{ fontSize: 9, color: AMBER, marginBottom: 10 }}>Unlock the map to load or save scenarios.</div>}
              <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 10 }}>READY SITUATIONS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
                {SCENARIOS.map(sc => (
                  <div key={sc.id} style={{ border: '1px solid #243d52', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div className="f-display" style={{ fontSize: 12, color: '#56a0e0', marginBottom: 3 }}>{sc.name}</div>
                      <div className="f-mono" style={{ fontSize: 8, color: MUT, lineHeight: 1.45, marginBottom: 6 }}>{sc.desc}</div>
                    </div>
                    <button onClick={() => loadScenario(sc)} disabled={mapLocked} className="f-mono" style={{ fontSize: 10, padding: '5px', border: `1px solid ${mapLocked ? '#243d52' : BLUE}`, borderRadius: 3, background: mapLocked ? '#16293c' : 'rgba(47,128,214,0.14)', color: mapLocked ? MUT : '#fff', cursor: mapLocked ? 'not-allowed' : 'pointer' }}>LOAD</button>
                  </div>
                ))}
              </div>
              <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 10 }}>SAVED SCENARIOS ({savedScenarios.length})</div>
              {savedScenarios.length === 0 ? (
                <div className="f-mono" style={{ fontSize: 9, color: MUT }}>No saved scenarios yet. Build a plan (region, targets, batteries, waves, conditions) and press SAVE CURRENT PLAN. Scenarios are stored in this browser and can be exported to a file to share.</div>
              ) : (
                savedScenarios.map(sc => (
                  <div key={sc.id} style={{ border: '1px solid #243d52', borderRadius: 4, padding: '7px 10px', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ overflow: 'hidden' }}>
                      <div className="f-display" style={{ fontSize: 12, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sc.name}</div>
                      <div className="f-mono" style={{ fontSize: 8, color: MUT }}>{(sc.batteries || []).length} batteries · {(sc.targets || []).length} targets · {(sc.planWaves || []).length} waves{sc.saved ? ' · ' + new Date(sc.saved).toLocaleDateString() : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                      <button onClick={() => applyScenario(sc)} disabled={mapLocked} className="f-mono" style={{ fontSize: 9, padding: '4px 10px', border: `1px solid ${mapLocked ? '#243d52' : BLUE}`, borderRadius: 3, background: mapLocked ? '#16293c' : 'rgba(47,128,214,0.14)', color: mapLocked ? MUT : '#fff', cursor: mapLocked ? 'not-allowed' : 'pointer' }}>LOAD</button>
                      <button onClick={() => exportScenario(sc)} className="f-mono" style={{ fontSize: 9, padding: '4px 8px', border: '1px solid #34516b', borderRadius: 3, background: 'transparent', color: MUT, cursor: 'pointer' }}>↓</button>
                      <button onClick={() => deleteSaved(sc.id)} className="f-mono" style={{ fontSize: 9, padding: '4px 8px', border: '1px solid #243d52', borderRadius: 3, background: 'transparent', color: RED, cursor: 'pointer' }}>×</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #243d52', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="f-display" style={{ fontSize: 20, color: BLUE, letterSpacing: '0.04em' }}>OPERATIONAL PLAN</span>
          <span className="f-mono" style={{ fontSize: 9, padding: '4px 10px', borderRadius: 3, border: `1px solid ${playing ? RED : mapLocked ? AMBER : '#243d52'}`, background: playing ? 'rgba(210,74,68,0.14)' : mapLocked ? 'rgba(217,165,47,0.12)' : 'transparent', color: playing ? '#e0726b' : mapLocked ? AMBER : MUT, letterSpacing: '0.05em' }}>
            {playing ? '● RUNNING' : mapLocked ? '◆ LOCKED – ready to run' : '✎ PLANNING'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {!mapLocked
            ? <button onClick={lockMap} className="f-mono" style={btn(AMBER)}>LOCK MAP + RINGS</button>
            : <button onClick={() => { if (playing) stopAttack(); unlockMap(); }} className="f-mono" style={btn(MUT)}>‹ BACK TO PLANNING</button>}
          {!mapLocked && (targets.length > 0 || batteries.length > 0 || planWaves.length > 0 || customRoutes.length > 0) && (
            <button onClick={() => { if (window.confirm('Clear all targets, batteries and attack waves? This cannot be undone.')) { setTargets([]); setBatteries([]); setPlanWaves([]); setCustomRoutes([]); setLaunchPoint(null); setReport(null); setMc(null); } }} className="f-mono" style={btn(RED)}>RESET</button>
          )}
          <button onClick={onClose} className="btn-riso btn-alt" style={{ padding: '7px 14px', fontSize: 12 }}>‹ MENU</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ---- left rail (DEFENCE): region + batteries + environment ---- */}
        <div style={{ width: 286, borderRight: '1px solid #243d52', overflowY: 'auto', padding: 12, background: '#0c1c2e' }}>
          <div className="f-display" style={{ fontSize: 12, color: BLUE, letterSpacing: '0.08em', padding: '4px 8px', marginBottom: 10, border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.10)', textAlign: 'center' }}>◆ DEFENCE PLANNING</div>
          <Section title="1 · REGION / COUNTRIES">
            <button onClick={() => setShowCountries(true)} className="f-mono" style={{ width: '100%', fontSize: 10, padding: '7px', border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.12)', color: '#fff', cursor: 'pointer', textAlign: 'left' }}>
              ▸ SELECT COUNTRIES ({capCodes.length})
            </button>
            {capitals.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                {capitals.map(c => (
                  <span key={c.code} className="f-mono" style={{ fontSize: 8, padding: '2px 6px', borderRadius: 10, border: '1px solid #243d52', background: '#0a1626', color: TEXT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {c.code} · {c.capital}
                    <button onClick={() => setCapCodes(p => p.filter(x => x !== c.code))} disabled={mapLocked} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 9, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="f-mono" style={{ fontSize: 8, color: MUT, marginTop: 6, lineHeight: 1.4 }}>Selected countries set the map view (the map fits to them) and mark their capitals. Add as many as you like to model the whole region.</div>
          </Section>
          <Section title="2 · TARGETS TO DEFEND (click map)">
            <div className="f-mono" style={{ fontSize: 9, color: AMBER, marginBottom: 6, lineHeight: 1.4 }}>
              These are the points you are defending. Click the map to drop one, or add your capitals. The enemy will aim at these.
            </div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
              {Object.entries(TGT_TYPES).map(([k, t]) => (
                <button key={k} onClick={() => { setTgtType(k); setPlaceKind('target'); }} className="f-mono" style={{ fontSize: 8, padding: '3px 6px', borderRadius: 3, border: `1px solid ${tgtType === k && placeKind === 'target' ? AMBER : '#243d52'}`, background: tgtType === k && placeKind === 'target' ? 'rgba(217,165,47,0.16)' : 'transparent', color: tgtType === k && placeKind === 'target' ? '#fff' : MUT, cursor: 'pointer' }}>{t.code} · {t.label}</button>
              ))}
            </div>
            <div className="f-mono" style={{ fontSize: 8, color: placeKind === 'target' ? GREEN : MUT, marginBottom: 6 }}>
              {placeKind === 'target' ? '▶ CLICK THE MAP to place a ' + ((TGT_TYPES[tgtType] || {}).label || 'target') : 'Pick a target type above, then click the map.'}
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <button onClick={() => { if (mapLocked) return; setPlaceKind('target'); setTargets(prev => { const have = new Set(prev.map(p => p.cap)); const add = capitals.filter(c => !have.has(c.code)).map(c => ({ id: 'T' + (tSeq.current++), lat: c.lat, lng: c.lng, name: c.capital, cap: c.code, type: 'city', maxHp: TGT_TYPES.city.hp, valueM: TGT_TYPES.city.valueM })); return [...prev, ...add]; }); }}
                className="f-mono" style={{ flex: 1, fontSize: 9, padding: '5px', border: '1px solid #243d52', borderRadius: 3, background: 'transparent', color: AMBER, cursor: 'pointer' }}>+ ADD MY CAPITALS</button>
              <button onClick={() => { if (!mapLocked) setTargets([]); }} className="f-mono" style={{ fontSize: 9, padding: '5px 8px', border: '1px solid #243d52', borderRadius: 3, background: 'transparent', color: MUT, cursor: 'pointer' }}>CLEAR</button>
            </div>
            {targets.length > 0 && (
              <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid #243d52', borderRadius: 3 }}>
                {targets.map(t => (
                  <div key={t.id} className="f-mono" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: TEXT, padding: '3px 6px', borderBottom: '1px solid #16293c' }}>
                    <span><span style={{ color: AMBER }}>{t.id}</span> {(TGT_TYPES[t.type] || {}).code || ''} {t.name}</span>
                    <button onClick={() => { if (!mapLocked) setTargets(prev => prev.filter(x => x.id !== t.id)); }} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 11 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="f-mono" style={{ fontSize: 9, color: targets.length ? GREEN : AMBER, marginTop: 5 }}>{targets.length ? targets.length + ' target(s) set ✓' : 'No targets yet – place at least one.'}</div>
          </Section>

          <Section title="3 · AIR DEFENCE – SAM / GUNS / C-UAS (ППО)">
            <div className="f-mono" style={{ fontSize: 8, color: placeKind === 'battery' ? GREEN : MUT, marginBottom: 5 }}>
              {placeKind === 'battery' ? '▶ CLICK THE MAP to place ' + ((allDefs[placeMode] || {}).tag || (allDefs[placeMode] || {}).name || 'a battery') : 'Pick a system, then click the map. Fighters, radars and EW are in their own sections below.'}
            </div>
            <div className="f-mono" style={{ fontSize: 8, color: '#56a0e0', marginBottom: 3 }}>QUICK SYSTEMS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, opacity: mapLocked ? 0.5 : 1, pointerEvents: mapLocked ? 'none' : 'auto' }}>
              {Object.values(allDefs).filter(b => !b.isFighter && !b.isSensor && !b.isEW && !/^lib_/.test(b.id)).map(b => (
                <button key={b.id} onClick={() => { setPlaceKind('battery'); setPlaceMode(b.id); }} className="f-mono"
                  style={{ fontSize: 10, padding: '6px 4px', textAlign: 'left', border: `1px solid ${placeMode === b.id && placeKind === 'battery' ? BLUE : '#243d52'}`, borderRadius: 3, background: placeMode === b.id && placeKind === 'battery' ? 'rgba(47,128,214,0.16)' : 'transparent', color: placeMode === b.id && placeKind === 'battery' ? '#fff' : TEXT, cursor: 'pointer' }}>
                  {b.tag || b.name}<br /><span style={{ color: MUT }}>{b.aeroRangeKm > 0 ? b.aeroRangeKm + 'km' : 'EW'}{b.tbmFootprintKm > 0 ? ' +ABM' : ''}</span>
                </button>
              ))}
            </div>
            {(() => {
              const adCats = [{ key: 'SAM', label: 'SAM' }, { key: 'MANPADS', label: 'MANPADS' }, { key: 'GUN_LASER', label: 'Guns/Laser' }, { key: 'INTERCEPTOR', label: 'Interceptors' }];
              const inCat = libOptions.filter(e => e.cat === libCat);
              return (
                <div style={{ marginTop: 8, opacity: mapLocked ? 0.5 : 1, pointerEvents: mapLocked ? 'none' : 'auto' }}>
                  <div className="f-mono" style={{ fontSize: 9, color: '#56a0e0', marginBottom: 3 }}>FULL LIBRARY BY CATEGORY</div>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
                    {adCats.map(c => {
                      const n = libOptions.filter(e => e.cat === c.key).length;
                      const on = libCat === c.key;
                      return <button key={c.key} onClick={() => setLibCat(c.key)} className="f-mono" style={{ fontSize: 8, padding: '3px 7px', borderRadius: 3, border: `1px solid ${on ? BLUE : '#243d52'}`, background: on ? 'rgba(47,128,214,0.16)' : 'transparent', color: on ? '#fff' : MUT, cursor: 'pointer' }}>{c.label} ({n})</button>;
                    })}
                  </div>
                  <select disabled={mapLocked} className="f-mono" value=""
                    onChange={e => { addFromLibrary(e.target.value); e.target.value = ''; }}
                    style={{ width: '100%', fontSize: 10, padding: '5px 4px', background: '#0a1626', border: '1px solid #243d52', color: TEXT, borderRadius: 3 }}>
                    <option value="" disabled>Pick a {libCat} system… ({inCat.length})</option>
                    {inCat.map(e => <option key={e.idx} value={e.idx}>{e.name} ({e.country}) · {e.rangeKm}km</option>)}
                  </select>
                </div>
              );
            })()}
            <div className="f-mono" style={{ fontSize: 9, color: MUT, marginTop: 6 }}>{batteries.filter(b => { const d = allDefs[b.type] || {}; return !d.isFighter && !d.isSensor && !d.isEW; }).length} AD systems placed. Library systems get a derived operational profile.</div>
            {batteries.length > 0 && (
              <div style={{ marginTop: 8, border: '1px solid #243d52', borderRadius: 3 }}>
                <div className="f-mono" style={{ fontSize: 8, color: MUT, padding: '4px 6px', background: '#16293c' }}>
                  PLACED SYSTEMS · DEFAULTS SET (UA DOCTRINE) · TAP A CLASS TO CHANGE
                </div>
                {batteries.map((b, i) => {
                  const def = allDefs[b.type] || {};
                  if (def.isFighter || def.isSensor || def.isEW) return null; // shown in their own sections
                  const allowed = effectiveCan(b, def);
                  const on = b.engage !== false;
                  return (
                    <div key={b.uid} style={{ padding: '5px 6px', borderTop: '1px solid #16293c' }}>
                      <div className="f-mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 3 }}>
                        <span className="f-mono" style={{ fontSize: 9, color: batColor(b.type), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.tag || def.name} <span style={{ color: MUT }}>{def.aeroRangeKm > 0 ? def.aeroRangeKm + 'km' : 'EW'}{def.tbmFootprintKm > 0 ? '+ABM' : ''}</span></span>
                        <span style={{ display: 'flex', gap: 3, flex: 'none' }}>
                          <button onClick={() => setBatteries(prev => prev.map((x, j) => j === i ? { ...x, engage: !(x.engage !== false) } : x))}
                            style={{ fontSize: 8, padding: '2px 7px', borderRadius: 3, border: `1px solid ${on ? GREEN : '#7a4444'}`, background: on ? 'rgba(79,157,119,0.18)' : 'rgba(210,74,68,0.12)', color: on ? GREEN : '#e09a9a', cursor: 'pointer' }}>{on ? 'ENGAGE' : 'HOLD'}</button>
                          <button onClick={() => setBatteries(prev => prev.filter((_, j) => j !== i))} disabled={mapLocked} style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, border: '1px solid #243d52', background: 'transparent', color: RED, cursor: mapLocked ? 'not-allowed' : 'pointer' }}>×</button>
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {ENGAGE_CLASSES.map(c => {
                          const phys = physCapable(def, c.key); // can it ever do this physically?
                          const sel = allowed.includes(c.key);
                          return (
                            <button key={c.key} disabled={!phys}
                              onClick={() => toggleCan(i, b, def, c.key)}
                              title={phys ? (sel ? 'Allowed – tap to deny' : 'Denied – tap to allow') : 'Not physically capable'}
                              style={{ fontSize: 7.5, padding: '2px 5px', borderRadius: 3, cursor: phys ? 'pointer' : 'not-allowed',
                                border: `1px solid ${!phys ? '#1a2c3e' : sel ? c.col : '#34516b'}`,
                                background: !phys ? 'transparent' : sel ? c.bg : 'transparent',
                                color: !phys ? '#33485c' : sel ? c.col : MUT, opacity: phys ? 1 : 0.5 }}>{c.short}</button>
                          );
                        })}
                      </div>
                      {/* launchers + missile type (bound to the library variants) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                        <span className="f-mono" style={{ fontSize: 8, color: MUT }}>LAUNCHERS</span>
                        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #34516b', borderRadius: 3 }}>
                          <button onClick={() => setBatteries(prev => prev.map((x, j) => j === i ? { ...x, launchers: Math.max(1, (x.launchers || 1) - 1) } : x))} style={{ fontSize: 11, padding: '0 6px', background: 'transparent', border: 'none', color: TEXT, cursor: 'pointer' }}>−</button>
                          <span className="f-mono" style={{ fontSize: 10, color: '#fff', minWidth: 14, textAlign: 'center' }}>{b.launchers || 1}</span>
                          <button onClick={() => setBatteries(prev => prev.map((x, j) => j === i ? { ...x, launchers: Math.min(12, (x.launchers || 1) + 1) } : x))} style={{ fontSize: 11, padding: '0 6px', background: 'transparent', border: 'none', color: TEXT, cursor: 'pointer' }}>+</button>
                        </div>
                        {(def.rounds) ? <span className="f-mono" style={{ fontSize: 8, color: '#5d6b7a' }}>= {(def.rounds * (b.launchers || 1))} rounds · {b.launchers || 1} ch</span> : <span className="f-mono" style={{ fontSize: 8, color: '#5d6b7a' }}>guns</span>}
                      </div>
                      {BATTERY_VARIANTS[b.type] && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                          <span className="f-mono" style={{ fontSize: 8, color: MUT }}>MISSILE</span>
                          <select value={b.variant || BATTERY_VARIANTS[b.type][0].id}
                            onChange={e => setBatteries(prev => prev.map((x, j) => j === i ? { ...x, variant: e.target.value } : x))}
                            style={{ flex: 1, fontSize: 9, padding: '2px', background: '#0a1626', border: '1px solid #34516b', borderRadius: 3, color: '#fff' }}>
                            {BATTERY_VARIANTS[b.type].map(v => <option key={v.id} value={v.id}>{v.name} · {v.aeroRangeKm}km{v.tbmFootprintKm > 0 ? ' ABM' + v.tbmFootprintKm : ''}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', padding: '4px 6px', borderTop: '1px solid #16293c', lineHeight: 1.45 }}>Ukrainian practice: MANPADS take Shahed and cruise; interceptor drone teams hunt OWA; guns cover low drones. Greyed classes are physically impossible (e.g. Gepard vs ballistic). HOLD a system to reserve it (e.g. Patriot for ballistic only).</div>
              </div>
            )}
          </Section>

          <Section title="4 · AIR PATROL – FIGHTERS (авіація)">
            <div className="f-mono" style={{ fontSize: 8, color: '#c99be0', marginBottom: 6, lineHeight: 1.4 }}>
              Combat air patrol. Fighters fly a patrol route you draw and engage cruise missiles and drones inside their air-to-air reach (never ballistic). When a fighter detects a threat it turns to intercept; its engagement radius travels with it. Speeds and ranges are real-world open-source values.
            </div>
            <div className="f-mono" style={{ fontSize: 8, color: placeKind === 'battery' && (allDefs[placeMode] || {}).isFighter && !(allDefs[placeMode] || {}).isSensor ? '#c99be0' : MUT, marginBottom: 5 }}>
              {placeKind === 'battery' && (allDefs[placeMode] || {}).isFighter && !(allDefs[placeMode] || {}).isSensor ? '▶ CLICK THE MAP to place ' + ((allDefs[placeMode] || {}).tag || (allDefs[placeMode] || {}).name) + ', then draw its patrol' : 'Pick a fighter below, place it, then draw its patrol route.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, opacity: mapLocked ? 0.5 : 1, pointerEvents: mapLocked ? 'none' : 'auto' }}>
              {Object.values(allDefs).filter(b => b.isFighter && !b.isSensor).map(b => {
                const sel = placeMode === b.id && placeKind === 'battery';
                return (
                  <button key={b.id} onClick={() => { setPlaceKind('battery'); setPlaceMode(b.id); }} className="f-mono"
                    style={{ fontSize: 10, padding: '6px 5px', textAlign: 'left', border: `1px solid ${sel ? '#c99be0' : '#243d52'}`, borderRadius: 3, background: sel ? 'rgba(201,155,224,0.16)' : 'transparent', color: sel ? '#fff' : TEXT, cursor: 'pointer' }}>
                    {b.tag || b.name}<br /><span style={{ color: MUT, fontSize: 8 }}>{b.speedKmh} km/h · A2A {b.aeroRangeKm} km · {b.rounds} msl</span>
                  </button>
                );
              })}
            </div>
            {batteries.filter(b => { const d = allDefs[b.type] || {}; return d.isFighter && !d.isSensor; }).length > 0 && (
              <div style={{ marginTop: 8, border: '1px solid #243d52', borderRadius: 3 }}>
                <div className="f-mono" style={{ fontSize: 8, color: MUT, padding: '4px 6px', background: '#16293c' }}>FIGHTERS · DRAW EACH ONE A PATROL</div>
                {batteries.filter(b => { const d = allDefs[b.type] || {}; return d.isFighter && !d.isSensor; }).map(b => {
                  const def = allDefs[b.type] || {};
                  const np = (b.patrol || []).length;
                  const drawing = placeKind === 'patrol' && patrolFor === b.uid;
                  return (
                    <div key={b.uid} style={{ padding: '5px 6px', borderTop: '1px solid #16293c' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="f-mono" style={{ fontSize: 9, color: '#c99be0' }}>{def.tag || def.name}</span>
                        <span className="f-mono" style={{ fontSize: 8, color: MUT }}>{def.speedKmh} km/h · {np > 0 ? np + ' patrol pts' : 'no route'}</span>
                        <button onClick={() => { setBatteries(prev => prev.filter(x => x.uid !== b.uid)); if (selBat === b.uid) setSelBat(null); if (patrolFor === b.uid) { setPatrolFor(null); setPlaceKind('none'); } }} className="f-mono" style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 7px', border: `1px solid ${RED}`, borderRadius: 3, background: 'transparent', color: '#e09a9a', cursor: 'pointer' }}>×</button>
                      </div>
                      {!mapLocked && (
                        <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                          <button onClick={() => { if (drawing) { setPlaceKind('none'); setPatrolFor(null); } else { setPatrolFor(b.uid); setPlaceKind('patrol'); } }} className="f-mono" style={{ fontSize: 9, padding: '3px 9px', borderRadius: 3, border: `1px solid ${drawing ? '#c99be0' : '#34516b'}`, background: drawing ? 'rgba(201,155,224,0.2)' : 'transparent', color: drawing ? '#fff' : '#c99be0', cursor: 'pointer' }}>{drawing ? '▶ CLICK MAP TO ADD' : (np > 0 ? 'EDIT PATROL' : 'DRAW PATROL')}</button>
                          {np > 0 && <button onClick={() => setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, patrol: (x.patrol || []).slice(0, -1) } : x))} className="f-mono" style={{ fontSize: 9, padding: '3px 8px', borderRadius: 3, border: '1px solid #34516b', background: 'transparent', color: MUT, cursor: 'pointer' }}>UNDO</button>}
                          {np > 0 && <button onClick={() => setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, patrol: [] } : x))} className="f-mono" style={{ fontSize: 9, padding: '3px 8px', borderRadius: 3, border: '1px solid #34516b', background: 'transparent', color: '#e09a9a', cursor: 'pointer' }}>CLEAR</button>}
                        </div>
                      )}
                      {np === 0 && <div className="f-mono" style={{ fontSize: 8, color: AMBER, marginTop: 4 }}>Needs a patrol route to fly. Press DRAW PATROL.</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="5 · RADARS & AWACS (радари)">
            <div className="f-mono" style={{ fontSize: 8, color: '#8fd0c4', marginBottom: 6, lineHeight: 1.4 }}>
              Dedicated sensors detect threats but never fire. They extend the picture so more threats show GREEN (seen) instead of RED (leaking through unseen). AWACS is airborne and sees low movers far out.
            </div>
            <div className="f-mono" style={{ fontSize: 8, color: placeKind === 'battery' && (allDefs[placeMode] || {}).isSensor ? '#8fd0c4' : MUT, marginBottom: 5 }}>
              {placeKind === 'battery' && (allDefs[placeMode] || {}).isSensor ? '▶ CLICK THE MAP to place ' + ((allDefs[placeMode] || {}).tag || (allDefs[placeMode] || {}).name) : 'Pick a sensor below, then click the map.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, opacity: mapLocked ? 0.5 : 1, pointerEvents: mapLocked ? 'none' : 'auto' }}>
              {Object.values(allDefs).filter(b => b.isSensor).map(b => {
                const sel = placeMode === b.id && placeKind === 'battery';
                return (
                  <button key={b.id} onClick={() => { setPlaceKind('battery'); setPlaceMode(b.id); }} className="f-mono"
                    style={{ fontSize: 10, padding: '6px 5px', textAlign: 'left', border: `1px solid ${sel ? '#8fd0c4' : '#243d52'}`, borderRadius: 3, background: sel ? 'rgba(143,208,196,0.16)' : 'transparent', color: sel ? '#fff' : TEXT, cursor: 'pointer' }}>
                    {b.tag || b.name}<br /><span style={{ color: MUT, fontSize: 8 }}>radar {b.detectKm} km{b.speedKmh ? ' · ' + b.speedKmh + ' km/h' : ''}</span>
                  </button>
                );
              })}
            </div>
            {batteries.filter(b => (allDefs[b.type] || {}).isSensor).length > 0 && (
              <div style={{ marginTop: 8, border: '1px solid #243d52', borderRadius: 3 }}>
                <div className="f-mono" style={{ fontSize: 8, color: MUT, padding: '4px 6px', background: '#16293c' }}>SENSORS PLACED</div>
                {batteries.filter(b => (allDefs[b.type] || {}).isSensor).map(b => {
                  const def = allDefs[b.type] || {};
                  return (
                    <div key={b.uid} style={{ padding: '5px 6px', borderTop: '1px solid #16293c', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="f-mono" style={{ fontSize: 9, color: '#8fd0c4' }}>{def.tag || def.name}</span>
                      <span className="f-mono" style={{ fontSize: 8, color: MUT }}>radar {def.detectKm} km</span>
                      <button onClick={() => { setBatteries(prev => prev.filter(x => x.uid !== b.uid)); if (selBat === b.uid) setSelBat(null); }} className="f-mono" style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 7px', border: `1px solid ${RED}`, borderRadius: 3, background: 'transparent', color: '#e09a9a', cursor: 'pointer' }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="6 · ELECTRONIC WARFARE (РЕБ)">
            <div className="f-mono" style={{ fontSize: 8, color: '#93a1b0', marginBottom: 6, lineHeight: 1.4 }}>
              EW suites soft-kill drones and disrupt navigation/links inside their footprint (no missiles spent). Place them to thin OWA and recon before they reach the target.
            </div>
            <div className="f-mono" style={{ fontSize: 8, color: placeKind === 'battery' && (allDefs[placeMode] || {}).isEW ? '#93a1b0' : MUT, marginBottom: 5 }}>
              {placeKind === 'battery' && (allDefs[placeMode] || {}).isEW ? '▶ CLICK THE MAP to place ' + ((allDefs[placeMode] || {}).tag || (allDefs[placeMode] || {}).name) : 'Pick an EW system below, then click the map.'}
            </div>
            <div className="f-mono" style={{ fontSize: 8, color: '#56a0e0', marginBottom: 3 }}>QUICK</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, opacity: mapLocked ? 0.5 : 1, pointerEvents: mapLocked ? 'none' : 'auto' }}>
              {Object.values(allDefs).filter(b => b.isEW && !/^lib_/.test(b.id)).map(b => {
                const sel = placeMode === b.id && placeKind === 'battery';
                return (
                  <button key={b.id} onClick={() => { setPlaceKind('battery'); setPlaceMode(b.id); }} className="f-mono"
                    style={{ fontSize: 10, padding: '6px 5px', textAlign: 'left', border: `1px solid ${sel ? '#93a1b0' : '#243d52'}`, borderRadius: 3, background: sel ? 'rgba(147,161,176,0.16)' : 'transparent', color: sel ? '#fff' : TEXT, cursor: 'pointer' }}>
                    {b.tag || b.name}<br /><span style={{ color: MUT, fontSize: 8 }}>EW {b.detectKm} km</span>
                  </button>
                );
              })}
            </div>
            {(() => {
              const ewLib = libOptions.filter(e => e.cat === 'EW');
              return (
                <div style={{ marginTop: 8, opacity: mapLocked ? 0.5 : 1, pointerEvents: mapLocked ? 'none' : 'auto' }}>
                  <div className="f-mono" style={{ fontSize: 9, color: '#56a0e0', marginBottom: 3 }}>EW LIBRARY ({ewLib.length})</div>
                  <select disabled={mapLocked} className="f-mono" value=""
                    onChange={e => { addFromLibrary(e.target.value); e.target.value = ''; }}
                    style={{ width: '100%', fontSize: 10, padding: '5px 4px', background: '#0a1626', border: '1px solid #243d52', color: TEXT, borderRadius: 3 }}>
                    <option value="" disabled>Pick an EW system…</option>
                    {ewLib.map(e => <option key={e.idx} value={e.idx}>{e.name} ({e.country}) · {e.rangeKm}km</option>)}
                  </select>
                </div>
              );
            })()}
            {batteries.filter(b => (allDefs[b.type] || {}).isEW).length > 0 && (
              <div style={{ marginTop: 8, border: '1px solid #243d52', borderRadius: 3 }}>
                <div className="f-mono" style={{ fontSize: 8, color: MUT, padding: '4px 6px', background: '#16293c' }}>EW PLACED</div>
                {batteries.filter(b => (allDefs[b.type] || {}).isEW).map(b => {
                  const def = allDefs[b.type] || {};
                  return (
                    <div key={b.uid} style={{ padding: '5px 6px', borderTop: '1px solid #16293c', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="f-mono" style={{ fontSize: 9, color: '#93a1b0' }}>{def.tag || def.name}</span>
                      <span className="f-mono" style={{ fontSize: 8, color: MUT }}>EW {def.detectKm} km</span>
                      <button onClick={() => { setBatteries(prev => prev.filter(x => x.uid !== b.uid)); if (selBat === b.uid) setSelBat(null); }} className="f-mono" style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 7px', border: `1px solid ${RED}`, borderRadius: 3, background: 'transparent', color: '#e09a9a', cursor: 'pointer' }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="7 · CONDITIONS">
            <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '0 0 2px' }}>SEASON</div>
            <Select value={season} onChange={setSeason} options={Object.values(SEASONS).map(s => [s.key, `${s.label} (${s.tempC > 0 ? '+' : ''}${s.tempC}°C)`])} />
            <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', margin: '3px 0 6px', lineHeight: 1.4 }}>{(SEASONS[season] || {}).notes}</div>
            <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '0 0 2px' }}>VISIBILITY / CLOUD</div>
            <Select value={wxPreset} onChange={setWxPreset} options={Object.values(WEATHER_PRESETS).map(w => [w.key, w.label])} />
            <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '6px 0 2px' }}>SURFACE WIND {windKmh} km/h</div>
            <input type="range" min="0" max="80" value={windKmh} onChange={e => setWindKmh(+e.target.value)} style={{ width: '100%' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              <label className="f-mono" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: TEXT, cursor: 'pointer' }}><input type="checkbox" checked={night} onChange={e => setNight(e.target.checked)} /> Night</label>
              <label className="f-mono" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: TEXT, cursor: 'pointer' }}><input type="checkbox" checked={coldStart} onChange={e => setColdStart(e.target.checked)} /> Cold start</label>
              <label className="f-mono" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: TEXT, cursor: 'pointer' }}><input type="checkbox" checked={centralised} onChange={e => setCentralised(e.target.checked)} /> Centralised C2</label>
              <label className="f-mono" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: TEXT, cursor: 'pointer' }}><input type="checkbox" checked={jamming} onChange={e => setJamming(e.target.checked)} /> Enemy EW/jamming</label>
            </div>
            <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '8px 0 2px' }}>SALVO</div>
            <Select value={salvoKey} onChange={setSalvoKey} options={Object.values(SALVO).map(s => [s.key, s.label])} />
            <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginTop: 6, lineHeight: 1.4 }}>Low-altitude cruise/OWA leak more (radar horizon); winter degrades guns/drones; jamming hurts track quality; cold start and centralised C2 add reaction delay.</div>
          </Section>
        </div>

        {/* ---- map + canvas ---- */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div ref={mapDivRef} style={{ position: 'absolute', inset: 0, background: '#0a1626' }} />
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 450, pointerEvents: 'none' }} />
          {!mapLocked && (() => {
            const modeInfo = placeKind === 'target'
              ? { c: AMBER, t: 'PLACING TARGETS – click the map to drop a ' + ((TGT_TYPES[tgtType] || {}).label || 'target') + ' to defend' }
              : placeKind === 'battery'
              ? { c: BLUE, t: 'PLACING BATTERIES – click the map to drop ' + ((allDefs[placeMode] || {}).tag || (allDefs[placeMode] || {}).name || 'a battery') }
              : placeKind === 'launch'
              ? { c: '#e8bd55', t: 'SET LAUNCH POINT – click the map to set a custom origin' }
              : placeKind === 'route'
              ? { c: '#e8bd55', t: 'DRAWING ROUTE – click the map to add waypoints' }
              : placeKind === 'patrol'
              ? { c: '#c99be0', t: 'DRAWING PATROL – click the map to add fighter patrol waypoints' }
              : { c: MUT, t: 'Pick what to place from the left panel.' };
            return (
              <div className="f-mono" style={{ position: 'absolute', top: 8, left: 8, zIndex: 500, background: 'rgba(10,22,38,0.92)', border: `1px solid ${modeInfo.c}`, borderRadius: 3, padding: '5px 10px', fontSize: 9, color: modeInfo.c, pointerEvents: 'none', maxWidth: 360 }}>
                <span style={{ fontWeight: 'bold' }}>▶ {modeInfo.t}</span>
              </div>
            );
          })()}
          {mapLocked && (
            <div className="f-mono" style={{ position: 'absolute', top: 8, left: 8, zIndex: 500, background: 'rgba(10,22,38,0.82)', border: '1px solid #243d52', borderRadius: 3, padding: '4px 8px', fontSize: 9, color: MUT, pointerEvents: 'none' }}>
              {playing ? 'LIVE · 1x = real time. Tap a battery to manage it; drag to reposition. Pan/zoom freely.' : 'MAP LOCKED. Tap a battery to manage it. START runs the attack matrix.'}
            </div>
          )}
          {selBat && (() => {
            const b = batteries.find(x => x.uid === selBat); if (!b) return null;
            const def = allDefs[b.type] || {}; const la = liveAmmo[b.uid] || {};
            const ammo = la.ammo != null ? la.ammo : (def.rounds || 0);
            const maxA = def.rounds || 0;
            const reloading = la.reloadUntil && performance.now() < la.reloadUntil;
            const secLeft = reloading ? Math.ceil((la.reloadUntil - performance.now()) / 1000) : 0;
            const allowed = effectiveCan(b, def);
            const low = maxA > 0 && ammo <= Math.max(1, Math.round(maxA * 0.25));
            return (
              <div className="riso-paper" style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 600, width: 320, background: '#0c1c2e', border: `1px solid ${BLUE}`, borderRadius: 4, padding: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="f-display" style={{ fontSize: 13, color: batColor(b.type) }}>{def.tag || def.name}</span>
                  <button onClick={() => setSelBat(null)} className="btn-riso btn-alt" style={{ padding: '2px 8px', fontSize: 10 }}>✕</button>
                </div>
                <div className="f-mono" style={{ fontSize: 9, color: MUT, marginBottom: 6 }}>
                  {def.nation ? def.nation + ' · ' : ''}{def.aeroRangeKm > 0 ? def.aeroRangeKm + ' km' : 'EW'}{def.tbmFootprintKm > 0 ? ' · ABM ' + def.tbmFootprintKm + 'km' : ''} · ${(def.costM || 0).toFixed(def.costM >= 1 ? 1 : 3)}M/shot · reload {def.reloadS}s
                </div>
                <div className="f-mono" style={{ fontSize: 10, marginBottom: 6, color: low ? RED : TEXT }}>
                  AMMO <span style={{ color: low ? RED : GREEN }}>{ammo === Infinity ? '∞' : ammo}{maxA && ammo !== Infinity ? ' / ' + maxA : ''}</span>
                  {la.shots != null ? <span style={{ color: MUT }}> · fired {la.shots} · kills {la.kills || 0}</span> : null}
                  {reloading ? <span style={{ color: AMBER }}> · RELOADING {secLeft}s</span> : null}
                  {low && !reloading ? <span style={{ color: RED }}> · LOW</span> : null}
                </div>
                {(la.maxHp != null && la.maxHp > 0) && (
                  <div className="f-mono" style={{ fontSize: 9, marginBottom: 6, color: la.disabled ? RED : la.hp < la.maxHp ? AMBER : MUT }}>
                    SITE INTEGRITY {la.disabled ? <span style={{ color: RED }}>· DESTROYED</span> : <span style={{ color: la.hp < la.maxHp ? AMBER : GREEN }}>{la.hp}/{la.maxHp}{la.hitsTaken ? ' · ' + la.hitsTaken + ' hit(s) taken' : ''}</span>}
                  </div>
                )}
                {BATTERY_VARIANTS[b.type] && (() => {
                  const vs = BATTERY_VARIANTS[b.type];
                  const curId = b.variant || vs[0].id;
                  const cur = vs.find(v => v.id === curId) || vs[0];
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <div className="f-mono" style={{ fontSize: 8, color: '#56a0e0', margin: '4px 0 3px' }}>VARIANT / MODIFICATION</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {vs.map(v => {
                          const sel = curId === v.id;
                          return (
                            <button key={v.id} onClick={() => setVariant(b.uid, v.id)}
                              style={{ fontSize: 9, padding: '4px 8px', borderRadius: 3, cursor: 'pointer',
                                border: `1px solid ${sel ? BLUE : '#34516b'}`, background: sel ? 'rgba(47,128,214,0.18)' : 'transparent', color: sel ? '#fff' : MUT }}>
                              {v.name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="f-mono" style={{ fontSize: 8, color: '#7f93a6', marginTop: 3, lineHeight: 1.4 }}>
                        {cur.aeroRangeKm} km{cur.tbmFootprintKm > 0 ? ` · ABM ${cur.tbmFootprintKm}km` : ''} · ${cur.costM >= 1 ? cur.costM.toFixed(1) : cur.costM.toFixed(3)}M/shot{cur.pkMul && cur.pkMul !== 1 ? ` · Pk ×${cur.pkMul.toFixed(2)}` : ''}. {cur.note}
                      </div>
                    </div>
                  );
                })()}
                <div className="f-mono" style={{ fontSize: 8, color: '#56a0e0', margin: '4px 0 3px' }}>ENGAGE WHAT (tap to allow/deny)</div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
                  {ENGAGE_CLASSES.map(c => {
                    const phys = physCapable(def, c.key); const sel = allowed.includes(c.key);
                    return (
                      <button key={c.key} disabled={!phys} onClick={() => toggleCanUid(b.uid, c.key)}
                        style={{ fontSize: 9, padding: '4px 9px', borderRadius: 3, cursor: phys ? 'pointer' : 'not-allowed',
                          border: `1px solid ${!phys ? '#1a2c3e' : sel ? c.col : '#34516b'}`,
                          background: !phys ? 'transparent' : sel ? c.bg : 'transparent',
                          color: !phys ? '#33485c' : sel ? c.col : MUT }}>{c.short}</button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button onClick={() => reloadBattery(b.uid)} disabled={reloading || ammo === maxA} className="f-display"
                    style={{ flex: 1, fontSize: 11, padding: '7px', borderRadius: 3, border: `1px solid ${reloading || ammo === maxA ? '#243d52' : GREEN}`, background: reloading || ammo === maxA ? '#16293c' : 'rgba(79,157,119,0.16)', color: reloading || ammo === maxA ? MUT : GREEN, cursor: reloading || ammo === maxA ? 'not-allowed' : 'pointer' }}>
                    {reloading ? 'RELOADING…' : 'RELOAD'}
                  </button>
                  <button onClick={() => toggleHideBattery(b.uid)} className="f-display"
                    style={{ flex: 1, fontSize: 11, padding: '7px', borderRadius: 3, border: `1px solid ${b.engage === false ? AMBER : '#34516b'}`, background: b.engage === false ? 'rgba(217,165,47,0.16)' : 'transparent', color: b.engage === false ? AMBER : MUT, cursor: 'pointer' }}>
                    {b.engage === false ? 'UNHIDE' : 'HOLD / HIDE'}
                  </button>
                </div>
                {!mapLocked && (
                  <div style={{ marginTop: 8, marginBottom: 4, padding: '6px 7px', border: '1px solid #243d52', borderRadius: 3, background: '#0a1626' }}>
                    <div className="f-mono" style={{ fontSize: 8, color: '#56a0e0', marginBottom: 4 }}>COMMAND &amp; INFORMATION DELAY (sec from first track to launch)</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="f-mono" style={{ fontSize: 8, color: MUT }}>REACTION</span>
                        <input type="number" min={0} max={120} step={1} value={b.reactDelaySec != null ? b.reactDelaySec : defaultReactDelay(b.type)} onChange={e => { const v = Math.max(0, +e.target.value || 0); setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, reactDelaySec: v } : x)); }} style={{ width: 46, fontSize: 10, padding: '3px 4px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 3, color: '#fff' }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="f-mono" style={{ fontSize: 8, color: MUT }}>+ C2 (central)</span>
                        <input type="number" min={0} max={120} step={1} value={b.c2DelaySec || 0} onChange={e => { const v = Math.max(0, +e.target.value || 0); setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, c2DelaySec: v } : x)); }} style={{ width: 46, fontSize: 10, padding: '3px 4px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 3, color: '#fff' }} />
                      </div>
                      <span className="f-mono" style={{ fontSize: 9, color: AMBER, marginLeft: 'auto' }}>= {(b.reactDelaySec != null ? b.reactDelaySec : defaultReactDelay(b.type)) + (b.c2DelaySec || 0)}s</span>
                    </div>
                    <div className="f-mono" style={{ fontSize: 7, color: '#5d6b7a', marginTop: 3, lineHeight: 1.4 }}>The battery holds a track this long before it may fire. A fast threat can leave the engagement zone before the delay expires.</div>
                  </div>
                )}
                {!mapLocked && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 4 }}>
                    <span className="f-mono" style={{ fontSize: 9, color: MUT }}>LAUNCHERS</span>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #34516b', borderRadius: 3 }}>
                      <button onClick={() => setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, launchers: Math.max(1, (x.launchers || 1) - 1) } : x))} style={{ fontSize: 12, padding: '0 8px', background: 'transparent', border: 'none', color: TEXT, cursor: 'pointer' }}>−</button>
                      <span className="f-mono" style={{ fontSize: 11, color: '#fff', minWidth: 16, textAlign: 'center' }}>{b.launchers || 1}</span>
                      <button onClick={() => setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, launchers: Math.min(12, (x.launchers || 1) + 1) } : x))} style={{ fontSize: 12, padding: '0 8px', background: 'transparent', border: 'none', color: TEXT, cursor: 'pointer' }}>+</button>
                    </div>
                    {def.rounds ? <span className="f-mono" style={{ fontSize: 8, color: '#5d6b7a' }}>= {def.rounds * (b.launchers || 1)} rounds · {b.launchers || 1} ch</span> : <span className="f-mono" style={{ fontSize: 8, color: '#5d6b7a' }}>guns</span>}
                    <button onClick={() => { setBatteries(prev => prev.filter(x => x.uid !== b.uid)); setSelBat(null); }} className="f-mono" style={{ marginLeft: 'auto', fontSize: 9, padding: '4px 9px', border: `1px solid ${RED}`, borderRadius: 3, background: 'rgba(210,74,68,0.12)', color: '#e09a9a', cursor: 'pointer' }}>REMOVE</button>
                  </div>
                )}
                {!mapLocked && (allDefs[b.type] || {}).isFighter && (() => {
                  const drawing = placeKind === 'patrol' && patrolFor === b.uid;
                  const np = (b.patrol || []).length;
                  return (
                    <div style={{ marginTop: 4, marginBottom: 4, padding: '6px 7px', border: `1px solid ${drawing ? '#c99be0' : '#243d52'}`, borderRadius: 3, background: drawing ? 'rgba(201,155,224,0.08)' : '#0a1626' }}>
                      <div className="f-mono" style={{ fontSize: 9, color: '#c99be0', marginBottom: 4 }}>PATROL ROUTE {np > 0 ? `(${np} point${np === 1 ? '' : 's'})` : '(none)'}</div>
                      <div className="f-mono" style={{ fontSize: 8, color: MUT, marginBottom: 5, lineHeight: 1.4 }}>
                        {np === 0 ? 'This aircraft needs a patrol route. Press DRAW, then click the map to add waypoints (2+ makes a racetrack it flies back and forth).' : (np === 1 ? 'One point = it loiters there. Add more for a racetrack.' : 'It flies leg to leg and reverses at the ends.')}
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button onClick={() => { if (drawing) { setPlaceKind('none'); setPatrolFor(null); } else { setPatrolFor(b.uid); setPlaceKind('patrol'); } }} className="f-mono" style={{ fontSize: 9, padding: '4px 10px', borderRadius: 3, border: `1px solid ${drawing ? '#c99be0' : '#34516b'}`, background: drawing ? 'rgba(201,155,224,0.2)' : 'transparent', color: drawing ? '#fff' : '#c99be0', cursor: 'pointer' }}>{drawing ? '▶ CLICK MAP TO ADD' : 'DRAW PATROL'}</button>
                        {np > 0 && <button onClick={() => setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, patrol: (x.patrol || []).slice(0, -1) } : x))} className="f-mono" style={{ fontSize: 9, padding: '4px 9px', borderRadius: 3, border: '1px solid #34516b', background: 'transparent', color: MUT, cursor: 'pointer' }}>UNDO LAST</button>}
                        {np > 0 && <button onClick={() => setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, patrol: [] } : x))} className="f-mono" style={{ fontSize: 9, padding: '4px 9px', borderRadius: 3, border: '1px solid #34516b', background: 'transparent', color: '#e09a9a', cursor: 'pointer' }}>CLEAR</button>}
                      </div>
                      <div className="f-mono" style={{ fontSize: 8, color: MUT, marginTop: 5 }}>Air-to-air reach {def.aeroRangeKm} km · radar {def.detectKm} km · {def.rounds} missiles · engages cruise / drones, not ballistic.</div>
                    </div>
                  );
                })()}
                {!mapLocked && (() => {
                  const isBig = (allDefs[b.type] || {}).tbmFootprintKm > 0;
                  const sd = b.selfDefend != null ? b.selfDefend : isBig;
                  if (!isBig) return null;
                  return (
                    <div style={{ marginTop: 4, marginBottom: 4, padding: '6px 7px', border: `1px solid ${sd ? '#4f9d77' : '#243d52'}`, borderRadius: 3, background: sd ? 'rgba(79,157,119,0.08)' : '#0a1626' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="f-mono" style={{ fontSize: 9, color: sd ? GREEN : MUT }}>SELF-DEFENCE (auto, human out of loop)</span>
                        <button onClick={() => setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, selfDefend: !sd } : x))} className="f-mono" style={{ fontSize: 9, padding: '3px 9px', borderRadius: 3, border: `1px solid ${sd ? GREEN : '#34516b'}`, background: sd ? 'rgba(79,157,119,0.2)' : 'transparent', color: sd ? '#fff' : MUT, cursor: 'pointer' }}>{sd ? 'ON' : 'OFF'}</button>
                      </div>
                      {sd && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                          <span className="f-mono" style={{ fontSize: 8, color: MUT }}>self-defence radius</span>
                          <input type="number" min={2} max={60} step={1} value={b.selfDefendKm != null ? b.selfDefendKm : 20} onChange={e => { const v = Math.max(2, +e.target.value || 20); setBatteries(prev => prev.map(x => x.uid === b.uid ? { ...x, selfDefendKm: v } : x)); }} style={{ width: 46, fontSize: 10, padding: '3px 4px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 3, color: '#fff' }} />
                          <span className="f-mono" style={{ fontSize: 8, color: MUT }}>km · zero delay, higher Pk inside it</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginTop: 6 }}>Drag the marker on the map to reposition this system. Deny classes to save scarce interceptors for the threats that matter.</div>
              </div>
            );
          })()}
          {(playing || live.intercepted > 0 || live.leaked > 0) && (
            <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 500, background: 'rgba(10,22,38,0.88)', border: '1px solid #243d52', borderRadius: 3, padding: '6px 10px', display: 'flex', gap: 14, alignItems: 'center' }}>
              <Live label="INBOUND" v={live.inbound} c={AMBER} />
              <Live label="INTERCEPTED" v={live.intercepted} c={GREEN} />
              <Live label="LEAKED" v={live.leaked} c={RED} />
              {live.transit ? <div style={{ textAlign: 'center' }}><div className="f-mono" style={{ fontSize: 8, color: '#93a1b0' }}>TRANSIT</div><div className="f-display" style={{ fontSize: 16, color: BLUE }}>{live.transit}x</div></div> : null}
            </div>
          )}
          {(live.spentM > 0 || live.dmgM > 0) && (
            <div className="f-mono" style={{ position: 'absolute', top: 64, right: 8, zIndex: 500, background: 'rgba(10,22,38,0.88)', border: '1px solid #243d52', borderRadius: 3, padding: '4px 10px', fontSize: 9 }}>
              <span style={{ color: BLUE }}>DEF ${(live.spentM || 0).toFixed(1)}M</span>
              <span style={{ color: '#5d6b7a' }}> · </span>
              <span style={{ color: GREEN }}>KILLED ${(live.killedM || 0).toFixed(1)}M</span>
              <span style={{ color: '#5d6b7a' }}> · </span>
              <span style={{ color: RED }}>DMG ${(live.dmgM || 0).toFixed(1)}M</span>
            </div>
          )}
        </div>

        {/* ---- right rail (ATTACK): targets + routes + attack matrix + simulate ---- */}
        <div style={{ width: 330, borderLeft: '1px solid #243d52', overflowY: 'auto', padding: 12, background: '#0c1c2e' }}>
          <div className="f-display" style={{ fontSize: 12, color: RED, letterSpacing: '0.08em', padding: '4px 8px', marginBottom: 10, border: `1px solid ${RED}`, borderRadius: 3, background: 'rgba(210,74,68,0.10)', textAlign: 'center' }}>◆ ATTACK PLANNING</div>
          <Section title="SCENARIO LIBRARY">
            <button onClick={() => setShowScenarios(true)} className="f-mono" style={{ width: '100%', fontSize: 10, padding: '6px', border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.12)', color: '#fff', cursor: 'pointer' }}>▸ SCENARIOS &amp; LIBRARIES</button>
          </Section>

          <div style={{ position: 'relative' }}>
            {targets.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(12,28,46,0.82)', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center' }}>
                <div className="f-display" style={{ fontSize: 13, color: AMBER, marginBottom: 6 }}>COMPLETE STEP 1 FIRST</div>
                <div className="f-mono" style={{ fontSize: 9, color: MUT, lineHeight: 1.5 }}>Place at least one target to defend on the left, then plan the attack against it here.</div>
              </div>
            )}
            <Section title="ENEMY ATTACK">
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, padding: '5px 7px', border: `1px solid ${enhanced ? '#e8bd55' : '#243d52'}`, borderRadius: 3, background: enhanced ? 'rgba(217,165,47,0.10)' : 'transparent' }}>
                <span className="f-mono" style={{ fontSize: 9, color: MUT }}>MODE</span>
                <button onClick={() => { setEnhanced(false); if (placeKind === 'route') setPlaceKind('target'); }} className="f-mono" style={{ flex: 1, fontSize: 9, padding: '4px', borderRadius: 3, border: `1px solid ${!enhanced ? BLUE : '#34516b'}`, background: !enhanced ? 'rgba(47,128,214,0.18)' : 'transparent', color: !enhanced ? '#fff' : MUT, cursor: 'pointer' }}>SIMPLE</button>
                <button onClick={() => { setEnhanced(true); }} className="f-mono" style={{ flex: 1, fontSize: 9, padding: '4px', borderRadius: 3, border: `1px solid ${enhanced ? '#e8bd55' : '#34516b'}`, background: enhanced ? 'rgba(217,165,47,0.2)' : 'transparent', color: enhanced ? '#fff' : MUT, cursor: 'pointer' }}>ENHANCED</button>
              </div>
              <div className="f-mono" style={{ fontSize: 8, color: MUT, marginBottom: 8, lineHeight: 1.4 }}>
                {enhanced ? 'ENHANCED: draw each missile route by hand with per-waypoint altitude (below). Full control over flight path and height.' : 'SIMPLE: pick a direction, threat and count. Threats launch automatically from that direction toward your targets.'}
              </div>

              {!enhanced && (
                <div>
                  <div className="f-mono" style={{ fontSize: 9, color: '#56a0e0', margin: '2px 0 4px' }}>ADD A WAVE</div>
                  <select value={qa.type} onChange={e => setQa(q => ({ ...q, type: e.target.value }))} className="f-mono"
                    style={{ width: '100%', fontSize: 10, padding: '5px 4px', background: '#0a1626', border: '1px solid #243d52', color: TEXT, borderRadius: 3, marginBottom: 4 }}>
                    {tOpts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <div className="f-mono" style={{ fontSize: 8, color: MUT, marginBottom: 3 }}>DIRECTION OF ATTACK</div>
                  <select value={qa.from} onChange={e => setQa(q => ({ ...q, from: e.target.value }))} className="f-mono" style={{ width: '100%', fontSize: 10, padding: '5px 4px', background: '#0a1626', border: '1px solid #243d52', color: TEXT, borderRadius: 3, marginBottom: 4 }}>
                    <optgroup label="Russia / Belarus">{THREAT_ORIGINS.filter(o => o.group === 'RU').map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>
                    <optgroup label="Sea-launched">{THREAT_ORIGINS.filter(o => o.group === 'SEA').map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>
                    <optgroup label="Other">{THREAT_ORIGINS.filter(o => o.group === 'IR').map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>
                    {launchPoint && <optgroup label="Custom"><option value="custom_launch">Custom launch point</option></optgroup>}
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                    <button onClick={() => { setPlaceKind(placeKind === 'launch' ? 'target' : 'launch'); }} className="f-mono" style={{ fontSize: 8, padding: '3px 7px', borderRadius: 3, border: `1px solid ${placeKind === 'launch' ? '#e8bd55' : '#34516b'}`, background: placeKind === 'launch' ? 'rgba(217,165,47,0.18)' : 'transparent', color: placeKind === 'launch' ? '#fff' : MUT, cursor: 'pointer' }}>{placeKind === 'launch' ? '▶ CLICK MAP FOR LAUNCH POINT' : 'or set custom launch point'}</button>
                    {launchPoint && <span className="f-mono" style={{ fontSize: 8, color: '#e8bd55' }}>{launchPoint.lat.toFixed(1)},{launchPoint.lng.toFixed(1)} <button onClick={() => { setLaunchPoint(null); if (qa.from === 'custom_launch') setQa(q => ({ ...q, from: 'ru_south' })); }} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 9 }}>×</button></span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
                    <MiniField label="TARGET"><select value={qa.target} onChange={e => setQa(q => ({ ...q, target: e.target.value }))} className="f-mono" style={miniIn}>
                      <option value="all">ALL (spread)</option>
                      <optgroup label="Targets">{targets.map(t => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}</optgroup>
                      {batteries.length > 0 && <optgroup label="Air defence sites (SEAD/DEAD)">{batteries.map(b => { const d = allDefs[b.type] || {}; return <option key={b.uid} value={'bat_' + b.uid}>◎ {d.tag || d.name}</option>; })}</optgroup>}
                    </select></MiniField>
                    <MiniField label="QTY"><input type="number" min="1" value={qa.count} onChange={e => setQa(q => ({ ...q, count: e.target.value }))} className="f-mono" style={miniIn} /></MiniField>
                  </div>
                  <div className="f-mono" style={{ fontSize: 8, color: '#56a0e0', margin: '4px 0 2px' }}>ATTACK TIMING</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
                    <MiniField label="START (h from H-hour)"><input type="number" min="0" step="0.25" value={qa.startGH} onChange={e => setQa(q => ({ ...q, startGH: e.target.value }))} className="f-mono" style={miniIn} /></MiniField>
                    <MiniField label="GAP between (sec)"><input type="number" min="5" value={qa.spacingSec} onChange={e => setQa(q => ({ ...q, spacingSec: e.target.value }))} className="f-mono" style={miniIn} /></MiniField>
                  </div>
                  <details style={{ marginBottom: 6 }}>
                    <summary className="f-mono" style={{ fontSize: 8, color: MUT, cursor: 'pointer' }}>advanced: speeds</summary>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
                      <MiniField label="CRUISE km/h"><input type="number" min="40" placeholder="auto" value={qa.kmh || ''} onChange={e => setQa(q => ({ ...q, kmh: e.target.value }))} className="f-mono" style={miniIn} /></MiniField>
                      <MiniField label="TERMINAL km/h"><input type="number" min="40" placeholder="auto" value={qa.terminalKmh || ''} onChange={e => setQa(q => ({ ...q, terminalKmh: e.target.value }))} className="f-mono" style={miniIn} /></MiniField>
                    </div>
                  </details>
                  <button onClick={addWaveRow} className="f-mono" style={{ width: '100%', fontSize: 11, padding: '8px', border: `1px solid ${RED}`, borderRadius: 3, background: 'rgba(210,74,68,0.18)', color: '#fff', cursor: 'pointer', marginBottom: 4, fontWeight: 'bold' }}>+ ADD THIS WAVE</button>
                  <div className="f-mono" style={{ fontSize: 8, color: planWaves.length ? GREEN : MUT, marginBottom: 8, textAlign: 'center' }}>{planWaves.length ? planWaves.length + ' wave(s) planned · ' + totalTracks + ' tracks (see list below) ✓' : 'No waves yet. Configure above and press ADD.'}</div>
                  <div className="f-mono" style={{ fontSize: 9, color: '#56a0e0', margin: '4px 0 3px' }}>QUICK STRIKE PATTERNS</div>
                  {STRIKE_PRESETS.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                      <button onClick={() => addPreset(p)} className="f-mono" style={{ fontSize: 9, padding: '3px 7px', border: '1px solid #243d52', borderRadius: 3, background: 'transparent', color: AMBER, cursor: 'pointer', flex: 'none' }}>+ ADD</button>
                      <span className="f-mono" style={{ fontSize: 9, color: TEXT }}>{p.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
          {enhanced && targets.length > 0 && (
            <Section title="ENHANCED ROUTES (draw by hand)">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <button onClick={() => setPlaceKind('route')} className="f-mono" style={{ fontSize: 9, padding: '4px 8px', borderRadius: 3, border: `1px solid ${placeKind === 'route' ? '#e8bd55' : '#34516b'}`, background: placeKind === 'route' ? 'rgba(217,165,47,0.2)' : 'transparent', color: placeKind === 'route' ? '#fff' : MUT, cursor: 'pointer' }}>{placeKind === 'route' ? '▶ DRAWING ON MAP' : 'DRAW MODE'}</button>
                <button onClick={addCustomRoute} className="f-mono" style={{ fontSize: 9, padding: '3px 8px', border: '1px solid #4f9d77', borderRadius: 3, background: 'rgba(79,157,119,0.14)', color: GREEN, cursor: 'pointer' }}>+ NEW ROUTE</button>
              </div>
              <div className="f-mono" style={{ fontSize: 8, color: MUT, marginBottom: 6, lineHeight: 1.4 }}>
                Press NEW ROUTE, set the altitude, then click the map for each waypoint. First click = launch, last = impact. Or type exact coordinates. Low routes hide under radar horizon.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
                <span className="f-mono" style={{ fontSize: 9, color: TEXT }}>Next WP altitude:</span>
                <input type="number" value={wpAltM} min={30} max={80000} step={50} onChange={e => setWpAltM(Math.max(30, +e.target.value || 30))} style={{ width: 80, fontSize: 10, padding: '3px 5px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 3, color: '#fff' }} />
                <span className="f-mono" style={{ fontSize: 8, color: MUT }}>m</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {[60, 1000, 8000].map(a => <button key={a} onClick={() => setWpAltM(a)} className="f-mono" style={{ fontSize: 8, padding: '2px 5px', border: '1px solid #243d52', borderRadius: 2, background: 'transparent', color: MUT, cursor: 'pointer' }}>{a >= 1000 ? a / 1000 + 'km' : a + 'm'}</button>)}
                </div>
              </div>
              {customRoutes.length === 0 && <div className="f-mono" style={{ fontSize: 8, color: MUT }}>No routes yet. Press NEW ROUTE.</div>}
              {customRoutes.map(cr => {
                const isAct = cr.id === activeRouteId;
                const rFam = resolveThreat ? resolveThreat(cr.type).family : 'owa';
                const isBallistic = rFam === 'ballistic';
                return (
                  <div key={cr.id} style={{ border: `1px solid ${isAct ? '#e8bd55' : '#243d52'}`, borderRadius: 3, padding: 6, marginBottom: 5, background: isAct ? 'rgba(217,165,47,0.08)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <button onClick={() => { setActiveRouteId(cr.id); setPlaceKind('route'); }} className="f-mono" style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, border: `1px solid ${isAct ? '#e8bd55' : '#34516b'}`, background: isAct ? 'rgba(217,165,47,0.2)' : 'transparent', color: isAct ? '#fff' : MUT, cursor: 'pointer' }}>{isAct ? (isBallistic ? 'SET LAUNCH' : 'DRAWING') : 'SELECT'}</button>
                      <select value={cr.type} onChange={e => updateRoute(cr.id, { type: e.target.value })} style={{ flex: 1, fontSize: 9, padding: '2px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }}>
                        {threatOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                      <button onClick={() => deleteRoute(cr.id)} className="f-mono" style={{ fontSize: 9, padding: '2px 6px', border: '1px solid #243d52', borderRadius: 2, background: 'transparent', color: RED, cursor: 'pointer' }}>×</button>
                    </div>
                    {isBallistic && (
                      <div className="f-mono" style={{ fontSize: 8, color: '#e0726b', marginBottom: 5, lineHeight: 1.4, padding: '4px 6px', border: '1px solid rgba(210,74,68,0.4)', borderRadius: 2, background: 'rgba(210,74,68,0.06)' }}>
                        ▲ BALLISTIC / HYPERSONIC flies a fixed trajectory. You cannot draw a winding path: set the AIM POINT below and one LAUNCH POINT on the map. The engine flies a direct depressed arc (with Earth-rotation drift) to the target.
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <span className="f-mono" style={{ fontSize: 8, color: MUT }}>{isBallistic ? 'AIM POINT' : 'AIMS AT'}</span>
                      <select value={cr.target || 'manual'} onChange={e => {
                        const v = e.target.value;
                        if (v === 'manual') { updateRoute(cr.id, { target: 'manual' }); return; }
                        let dest = null;
                        if (v.startsWith('bat_')) { const bb = batteries.find(x => 'bat_' + x.uid === v); if (bb) dest = { lat: bb.lat, lng: bb.lng }; }
                        else { const tt = targets.find(x => x.id === v); if (tt) dest = { lat: tt.lat, lng: tt.lng }; }
                        if (dest) {
                          setCustomRoutes(prev => prev.map(r => {
                            if (r.id !== cr.id) return r;
                            const pts = r.points.slice();
                            const alt = 80;
                            if (pts.length === 0) pts.push({ lat: dest.lat, lng: dest.lng, altM: alt });
                            else pts[pts.length - 1] = { lat: dest.lat, lng: dest.lng, altM: pts[pts.length - 1].altM || alt };
                            return { ...r, target: v, points: pts };
                          }));
                        } else updateRoute(cr.id, { target: v });
                      }} style={{ flex: 1, fontSize: 8, padding: '2px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }}>
                        <option value="manual">{isBallistic ? 'choose a target' : 'manual (last waypoint = impact)'}</option>
                        <optgroup label="Targets">{targets.map(t => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}</optgroup>
                        {batteries.length > 0 && <optgroup label="AD sites">{batteries.map(b => { const d = allDefs[b.type] || {}; return <option key={b.uid} value={'bat_' + b.uid}>◎ {d.tag || d.name}</option>; })}</optgroup>}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                      <span className="f-mono" style={{ fontSize: 8, color: MUT }}>×</span>
                      <input type="number" value={cr.count} min={1} max={50} onChange={e => updateRoute(cr.id, { count: Math.max(1, +e.target.value || 1) })} style={{ width: 42, fontSize: 9, padding: '2px 4px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }} />
                      <span className="f-mono" style={{ fontSize: 8, color: MUT }}>spacing</span>
                      <input type="number" value={cr.spacingSec} min={2} max={600} onChange={e => updateRoute(cr.id, { spacingSec: Math.max(2, +e.target.value || 30) })} style={{ width: 46, fontSize: 9, padding: '2px 4px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }} />
                      <span className="f-mono" style={{ fontSize: 8, color: MUT }}>s · H+</span>
                      <input type="number" value={cr.startGH} min={0} max={12} step={0.5} onChange={e => updateRoute(cr.id, { startGH: Math.max(0, +e.target.value || 0) })} style={{ width: 42, fontSize: 9, padding: '2px 4px', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }} />
                    </div>
                    {isBallistic ? (
                      <div className="f-mono" style={{ fontSize: 8, marginTop: 2 }}>
                        {(() => {
                          const hasAim = cr.target && cr.target !== 'manual';
                          const hasLaunch = cr.points.length >= 2;
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ color: hasAim ? GREEN : AMBER }}>{hasAim ? '✓ aim point set' : '• choose an aim point above'}</span>
                              <span style={{ color: hasLaunch ? GREEN : (isAct ? '#e8bd55' : AMBER) }}>{hasLaunch ? '✓ launch point set (' + cr.points[0].lat.toFixed(1) + ', ' + cr.points[0].lng.toFixed(1) + ')' : (isAct ? '▶ now click the map to set the launch point' : '• press SET LAUNCH, then click the map')}</span>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="f-mono" style={{ fontSize: 8, color: cr.points.length >= 2 ? GREEN : AMBER }}>{cr.points.length} waypoints{cr.points.length < 2 ? ' (need 2+)' : ''}</span>
                          {cr.points.length > 0 && <button onClick={() => undoWaypoint(cr.id)} className="f-mono" style={{ fontSize: 8, padding: '2px 6px', border: '1px solid #34516b', borderRadius: 2, background: 'transparent', color: MUT, cursor: 'pointer' }}>UNDO LAST</button>}
                        </div>
                        {cr.points.length > 0 && (
                          <div style={{ marginTop: 4, border: '1px solid #1d3346', borderRadius: 2 }}>
                            <div className="f-mono" style={{ display: 'grid', gridTemplateColumns: '16px 1fr 1fr 0.8fr 16px', gap: 2, fontSize: 7, color: '#5d6b7a', padding: '2px 4px', background: '#0c1c2e' }}>
                              <span>#</span><span>LAT</span><span>LNG</span><span>ALT m</span><span></span>
                            </div>
                            {cr.points.map((p, idx) => (
                              <div key={idx} className="f-mono" style={{ display: 'grid', gridTemplateColumns: '16px 1fr 1fr 0.8fr 16px', gap: 2, alignItems: 'center', padding: '1px 4px', borderTop: '1px solid #16293c' }}>
                                <span style={{ fontSize: 7, color: idx === 0 ? GREEN : idx === cr.points.length - 1 ? RED : MUT }}>{idx === 0 ? 'L' : idx === cr.points.length - 1 ? 'I' : idx}</span>
                                <input type="number" value={+p.lat.toFixed(3)} step={0.01} onChange={e => updateWaypoint(cr.id, idx, { lat: +e.target.value })} style={{ width: '100%', fontSize: 8, padding: '1px 2px', background: '#0a1626', border: '1px solid #243d52', borderRadius: 2, color: '#cdd6e0' }} />
                                <input type="number" value={+p.lng.toFixed(3)} step={0.01} onChange={e => updateWaypoint(cr.id, idx, { lng: +e.target.value })} style={{ width: '100%', fontSize: 8, padding: '1px 2px', background: '#0a1626', border: '1px solid #243d52', borderRadius: 2, color: '#cdd6e0' }} />
                                <input type="number" value={p.altM} step={50} min={30} onChange={e => updateWaypoint(cr.id, idx, { altM: Math.max(30, +e.target.value || 30) })} style={{ width: '100%', fontSize: 8, padding: '1px 2px', background: '#0a1626', border: '1px solid #243d52', borderRadius: 2, color: '#cdd6e0' }} />
                                <button onClick={() => removeWaypoint(cr.id, idx)} style={{ fontSize: 8, padding: 0, background: 'transparent', border: 'none', color: RED, cursor: 'pointer' }}>×</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <TypedWaypointAdder onAdd={(lat, lng, alt) => addTypedWaypoint(cr.id, lat, lng, alt)} defaultAlt={wpAltM} />
                      </>
                    )}
                  </div>
                );
              })}
            </Section>
          )}


          {matrix.length > 0 && (
          <Section title={`PLANNED WAVES (${totalTracks} tracks)`}>
            <div style={{ border: '1px solid #243d52', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
              <div className="f-mono" style={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr 0.35fr 0.45fr 0.28fr', fontSize: 8, color: MUT, background: '#16293c', padding: '3px 6px', letterSpacing: '0.05em' }}>
                <span>THREAT</span><span>FROM</span><span>TARGET</span><span>QTY</span><span>H+</span><span></span>
              </div>
              {matrix.map((r) => (
                <div key={r.id} className="f-mono" style={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr 0.35fr 0.45fr 0.28fr', fontSize: 9, color: TEXT, padding: '3px 6px', borderTop: '1px solid #16293c', alignItems: 'center' }}>
                  <span style={{ color: FAM_COL[r.family] || TEXT }}>{r.type}</span>
                  <span style={{ color: MUT, fontSize: 8 }}>{originShort(r.from)}</span>
                  <span style={{ color: AMBER, fontSize: 8 }}>{r.target === 'all' ? 'ALL' : r.target}</span>
                  <span>{r.count}</span><span>{r.startGH}h</span>
                  <button onClick={() => setPlanWaves(p => p.filter(w => w.id !== r.id))} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 10 }}>×</button>
                </div>
              ))}
            </div>
            <SyncMatrix matrix={matrix} targets={targets} onShift={(id, dh) => setPlanWaves(p => p.map(w => w.id === id ? { ...w, startGH: Math.max(0, (+w.startGH || 0) + dh) } : w))} />
          </Section>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span className="f-mono" style={{ fontSize: 9, color: MUT }}>PLAYBACK <span style={{ color: '#5d6b7a' }}>(1x = real time)</span></span>
            {[1, 5, 30, 120, 600].map(s => (
              <button key={s} onClick={() => setPlaySpeed(s)} className="f-mono"
                style={{ fontSize: 10, padding: '3px 8px', border: `1px solid ${playSpeed === s ? BLUE : '#243d52'}`, borderRadius: 3, background: playSpeed === s ? 'rgba(47,128,214,0.18)' : 'transparent', color: playSpeed === s ? '#fff' : MUT, cursor: 'pointer' }}>
                {s}x
              </button>
            ))}
            <span className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginLeft: 'auto' }}>real relative speeds</span>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {!playing
              ? <button onClick={playAttack} disabled={!batteries.length || !totalTracks || !targets.length} className="f-display" style={actBtn(GREEN, !batteries.length || !totalTracks || !targets.length)}>▶ START SIMULATION</button>
              : <button onClick={stopAttack} className="f-display" style={actBtn(RED, false)}>■ STOP</button>}
            <button onClick={runMC} disabled={running || !batteries.length || !totalTracks || !targets.length} className="f-display" style={actBtn(BLUE, running || !batteries.length || !totalTracks || !targets.length)}>{running && mcProgress > 0 ? `MONTE-CARLO ${mcProgress}%` : running ? '…' : 'MONTE-CARLO ×160'}</button>
          </div>
          {(!batteries.length || !totalTracks || !targets.length) && (
            <div className="f-mono" style={{ fontSize: 9, color: AMBER, marginBottom: 10, lineHeight: 1.5, padding: '6px 8px', border: '1px solid rgba(217,165,47,0.4)', borderRadius: 3 }}>
              To run, you still need: {[
                !targets.length ? 'a TARGET (left step 2: click the map)' : null,
                !batteries.length ? 'a BATTERY (left step 3: pick a system, click the map)' : null,
                !totalTracks ? 'an ATTACK WAVE (right: ADD a wave or draw a route)' : null,
              ].filter(Boolean).join(' · ')}
            </div>
          )}

          {report && (
            <Section title={`SIMULATION REPORT${report.aborted ? ' (STOPPED EARLY)' : ''}`}>
              <button onClick={() => setShowFinal(true)} className="f-display" style={{ width: '100%', marginBottom: 8, fontSize: 12, padding: '9px', border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.14)', color: '#fff', cursor: 'pointer', letterSpacing: '0.03em' }}>OPEN FINAL REPORT</button>
              <Stat label="Intercept rate" v={`${Math.round(report.rate * 100)}%`} sub={`${report.killed} killed / ${report.leaked} leaked of ${report.total}`} color={report.rate > 0.8 ? GREEN : report.rate > 0.6 ? AMBER : RED} />
              {report.finance && <Stat label="Cost exchange" v={`${report.finance.exchange.toFixed(1)} : 1`} sub={`DEF $${report.finance.spentM.toFixed(1)}M spent · killed $${report.finance.killedM.toFixed(1)}M · damage $${report.finance.dmgM.toFixed(1)}M`} color={report.finance.exchange >= 1 ? GREEN : AMBER} />}
              <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '6px 0 3px' }}>BY THREAT FAMILY</div>
              {Object.entries(report.byFam).map(([f, v]) => (
                <div key={f} className="f-mono" style={{ fontSize: 10, color: TEXT, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: FAM_COL[f] || TEXT }}>{f}</span>
                  <span style={{ color: MUT }}>{v.killed}/{v.total} killed · {v.leaked} leaked</span>
                </div>
              ))}
              <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '8px 0 3px' }}>EXPENDITURE / KILLS BY SYSTEM</div>
              {Object.entries(report.shots).map(([t, n]) => (
                <div key={t} className="f-mono" style={{ fontSize: 10, color: TEXT, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t}</span><span style={{ color: MUT }}>{n} rds · {report.kills[t] || 0} kills</span>
                </div>
              ))}
              <div className="f-mono" style={{ fontSize: 9, color: MUT, marginTop: 8 }}>
                {report.targetCount} targets · {report.batteries} batteries · WX {report.weather.preset}{report.weather.night ? ' night' : ''}, wind {report.weather.windKmh} km/h · {(SALVO[report.salvo] || SALVO.single).label}
              </div>
              <button onClick={exportReport} className="f-mono" style={{ width: '100%', marginTop: 8, fontSize: 10, padding: '7px', border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.10)', color: '#fff', cursor: 'pointer' }}>EXPORT REPORT (JSON)</button>
            </Section>
          )}

          <Section title="MONTE-CARLO RESULTS">
            {!mc && <div className="f-mono" style={{ fontSize: 10, color: MUT }}>Same matrix, run headless 200x for the leaker distribution and interceptor expenditure.</div>}
            {mc && <MCResults mc={mc} seed={mcSeed} />}
            <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginTop: 10, paddingTop: 6, borderTop: '1px solid #243d52', letterSpacing: '0.04em' }}>
              ILLUSTRATIVE · UNCLASSIFIED · NOT VALIDATED OA. Coefficients are order-of-magnitude from public OSINT and expert estimate, not authoritative TTP.
            </div>
          </Section>
        </div>
      </div>
      <div className="cls-banner">PUBLIC</div>
    </div>
  );
}

function FinalReport({ report, onClose, onExport }) {
  const f = report.finance || { spentM: 0, killedM: 0, dmgM: 0, exchange: 0, perKillM: 0, net: 0 };
  const tState = (t) => t.hp <= 0 ? ['DESTROYED', RED] : (t.hp < t.maxHp ? ['DAMAGED', AMBER] : ['INTACT', GREEN]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(6,14,24,0.84)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(860px, 96vw)', maxHeight: '90vh', overflowY: 'auto', background: '#0c1c2e', border: '1px solid #34516b', borderRadius: 6 }}>
        <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderBottom: '1px solid #243d52' }}>
          <div>
            <span className="f-display" style={{ fontSize: 20, color: BLUE, letterSpacing: '0.04em' }}>OPERATIONAL SIMULATION · FINAL REPORT</span>
            {report.aborted && <span className="f-mono" style={{ fontSize: 10, color: AMBER, marginLeft: 10 }}>STOPPED EARLY</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onExport} className="f-mono" style={{ fontSize: 11, padding: '6px 12px', border: `1px solid ${BLUE}`, borderRadius: 3, background: 'rgba(47,128,214,0.12)', color: '#fff', cursor: 'pointer' }}>EXPORT JSON</button>
            <button onClick={onClose} className="btn-riso btn-alt" style={{ padding: '6px 12px', fontSize: 11 }}>CLOSE</button>
          </div>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
            <Big label="INTERCEPT RATE" v={`${Math.round(report.rate * 100)}%`} c={report.rate > 0.8 ? GREEN : report.rate > 0.6 ? AMBER : RED} sub={`${report.killed} of ${report.total} killed`} />
            <Big label="LEAKERS" v={report.leaked} c={report.leaked === 0 ? GREEN : report.leaked <= 3 ? AMBER : RED} sub="reached their targets" />
            <Big label="DEFENCE SPEND" v={`$${f.spentM.toFixed(1)}M`} c={BLUE} sub={`$${f.perKillM.toFixed(2)}M per kill`} />
            <Big label="COST EXCHANGE" v={`${f.exchange.toFixed(1)} : 1`} c={f.exchange >= 1 ? GREEN : AMBER} sub="threat value killed vs spend" />
          </div>
          {report.unresolved > 0 && (
            <div className="f-mono" style={{ fontSize: 10, color: AMBER, padding: '8px 10px', border: '1px solid rgba(217,165,47,0.5)', borderRadius: 3, marginBottom: 12, lineHeight: 1.5 }}>
              ⚠ {report.unresolved} threat(s) were still in flight when the run's time limit was reached and are NOT counted as hits or intercepts. This happens with very long-range raids; the simulated flight simply had not finished. Launch from a closer origin, or let the run play longer, for a complete result.
            </div>
          )}

          <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 8 }}>FINANCIAL ASSESSMENT (ILLUSTRATIVE $M)</div>
          <div className="f-mono" style={{ fontSize: 11, color: TEXT, lineHeight: 1.8, marginBottom: 14 }}>
            Interceptors expended: <span style={{ color: BLUE }}>${f.spentM.toFixed(1)}M</span> ·
            Threat value destroyed: <span style={{ color: GREEN }}>${f.killedM.toFixed(1)}M</span> ·
            Infrastructure damage taken: <span style={{ color: RED }}>${f.dmgM.toFixed(1)}M</span><br />
            Net assessment (killed − spend − damage): <span style={{ color: f.net >= 0 ? GREEN : RED }}>{f.net >= 0 ? '+' : ''}${f.net.toFixed(1)}M</span>
          </div>

          {report.env && (
            <div className="f-mono" style={{ fontSize: 10, color: TEXT, marginBottom: 14, padding: '6px 8px', border: '1px solid #243d52', borderRadius: 3, lineHeight: 1.6 }}>
              <span style={{ color: '#56a0e0' }}>CONDITIONS:</span> {(SEASONS[report.env.season] || {}).label} {report.env.tempC > 0 ? '+' : ''}{report.env.tempC}°C · {report.env.night ? 'night' : 'day'}{report.env.icing > 0.2 ? ' · icing' : ''}{report.env.jamming ? ' · enemy EW' : ''}{report.env.coldStart ? ' · cold start' : ''}{report.env.centralised ? ' · centralised C2' : ''}
              {' · '}real threats {report.realThreats}, decoys {report.decoys}, protection of real threats <span style={{ color: report.protect > 0.85 ? GREEN : report.protect > 0.6 ? AMBER : RED }}>{Math.round((report.protect || 0) * 100)}%</span>
            </div>
          )}

          {report.miss && (Object.values(report.miss).some(v => v > 0)) && (
            <div style={{ marginBottom: 14 }}>
              <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 8 }}>WHY SHOTS MISSED / THREATS LEAKED</div>
              {[
                ['Low-altitude / terrain masking (radar horizon)', report.miss.tracklow],
                ['Saturation (too many simultaneous tracks)', report.miss.saturation],
                ['Weather / optical degradation', report.miss.weather],
                ['Weapon reliability (duds, fly-outs)', report.miss.reliability],
                ['Classification hesitation (decoys, low RCS)', report.miss.misclassified],
              ].filter(([, v]) => v > 0).map(([lbl, v]) => (
                <div key={lbl} className="f-mono" style={{ fontSize: 10, color: TEXT, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{lbl}</span><span style={{ color: AMBER }}>{v}</span>
                </div>
              ))}
              <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginTop: 4 }}>Failed shots attributed to their dominant degradation source. A single threat may survive several failed attempts.</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
            <div>
              <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 8 }}>BY THREAT FAMILY</div>
              {Object.entries(report.byFam).map(([fam, v]) => (
                <div key={fam} className="f-mono" style={{ fontSize: 10, color: TEXT, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span style={{ color: FAM_COL[fam] || TEXT }}>{fam}</span>
                  <span style={{ color: MUT }}>{v.killed}/{v.total} killed · {v.leaked} leaked</span>
                </div>
              ))}
            </div>
            <div>
              <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 8 }}>BY DEFENCE SYSTEM</div>
              <div className="f-mono" style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.5fr 0.5fr 0.7fr', fontSize: 8, color: MUT, padding: '2px 0' }}>
                <span>SYSTEM</span><span>RDS</span><span>KILLS</span><span>SPEND</span>
              </div>
              {Object.entries(report.shots).map(([sys, n]) => (
                <div key={sys} className="f-mono" style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.5fr 0.5fr 0.7fr', fontSize: 10, color: TEXT, padding: '2px 0' }}>
                  <span>{sys}</span><span>{n}</span><span style={{ color: GREEN }}>{report.kills[sys] || 0}</span><span style={{ color: BLUE }}>${((report.spendBySys || {})[sys] || 0).toFixed(1)}M</span>
                </div>
              ))}
            </div>
          </div>

          <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 8 }}>IMPACT TARGETS STATUS</div>
          <div className="f-mono" style={{ display: 'grid', gridTemplateColumns: '0.5fr 0.6fr 1.2fr 0.7fr 0.5fr 0.8fr', fontSize: 8, color: MUT, padding: '2px 0' }}>
            <span>ID</span><span>TYPE</span><span>NAME</span><span>HP</span><span>HITS</span><span>DAMAGE</span>
          </div>
          {(report.targetStatus || []).filter(t => t.type !== 'ad_site').map(t => {
            const [lbl, col] = tState(t);
            return (
              <div key={t.id} className="f-mono" style={{ display: 'grid', gridTemplateColumns: '0.5fr 0.6fr 1.2fr 0.7fr 0.5fr 0.8fr', fontSize: 10, color: TEXT, padding: '2px 0', borderTop: '1px solid #16293c' }}>
                <span style={{ color: AMBER }}>{t.id}</span>
                <span style={{ color: MUT }}>{(TGT_TYPES[t.type] || {}).code || t.type}</span>
                <span>{t.name} <span style={{ color: col, fontSize: 8 }}>{lbl}</span></span>
                <span>{t.hp}/{t.maxHp}</span><span>{t.hits}</span><span style={{ color: t.dmgM > 0 ? RED : MUT }}>${t.dmgM.toFixed(1)}M</span>
              </div>
            );
          })}
          {report.adSites && report.adSites.total > 0 && (
            <div className="f-mono" style={{ fontSize: 9, marginTop: 8, padding: '6px 8px', border: `1px solid ${report.adSites.destroyed > 0 ? RED : '#243d52'}`, borderRadius: 3, background: report.adSites.destroyed > 0 ? 'rgba(210,74,68,0.08)' : 'transparent', color: report.adSites.destroyed > 0 ? '#e09a9a' : MUT }}>
              AIR DEFENCE SITES (SEAD/DEAD): {report.adSites.total - report.adSites.destroyed}/{report.adSites.total} surviving{report.adSites.destroyed > 0 ? ' · destroyed: ' + report.adSites.list.join(', ') : ' · all intact'}
            </div>
          )}

          <div className="f-mono" style={{ fontSize: 9, color: MUT, marginTop: 12 }}>
            {report.targetCount} targets · {report.batteries} batteries · WX {report.weather.preset}{report.weather.night ? ' night' : ''}, wind {report.weather.windKmh} km/h · {(SALVO[report.salvo] || SALVO.single).label} · sim {report.simSec}s{report.seed ? ' · seed ' + report.seed : ''}
          </div>
          <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginTop: 8, paddingTop: 6, borderTop: '1px solid #243d52', letterSpacing: '0.04em' }}>
            ILLUSTRATIVE · UNCLASSIFIED · NOT VALIDATED OA. All costs and values are order-of-magnitude from public sources and expert estimate, not authoritative TTP or procurement data.
          </div>
        </div>
      </div>
    </div>
  );
}
function Big({ label, v, c, sub }) {
  return (
    <div style={{ padding: '8px 10px', border: '1px solid #243d52', borderRadius: 3, background: '#0a1626' }}>
      <div className="f-mono" style={{ fontSize: 8, color: '#93a1b0', letterSpacing: '0.08em' }}>{label}</div>
      <div className="f-display" style={{ fontSize: 22, color: c }}>{v}</div>
      {sub && <div className="f-mono" style={{ fontSize: 8, color: '#93a1b0' }}>{sub}</div>}
    </div>
  );
}

function MCResults({ mc, seed }) {
  const pc = (s) => `${(s.mean * 100).toFixed(0)}%`;
  const pcCI = (s) => `${(s.lo * 100).toFixed(0)}–${(s.hi * 100).toFixed(0)}%`;
  const n1 = (s) => s.mean.toFixed(1);
  const ir = mc.interceptRate, pr = mc.protect, lk = mc.leaked, sp = mc.spentM, ex = mc.exchange;
  return (
    <div>
      <div className="f-mono" style={{ fontSize: 8, color: MUT, marginBottom: 8 }}>{mc.N} seeded runs · 95% confidence intervals · seed {seed}</div>
      <Stat label="Intercept rate" v={`${pc(ir)} mean`} sub={`95% CI ${pcCI(ir)} · P10 ${(ir.p10 * 100).toFixed(0)}% / P90 ${(ir.p90 * 100).toFixed(0)}%`} color={ir.mean > 0.8 ? GREEN : ir.mean > 0.6 ? AMBER : RED} />
      <Stat label="Real-threat protection" v={`${pc(pr)} mean`} sub={`95% CI ${pcCI(pr)} (decoys excluded)`} color={pr.mean > 0.85 ? GREEN : pr.mean > 0.6 ? AMBER : RED} />
      <Stat label="Leakers reaching target" v={`${n1(lk)} mean`} sub={`95% CI ${lk.lo.toFixed(1)}–${lk.hi.toFixed(1)} · P90 ${lk.p90} · worst ${lk.max}`} color={RED} />
      <Stat label="Defence spend" v={`$${n1(sp)}M`} sub={`95% CI $${sp.lo.toFixed(1)}–${sp.hi.toFixed(1)}M`} color={BLUE} />
      <Stat label="Cost exchange" v={`${n1(ex)} : 1`} sub={`threat value killed per $ spent · 95% CI ${ex.lo.toFixed(1)}–${ex.hi.toFixed(1)}`} color={ex.mean >= 1 ? GREEN : AMBER} />
      <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginTop: 6 }}>Confidence intervals narrow as runs increase. Same seed reproduces the run exactly.</div>
    </div>
  );
}

const btn = (c) => ({ fontSize: 11, padding: '7px 12px', border: `1px solid ${c}`, borderRadius: 3, background: 'transparent', color: c, cursor: 'pointer', letterSpacing: '0.04em' });
const actBtn = (c, dis) => ({ flex: 1, fontSize: 12, padding: '10px', border: `1px solid ${c}`, borderRadius: 3, background: dis ? '#16293c' : 'rgba(47,128,214,0.10)', color: dis ? MUT : '#fff', cursor: dis ? 'not-allowed' : 'pointer', letterSpacing: '0.03em' });
const miniIn = { width: '100%', fontSize: 10, padding: '4px 3px', background: '#0a1626', border: '1px solid #243d52', color: '#dde3ea', borderRadius: 3 };
function MiniField({ label, children }) { return <div><div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginBottom: 1 }}>{label}</div>{children}</div>; }
function Section({ title, children }) { return <div style={{ marginBottom: 16 }}><div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 8 }}>{title}</div>{children}</div>; }

function SyncMatrix({ matrix, targets, onShift }) {
  const ORI = {}; THREAT_ORIGINS.forEach(o => { ORI[o.id] = o; });
  const MUT = '#93a1b0', AMBER = '#d9a52f';
  const FAM = { ballistic: '#d24a44', cruise: '#e0726b', owa: '#d9a52f', glide: '#c2873e' };
  // estimate launch and time-on-target for each wave (hours from H+0)
  const tgt0 = targets[0] || { lat: 50.45, lng: 30.52 };
  const rows = matrix.map(r => {
    const o = ORI[r.from] || { lat: 55, lng: 37 };
    const distKm = kmBetween({ lat: o.lat, lng: o.lng }, { lat: tgt0.lat, lng: tgt0.lng });
    const kmh = r.kmh || 185;
    const flightH = distKm / kmh;
    const launchH = r.startGH || 0;
    const firstArr = launchH + flightH;
    const lastArr = firstArr + ((Math.max(1, r.count) - 1) * (r.spacingSec || 30)) / 3600;
    return { ...r, launchH, firstArr, lastArr, flightH };
  });
  const maxH = Math.max(1.0, ...rows.map(r => r.lastArr)) * 1.05;
  const pct = h => (h / maxH) * 100;
  return (
    <div style={{ marginTop: 10, border: '1px solid #243d52', borderRadius: 3, padding: 8, background: '#0a1626' }}>
      <div className="f-mono" style={{ fontSize: 9, color: '#56a0e0', marginBottom: 2 }}>TIME-ON-TARGET SYNCHRONISATION</div>
      <div className="f-mono" style={{ fontSize: 7.5, color: MUT, marginBottom: 7, lineHeight: 1.4 }}>
        Bars show each wave from launch (hollow) to arrival window over the target (solid), using origin distance and threat speed. Use the arrows to shift a wave so strikes land together or in sequence.
      </div>
      {rows.map((r, i) => (
        <div key={r.id} style={{ marginBottom: 6 }}>
          <div className="f-mono" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 8, marginBottom: 2 }}>
            <span style={{ color: FAM[r.family] || '#dde3ea' }}>{r.type} ×{r.count}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: MUT }}>TOT H+{r.firstArr.toFixed(2)}</span>
              <button onClick={() => onShift(r.id, -0.25)} style={{ fontSize: 9, padding: '0 5px', border: '1px solid #34516b', borderRadius: 2, background: 'transparent', color: '#cdd6e0', cursor: 'pointer' }}>◂</button>
              <button onClick={() => onShift(r.id, +0.25)} style={{ fontSize: 9, padding: '0 5px', border: '1px solid #34516b', borderRadius: 2, background: 'transparent', color: '#cdd6e0', cursor: 'pointer' }}>▸</button>
            </span>
          </div>
          <div style={{ position: 'relative', height: 11, background: '#0c1c2e', border: '1px solid #16293c', borderRadius: 2 }}>
            {/* launch->first arrival (transit) hollow */}
            <div style={{ position: 'absolute', left: pct(r.launchH) + '%', width: Math.max(1, pct(r.firstArr) - pct(r.launchH)) + '%', top: 3, height: 5, border: `1px solid ${FAM[r.family] || '#6b7d8f'}`, borderRadius: 2, opacity: 0.5 }} />
            {/* arrival window solid */}
            <div style={{ position: 'absolute', left: pct(r.firstArr) + '%', width: Math.max(2, pct(r.lastArr) - pct(r.firstArr)) + '%', top: 2, height: 7, background: FAM[r.family] || '#6b7d8f', borderRadius: 2 }} />
          </div>
        </div>
      ))}
      {/* time axis */}
      <div style={{ position: 'relative', height: 12, marginTop: 2 }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <span key={f} className="f-mono" style={{ position: 'absolute', left: (f * 100) + '%', transform: 'translateX(-50%)', fontSize: 7, color: '#5d6b7a' }}>H+{(f * maxH).toFixed(1)}</span>
        ))}
      </div>
    </div>
  );
}

function TypedWaypointAdder({ onAdd, defaultAlt }) {
  const [lat, setLat] = React.useState('');
  const [lng, setLng] = React.useState('');
  const [alt, setAlt] = React.useState(defaultAlt || 1000);
  const MUT = '#93a1b0';
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginTop: 4 }}>
      <span className="f-mono" style={{ fontSize: 7, color: MUT }}>add by coord</span>
      <input type="number" placeholder="lat" value={lat} step={0.01} onChange={e => setLat(e.target.value)} style={{ width: 46, fontSize: 8, padding: '2px 3px', background: '#0a1626', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }} />
      <input type="number" placeholder="lng" value={lng} step={0.01} onChange={e => setLng(e.target.value)} style={{ width: 46, fontSize: 8, padding: '2px 3px', background: '#0a1626', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }} />
      <input type="number" placeholder="alt" value={alt} step={50} onChange={e => setAlt(e.target.value)} style={{ width: 42, fontSize: 8, padding: '2px 3px', background: '#0a1626', border: '1px solid #34516b', borderRadius: 2, color: '#fff' }} />
      <button onClick={() => { const la = parseFloat(lat), ln = parseFloat(lng), al = parseFloat(alt); if (isFinite(la) && isFinite(ln)) { onAdd(la, ln, isFinite(al) ? al : 1000); setLat(''); setLng(''); } }}
        className="f-mono" style={{ fontSize: 8, padding: '2px 7px', border: '1px solid #4f9d77', borderRadius: 2, background: 'rgba(79,157,119,0.14)', color: '#4f9d77', cursor: 'pointer' }}>ADD</button>
    </div>
  );
}
function Select({ value, onChange, options, disabled }) { return <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className="f-mono" style={{ width: '100%', fontSize: 11, padding: '6px 4px', background: '#0a1626', border: '1px solid #243d52', color: '#dde3ea', borderRadius: 3, opacity: disabled ? 0.5 : 1 }}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>; }
function Stat({ label, v, sub, color }) { return <div style={{ marginBottom: 8, padding: '6px 8px', border: '1px solid #243d52', borderRadius: 3, background: '#0a1626' }}><div className="f-mono" style={{ fontSize: 9, color: '#93a1b0' }}>{label}</div><div className="f-display" style={{ fontSize: 17, color }}>{v}</div>{sub && <div className="f-mono" style={{ fontSize: 9, color: '#93a1b0' }}>{sub}</div>}</div>; }
function Live({ label, v, c }) { return <div style={{ textAlign: 'center' }}><div className="f-mono" style={{ fontSize: 8, color: '#93a1b0' }}>{label}</div><div className="f-display" style={{ fontSize: 18, color: c }}>{v}</div></div>; }
