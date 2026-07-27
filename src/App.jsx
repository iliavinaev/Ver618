import React, { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { MultiplayerGameView } from './mp/MultiplayerGameView.jsx';
import { useMultiplayer as useMultiplayerHook, generateRoomCode as generateRoomCodeFn } from './mp/useMultiplayer';
import { JATEC_LOGO, PM_LOGO, AURELIA_SAT } from './jatecLogo.js';
import L from 'leaflet';
import { AD_LIBRARY, AD_CATEGORIES } from './data/airDefense';
import { OFFENSIVE_LIBRARY, OFFENSIVE_CATEGORIES } from './data/offensiveSystems';
import * as XLSX from 'xlsx';
import OperationalPlan from './OperationalPlan.jsx';

// ============================================================================
// UNIFIED LIBRARY WORKBOOK
// The defence and offensive catalogues have different native shapes. For an
// Excel round-trip both are flattened onto one common column set, so a single
// workbook holds the whole reference base and can be edited in Excel and read
// back. Unknown columns are ignored on import; missing ones are simply blank.
// ============================================================================
const LIB_COLUMNS = [
  'side', 'category', 'family', 'name', 'country', 'manufacturer', 'class',
  'range_km', 'range_text', 'altitude_km', 'altitude_text', 'speed_text',
  'armament', 'guidance', 'launchers', 'per_launcher', 'radar', 'cost',
  'threat_class', 'available', 'notes',
];
// flatten a native library entry onto the shared column set
function libRowFromEntry(e, side) {
  const isDef = side === 'DEFENCE';
  return {
    side,
    category: (isDef ? e.cat : e.category || e.tab) || '',
    family: e.family || '',
    name: e.name || '',
    country: e.country || e.nation || '',
    manufacturer: e.mfr || '',
    class: e.cls || e.type || '',
    range_km: e.rangeKm != null ? e.rangeKm : '',
    range_text: e.rangeText || '',
    altitude_km: e.altKm != null ? e.altKm : '',
    altitude_text: e.altText || e.ceilText || '',
    speed_text: e.speedText || '',
    armament: e.missile || e.armament || e.warhead || '',
    guidance: e.guidance || '',
    launchers: e.launchers != null ? e.launchers : '',
    per_launcher: e.perLauncher != null ? e.perLauncher : '',
    radar: e.radar || '',
    cost: e.cost || e.costMissile || e.sysCost || '',
    threat_class: e.threatClass || '',
    available: isDef ? (e.deployable === false ? 'no' : 'yes') : (e.usable === false ? 'no' : 'yes'),
    notes: e.notes || '',
  };
}
// rebuild a native entry from a spreadsheet row
function entryFromLibRow(row, side) {
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const name = String(row.name || '').trim();
  if (!name) return null;
  const common = {
    family: String(row.family || name).trim(),
    name,
    country: String(row.country || '').trim(),
    mfr: String(row.manufacturer || '').trim(),
    cls: String(row.class || '').trim(),
    rangeKm: num(row.range_km),
    rangeText: String(row.range_text || '').trim(),
    altKm: num(row.altitude_km),
    altText: String(row.altitude_text || '').trim(),
    speedText: String(row.speed_text || '').trim(),
    guidance: String(row.guidance || '').trim(),
    cost: String(row.cost || '').trim(),
    notes: String(row.notes || '').trim(),
  };
  if (side === 'DEFENCE') {
    return {
      ...common,
      cat: String(row.category || 'SAM').trim().toUpperCase().replace(/[^A-Z_]/g, '_') || 'SAM',
      missile: String(row.armament || '').trim(),
      launchers: num(row.launchers),
      perLauncher: num(row.per_launcher),
      radar: String(row.radar || '').trim(),
      deployable: String(row.available || 'yes').toLowerCase() !== 'no',
    };
  }
  return {
    ...common,
    category: String(row.category || '').trim(),
    warhead: String(row.armament || '').trim(),
    threatClass: String(row.threat_class || '').trim(),
    usable: String(row.available || 'yes').toLowerCase() !== 'no',
  };
}
function exportLibraryWorkbook(customDef, customOff) {
  const def = [...AD_LIBRARY, ...(customDef || [])].map(e => libRowFromEntry(e, 'DEFENCE'));
  const off = [...OFFENSIVE_LIBRARY, ...(customOff || [])].map(e => libRowFromEntry(e, 'OFFENSIVE'));
  const readme = [
    { field: 'PURPOSE', meaning: 'Unified SKYWATCH reference libraries. Edit here, then import the file back into the tool.' },
    { field: 'HOW TO ADD', meaning: 'Add rows to the DEFENCE or OFFENSIVE sheet. Only "name" is mandatory. On import, rows whose name already exists are skipped.' },
    { field: 'side', meaning: 'DEFENCE or OFFENSIVE. Set automatically per sheet.' },
    { field: 'category', meaning: 'DEFENCE: SAM, MANPADS, GUN_LASER, MVG, INTERCEPTOR, RADAR, ESM, EW (RED_* rows are enemy reference and are never placeable). OFFENSIVE: the threat grouping.' },
    { field: 'range_km', meaning: 'Numeric. For a weapon this is engagement range; for a radar or ESM station it is detection range; for a threat it is flight range.' },
    { field: 'altitude_km', meaning: 'Numeric ceiling. For mobile fire groups this is the hard altitude gate that decides whether a high-flying drone can be engaged at all.' },
    { field: 'armament', meaning: 'Missile, gun or warhead description.' },
    { field: 'available', meaning: 'yes or no. "no" marks a reference-only entry that cannot be placed.' },
    { field: 'CAUTION', meaning: 'All values are illustrative open-source estimates, not validated operational analysis.' },
  ];
  const wb = XLSX.utils.book_new();
  const mk = (rows, cols) => {
    const ws = XLSX.utils.json_to_sheet(rows, cols ? { header: cols } : undefined);
    ws['!cols'] = (cols || Object.keys(rows[0] || {})).map(c => ({ wch: c === 'notes' ? 60 : c === 'name' || c === 'family' ? 26 : 14 }));
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, mk(readme), 'README');
  XLSX.utils.book_append_sheet(wb, mk(def, LIB_COLUMNS), 'DEFENCE');
  XLSX.utils.book_append_sheet(wb, mk(off, LIB_COLUMNS), 'OFFENSIVE');
  XLSX.writeFile(wb, 'skywatch-libraries.xlsx');
}


// ============================================================================
// SKYWATCH/6.0, Brigade Air Defense Operations
// v6.0, DELTA-STYLE COP REDESIGN + RECON-STRIKE DEPENDENCY
//   Visual: Dark navy COP theme, NATO MIL-STD-2525 affiliation colors,
//           clean sans-serif typography, vector-tile inspired map,
//           card-based sidebar widgets, tactical sit awareness layout.
//   Mechanics:
//     - Recon-strike dependency: Iskander/Kinzhal need HALE alive,
//       KAB needs Orlan-30, Lancet needs ZALA. Saturation strikes
//       (Geran/cruise) work without recon but with reduced PK.
//     - Recon coverage tracker per region (NE/E/SE) with timeout.
//     - Designation alerts: when adversary recon is illuminating zone,
//       Blue gets warning ("KAB strike window OPEN, designator active").
//     - Strict ID realism: recon footprints visible to Blue ONLY
//       when adversary recon is classified.
//     - Strikes auto-cancelled if dependent recon killed in time.
// Time compression: 28 real-minutes = 48 game-hours (1 real-sec = ~103 game-sec)
// Player commands AD assets via menu, does NOT click on targets.
// ============================================================================

const MAP_W = 900;
const MAP_H = 580;

// 28 min real-time = 48h game-time
const TIME_COMPRESSION = 103;
const TOTAL_GAME_HOURS = 48;
const TOTAL_REAL_MS = (TOTAL_GAME_HOURS * 3600 * 1000) / TIME_COMPRESSION;

const GH = (hours) => hours * 3600 * 1000;

// ============================================================================
// TOPOGRAPHY
// ============================================================================
const TERRAIN = {
  msr: 'M 50 290 L 280 280 L 460 295 L 640 285 L 850 295',
  northRoad: 'M 80 150 L 250 165 L 420 145 L 600 160 L 820 150',
  southRoad: 'M 70 440 L 240 425 L 410 445 L 590 430 L 830 445',
  conn1: 'M 250 165 L 280 280 L 240 425',
  conn2: 'M 600 160 L 640 285 L 590 430',
  river: 'M 30 90 Q 200 110 380 80 T 700 95 L 870 80',
  forests: [
    { x: 120, y: 220, w: 100, h: 60 },
    { x: 380, y: 350, w: 140, h: 80 },
    { x: 680, y: 380, w: 110, h: 70 },
    { x: 540, y: 200, w: 90, h: 60 },
    { x: 200, y: 380, w: 80, h: 50 },
  ],
  villages: [
    { x: 240, y: 280, name: 'KOLOSY', size: 'sm' },
    { x: 460, y: 295, name: 'BEREZH', size: 'md' },
    { x: 640, y: 285, name: 'DUBYNE', size: 'sm' },
    { x: 380, y: 80, name: 'VYSHNI', size: 'sm' },
    { x: 590, y: 430, name: 'NYZHNI', size: 'sm' },
  ],
  hills: [
    { x: 320, y: 200, r: 35 },
    { x: 560, y: 380, r: 30 },
    { x: 750, y: 220, r: 25 },
  ],
};

const FRIENDLY_BOUND = { xMin: 60, xMax: 600, yMin: 50, yMax: 540 };
const FLOT_PATH = 'M 700 60 Q 690 200 720 290 Q 740 380 710 540';

// ============================================================================
// BRIGADE BATTLE ORDER, full NATO defensive layout to platoon level
// MIL-STD-2525 simplified: rectangle + size indicator above
// size: 'X' = corps, 'III' = brigade, 'II' = battalion, 'I' = company, '•••' = platoon, '••' = section
// type: 'inf' (mech infantry), 'arm' (armor), 'arty', 'mortar', 'recon', 'engr', 'log', 'cp', 'med', 'at' (anti-tank)
// kind: 'bde'|'bn'|'coy'|'plt'|'sec', determines render size/style
// ============================================================================

// Helper: generate 3 platoons for a company at company position with offsets toward FLOT
// Companies sit ~525-565 X. Platoons sit ahead at 615-660 X spread vertically across 50-60 px
const platoons = (cid, cx, cy, baseLabel, type) => {
  const px = cx + 90; // platoons forward of company HQ
  const offsets = [-35, 0, +35]; // y spread
  return offsets.map((dy, i) => ({
    id: `${cid}_p${i+1}`, x: px + (i === 1 ? 8 : 0), y: cy + dy,
    name: `${i+1}`, size: '•••', type, label: `${i+1} PLT ${baseLabel}`, kind: 'plt',
  }));
};

const UNITS = [
  // ============================================================================
  // 1st MECH BATTALION, north sector
  // ============================================================================
  { id: 'bn1_hq',  x: 460, y: 135, name: '1', size: 'II', type: 'inf', label: '1 MECH BN HQ', kind: 'bn' },
  { id: 'bn1_tac', x: 488, y: 158, name: 'T', size: '•••', type: 'cp', label: 'BN TAC', kind: 'plt' },
  { id: 'bn1_mor', x: 430, y: 168, name: 'M', size: 'I', type: 'mortar', label: '1 BN MORTAR BTRY', kind: 'coy' },
  { id: 'bn1_at',  x: 405, y: 130, name: 'AT', size: '•••', type: 'at', label: '1 BN AT PLT', kind: 'plt' },
  { id: 'bn1_scout',x: 430, y: 95, name: 'S', size: '•••', type: 'recon', label: '1 BN SCOUT PLT', kind: 'plt' },
  { id: 'bn1_med', x: 395, y: 158, name: 'M', size: '•••', type: 'med', label: '1 BN AID', kind: 'plt' },

  // A Co, 1 Bn, NORTH-NORTH FLOT sector
  { id: 'bn1a_hq', x: 530, y: 95,  name: 'A/1', size: 'I', type: 'inf', label: 'A CO 1 BN', kind: 'coy' },
  ...platoons('bn1a', 530, 95, 'A/1', 'inf'),
  // B Co, 1 Bn, NORTH-CENTRAL FLOT sector
  { id: 'bn1b_hq', x: 545, y: 160, name: 'B/1', size: 'I', type: 'inf', label: 'B CO 1 BN', kind: 'coy' },
  ...platoons('bn1b', 545, 160, 'B/1', 'inf'),
  // C Co, 1 Bn (TANK Team), NORTH-SOUTH FLOT sector
  { id: 'bn1c_hq', x: 525, y: 220, name: 'C/1', size: 'I', type: 'arm', label: 'TM C 1 BN (TANK)', kind: 'coy' },
  ...platoons('bn1c', 525, 220, 'C/1', 'arm'),

  // ============================================================================
  // 2nd MECH BATTALION, center sector
  // ============================================================================
  { id: 'bn2_hq',  x: 460, y: 290, name: '2', size: 'II', type: 'inf', label: '2 MECH BN HQ', kind: 'bn' },
  { id: 'bn2_tac', x: 488, y: 313, name: 'T', size: '•••', type: 'cp', label: 'BN TAC', kind: 'plt' },
  { id: 'bn2_mor', x: 430, y: 320, name: 'M', size: 'I', type: 'mortar', label: '2 BN MORTAR BTRY', kind: 'coy' },
  { id: 'bn2_at',  x: 405, y: 285, name: 'AT', size: '•••', type: 'at', label: '2 BN AT PLT', kind: 'plt' },
  { id: 'bn2_scout',x: 430, y: 252, name: 'S', size: '•••', type: 'recon', label: '2 BN SCOUT PLT', kind: 'plt' },
  { id: 'bn2_med', x: 395, y: 312, name: 'M', size: '•••', type: 'med', label: '2 BN AID', kind: 'plt' },

  // A Co, 2 Bn
  { id: 'bn2a_hq', x: 540, y: 255, name: 'A/2', size: 'I', type: 'inf', label: 'A CO 2 BN', kind: 'coy' },
  ...platoons('bn2a', 540, 255, 'A/2', 'inf'),
  // B Co, 2 Bn
  { id: 'bn2b_hq', x: 555, y: 320, name: 'B/2', size: 'I', type: 'inf', label: 'B CO 2 BN', kind: 'coy' },
  ...platoons('bn2b', 555, 320, 'B/2', 'inf'),
  // C Co, 2 Bn (Tank team)
  { id: 'bn2c_hq', x: 535, y: 380, name: 'C/2', size: 'I', type: 'arm', label: 'TM C 2 BN (TANK)', kind: 'coy' },
  ...platoons('bn2c', 535, 380, 'C/2', 'arm'),

  // ============================================================================
  // 3rd MECH BATTALION, south sector
  // ============================================================================
  { id: 'bn3_hq',  x: 460, y: 445, name: '3', size: 'II', type: 'inf', label: '3 MECH BN HQ', kind: 'bn' },
  { id: 'bn3_tac', x: 488, y: 468, name: 'T', size: '•••', type: 'cp', label: 'BN TAC', kind: 'plt' },
  { id: 'bn3_mor', x: 430, y: 478, name: 'M', size: 'I', type: 'mortar', label: '3 BN MORTAR BTRY', kind: 'coy' },
  { id: 'bn3_at',  x: 405, y: 440, name: 'AT', size: '•••', type: 'at', label: '3 BN AT PLT', kind: 'plt' },
  { id: 'bn3_scout',x: 430, y: 412, name: 'S', size: '•••', type: 'recon', label: '3 BN SCOUT PLT', kind: 'plt' },
  { id: 'bn3_med', x: 395, y: 466, name: 'M', size: '•••', type: 'med', label: '3 BN AID', kind: 'plt' },

  // A Co, 3 Bn
  { id: 'bn3a_hq', x: 540, y: 405, name: 'A/3', size: 'I', type: 'inf', label: 'A CO 3 BN', kind: 'coy' },
  ...platoons('bn3a', 540, 405, 'A/3', 'inf'),
  // B Co, 3 Bn
  { id: 'bn3b_hq', x: 555, y: 470, name: 'B/3', size: 'I', type: 'inf', label: 'B CO 3 BN', kind: 'coy' },
  ...platoons('bn3b', 555, 470, 'B/3', 'inf'),
  // C Co, 3 Bn
  { id: 'bn3c_hq', x: 530, y: 525, name: 'C/3', size: 'I', type: 'inf', label: 'C CO 3 BN', kind: 'coy' },
  ...platoons('bn3c', 530, 525, 'C/3', 'inf'),

  // ============================================================================
  // BRIGADE ARTILLERY BATTALION, rear
  // ============================================================================
  { id: 'arty_hq',  x: 195, y: 410, name: 'ART', size: 'II', type: 'arty', label: 'BDE ARTY BN HQ', kind: 'bn' },
  // A Btry 155mm, south
  { id: 'arty_a',   x: 250, y: 460, name: 'A',   size: 'I', type: 'arty', label: 'A BTRY 155mm', kind: 'coy' },
  { id: 'arty_a1',  x: 240, y: 480, name: '1', size: '••',  type: 'arty', label: '1 SEC', kind: 'sec' },
  { id: 'arty_a2',  x: 260, y: 478, name: '2', size: '••',  type: 'arty', label: '2 SEC', kind: 'sec' },
  { id: 'arty_a3',  x: 252, y: 498, name: '3', size: '••',  type: 'arty', label: '3 SEC', kind: 'sec' },
  // B Btry 155mm, center
  { id: 'arty_b',   x: 175, y: 460, name: 'B',   size: 'I', type: 'arty', label: 'B BTRY 155mm', kind: 'coy' },
  { id: 'arty_b1',  x: 162, y: 478, name: '1', size: '••',  type: 'arty', label: '1 SEC', kind: 'sec' },
  { id: 'arty_b2',  x: 184, y: 480, name: '2', size: '••',  type: 'arty', label: '2 SEC', kind: 'sec' },
  { id: 'arty_b3',  x: 175, y: 498, name: '3', size: '••',  type: 'arty', label: '3 SEC', kind: 'sec' },
  // C Btry MLRS
  { id: 'arty_c',   x: 110, y: 425, name: 'C',   size: 'I', type: 'arty', label: 'C BTRY MLRS', kind: 'coy' },
  { id: 'arty_c1',  x: 95,  y: 445, name: '1', size: '••',  type: 'arty', label: '1 SEC MLRS', kind: 'sec' },
  { id: 'arty_c2',  x: 120, y: 446, name: '2', size: '••',  type: 'arty', label: '2 SEC MLRS', kind: 'sec' },

  // ============================================================================
  // BDE RECON COMPANY, flanks
  // ============================================================================
  { id: 'recon_co_hq', x: 380, y: 75,  name: 'R', size: 'I', type: 'recon', label: 'BDE RECON CO', kind: 'coy' },
  { id: 'recon_n1',    x: 440, y: 70,  name: '1', size: '•••', type: 'recon', label: '1 PLT N FLANK', kind: 'plt' },
  { id: 'recon_n2',    x: 510, y: 65,  name: '2', size: '•••', type: 'recon', label: '2 PLT N FLANK', kind: 'plt' },
  { id: 'recon_s1',    x: 440, y: 535, name: '3', size: '•••', type: 'recon', label: '3 PLT S FLANK', kind: 'plt' },
  { id: 'recon_s2',    x: 510, y: 540, name: '4', size: '•••', type: 'recon', label: '4 PLT S FLANK', kind: 'plt' },

  // ============================================================================
  // RESERVE TASK FORCE, center deep
  // ============================================================================
  { id: 'res_tf_hq',  x: 280, y: 240, name: 'TF', size: 'I',   type: 'arm', label: 'TF RESERVE (TANK)', kind: 'coy' },
  { id: 'res_tk1',    x: 305, y: 220, name: '1', size: '•••', type: 'arm', label: '1 TANK PLT', kind: 'plt' },
  { id: 'res_tk2',    x: 305, y: 260, name: '2', size: '•••', type: 'arm', label: '2 TANK PLT', kind: 'plt' },
  { id: 'res_inf',    x: 270, y: 280, name: 'I', size: '•••', type: 'inf', label: 'MECH PLT', kind: 'plt' },

  // ============================================================================
  // BDE COMBAT SUPPORT
  // ============================================================================
  { id: 'engr_co',  x: 145, y: 320, name: 'E', size: 'I',   type: 'engr', label: 'COMBAT ENGR CO', kind: 'coy' },
  { id: 'engr_p1',  x: 165, y: 305, name: '1', size: '•••', type: 'engr', label: '1 ENGR PLT', kind: 'plt' },
  { id: 'engr_p2',  x: 165, y: 335, name: '2', size: '•••', type: 'engr', label: '2 ENGR PLT', kind: 'plt' },

  // ============================================================================
  // BDE LOGISTICS / BSA
  // ============================================================================
  { id: 'bsb_hq',   x: 100, y: 360, name: 'BSB', size: 'II', type: 'log', label: 'BDE SUPPORT BN', kind: 'bn' },
  { id: 'bsa',      x: 90,  y: 390, name: 'BSA', size: 'I',  type: 'log', label: 'BDE SUPPORT AREA', kind: 'coy' },

  // ============================================================================
  // BDE COMMAND
  // ============================================================================
  { id: 'bde_main', x: 95,  y: 200, name: 'X', size: 'III', type: 'cp', label: '1 MECH BDE MAIN', kind: 'bde' },
];

// Battalion AOR boundaries, drawn as dashed lines separating sectors
// Reference: between BNs y-coords are roughly 215 and 375
const BN_BOUNDARIES = [
  { y: 215, label: '1 / 2 BN BOUNDARY' },
  { y: 375, label: '2 / 3 BN BOUNDARY' },
];

// ============================================================================
// DEFENDED OBJECTS
// ============================================================================
const CAPITAL_NODES = [
  // Critical civilian infrastructure of the capital (AURELIA), all aerial-targetable
  { id: 'gov',     x: 360, y: 270, name: 'GOV QUARTER',   hp: 4, maxHp: 4, value: 4, glyph: '⬡', sym: 'GOV',  kind: 'rear' },
  { id: 'chp',     x: 300, y: 160, name: 'CHP-5',   hp: 3, maxHp: 3, value: 4, glyph: '⚡', sym: 'CHP',  kind: 'rear' },
  { id: 'substn',  x: 460, y: 195, name: 'SUBSTATION-N',  hp: 2, maxHp: 2, value: 3, glyph: '⚡', sym: 'PWR',  kind: 'rear' },
  { id: 'water',   x: 270, y: 385, name: 'WATER PLANT',   hp: 2, maxHp: 2, value: 3, glyph: '◌', sym: 'H2O',  kind: 'rear' },
  { id: 'hosp',    x: 420, y: 350, name: 'CENTRAL HOSP',  hp: 2, maxHp: 2, value: 2, glyph: '✚', sym: 'MED',  kind: 'rear' },
  { id: 'telecom', x: 480, y: 290, name: 'TELECOM HUB',   hp: 2, maxHp: 2, value: 2, glyph: '◉', sym: 'COM',  kind: 'rear' },
  { id: 'rail',    x: 340, y: 445, name: 'RAIL JUNCTION', hp: 2, maxHp: 2, value: 2, glyph: '▭', sym: 'RAIL', kind: 'rear' },
];

// Original brigade-level nodes (rear C2/log + forward strongpoints on the FLOT)
const BRIGADE_NODES = [
  { id: 'cp',      x: 380, y: 290, name: 'BDE TAC', hp: 4, maxHp: 4, value: 4, glyph: '◧', sym: 'TAC',   kind: 'rear' },
  { id: 'farp',    x: 320, y: 200, name: 'FARP-2',  hp: 3, maxHp: 3, value: 3, glyph: '✚', sym: 'FARP',  kind: 'rear' },
  { id: 'ammo',    x: 350, y: 410, name: 'ATP-3',   hp: 3, maxHp: 3, value: 3, glyph: '◬', sym: 'ATP',   kind: 'rear' },
  { id: 'medical', x: 270, y: 350, name: 'R-2',     hp: 2, maxHp: 2, value: 2, glyph: '✚', sym: 'R2',    kind: 'rear' },
  { id: 'fwd_n',   x: 590, y: 160, name: 'STP-N',   hp: 3, maxHp: 3, value: 2, glyph: '▲', sym: 'STP-N', kind: 'forward' },
  { id: 'fwd_c',   x: 610, y: 290, name: 'STP-C',   hp: 3, maxHp: 3, value: 2, glyph: '▲', sym: 'STP-C', kind: 'forward' },
  { id: 'fwd_s',   x: 580, y: 420, name: 'STP-S',   hp: 3, maxHp: 3, value: 2, glyph: '▲', sym: 'STP-S', kind: 'forward' },
];

// Capital scenario uses infrastructure nodes; brigade scenarios use military nodes.
const isCapital = (sc) => !!(sc && (sc.map === 'capital' || sc.id === 'stolytsia_24'));
const M_ALT_ORDER = { noe:0, low:1, med:2, high:3, ball:4 };
const M_CLASS_ALT = { ballistic:'ball', male:'high', cruise:'low', glide:'med', owa:'low', recon:'med', tactical:'low', indirect:'low', unknown:'low' };
const m_altIndex = (tt) => { const b = (tt && (tt.altBand || M_CLASS_ALT[tt.class])) || 'low'; const v = M_ALT_ORDER[b]; return v==null ? 1 : v; };
const m_ceilIndex = (c) => { if (c && c.ceiling && M_ALT_ORDER[c.ceiling]!=null) return M_ALT_ORDER[c.ceiling]; const e=(c&&c.engageDefault)||[]; if(e.includes('ballistic'))return 4; if(e.includes('male'))return 3; if(e.includes('cruise')||e.includes('glide'))return 2; return 1; };
// COST MODEL (illustrative, open-source figures, thousands USD)
const m_shotCostK = (at) => { const t={ patriot:4000, iris:800, nasams:1000, crotale:400, stinger:120, gepard:5, skynex:5, interceptor:30, zu23:1, hmg:0.5, pkm:0.2, mg:1, ew:0 }[at]; return t==null?50:t; };
const m_threatCostK = (tt) => {
  if(!tt) return 0;
  const s=((tt.code||'')+' '+(tt.name||'')).toUpperCase();
  if(s.includes('KINZHAL'))return 10000;
  if(s.includes('ISKANDER'))return 3000;
  if(s.includes('KH-101')||s.includes('KH101'))return 13000;
  if(s.includes('KH-22')||s.includes('KH22'))return 1000;
  if(s.includes('KALIBR'))return 6500;
  if(s.includes('KAB'))return 30;
  if(s.includes('GERAN')||s.includes('SHAHED'))return 35;
  if(s.includes('LANCET'))return 35;
  if(s.includes('FPV')||s.includes('UPYR')||s.includes('GHOUL'))return 0.5;
  if(s.includes('DECOY'))return 2;
  if(s.includes('ORION')||s.includes('FORPOST')||s.includes('ALTIUS')||s.includes('SIRIUS'))return 5000;
  if(s.includes('ORLAN')||s.includes('SUPERCAM')||s.includes('ZALA')||s.includes('ELERON')||s.includes('TACHYON'))return 80;
  if(s.includes('MAVIC')||s.includes('COTS'))return 3;
  const byClass={ ballistic:3000, cruise:2000, glide:30, owa:35, male:5000, recon:100, tactical:35, indirect:3, unknown:0 };
  return byClass[tt.class] || 50;
};
const m_gnssVuln = (tt) => { if(!tt) return false; if(tt.custom) return tt.navigation==='gnss_ins'; if(tt.ewVuln) return false; return tt.class==='cruise' || tt.class==='owa'; };
const nodesForScenario = (sc) => isCapital(sc) ? CAPITAL_NODES : BRIGADE_NODES;
// Nodes the player actually defends: authored / geo targets when present, else the map default.
const activeNodes = (sc) => (sc && sc.nodes && sc.nodes.length) ? sc.nodes : nodesForScenario(sc);
const NODES_BASE = CAPITAL_NODES; // default (capital demo)
// Authorable enemy target types for the scenario modeller (each = a defended node).
const NODE_TYPES = [
  { key:'gov',      name:'Government building', glyph:'\u2b21', sym:'GOV',  hp:4, value:4, kind:'rear' },
  { key:'hq',       name:'Military HQ / C2',    glyph:'\u25e7', sym:'HQ',   hp:4, value:4, kind:'rear' },
  { key:'power',    name:'Power plant',         glyph:'\u26a1', sym:'PWR',  hp:3, value:4, kind:'rear' },
  { key:'substn',   name:'Substation',          glyph:'\u26a1', sym:'SUB',  hp:2, value:3, kind:'rear' },
  { key:'comms',    name:'Comms / telecom',     glyph:'\u25c9', sym:'COM',  hp:2, value:3, kind:'rear' },
  { key:'logi',     name:'Logistics depot',     glyph:'\u25ec', sym:'LOG',  hp:3, value:3, kind:'rear' },
  { key:'airfield', name:'Airfield / FARP',     glyph:'▲', sym:'AF',   hp:3, value:3, kind:'rear' },
  { key:'bridge',   name:'Bridge / MSR',        glyph:'\u25ad', sym:'BRG',  hp:2, value:2, kind:'rear' },
  { key:'water',    name:'Water plant',         glyph:'\u25cc', sym:'H2O',  hp:2, value:3, kind:'rear' },
  { key:'hosp',     name:'Hospital',            glyph:'\u271a', sym:'MED',  hp:2, value:2, kind:'rear' },
  { key:'fwd',      name:'Forward strongpoint', glyph:'▲', sym:'STP',  hp:3, value:2, kind:'forward' },
];

// ===== Real-world map (Leaflet + Esri satellite tiles) =====
const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Imagery: Esri, Maxar, Earthstar Geographics';
// East-west ground width of a geo frame in km (at centre latitude).
const geoKmWidth = (geo) => geo ? Math.abs(geo.e - geo.w) * 111.32 * Math.cos(((geo.n + geo.s) / 2) * Math.PI / 180) : 0;
const geoKmPerPx = (geo) => geoKmWidth(geo) / MAP_W;
// Convert a stored geo target (lat/lng) to game px within a frame's bounds (linear).
const geoToPx = (geo, lat, lng) => ({
  x: ((lng - geo.w) / ((geo.e - geo.w) || 1)) * MAP_W,
  y: ((geo.n - lat) / ((geo.n - geo.s) || 1)) * MAP_H,
});

// Interactive picker: pan/zoom real satellite, click to drop targets, scale bar shown.
function GeoTargetEditor({ geoTargets, setGeoTargets, nodeType, initGeo, onBounds }) {
  const ref = useRef(null), mapRef = useRef(null), markersRef = useRef([]);
  const ntRef = useRef(nodeType); ntRef.current = nodeType;
  const gtRef = useRef(geoTargets); gtRef.current = geoTargets;
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomSnap: 0, worldCopyJump: true });
    L.tileLayer(ESRI_URL, { maxZoom: 19, attribution: ESRI_ATTR }).addTo(map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
    if (initGeo && initGeo.n != null) map.fitBounds([[initGeo.s, initGeo.w], [initGeo.n, initGeo.e]], { animate: false });
    else map.setView([50.8466, 4.3517], 11);
    map.on('click', (e) => {
      const t = NODE_TYPES.find(z => z.key === ntRef.current) || NODE_TYPES[0];
      const cnt = gtRef.current.filter(g => g.typeKey === t.key).length + 1;
      setGeoTargets([...gtRef.current, { id: t.key + '_' + Date.now(), lat: e.latlng.lat, lng: e.latlng.lng, name: t.sym + (cnt > 1 ? ('-' + cnt) : ''), hp: t.hp, maxHp: t.hp, value: t.value, glyph: t.glyph, sym: t.sym, kind: t.kind, typeKey: t.key }]);
    });
    const emit = () => { const b = map.getBounds(); onBounds && onBounds({ n: b.getNorth(), s: b.getSouth(), e: b.getEast(), w: b.getWest() }); };
    map.on('moveend zoomend', emit);
    mapRef.current = map;
    setTimeout(() => { map.invalidateSize(); emit(); }, 160);
    return () => { try { map.remove(); } catch (e) {} mapRef.current = null; markersRef.current = []; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    markersRef.current.forEach(m => { try { map.removeLayer(m); } catch (e) {} });
    markersRef.current = geoTargets.map(g => {
      const col = g.kind === 'forward' ? '#b8893a' : '#2f80d6';
      const m = L.marker([g.lat, g.lng], { icon: L.divIcon({ className: '', iconSize: [50, 26], iconAnchor: [25, 13], html: '<div style="text-align:center;font-family:monospace;font-size:9px;line-height:1.1;color:' + col + '"><span style="border:1.5px solid ' + col + ';background:rgba(10,22,38,0.74);border-radius:2px;padding:1px 3px;white-space:nowrap">' + g.glyph + ' ' + g.sym + '</span></div>' }) });
      m.on('click', () => setGeoTargets(gtRef.current.filter(x => x.id !== g.id)));
      m.addTo(map); return m;
    });
  }, [geoTargets]);
  return <div ref={ref} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />;
}

// Locked, non-interactive satellite background for the live battle/deploy map.
function GeoBackground({ geo }) {
  const ref = useRef(null), mapRef = useRef(null);
  useEffect(() => {
    if (!ref.current || mapRef.current || !geo) return;
    const map = L.map(ref.current, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0 });
    L.tileLayer(ESRI_URL, { maxZoom: 19, attribution: ESRI_ATTR }).addTo(map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
    const fit = () => { try { map.invalidateSize(); map.fitBounds([[geo.s, geo.w], [geo.n, geo.e]], { animate: false }); } catch (e) {} };
    fit();
    let ro; try { ro = new ResizeObserver(fit); ro.observe(ref.current); } catch (e) {}
    setTimeout(fit, 160);
    mapRef.current = map;
    return () => { try { ro && ro.disconnect(); map.remove(); } catch (e) {} mapRef.current = null; };
  }, []);
  return <div ref={ref} style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#0a1626' }} />;
}

// ============================================================================
// THREATS
// avoid: probability per second to deviate around active AD zone (0 = ballistic)
// signature: 'huge'|'large'|'medium'|'small'|'tiny', affects classify speed
// strategic: only engaged by Patriot-tier (player can't waste IRIS-T on Lancet)
// ============================================================================
const TT = {
  // ----- Ballistic (strategic) -----  maneuver: 0 = cannot alter course, flies straight
  iskander:   { name: 'ISKANDER-M',     code: 'BAL',       class: 'ballistic', speed: 0.28, classify: 800,  ewVuln: false, color: '#d24a44', sym: 'D',     dmg: 2, hint: 'Quasi-ballistic SRBM. Patriot only. Flies straight.', avoid: 0, maneuver: 0, gLimit: 0.5, signature: 'huge', strategic: true },
  kn23:       { name: 'KN-23 (DPRK)',   code: 'BAL-KN',    class: 'ballistic', speed: 0.30, classify: 800,  ewVuln: false, color: '#d24a44', sym: 'D',     dmg: 2, hint: 'DPRK SRBM, Iskander-class. Patriot only. Straight.', avoid: 0, maneuver: 0, gLimit: 0.5, signature: 'huge', strategic: true },
  oreshnik:   { name: 'ORESHNIK',       code: 'IRBM',      class: 'ballistic', speed: 0.62, classify: 600,  ewVuln: false, color: '#b03a34', sym: 'D',     dmg: 3, hint: 'IRBM (RS-26 derivative), MIRV: separates into independent blocks in the terminal phase. Near-impossible for current AD.', avoid: 0, maneuver: 0, gLimit: 0.5, mirv: 6, mirvSplitKm: 120, signature: 'huge', strategic: true },
  kinzhal:    { name: 'KH-47M2 KINZHAL',code: 'AERO-BAL',  class: 'ballistic', speed: 0.38, classify: 700,  ewVuln: false, color: '#e0726b', sym: 'star',  dmg: 2, hint: 'Aeroballistic, terminal maneuver. Patriot only.',     avoid: 0, maneuver: 0.35, gLimit: 3, signature: 'huge', strategic: true },

  // ----- Hypersonic cruise (maneuvering) -----
  zircon:     { name: '3M22 ZIRCON',    code: 'HCM',       class: 'cruise',    speed: 0.30, classify: 900,  ewVuln: false, color: '#e0726b', sym: 'arrow', dmg: 2, hint: 'Hypersonic sea-launched cruise. Maneuvers, very hard to intercept.', avoid: 0.15, maneuver: 0.8, gLimit: 6, signature: 'large', strategic: true },

  // ----- Cruise (strategic) -----  maneuver via route (terrain-follow around AD)
  kh101:      { name: 'KH-101',         code: 'CR-AIR',    class: 'cruise',    speed: 0.10, classify: 1700, ewVuln: false, color: '#d24a44', sym: 'arrow', dmg: 1, hint: 'Air-launched cruise. Terrain-follows around AD.',    avoid: 0.05, maneuver: 1.0, gLimit: 5, signature: 'large', strategic: true },
  kalibr:     { name: 'KALIBR',         code: 'CR-SEA',    class: 'cruise',    speed: 0.10, classify: 1700, ewVuln: false, color: '#e0726b', sym: 'arrow', dmg: 1, hint: 'Sea-launched cruise. Routes around AD.',            avoid: 0.05, maneuver: 1.0, gLimit: 5, signature: 'large', strategic: true },
  kh69:       { name: 'KH-69',          code: 'CR-STEALTH',class: 'cruise',    speed: 0.09, classify: 1900, ewVuln: false, color: '#d24a44', sym: 'arrow', dmg: 1, hint: 'Low-RCS stealthy cruise. Hard to detect, routes around AD.', avoid: 0.05, maneuver: 1.0, gLimit: 5, signature: 'small', strategic: true },
  kh22:       { name: 'KH-22',          code: 'CR-HVY',    class: 'cruise',    speed: 0.14, classify: 1500, ewVuln: false, color: '#d24a44', sym: 'arrow', dmg: 2, hint: 'Heavy cruise. Patriot only realistic.',           avoid: 0,    maneuver: 0.5, gLimit: 4, signature: 'large', strategic: true },
  kh59:       { name: 'KH-59',          code: 'CR-TAC',    class: 'cruise',    speed: 0.11, classify: 1600, ewVuln: false, color: '#c2873e', sym: 'arrow', dmg: 1, hint: 'Tactical air-launched cruise/standoff.',           avoid: 0.05, maneuver: 0.9, gLimit: 5, signature: 'medium' },

  // ----- Glide -----
  kab:        { name: 'UMPK/KAB',       code: 'GLIDE',     class: 'glide',     speed: 0.05, classify: 1200, ewVuln: true,  color: '#c2873e', sym: 'box',   dmg: 2, hint: 'Glide bomb. Short window.',                       avoid: 0,    maneuver: 0.2, gLimit: 3, signature: 'medium' },

  // ----- Indirect fire (surface impacts on FLOT, NOT aerial threats) -----
  arty:       { name: 'ARTY 152mm',     code: 'ARTY',      class: 'indirect',  speed: 0.30, classify: 600,  ewVuln: false, color: '#d24a44', sym: 'shell', dmg: 1, hint: 'Tube artillery, surface impact. AD cannot intercept.', avoid: 0, signature: 'tiny', indirect: true },
  mlrs:       { name: 'MLRS GRAD',      code: 'MLRS',      class: 'indirect',  speed: 0.40, classify: 500,  ewVuln: false, color: '#d24a44', sym: 'shell', dmg: 1, hint: 'Rocket artillery, saturation strike. AD cannot intercept.', avoid: 0, signature: 'small', indirect: true },
  mlrs_hvy:   { name: 'MLRS HEAVY',     code: 'MLRS-HVY',  class: 'indirect',  speed: 0.35, classify: 500,  ewVuln: false, color: '#d24a44', sym: 'shell', dmg: 2, hint: 'Heavy MRL (Smerch/Tornado), large warhead.',  avoid: 0,    signature: 'small', indirect: true },
  mortar:     { name: '120mm MORTAR',   code: 'MORT',      class: 'indirect',  speed: 0.20, classify: 700,  ewVuln: false, color: '#d24a44', sym: 'shell', dmg: 1, hint: 'Mortar fire on forward positions.',           avoid: 0,    signature: 'tiny', indirect: true },

  // ----- OWA / Long-range loitering -----
  geran2:     { name: 'GERAN-2',        code: 'OWA-LR',    class: 'owa',       speed: 0.05, classify: 2100, ewVuln: false, color: '#d9a52f', sym: 'D',     dmg: 1, hint: 'OWA loitering. Slow. Strategic. (Shahed-136 export).', avoid: 0.20, signature: 'medium' },
  geran1:     { name: 'GERAN-1',        code: 'OWA-SR',    class: 'owa',       speed: 0.05, classify: 2200, ewVuln: false, color: '#c8924e', sym: 'D',     dmg: 1, hint: 'Smaller OWA. Tactical.',                      avoid: 0.20, signature: 'medium' },
  geran2_jet: { name: 'GERAN-2 (jet)',  code: 'OWA-JET',   class: 'owa',       speed: 0.085,classify: 2000, ewVuln: false, color: '#c8924e', sym: 'D',     dmg: 1, hint: 'Jet variant. Faster.',                       avoid: 0.10, signature: 'medium' },
  kub_bla:    { name: 'KUB-BLA',        code: 'KUB',       class: 'owa',       speed: 0.06, classify: 2000, ewVuln: false, color: '#c8924e', sym: 'D',     dmg: 1, hint: 'Wing-shaped loitering. Optical guidance.',    avoid: 0.15, signature: 'medium' },
  privet82:   { name: 'PRIVET-82',      code: 'PRV-82',    class: 'owa',       speed: 0.065,classify: 2000, ewVuln: false, color: '#c8924e', sym: 'D',     dmg: 1, hint: 'Tactical loitering munition.',                avoid: 0.15, signature: 'small' },
  molniya:    { name: 'MOLNIYA',        code: 'MLNY',      class: 'owa',       speed: 0.07, classify: 2000, ewVuln: false, color: '#c8924e', sym: 'D',     dmg: 1, hint: 'Long-range loitering, air-launched.',         avoid: 0.10, signature: 'small' },

  // ----- Tactical / hunters -----
  lancet:     { name: 'LANCET-3',       code: 'IZD-52',    class: 'tactical',  speed: 0.045,classify: 2400, ewVuln: true,  color: '#c8924e', sym: 'T',     dmg: 1, hint: 'Hunts AD. EW vulnerable.',                   avoid: 0,    signature: 'small', target: 'ad_assets' },
  lancet_of:  { name: 'LANCET-OF',      code: 'IZD-OF',    class: 'tactical',  speed: 0.045,classify: 2400, ewVuln: false, color: '#c66060', sym: 'T',     dmg: 1, hint: 'Fiber-optic Lancet. EW IMMUNE.',             avoid: 0,    signature: 'small', target: 'ad_assets' },
  fpv:        { name: 'FPV STRIKE',     code: 'FPV',       class: 'tactical',  speed: 0.05, classify: 1500, ewVuln: true,  color: '#d9a52f', sym: 'S',     dmg: 1, hint: 'FPV suicide. EW critical.',                  avoid: 0,    signature: 'small', target: 'ad_assets' },
  fpv_of:     { name: 'FPV-OF',         code: 'FPV-OF',    class: 'tactical',  speed: 0.05, classify: 1500, ewVuln: false, color: '#e0726b', sym: 'S',     dmg: 1, hint: 'Fiber-optic FPV. EW IMMUNE. Kinetic only.',  avoid: 0,    signature: 'small', target: 'ad_assets' },
  upyr:       { name: 'UPYR',           code: 'UPYR',      class: 'tactical',  speed: 0.06, classify: 1700, ewVuln: true,  color: '#d9a52f', sym: 'S',     dmg: 1, hint: 'Heavier RU FPV strike.',                     avoid: 0,    signature: 'small', target: 'ad_assets' },
  ghoul:      { name: 'GHOUL',          code: 'GHL',       class: 'tactical',  speed: 0.06, classify: 1700, ewVuln: true,  color: '#c8924e', sym: 'S',     dmg: 1, hint: 'Heavier RU FPV strike.',                     avoid: 0,    signature: 'small', target: 'ad_assets' },

  // ----- Recon -----
  orlan10:    { name: 'ORLAN-10',       code: 'ORLAN-10',  class: 'recon',     speed: 0.045,classify: 2100, ewVuln: true,  color: '#c8924e', sym: 'O',     dmg: 0, hint: 'Recon. Paralleling = ballistic warning!',     avoid: 0.20, signature: 'small' },
  orlan30:    { name: 'ORLAN-30',       code: 'ORLAN-30',  class: 'recon',     speed: 0.05, classify: 2100, ewVuln: true,  color: '#c8924e', sym: 'O',     dmg: 0, hint: 'Laser designator. Used for KAB strikes.',     avoid: 0.20, signature: 'small' },
  zala:       { name: 'ZALA',           code: 'ZALA',      class: 'recon',     speed: 0.045,classify: 2200, ewVuln: true,  color: '#c8924e', sym: 'O',     dmg: 0, hint: 'Recon for Lancet targeting.',                 avoid: 0.25, signature: 'small' },
  eleron3:    { name: 'ELERON-3',       code: 'ELRN',      class: 'recon',     speed: 0.04, classify: 2200, ewVuln: true,  color: '#c8924e', sym: 'O',     dmg: 0, hint: 'Tactical recon UAV.',                         avoid: 0.25, signature: 'small' },
  supercam:   { name: 'SUPERCAM',       code: 'SCAM',      class: 'recon',     speed: 0.045,classify: 2200, ewVuln: true,  color: '#c8924e', sym: 'O',     dmg: 0, hint: 'Optical recon UAV.',                          avoid: 0.20, signature: 'small' },
  tachyon:    { name: 'TACHYON',        code: 'TCHY',      class: 'recon',     speed: 0.045,classify: 2300, ewVuln: true,  color: '#c8924e', sym: 'O',     dmg: 0, hint: 'Short-range recon.',                          avoid: 0.25, signature: 'tiny'  },
  mavic:      { name: 'COTS QUAD',      code: 'COTS',      class: 'recon',     speed: 0.025,classify: 1300, ewVuln: true,  color: '#c8924e', sym: 'O',     dmg: 0, hint: 'COTS quad. EW = RTL.',                        avoid: 0.30, signature: 'tiny'  },

  // ----- MALE strike-recon -----
  orion:      { name: 'ORION',          code: 'ORION',     class: 'male',      speed: 0.04, classify: 1800, ewVuln: false, color: '#d24a44', sym: 'arrow', dmg: 1, hint: 'MALE strike-recon. Slow, high. SHORAD weak vs altitude.', avoid: 0.05, signature: 'large' },
  forpost:    { name: 'FORPOST-R',      code: 'FRPST',     class: 'male',      speed: 0.035,classify: 1800, ewVuln: false, color: '#d24a44', sym: 'arrow', dmg: 0, hint: 'MALE recon. ELINT.',                          avoid: 0.05, signature: 'large' },
  altius:     { name: 'ALTIUS',         code: 'ALTS',      class: 'male',      speed: 0.04, classify: 1700, ewVuln: false, color: '#d24a44', sym: 'arrow', dmg: 1, hint: 'HALE/MALE. Strategic asset.',                avoid: 0.05, signature: 'large' },
  sirius:     { name: 'SIRIUS',         code: 'SRIS',      class: 'male',      speed: 0.04, classify: 1700, ewVuln: false, color: '#d24a44', sym: 'arrow', dmg: 1, hint: 'Strike-recon MALE.',                          avoid: 0.05, signature: 'large' },

  // ----- Decoys / ambiguous -----
  decoy:      { name: 'UNK CONTACT',    code: '???',       class: 'unknown',   speed: 0.035,classify: 2200, ewVuln: false, color: '#243d52', sym: 'Q',     dmg: 0, hint: 'Unidentified.',                               avoid: 0,    signature: 'small' },
  emit_decoy: { name: 'EMISSION DECOY', code: 'EMIT-DCY',  class: 'unknown',   speed: 0.04, classify: 2400, ewVuln: false, color: '#243d52', sym: 'Q',     dmg: 0, hint: 'Probe, engaging compromises position.',     avoid: 0,    signature: 'small', emissionDecoy: true },
};

// ============================================================================
// PROBABILITY-OF-KILL MATRIX
// male = Orion/Forpost/Sirius/Altius, high-altitude, slow, large RCS
// indirect = artillery/MLRS/mortar, surface impact, AD cannot intercept (P=0)
// ============================================================================
const PK = {
  patriot:     { ballistic: 0.85, cruise: 0.70, glide: 0.50, owa: 0.40, male: 0.80, tactical: 0.10, recon: 0.20, unknown: 0.10, indirect: 0.0 },
  iris:        { ballistic: 0.05, cruise: 0.80, glide: 0.65, owa: 0.75, male: 0.85, tactical: 0.40, recon: 0.55, unknown: 0.30, indirect: 0.0 },
  nasams:      { ballistic: 0.05, cruise: 0.75, glide: 0.60, owa: 0.70, male: 0.80, tactical: 0.40, recon: 0.50, unknown: 0.30, indirect: 0.0 },
  crotale:     { ballistic: 0.0,  cruise: 0.55, glide: 0.50, owa: 0.65, male: 0.50, tactical: 0.55, recon: 0.45, unknown: 0.30, indirect: 0.0 },
  stinger:     { ballistic: 0.0,  cruise: 0.20, glide: 0.30, owa: 0.55, male: 0.40, tactical: 0.40, recon: 0.45, unknown: 0.25, indirect: 0.0 },
  gepard:      { ballistic: 0.0,  cruise: 0.15, glide: 0.20, owa: 0.65, male: 0.30, tactical: 0.55, recon: 0.65, unknown: 0.30, indirect: 0.0 },
  skynex:      { ballistic: 0.0,  cruise: 0.20, glide: 0.25, owa: 0.65, male: 0.30, tactical: 0.60, recon: 0.65, unknown: 0.30, indirect: 0.0 },
  interceptor: { ballistic: 0.0,  cruise: 0.10, glide: 0.20, owa: 0.70, male: 0.20, tactical: 0.30, recon: 0.20, unknown: 0.10, indirect: 0.0 },
  // Ukrainian mobile fire group weapon profiles
  zu23:        { ballistic: 0.0,  cruise: 0.05, glide: 0.08, owa: 0.32, male: 0.10, tactical: 0.45, recon: 0.42, unknown: 0.15, indirect: 0.0 }, // 23mm autocannon, primary Shahed killer
  hmg:         { ballistic: 0.0,  cruise: 0.02, glide: 0.05, owa: 0.18, male: 0.06, tactical: 0.48, recon: 0.45, unknown: 0.12, indirect: 0.0 }, // .50/DShK heavy MG
  pkm:         { ballistic: 0.0,  cruise: 0.0,  glide: 0.0,  owa: 0.08, male: 0.0,  tactical: 0.42, recon: 0.45, unknown: 0.08, indirect: 0.0 }, // 7.62mm light, vs FPV/small
  mg:          { ballistic: 0.0,  cruise: 0.0,  glide: 0.0,  owa: 0.05, male: 0.0,  tactical: 0.08, recon: 0.15, unknown: 0.05, indirect: 0.0 },
  ew:          { ballistic: 0.0,  cruise: 0.0,  glide: 0.0,  owa: 0.0,  male: 0.0,  tactical: 0.0,  recon: 0.0,  unknown: 0.0,  indirect: 0.0 },
};

// ============================================================================
// ASSET CATALOG
// echelon: 'corps' | 'div' | 'bde' | 'bn', who owns the asset doctrinally
// attached: true if NOT organic to bde (auto-controlled, player can't move/repair it)
// engageDefault: classes the asset will engage out-of-the-box (player can change)
// ============================================================================
// ============================================================================
// DRONE INTERCEPTOR LOADOUTS, operator selects per crew before match
// Each loadout = one full magazine for one FPV INT crew
// ============================================================================
const DRONE_LOADOUTS = {
  sting: {
    name: 'Sting (Wild Hornets)',
    desc: 'Combat-proven all-rounder. Thermal + AI terminal guidance, ~195 mph. First system to down a jet Geran-3. Balanced PK across OWA and recon.',
    count: 6,
    droneSpeed: 0.20,
    fuelMin: 16,
    pkMod: { owa: 1.1, recon: 1.0, tactical: 0.7, cruise: 0.5, male: 0.5 },
    color: '#d9a52f',
    icon: '▲',
  },
  p1sun: {
    name: 'P1-SUN (SkyFall)',
    desc: 'Fiber-optic Shahed hunter, 3D-printed. ~280 mph (fastest), computer vision + thermal. Fiber link = EW-immune. Cheap > high volume.',
    count: 8,
    droneSpeed: 0.26,
    fuelMin: 12,
    pkMod: { owa: 1.0, recon: 0.9, tactical: 0.5, cruise: 0.45, male: 0.3 },
    ewImmune: true,
    color: '#d4995a',
    icon: '⬥',
  },
  bagnet: {
    name: 'Bagnet',
    desc: 'Long-endurance autonomous interceptor. 20-min flight, 15 km reach, 1 kg warhead, fully fire-and-forget EO+AI. Fewer drones but high capability.',
    count: 4,
    droneSpeed: 0.22,
    fuelMin: 20,
    pkMod: { owa: 1.05, recon: 1.1, tactical: 0.9, cruise: 0.5, male: 0.7 },
    color: '#5aa0e6',
    icon: '◆',
  },
  octopus: {
    name: 'Octopus-100 (UA–UK)',
    desc: 'Joint Build-with-Ukraine interceptor. Balanced high-end performer, good across all small-UAS classes. Steady production.',
    count: 5,
    droneSpeed: 0.23,
    fuelMin: 18,
    pkMod: { owa: 1.05, recon: 1.05, tactical: 0.8, cruise: 0.5, male: 0.6 },
    color: '#2f80d6',
    icon: '✦',
  },
  kamikaze_quad: {
    name: 'Kamikaze Quad (COTS mass)',
    desc: '8× cheap COTS-modified quads. High volume, short range, OWA + recon only. For saturation waves.',
    count: 8,
    droneSpeed: 0.18,
    fuelMin: 8,
    pkMod: { owa: 0.9, recon: 0.85, tactical: 0.3, cruise: 0, male: 0 },
    color: '#c8924e',
    icon: '●',
  },
  net_capture: {
    name: 'Net Interceptor (capture)',
    desc: '2× net-equipped, disables target rather than destroys. Slow, intel value (recover intact airframe).',
    count: 2,
    droneSpeed: 0.16,
    fuelMin: 15,
    pkMod: { owa: 0.6, recon: 0.7, tactical: 0.4, cruise: 0, male: 0 },
    color: '#93a1b0',
    icon: '◯',
  },
};

// Default loadout
const DEFAULT_LOADOUT = 'sting';

// AURELIA mid-attack reinforcement, drone-interceptor crews the commander can
// commit DURING the attack as saturation builds (demonstrates their value).
const REINFORCE_POSITIONS = [{ x: 560, y: 205 }, { x: 575, y: 295 }, { x: 560, y: 385 }, { x: 520, y: 150 }, { x: 520, y: 440 }];
const REINFORCE_MAX = 5;

const CARDS = {
  // --- ATTACHED FROM CORPS/DIV (auto-controlled, player view-only) ---
  patriot:    { tag: 'PAC3', name: 'PATRIOT PAC-3 (DIV)',  nation: 'US',    range: 380, sensorRange: 460, ammoMax: 6,   firingDelay: 6000, moveSpeed: 0.04, deployTime: 30000, color: '#2f80d6', hp: 3, repairTime: 60000, sectorArc: 360, echelon: 'corps', attached: true, engageDefault: ['ballistic', 'cruise', 'male'] },
  iris_t:     { tag: 'IRIS', name: 'IRIS-T SLM (CORPS)',   nation: 'DE',    range: 240, sensorRange: 300, ammoMax: 10,  firingDelay: 4000, moveSpeed: 0.05, deployTime: 18000, color: '#2f80d6', hp: 2, repairTime: 45000, sectorArc: 360, echelon: 'corps', attached: true, engageDefault: ['cruise', 'glide', 'owa', 'male'] },

  // --- BDE ORGANIC ---
  nasams:     { tag: 'NSMS', name: 'NASAMS-2',             nation: 'NO/US', range: 220, sensorRange: 280, ammoMax: 8,  firingDelay: 4000, moveSpeed: 0.05, deployTime: 18000, color: '#2f80d6', hp: 2, repairTime: 45000, sectorArc: 360, echelon: 'bde', attached: false, engageDefault: ['cruise', 'glide', 'owa', 'male'] },
  camm:       { tag: 'CAMM', name: 'CAMM Sky Sabre',       nation: 'UK',    range: 200, sensorRange: 250, ammoMax: 10,  firingDelay: 3500, moveSpeed: 0.06, deployTime: 16000, color: '#2f80d6', hp: 2, repairTime: 40000, sectorArc: 360, echelon: 'bde', attached: false, engageDefault: ['cruise', 'glide', 'owa'] },
  crotale:    { tag: 'CRTL', name: 'CROTALE-NG',           nation: 'FR',    range: 160, sensorRange: 200, ammoMax: 8,  firingDelay: 3000, moveSpeed: 0.07, deployTime: 12000, color: '#2f80d6', hp: 2, repairTime: 30000, sectorArc: 180, echelon: 'bde', attached: false, engageDefault: ['cruise', 'owa', 'male'] },

  // --- BN/COY MANPADS ---
  stinger:    { tag: 'STNG', name: 'STINGER MANPADS',      nation: 'US',    range: 110, sensorRange: 130, ammoMax: 5,   firingDelay: 2500, moveSpeed: 0.10, deployTime: 3000,  color: '#2f80d6', hp: 1, repairTime: 15000, sectorArc: 180, echelon: 'bn',  attached: false, engageDefault: ['owa', 'male'] },
  piorun:     { tag: 'PIO',  name: 'PIORUN MANPADS',       nation: 'PL',    range: 105, sensorRange: 130, ammoMax: 5,   firingDelay: 2500, moveSpeed: 0.10, deployTime: 3000,  color: '#2f80d6', hp: 1, repairTime: 15000, sectorArc: 180, echelon: 'bn',  attached: false, engageDefault: ['owa', 'male'] },

  // --- BN SHORAD ---
  gepard:     { tag: 'GEP',  name: 'GEPARD SHORAD',        nation: 'DE',    range: 80,  sensorRange: 110, ammoMax: 12,  firingDelay: 1500, moveSpeed: 0.08, deployTime: 5000,  color: '#2f80d6', hp: 2, repairTime: 25000, sectorArc: 180, echelon: 'bn', attached: false, engageDefault: ['owa', 'tactical', 'recon'] },
  skynex:     { tag: 'SKYX', name: 'SKYNEX SHORAD',        nation: 'DE',    range: 75,  sensorRange: 105, ammoMax: 12,  firingDelay: 1500, moveSpeed: 0.08, deployTime: 6000,  color: '#2f80d6', hp: 2, repairTime: 25000, sectorArc: 180, echelon: 'bn', attached: false, engageDefault: ['owa', 'tactical', 'recon'] },

  // --- BDE EW ---
  ew_a:       { tag: 'EW1',  name: 'EW SUITE / KOLIBRI',   nation: 'DE',    range: 95,  sensorRange: 130, ammoMax: 100, firingDelay: 0,    moveSpeed: 0.07, deployTime: 4000,  color: '#93a1b0', hp: 2, repairTime: 20000, sectorArc: 360, echelon: 'bde', attached: false, isEW: true, engageDefault: ['tactical', 'recon'] },
  ew_b:       { tag: 'EW2',  name: 'EW SUITE / GROUND',    nation: 'NL',    range: 100, sensorRange: 130, ammoMax: 100, firingDelay: 0,    moveSpeed: 0.07, deployTime: 4000,  color: '#93a1b0', hp: 2, repairTime: 20000, sectorArc: 360, echelon: 'bde', attached: false, isEW: true, engageDefault: ['tactical', 'recon'] },

  // --- BDE C-UAS DRONE INTERCEPTOR ---
  // --- BDE C-UAS DRONE INTERCEPTOR CREWS ---
  // ammoMax = drones in stock. firingDelay = launch prep before next drone can be sent.
  // droneSpeed = px/ms. droneFuelMin = max flight time in game-minutes before crash.
  int_a:      { tag: 'INT-1',name: 'Drone Interceptor Crew 1', nation: 'UA',    range: 280, sensorRange: 340, ammoMax: 6,   firingDelay: 5000, moveSpeed: 0.10, deployTime: 2000,  color: '#d9a52f', hp: 1, repairTime: 12000, sectorArc: 180, echelon: 'bde', attached: false, engageDefault: ['owa', 'recon'], isInterceptor: true, droneSpeed: 0.20, droneFuelMin: 12 },
  int_b:      { tag: 'INT-2',name: 'Drone Interceptor Crew 2', nation: 'UA',    range: 260, sensorRange: 320, ammoMax: 6,   firingDelay: 5000, moveSpeed: 0.10, deployTime: 2000,  color: '#d9a52f', hp: 1, repairTime: 12000, sectorArc: 180, echelon: 'bde', attached: false, engageDefault: ['owa', 'recon'], isInterceptor: true, droneSpeed: 0.20, droneFuelMin: 12 },
  int_c:      { tag: 'INT-3',name: 'Drone Interceptor Crew 3', nation: 'UA',    range: 260, sensorRange: 320, ammoMax: 6,   firingDelay: 5000, moveSpeed: 0.10, deployTime: 2000,  color: '#d9a52f', hp: 1, repairTime: 12000, sectorArc: 180, echelon: 'bde', attached: false, engageDefault: ['owa', 'recon'], isInterceptor: true, droneSpeed: 0.20, droneFuelMin: 12 },

  // --- Ukrainian mobile fire groups ---
  // Mixed weapon systems per the publicly documented UA C-UAS model:
  // ZU-23-2 autocannon (primary Shahed killer), .50/DShK heavy MG, PKM light, searchlight + acoustic cueing.
  mg_a:       { tag: 'ZU-23', name: 'ZU-23-2 Mobile Fire Group', nation: 'UA', range: 48, sensorRange: 80, ammoMax: 120, firingDelay: 800,  moveSpeed: 0.11, deployTime: 1200, color: '#2f80d6', hp: 1, repairTime: 8000, sectorArc: 360, echelon: 'coy', attached: false, engageDefault: ['owa', 'tactical', 'recon'], weapon: 'ZU-23-2 (23mm)' },
  mg_b:       { tag: 'M2 .50', name: 'Browning M2 Fire Group',  nation: 'UA', range: 38, sensorRange: 65, ammoMax: 150, firingDelay: 900,  moveSpeed: 0.12, deployTime: 1000, color: '#2f80d6', hp: 1, repairTime: 7000, sectorArc: 360, echelon: 'coy', attached: false, engageDefault: ['owa', 'tactical', 'recon'], weapon: 'Browning M2 (12.7mm)' },
  mg_c:       { tag: 'PKM',   name: 'PKM Light Fire Team',     nation: 'UA', range: 30, sensorRange: 55, ammoMax: 200, firingDelay: 700,  moveSpeed: 0.14, deployTime: 800,  color: '#2f80d6', hp: 1, repairTime: 6000, sectorArc: 360, echelon: 'coy', attached: false, engageDefault: ['tactical', 'recon'], weapon: 'PKM (7.62mm)' },
  mg_d:       { tag: 'DShK',   name: 'DShKM Fire Group',        nation: 'UA', range: 36, sensorRange: 62, ammoMax: 150, firingDelay: 900,  moveSpeed: 0.12, deployTime: 1000, color: '#2f80d6', hp: 1, repairTime: 7000, sectorArc: 360, echelon: 'coy', attached: false, engageDefault: ['owa', 'tactical', 'recon'], weapon: 'DShKM (12.7mm)' },
  mg_e:       { tag: 'ZU-23', name: 'ZU-23-2 Mobile Fire Group', nation: 'UA', range: 48, sensorRange: 80, ammoMax: 120, firingDelay: 800,  moveSpeed: 0.11, deployTime: 1200, color: '#2f80d6', hp: 1, repairTime: 8000, sectorArc: 360, echelon: 'coy', attached: false, engageDefault: ['owa', 'tactical', 'recon'], weapon: 'ZU-23-2 (23mm)' },
  mg_f:       { tag: 'PKM',   name: 'PKM Light Fire Team',     nation: 'UA', range: 30, sensorRange: 55, ammoMax: 200, firingDelay: 700,  moveSpeed: 0.14, deployTime: 800,  color: '#2f80d6', hp: 1, repairTime: 6000, sectorArc: 360, echelon: 'coy', attached: false, engageDefault: ['tactical', 'recon'], weapon: 'PKM (7.62mm)' },
};

// ============================================================================
// FRIENDLY RECON ASSETS, visible on map, not engageable, just patrolling
// ============================================================================
const FRIENDLY_RECON = [
  { id: 'fr1', name: 'RQ-11 RAVEN',     code: 'RVN-1', x: 240, y: 220, vx: 0.03, vy: 0.0, range: 60, color: '#2f80d6', loop: true },
  { id: 'fr2', name: 'TB2 PATROL',      code: 'TB2-A', x: 380, y: 180, vx: 0.04, vy: 0.0, range: 100, color: '#2f80d6', loop: true },
  { id: 'fr3', name: 'HEIDRUN UAV',     code: 'HDR-1', x: 320, y: 380, vx: 0.025, vy: 0.0, range: 70, color: '#2f80d6', loop: true },
];

// ============================================================================
// SCENARIO
// ============================================================================
// ============================================================================
// SPAWN SCHEDULES per scenario
// ============================================================================
const IRON_WIND_SCHEDULE = [
  { gt: GH(0.5), type: 'orlan10', from: 'E' },
  { gt: GH(1.0), type: 'mortar', from: 'E' },                   // sporadic mortar harassment
  { gt: GH(1.2), type: 'zala', from: 'NE' },
  { gt: GH(1.5), type: 'mavic', from: 'NE' },
  { gt: GH(1.8), type: 'arty', from: 'E' },                     // first arty registration
  { gt: GH(2.0), type: 'orlan30', from: 'SE' },
  { gt: GH(2.3), type: 'arty', from: 'NE' },
  { gt: GH(2.7), type: 'emit_decoy', from: 'E' },

  { gt: GH(3.0), type: 'geran2', from: 'NE' },
  { gt: GH(3.3), type: 'geran2', from: 'E' },
  { gt: GH(3.7), type: 'lancet', from: 'E' },
  { gt: GH(3.9), type: 'kub_bla', from: 'E' },
  { gt: GH(4.2), type: 'fpv', from: 'SE' },

  { gt: GH(5.5), type: 'forpost', from: 'NE' },                // ELINT pass, high alt
  { gt: GH(6.0), type: 'orlan10', from: 'NE', paralleling: true },
  { gt: GH(6.5), type: 'iskander', from: 'E' },
  { gt: GH(7.0), type: 'kh101', from: 'NE' },
  { gt: GH(7.5), type: 'kh101', from: 'E' },
  { gt: GH(8.0), type: 'kalibr', from: 'SE' },
  { gt: GH(8.5), type: 'kab', from: 'E' },
  // ARTILLERY BARRAGE H+8.7, saturate forward positions
  { gt: GH(8.7), type: 'arty', from: 'E' },
  { gt: GH(8.8), type: 'arty', from: 'NE' },
  { gt: GH(8.9), type: 'mlrs', from: 'E' },
  { gt: GH(9.0), type: 'mlrs', from: 'E' },
  { gt: GH(9.1), type: 'arty', from: 'SE' },
  { gt: GH(9.2), type: 'mortar', from: 'E' },

  { gt: GH(10.0), type: 'geran2', from: 'NE' },
  { gt: GH(10.4), type: 'geran2', from: 'E' },
  { gt: GH(10.8), type: 'geran2', from: 'SE' },
  { gt: GH(11.0), type: 'geran1', from: 'E' },                 // smaller OWA mixed
  { gt: GH(11.2), type: 'geran2_jet', from: 'NE' },
  { gt: GH(11.6), type: 'geran2', from: 'E' },
  { gt: GH(11.8), type: 'molniya', from: 'E' },
  { gt: GH(12.0), type: 'decoy', from: 'NE' },

  { gt: GH(13.5), type: 'orion', from: 'NE' },                 // MALE strike
  { gt: GH(14.0), type: 'mavic', from: 'E' },
  { gt: GH(14.3), type: 'supercam', from: 'E' },
  { gt: GH(14.5), type: 'emit_decoy', from: 'NE' },
  { gt: GH(15.0), type: 'lancet', from: 'E' },
  { gt: GH(15.3), type: 'upyr', from: 'E' },                   // FPV variant
  { gt: GH(15.5), type: 'fpv_of', from: 'NE' },
  { gt: GH(16.0), type: 'ghoul', from: 'SE' },

  { gt: GH(18.5), type: 'orlan30', from: 'E' },                // designator before KAB
  { gt: GH(19.0), type: 'orlan10', from: 'E' },
  { gt: GH(19.5), type: 'kab', from: 'E' },
  { gt: GH(20.0), type: 'kab', from: 'E' },
  { gt: GH(20.5), type: 'geran2', from: 'NE' },
  { gt: GH(20.6), type: 'arty', from: 'E' },
  { gt: GH(20.7), type: 'mlrs', from: 'E' },
  { gt: GH(20.8), type: 'privet82', from: 'E' },
  { gt: GH(21.0), type: 'geran2', from: 'SE' },

  { gt: GH(23.5), type: 'altius', from: 'NE' },                // strategic asset
  { gt: GH(24.0), type: 'orlan10', from: 'NE', paralleling: true },
  { gt: GH(24.5), type: 'kinzhal', from: 'E' },
  { gt: GH(25.0), type: 'kh22', from: 'NE' },
  { gt: GH(25.5), type: 'kh101', from: 'E' },
  { gt: GH(26.0), type: 'kalibr', from: 'SE' },
  // PRE-SATURATION ARTY PREP
  { gt: GH(23.0), type: 'mortar', from: 'E' },
  { gt: GH(23.2), type: 'arty', from: 'NE' },
  { gt: GH(23.4), type: 'arty', from: 'E' },
  { gt: GH(23.6), type: 'mlrs_hvy', from: 'E' },
  { gt: GH(23.8), type: 'mlrs', from: 'SE' },
  { gt: GH(26.5), type: 'geran2', from: 'NE' },
  { gt: GH(26.8), type: 'geran2', from: 'E' },
  { gt: GH(27.0), type: 'kub_bla', from: 'NE' },
  { gt: GH(27.2), type: 'geran2', from: 'SE' },
  { gt: GH(27.6), type: 'geran2_jet', from: 'E' },
  { gt: GH(28.0), type: 'decoy', from: 'NE' },
  { gt: GH(28.5), type: 'molniya', from: 'NE' },

  { gt: GH(30.0), type: 'lancet_of', from: 'E' },
  { gt: GH(30.3), type: 'eleron3', from: 'NE' },               // recon
  { gt: GH(30.5), type: 'fpv_of', from: 'SE' },
  { gt: GH(31.0), type: 'fpv', from: 'E' },
  { gt: GH(31.3), type: 'upyr', from: 'E' },
  { gt: GH(31.5), type: 'lancet', from: 'NE' },

  { gt: GH(33.5), type: 'sirius', from: 'NE' },                // strike-recon
  { gt: GH(34.0), type: 'tachyon', from: 'E' },
  { gt: GH(34.8), type: 'kh101', from: 'NE' },
  { gt: GH(35.2), type: 'kalibr', from: 'E' },
  { gt: GH(35.5), type: 'orion', from: 'SE' },
  { gt: GH(35.8), type: 'kh101', from: 'SE' },
  { gt: GH(36.2), type: 'kab', from: 'E' },

  { gt: GH(40.0), type: 'geran2', from: 'NE' },
  { gt: GH(40.4), type: 'geran2', from: 'E' },
  { gt: GH(40.8), type: 'geran2_jet', from: 'SE' },
  { gt: GH(41.2), type: 'geran2', from: 'NE' },
  { gt: GH(41.6), type: 'fpv_of', from: 'E' },
  { gt: GH(42.0), type: 'lancet', from: 'E' },
  { gt: GH(42.5), type: 'ghoul', from: 'SE' },

  { gt: GH(44.5), type: 'zala', from: 'NE' },
  { gt: GH(44.7), type: 'arty', from: 'E' },
  { gt: GH(44.8), type: 'arty', from: 'NE' },
  { gt: GH(44.9), type: 'mlrs_hvy', from: 'E' },
  { gt: GH(45.0), type: 'orlan10', from: 'NE', paralleling: true },
  { gt: GH(45.5), type: 'iskander', from: 'E' },
  { gt: GH(46.0), type: 'kh22', from: 'NE' },
  { gt: GH(46.5), type: 'geran2', from: 'E' },
  { gt: GH(47.0), type: 'fpv', from: 'SE' },
];

// ----- COLD STRIKE: surprise attack, 8 game-hours compressed (~5 min real),
// no recon phase, immediate kinetic from H+0 -----
const COLD_STRIKE_SCHEDULE = [
  // H+0, instant strike. Patriot/IRIS-T not in ENGAGE yet (player must react)
  { gt: GH(0.05), type: 'iskander', from: 'E' },
  { gt: GH(0.1),  type: 'kh101', from: 'NE' },
  { gt: GH(0.15), type: 'kalibr', from: 'SE' },
  { gt: GH(0.2),  type: 'geran2', from: 'NE' },
  { gt: GH(0.25), type: 'geran2', from: 'E' },
  { gt: GH(0.3),  type: 'geran2_jet', from: 'SE' },
  { gt: GH(0.4),  type: 'kh22', from: 'E' },
  { gt: GH(0.5),  type: 'kab', from: 'E' },
  { gt: GH(0.55), type: 'kab', from: 'NE' },
  { gt: GH(0.7),  type: 'fpv_of', from: 'SE' },
  { gt: GH(0.8),  type: 'lancet_of', from: 'E' },

  // H+1, second wave (artillery prep)
  { gt: GH(1.0),  type: 'mlrs_hvy', from: 'E' },
  { gt: GH(1.1),  type: 'mlrs_hvy', from: 'NE' },
  { gt: GH(1.2),  type: 'arty', from: 'E' },
  { gt: GH(1.3),  type: 'arty', from: 'SE' },
  { gt: GH(1.5),  type: 'kinzhal', from: 'E' },
  { gt: GH(1.7),  type: 'geran2', from: 'NE' },
  { gt: GH(1.8),  type: 'geran2', from: 'E' },
  { gt: GH(2.0),  type: 'fpv', from: 'E' },
  { gt: GH(2.1),  type: 'fpv', from: 'NE' },
  { gt: GH(2.3),  type: 'lancet', from: 'E' },

  // H+3, sustained pressure
  { gt: GH(3.0),  type: 'orlan30', from: 'NE' },
  { gt: GH(3.3),  type: 'kab', from: 'E' },
  { gt: GH(3.5),  type: 'geran2', from: 'E' },
  { gt: GH(3.8),  type: 'geran2', from: 'SE' },
  { gt: GH(4.0),  type: 'orion', from: 'NE' },
  { gt: GH(4.3),  type: 'mlrs', from: 'E' },
  { gt: GH(4.5),  type: 'fpv_of', from: 'E' },
  { gt: GH(4.8),  type: 'lancet', from: 'NE' },

  // H+6, culmination, strategic salvo before relief arrives
  { gt: GH(6.0),  type: 'iskander', from: 'E' },
  { gt: GH(6.2),  type: 'kh101', from: 'E' },
  { gt: GH(6.3),  type: 'kalibr', from: 'NE' },
  { gt: GH(6.5),  type: 'geran2', from: 'E' },
  { gt: GH(6.7),  type: 'geran2_jet', from: 'NE' },
  { gt: GH(7.0),  type: 'kab', from: 'E' },
  { gt: GH(7.5),  type: 'fpv', from: 'SE' },
];

// ----- ACTIVE COMBAT: high-tempo peer-on-peer, 24h compressed,
// constant pressure with brief lulls only -----
const ACTIVE_COMBAT_SCHEDULE = [
  // Generated as a tight cycle: every 1-1.5 hour brings a recon>strike sequence
  ...Array.from({ length: 24 }, (_, h) => {
    const hh = h + 0.5;
    const events = [];
    // Constant arty/mortar background (every hour)
    if (h % 1 === 0) {
      events.push({ gt: GH(hh), type: 'arty', from: ['E','NE','SE'][h % 3] });
      events.push({ gt: GH(hh + 0.1), type: 'mortar', from: 'E' });
    }
    // Recon every 2h
    if (h % 2 === 0) {
      events.push({ gt: GH(hh + 0.2), type: ['orlan10', 'orlan30', 'zala', 'supercam'][h % 4], from: ['E','NE','SE'][h % 3] });
    }
    // OWA swarm every 3h
    if (h % 3 === 0) {
      events.push({ gt: GH(hh + 0.3), type: 'geran2', from: 'NE' });
      events.push({ gt: GH(hh + 0.4), type: 'geran2', from: 'E' });
      events.push({ gt: GH(hh + 0.5), type: 'geran2', from: 'SE' });
    }
    // Tactical hunters every 2h
    if (h % 2 === 1) {
      events.push({ gt: GH(hh + 0.4), type: ['fpv', 'fpv_of', 'lancet', 'lancet_of', 'upyr', 'ghoul'][h % 6], from: ['E','NE','SE'][h % 3] });
    }
    // KAB strikes every 4h (designator first)
    if (h % 4 === 2) {
      events.push({ gt: GH(hh + 0.6), type: 'orlan30', from: 'E' });
      events.push({ gt: GH(hh + 0.8), type: 'kab', from: 'E' });
    }
    // MLRS every 6h
    if (h % 6 === 3) {
      events.push({ gt: GH(hh + 0.5), type: 'mlrs', from: 'E' });
      events.push({ gt: GH(hh + 0.55), type: 'mlrs_hvy', from: 'NE' });
    }
    // Cruise every 5h
    if (h % 5 === 4) {
      events.push({ gt: GH(hh + 0.7), type: ['kh101', 'kalibr', 'kh22'][h % 3], from: 'E' });
    }
    // Ballistic every 8h
    if (h % 8 === 6) {
      events.push({ gt: GH(hh + 0.1), type: 'orlan10', from: 'NE', paralleling: true });
      events.push({ gt: GH(hh + 0.5), type: 'iskander', from: 'E' });
    }
    return events;
  }).flat(),
];

// ============================================================================
// PHASES per scenario
// ============================================================================
const IRON_WIND_PHASES = [
  { gt: GH(0),  name: 'H+0 / RECON', desc: 'Adversary identifying positions' },
  { gt: GH(3),  name: 'H+3 / FIRST PROBE', desc: 'Initial Shahed/Lancet test' },
  { gt: GH(6),  name: 'H+6 / BALLISTIC OPENER', desc: 'Paralleling Orlan = warning! Iskander incoming' },
  { gt: GH(10), name: 'H+10 / OWA SWARM', desc: 'Mass Shahed saturation' },
  { gt: GH(14), name: 'H+14 / AD HUNT', desc: 'Lancet/FPV hunting your emitters' },
  { gt: GH(19), name: 'H+19 / KAB STRIKES', desc: 'Glide bombs along MSR' },
  { gt: GH(24), name: 'H+24 / NIGHT SATURATION', desc: 'Largest combined strike' },
  { gt: GH(30), name: 'H+30 / AD HUNT II', desc: 'Renewed counter-AD pressure' },
  { gt: GH(34), name: 'H+34 / CRUISE', desc: 'Cruise saturation' },
  { gt: GH(40), name: 'H+40 / FINAL OWA', desc: 'Pre-relief saturation attempt' },
  { gt: GH(45), name: 'H+45 / TERMINAL', desc: 'Last ballistic salvo before relief' },
  { gt: GH(48), name: 'H+48 / RELIEF', desc: 'Reinforcement column arrives' },
];

const COLD_STRIKE_PHASES = [
  { gt: GH(0),    name: 'H+0 / SURPRISE', desc: 'No warning, cold launches incoming!' },
  { gt: GH(1),    name: 'H+1 / SECOND WAVE', desc: 'Artillery + ballistic on damaged AD' },
  { gt: GH(3),    name: 'H+3 / SUSTAINED', desc: 'Sustained pressure, hunters active' },
  { gt: GH(6),    name: 'H+6 / CULMINATION', desc: 'Final salvo before relief' },
  { gt: GH(8),    name: 'H+8 / RELIEF', desc: 'CORPS QRF column arrives' },
];

const ACTIVE_COMBAT_PHASES = [
  { gt: GH(0),  name: 'H+0 / OPENING', desc: 'Active combat, multi-axis pressure' },
  { gt: GH(6),  name: 'H+6 / SUSTAINED', desc: 'Resupply consumption phase' },
  { gt: GH(12), name: 'H+12 / MIDDAY', desc: 'Continued tempo, hunter pressure' },
  { gt: GH(18), name: 'H+18 / EVENING SURGE', desc: 'Secondary OPFOR push' },
  { gt: GH(24), name: 'H+24 / EXTRACTION', desc: 'Bde extracted to reserve' },
];

// ============================================================================
// STOLYTSIA-24, Combined mass attack on the capital (one night)
// Modelled on the documented pattern of large combined OWA + cruise + ballistic
// strikes. Fully fictional in routing / positioning. ~12 game-hours = one night.
// Five phases: decoy probe > mass OWA > cruise > ballistic window > residual.
// ============================================================================
const STOLYTSIA_BASE = [
  // WAVE-STRUCTURED combined strike on AURELIA. Each wave is a column of UAVs from
  // one bearing flying nose-to-tail (visible "one after another"), with gaps between
  // waves and overlapping columns from multiple axes. Cruise + ballistic layered in;
  // builds to a terminal salvo (rapid overlapping waves + hypersonic). ~12 GH = one night.
  { gt: GH(0.2), type: 'emit_decoy', from: 'NE' },
  { gt: GH(0.23), type: 'geran2', from: 'NE' },
  { gt: GH(0.26), type: 'geran2', from: 'NE' },
  { gt: GH(0.9), type: 'geran2', from: 'E' },
  { gt: GH(0.93), type: 'geran2', from: 'E' },
  { gt: GH(0.96), type: 'emit_decoy', from: 'E' },
  { gt: GH(1.5), type: 'geran2', from: 'SE' },
  { gt: GH(1.53), type: 'geran2', from: 'SE' },
  { gt: GH(1.56), type: 'geran1', from: 'SE' },
  { gt: GH(2.1), type: 'geran2', from: 'NE' },
  { gt: GH(2.1), type: 'kh101', from: 'E' },
  { gt: GH(2.13), type: 'geran2', from: 'NE' },
  { gt: GH(2.16), type: 'geran2', from: 'NE' },
  { gt: GH(2.19), type: 'geran2', from: 'NE' },
  { gt: GH(2.7), type: 'geran2', from: 'E' },
  { gt: GH(2.73), type: 'geran2', from: 'E' },
  { gt: GH(2.76), type: 'geran2', from: 'E' },
  { gt: GH(3.2), type: 'geran2', from: 'SE' },
  { gt: GH(3.23), type: 'geran2', from: 'SE' },
  { gt: GH(3.26), type: 'geran2', from: 'SE' },
  { gt: GH(3.29), type: 'geran2', from: 'SE' },
  { gt: GH(3.3), type: 'kalibr', from: 'SE' },
  { gt: GH(3.8), type: 'geran2', from: 'NE' },
  { gt: GH(3.83), type: 'geran2', from: 'NE' },
  { gt: GH(3.86), type: 'geran2', from: 'NE' },
  { gt: GH(4.3), type: 'geran2', from: 'E' },
  { gt: GH(4.33), type: 'geran2', from: 'E' },
  { gt: GH(4.36), type: 'geran2', from: 'E' },
  { gt: GH(4.39), type: 'geran2', from: 'E' },
  { gt: GH(4.4), type: 'emit_decoy', from: 'NE' },
  { gt: GH(4.43), type: 'geran2', from: 'NE' },
  { gt: GH(4.8), type: 'geran2', from: 'SE' },
  { gt: GH(4.83), type: 'geran2', from: 'SE' },
  { gt: GH(4.86), type: 'geran2', from: 'SE' },
  { gt: GH(4.9), type: 'kh101', from: 'E' },
  { gt: GH(5.1), type: 'geran2', from: 'NE' },
  { gt: GH(5.13), type: 'geran2', from: 'NE' },
  { gt: GH(5.16), type: 'geran2', from: 'NE' },
  { gt: GH(5.19), type: 'geran2', from: 'NE' },
  { gt: GH(5.2), type: 'geran2', from: 'SE' },
  { gt: GH(5.22), type: 'geran2', from: 'NE' },
  { gt: GH(5.23), type: 'geran2', from: 'SE' },
  { gt: GH(5.26), type: 'geran2', from: 'SE' },
  { gt: GH(5.9), type: 'geran2', from: 'E' },
  { gt: GH(5.93), type: 'geran2', from: 'E' },
  { gt: GH(5.96), type: 'geran2', from: 'E' },
  { gt: GH(5.99), type: 'geran2', from: 'E' },
  { gt: GH(6.0), type: 'iskander', from: 'E' },
  { gt: GH(6.5), type: 'geran2', from: 'SE' },
  { gt: GH(6.53), type: 'geran2', from: 'SE' },
  { gt: GH(6.56), type: 'geran2', from: 'SE' },
  { gt: GH(6.59), type: 'geran2', from: 'SE' },
  { gt: GH(6.6), type: 'kh101', from: 'NE' },
  { gt: GH(7.0), type: 'geran2', from: 'NE' },
  { gt: GH(7.03), type: 'geran2', from: 'NE' },
  { gt: GH(7.06), type: 'geran2', from: 'NE' },
  { gt: GH(7.09), type: 'geran2', from: 'NE' },
  { gt: GH(7.1), type: 'geran2', from: 'E' },
  { gt: GH(7.12), type: 'geran2', from: 'NE' },
  { gt: GH(7.13), type: 'geran2', from: 'E' },
  { gt: GH(7.16), type: 'geran2', from: 'E' },
  { gt: GH(7.2), type: 'kalibr', from: 'SE' },
  { gt: GH(7.7), type: 'geran2', from: 'E' },
  { gt: GH(7.73), type: 'geran2', from: 'E' },
  { gt: GH(7.76), type: 'geran2', from: 'E' },
  { gt: GH(7.79), type: 'geran2', from: 'E' },
  { gt: GH(7.8), type: 'iskander', from: 'SE' },
  { gt: GH(8.3), type: 'geran2', from: 'NE' },
  { gt: GH(8.33), type: 'geran2', from: 'NE' },
  { gt: GH(8.35), type: 'geran2', from: 'E' },
  { gt: GH(8.36), type: 'geran2', from: 'NE' },
  { gt: GH(8.38), type: 'geran2', from: 'E' },
  { gt: GH(8.39), type: 'geran2', from: 'NE' },
  { gt: GH(8.4), type: 'geran2', from: 'SE' },
  { gt: GH(8.41), type: 'geran2', from: 'E' },
  { gt: GH(8.42), type: 'geran2', from: 'NE' },
  { gt: GH(8.43), type: 'geran2', from: 'SE' },
  { gt: GH(8.44), type: 'geran2', from: 'E' },
  { gt: GH(8.45), type: 'geran2', from: 'NE' },
  { gt: GH(8.46), type: 'geran2', from: 'SE' },
  { gt: GH(8.47), type: 'geran2', from: 'E' },
  { gt: GH(8.49), type: 'geran2', from: 'SE' },
  { gt: GH(8.5), type: 'kh101', from: 'E' },
  { gt: GH(8.5), type: 'kalibr', from: 'SE' },
  { gt: GH(8.52), type: 'geran2', from: 'SE' },
  { gt: GH(8.7), type: 'kinzhal', from: 'NE' },
  { gt: GH(8.9), type: 'geran2', from: 'NE' },
  { gt: GH(8.93), type: 'geran2', from: 'NE' },
  { gt: GH(8.95), type: 'geran2', from: 'SE' },
  { gt: GH(8.96), type: 'geran2', from: 'NE' },
  { gt: GH(8.98), type: 'geran2', from: 'SE' },
  { gt: GH(8.99), type: 'geran2', from: 'NE' },
  { gt: GH(9.0), type: 'geran2', from: 'E' },
  { gt: GH(9.01), type: 'geran2', from: 'SE' },
  { gt: GH(9.02), type: 'geran2', from: 'NE' },
  { gt: GH(9.03), type: 'geran2', from: 'E' },
  { gt: GH(9.04), type: 'geran2', from: 'SE' },
  { gt: GH(9.06), type: 'geran2', from: 'E' },
  { gt: GH(9.09), type: 'geran2', from: 'E' },
  { gt: GH(9.1), type: 'kh101', from: 'NE' },
  { gt: GH(9.12), type: 'geran2', from: 'E' },
  { gt: GH(9.2), type: 'iskander', from: 'E' },
  { gt: GH(9.4), type: 'geran2', from: 'SE' },
  { gt: GH(9.43), type: 'geran2', from: 'SE' },
  { gt: GH(9.45), type: 'geran2', from: 'NE' },
  { gt: GH(9.46), type: 'geran2', from: 'SE' },
  { gt: GH(9.48), type: 'geran2', from: 'NE' },
  { gt: GH(9.49), type: 'geran2', from: 'SE' },
  { gt: GH(9.5), type: 'kinzhal', from: 'E' },
  { gt: GH(9.51), type: 'geran2', from: 'NE' },
  { gt: GH(9.52), type: 'geran2', from: 'SE' },
  { gt: GH(9.54), type: 'geran2', from: 'NE' },
  { gt: GH(9.55), type: 'geran2', from: 'SE' },
  { gt: GH(9.6), type: 'geran2', from: 'E' },
  { gt: GH(9.63), type: 'geran2', from: 'E' },
  { gt: GH(9.66), type: 'geran2', from: 'E' },
  { gt: GH(9.69), type: 'geran2', from: 'E' },
  { gt: GH(9.7), type: 'kalibr', from: 'SE' },
  { gt: GH(9.72), type: 'geran2', from: 'E' },
  { gt: GH(9.8), type: 'iskander', from: 'NE' },
  { gt: GH(9.9), type: 'geran2', from: 'E' },
  { gt: GH(9.93), type: 'geran2', from: 'E' },
  { gt: GH(9.96), type: 'geran2', from: 'E' },
  { gt: GH(9.99), type: 'geran2', from: 'E' },
  { gt: GH(10.0), type: 'geran2', from: 'SE' },
  { gt: GH(10.03), type: 'geran2', from: 'SE' },
  { gt: GH(10.06), type: 'geran2', from: 'SE' },
  { gt: GH(10.09), type: 'geran2', from: 'SE' },
  { gt: GH(10.1), type: 'geran2', from: 'NE' },
  { gt: GH(10.12), type: 'geran2', from: 'SE' },
  { gt: GH(10.13), type: 'geran2', from: 'NE' },
  { gt: GH(10.16), type: 'geran2', from: 'NE' },
  { gt: GH(10.3), type: 'geran2', from: 'E' },
  { gt: GH(10.33), type: 'geran2', from: 'E' },
  { gt: GH(10.36), type: 'geran2', from: 'E' },
  { gt: GH(10.39), type: 'geran2', from: 'E' },
  { gt: GH(10.8), type: 'geran2', from: 'E' },
  { gt: GH(10.83), type: 'geran2', from: 'E' },
  { gt: GH(11.3), type: 'geran1', from: 'SE' },
  { gt: GH(11.33), type: 'geran2', from: 'SE' },
  { gt: GH(11.7), type: 'geran2', from: 'NE' },
  { gt: GH(11.73), type: 'geran2', from: 'NE' },
];
// Demonstration intensification: heavier OWA volume, more cruise, and a sustained
// ballistic cadence building to a hypersonic terminal salvo. Merged and sorted in.
const STOLYTSIA_EXTRA = [
  { gt: GH(1.0), type: 'geran2', from: 'E' }, { gt: GH(1.03), type: 'geran2', from: 'E' }, { gt: GH(1.06), type: 'geran2', from: 'NE' },
  { gt: GH(1.6), type: 'kh101', from: 'NE' }, { gt: GH(1.9), type: 'geran2', from: 'SE' }, { gt: GH(1.93), type: 'geran2', from: 'SE' },
  { gt: GH(2.4), type: 'geran2', from: 'E' }, { gt: GH(2.43), type: 'geran2', from: 'E' }, { gt: GH(2.5), type: 'iskander', from: 'E' },
  { gt: GH(2.9), type: 'geran2', from: 'NE' }, { gt: GH(2.93), type: 'geran2', from: 'NE' }, { gt: GH(3.0), type: 'kalibr', from: 'SE' },
  { gt: GH(3.5), type: 'iskander', from: 'NE' }, { gt: GH(3.6), type: 'geran2', from: 'E' }, { gt: GH(3.63), type: 'geran2', from: 'E' }, { gt: GH(3.66), type: 'geran1', from: 'E' },
  { gt: GH(4.0), type: 'geran2', from: 'SE' }, { gt: GH(4.03), type: 'geran2', from: 'SE' }, { gt: GH(4.1), type: 'kh101', from: 'NE' }, { gt: GH(4.5), type: 'iskander', from: 'SE' },
  { gt: GH(5.0), type: 'geran2', from: 'E' }, { gt: GH(5.03), type: 'geran2', from: 'E' }, { gt: GH(5.06), type: 'geran2', from: 'NE' }, { gt: GH(5.5), type: 'iskander', from: 'E' },
  { gt: GH(5.7), type: 'kh22', from: 'E' }, { gt: GH(6.1), type: 'geran2', from: 'SE' }, { gt: GH(6.13), type: 'geran2', from: 'SE' }, { gt: GH(6.3), type: 'iskander', from: 'NE' },
  { gt: GH(6.8), type: 'kinzhal', from: 'E' }, { gt: GH(7.0), type: 'iskander', from: 'SE' }, { gt: GH(7.3), type: 'geran2', from: 'E' }, { gt: GH(7.33), type: 'geran2', from: 'E' },
  { gt: GH(7.5), type: 'kh101', from: 'NE' }, { gt: GH(8.0), type: 'iskander', from: 'E' }, { gt: GH(8.5), type: 'iskander', from: 'NE' }, { gt: GH(8.7), type: 'geran2', from: 'SE' }, { gt: GH(8.73), type: 'geran2', from: 'SE' },
  { gt: GH(9.0), type: 'kinzhal', from: 'NE' }, { gt: GH(9.2), type: 'iskander', from: 'E' }, { gt: GH(9.5), type: 'kalibr', from: 'SE' }, { gt: GH(9.7), type: 'geran2', from: 'E' }, { gt: GH(9.73), type: 'geran2', from: 'E' },
  { gt: GH(10.0), type: 'iskander', from: 'SE' }, { gt: GH(10.3), type: 'geran2', from: 'NE' }, { gt: GH(10.33), type: 'geran2', from: 'NE' }, { gt: GH(10.7), type: 'iskander', from: 'E' },
  // Terminal salvo: overlapping ballistic + hypersonic + saturation
  { gt: GH(11.0), type: 'kinzhal', from: 'E' }, { gt: GH(11.1), type: 'iskander', from: 'NE' }, { gt: GH(11.2), type: 'iskander', from: 'SE' },
  { gt: GH(11.3), type: 'kh101', from: 'E' }, { gt: GH(11.4), type: 'geran2', from: 'E' }, { gt: GH(11.42), type: 'geran2', from: 'NE' }, { gt: GH(11.44), type: 'geran2', from: 'SE' },
  { gt: GH(11.5), type: 'kinzhal', from: 'NE' }, { gt: GH(11.6), type: 'iskander', from: 'E' }, { gt: GH(11.7), type: 'geran2', from: 'SE' },
];
const STOLYTSIA_SCHEDULE = STOLYTSIA_BASE.concat(STOLYTSIA_EXTRA).sort((a, b) => a.gt - b.gt);

const STOLYTSIA_PHASES = [
  { gt: GH(0),    name: '2300 / PROBE', desc: 'Decoys map your reaction, do not waste missiles on imitators' },
  { gt: GH(1.5),  name: '0030 / FIRST WAVE', desc: 'Mass Shahed from all axes WITH cruise missiles layered in' },
  { gt: GH(3.5),  name: '0230 / COMBINED PRESSURE', desc: 'Sustained drones + cruise + first ballistic probe, conserve interceptors' },
  { gt: GH(6),    name: '0430 / BALLISTIC WINDOW', desc: 'Synchronised drones + cruise + ballistic, compressed reaction time' },
  { gt: GH(8.3),  name: '0530 / TERMINAL SALVO', desc: 'CULMINATION, everything at once: mass OWA + cruise + ballistic + hypersonic. Hold the centre.' },
  { gt: GH(10.5), name: '0730 / AFTERMATH', desc: 'Scattered residual before dawn, damage assessment' },
];

// ============================================================================
// SCENARIOS, selectable mission profiles
// ============================================================================
const COMMON_INVENTORY = [
  { card: 'nasams', count: 1, required: 1 },
  { card: 'crotale', count: 1, required: 0 },
  { card: 'gepard', count: 1, required: 1 },
  { card: 'skynex', count: 1, required: 0 },
  { card: 'int_a', count: 1, required: 1 },
  { card: 'int_b', count: 1, required: 0 },
  { card: 'int_c', count: 1, required: 0 },
  { card: 'ew_a', count: 1, required: 1 },
  { card: 'ew_b', count: 1, required: 0 },
  { card: 'stinger', count: 1, required: 0 },
  { card: 'piorun', count: 1, required: 0 },
  { card: 'mg_a', count: 1, required: 1 },
  { card: 'mg_b', count: 1, required: 1 },
  { card: 'mg_c', count: 1, required: 0 },
  { card: 'mg_d', count: 1, required: 0 },
  { card: 'mg_e', count: 1, required: 0 },
  { card: 'mg_f', count: 1, required: 0 },
];

// Capital (AURELIA) inventory, SAM / SHORAD / MANPADS / EW / mobile fire groups.
// No FPV drone-interceptor crews (those are a brigade-level / frontline capability).
const CAPITAL_INVENTORY = [
  { card: 'nasams', count: 1, required: 1 },
  { card: 'crotale', count: 1, required: 0 },
  { card: 'gepard', count: 1, required: 1 },
  { card: 'skynex', count: 1, required: 0 },
  { card: 'ew_a', count: 1, required: 1 },
  { card: 'ew_b', count: 1, required: 0 },
  { card: 'stinger', count: 1, required: 0 },
  { card: 'piorun', count: 1, required: 0 },
  { card: 'mg_a', count: 1, required: 1 },
  { card: 'mg_b', count: 1, required: 1 },
  { card: 'mg_c', count: 1, required: 0 },
  { card: 'mg_d', count: 1, required: 0 },
  { card: 'mg_e', count: 1, required: 0 },
  { card: 'mg_f', count: 1, required: 0 },
];

const COMMON_PREPLACED = [
  { card: 'iris_t',  x: 200, y: 180, facing: 90 },
];

// NATO IAMD layered laydown for capital defence, concentric rings facing the
// eastern threat axis (NE/E/SE), with C-UAS teams co-located on infrastructure.
// Applied by the "DOCTRINAL LAYDOWN" button on the deploy screen.
const DOCTRINAL_LAYDOWN = {
  // Outer ring, long-range interceptors on the approaches
  int_a:   { x: 560, y: 200 }, // NE
  int_c:   { x: 570, y: 290 }, // E
  int_b:   { x: 560, y: 390 }, // SE
  // Mid SAM, cover city centre
  nasams:  { x: 430, y: 290 },
  crotale: { x: 480, y: 360 },
  // C-UAS hard kill, over key infrastructure corridors
  gepard:  { x: 340, y: 220 },
  skynex:  { x: 400, y: 400 },
  // MANPADS, eastern high-altitude approaches
  stinger: { x: 540, y: 160 },
  piorun:  { x: 540, y: 440 },
  // EW, central denial corridors
  ew_a:    { x: 360, y: 240 },
  ew_b:    { x: 360, y: 360 },
  // C-UAS teams co-located with critical infrastructure (MG range ~35)
  mg_a:    { x: 380, y: 270 }, // GOV
  mg_b:    { x: 320, y: 165 }, // CHP
  mg_c:    { x: 450, y: 350 }, // HOSP
  mg_d:    { x: 290, y: 385 }, // WATER
  mg_e:    { x: 500, y: 290 }, // TELECOM
  mg_f:    { x: 510, y: 405 }, // BRIDGE
};

const SCENARIOS = {
  stolytsia_24: {
    id: 'stolytsia_24',
    name: 'AURELIA-24 / ONE NIGHT',
    subtitle: 'CAPITAL DEFENCE, COMBINED MASS ATTACK',
    difficulty: 'HARD',
    realDuration: GH(12) / TIME_COMPRESSION, // ~7 min real for 12 game-hours (one night)
    totalGameHours: 12,
    schedule: STOLYTSIA_SCHEDULE,
    phases: STOLYTSIA_PHASES,
    enemyEW: false,
    coldStart: false,
    brief: "AURELIA, capital of a fictional allied state. The adversary launches a combined overnight strike package modelled on documented saturation-attack patterns: waves of OWA drones and emission decoys to overload the air picture, cruise missiles on low-altitude routes layered into the swarm, and a ballistic window before dawn. Your task: defend critical civilian infrastructure with limited missiles. Do not waste interceptors on decoys. All geography, routing and positions fictional, training only.",
    objectives: [
      'Protect critical infrastructure (GOV / CHP / power / water / hospital)',
      'Do not expend SAM missiles on emission decoys',
      'Survive the pre-dawn ballistic window with layered fires',
      'Minimise civilian infrastructure damage through dawn',
    ],
    preplaced: COMMON_PREPLACED,
    inventory: CAPITAL_INVENTORY,
  },
  iron_wind: {
    id: 'iron_wind',
    name: 'IRON WIND / 48H',
    subtitle: 'BRIGADE DEFENSE, REINFORCEMENT IN 48H',
    difficulty: 'MEDIUM',
    realDuration: TOTAL_REAL_MS, // ~28 min real
    totalGameHours: 48,
    schedule: IRON_WIND_SCHEDULE,
    phases: IRON_WIND_PHASES,
    enemyEW: false,
    coldStart: false,
    brief: "1st Mech Bde, multinational, holds AOR east of Berezh. Sustained 48-hour offensive expected, recon-strike pattern, coordinated attacks every 6-12 hours, paralleling Orlan as ballistic warning. Patriot battery (DIV) and IRIS-T detachment (CORPS) provide overhead protection automatically. Reinforcement column arrives at H+48.",
    objectives: [
      'All 4 brigade rear nodes hold until H+48',
      'Forward STPs hold (HP > 1)',
      'Minimize losses of organic AD assets',
      'Avoid engagement of unclassified contacts (ROE)',
    ],
    preplaced: COMMON_PREPLACED,
    inventory: COMMON_INVENTORY,
  },
  cold_strike: {
    id: 'cold_strike',
    name: 'COLD STRIKE / 8H',
    subtitle: 'SURPRISE ATTACK, REACT WITH WHAT YOU HAVE',
    difficulty: 'HARD',
    realDuration: 8 * 3600 * 1000 / TIME_COMPRESSION, // ~5 min real for 8h game
    totalGameHours: 8,
    schedule: COLD_STRIKE_SCHEDULE,
    phases: COLD_STRIKE_PHASES,
    enemyEW: false,
    coldStart: true, // all assets start in STANDBY, NO advance warning, kinetic from H+0
    brief: "PEACETIME POSTURE INTERRUPTED. No SIGINT warning. RU launches a coordinated decapitation strike at 0500 local. Your assets are in cold storage, engines off, ammo bays sealed, EW antennas folded. Patriot/IRIS-T crews are still in barracks. You have ~5 real-minutes (8 game-hours) to react before CORPS QRF arrives. Survive.",
    objectives: [
      'Get assets to ENGAGE within first game-minute',
      'Forward STPs hold (HP > 0)',
      'BDE TAC must survive at any cost',
      'Lose no more than 30% of AD assets',
    ],
    preplaced: COMMON_PREPLACED,
    inventory: COMMON_INVENTORY,
  },
  active_combat: {
    id: 'active_combat',
    name: 'ACTIVE COMBAT / 24H',
    subtitle: 'HIGH-TEMPO PEER-ON-PEER, SUSTAIN AND ATTRIT',
    difficulty: 'EXTREME',
    realDuration: 24 * 3600 * 1000 / TIME_COMPRESSION, // ~14 min real
    totalGameHours: 24,
    schedule: ACTIVE_COMBAT_SCHEDULE,
    phases: ACTIVE_COMBAT_PHASES,
    enemyEW: true, // Active enemy EW node from start
    coldStart: false,
    brief: "Brigade engaged in active offensive operations. Continuous threat density: arty harassment every game-hour, OWA swarm every 3 hours, periodic cruise/ballistic strikes. Active enemy EW NODE in adversary AOR degrades your data-link weapons by 25%. Use bde artillery or CAS request to neutralize it. Operate for 24 game-hours until brigade extraction.",
    objectives: [
      'Sustain operations for 24 game-hours',
      'Forward STPs hold (HP > 0)',
      'Neutralize enemy EW NODE',
      'Lose no more than 40% of AD assets',
    ],
    preplaced: COMMON_PREPLACED,
    inventory: COMMON_INVENTORY,
  },
};

// Runtime-mutable references to active scenario (changed at scenario selection)
let SCENARIO = SCENARIOS.stolytsia_24;
// Player-selected session length for the AURELIA capital scenario (minutes of real time).
// Shorter = more compressed = higher saturation tempo. Options: 5 / 10 / 15.
let SELECTED_DURATION_MIN = 10;
let SPAWN_SCHEDULE = SCENARIO.schedule;
let PHASES = SCENARIO.phases;
const setActiveScenario = (id) => {
  SCENARIO = SCENARIOS[id] || SCENARIOS.iron_wind;
  SPAWN_SCHEDULE = SCENARIO.schedule;
  PHASES = SCENARIO.phases;
};

// ============================================================================
// HELPERS
// ============================================================================
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmtGameTime = (gt) => {
  const totalH = gt / (3600 * 1000);
  const h = Math.floor(totalH);
  const m = Math.floor((totalH - h) * 60);
  return `H+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const fmtRealTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// === NATO FORMATTERS ===
// DTG (Date-Time Group) NATO format: DDHHMMzMONYY
// Example: 081430ZMAY26 = 8 May 2026, 14:30 Zulu
const MISSION_START_DATE = new Date('2026-05-08T14:00:00Z');
const fmtDTG = (gt) => {
  const t = new Date(MISSION_START_DATE.getTime() + gt);
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const mon = months[t.getUTCMonth()];
  const yy = String(t.getUTCFullYear()).slice(2);
  return `${dd}${hh}${mm}Z${mon}${yy}`;
};

// Bearing > degrees magnetic (compass)
const BEARING_DEG = { N: 360, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const fmtBearing = (b) => {
  const deg = BEARING_DEG[b] ?? 90;
  return `${String(deg).padStart(3, '0')}°M`;
};

// MGRS approximation for x,y coordinates on map
// Map is 900x580 px representing ~30km × 20km AOR
// Map center approximated as 36ULH 12345 67890 (placeholder grid)
const fmtMGRS = (x, y) => {
  // Convert px to meters (map ~30km wide / 20km tall)
  const mE = Math.floor(x * (30000 / 900));
  const mN = Math.floor((580 - y) * (20000 / 580)); // invert Y for north-up
  const e5 = String(12000 + mE).padStart(5, '0');
  const n5 = String(67000 + mN).padStart(5, '0');
  return `36ULH ${e5} ${n5}`;
};

// NATO callsign translation, replace internal IDs with phonetic
const NATO_CALLSIGN = {
  patriot: 'TANGO-1', iris_t: 'IRIS-1', nasams: 'KILO-1', crotale: 'CROTALE-1', camm: 'CAMM-1',
  gepard: 'GOLF-1', skynex: 'SKY-1',
  stinger: 'STINGER-1', piorun: 'PIORUN-1',
  int_a: 'ALPHA-1-1', int_b: 'BRAVO-2-1', int_c: 'CHARLIE-3-1',
  ew_a: 'WHISKEY-1', ew_b: 'WHISKEY-2',
  mg_a: 'MIKE-1', mg_b: 'MIKE-2', mg_c: 'MIKE-3', mg_d: 'MIKE-4', mg_e: 'MIKE-5', mg_f: 'MIKE-6',
};
const callsign = (cardId) => NATO_CALLSIGN[cardId] || cardId.toUpperCase();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let _id = 1;
const uid = () => _id++;
const nowMs = () => performance.now();
const grade = (p) => {
  if (p >= 90) return { l: 'A', c: '#2f80d6' };
  if (p >= 75) return { l: 'B', c: '#2f80d6' };
  if (p >= 60) return { l: 'C', c: '#5d6b7a' };
  if (p >= 40) return { l: 'D', c: '#d4995a' };
  return { l: 'F', c: '#d24a44' };
};
const VECTORS = {
  N: { x: MAP_W * 0.45, y: 5 },
  NE: { x: MAP_W - 5, y: MAP_H * 0.18 },
  E: { x: MAP_W - 5, y: MAP_H * 0.5 },
  SE: { x: MAP_W - 5, y: MAP_H * 0.82 },
  S: { x: MAP_W * 0.45, y: MAP_H - 5 },
};
const mapAssetType = (cardId) => ({
  patriot: 'patriot', iris_t: 'iris', nasams: 'nasams', camm: 'iris',
  crotale: 'crotale', stinger: 'stinger', piorun: 'stinger',
  gepard: 'gepard', skynex: 'skynex',
  int_a: 'interceptor', int_b: 'interceptor', int_c: 'interceptor',
  ew_a: 'ew', ew_b: 'ew',
  mg_a: 'zu23', mg_b: 'hmg', mg_c: 'pkm', mg_d: 'hmg', mg_e: 'zu23', mg_f: 'pkm',
}[cardId] || (CARDS[cardId] && CARDS[cardId].mapAs) || cardId);

// Compact zoom controls overlaid on a map. Panning uses the wrapper's native scroll.
const zbtn = { width:'22px', height:'22px', background:'#102234', border:'1px solid #243d52', color:'#dde3ea', borderRadius:'3px', cursor:'pointer', lineHeight:1, fontSize:'13px' };
function ZoomControls({ zoom, setZoom }) {
  const set = (z) => setZoom(Math.max(1, Math.min(3, Math.round(z * 10) / 10)));
  return (
    <div className="flex items-center gap-1" style={{ position:'absolute', top:6, right:6, zIndex:20, background:'rgba(10,22,38,0.88)', border:'1px solid #243d52', borderRadius:'5px', padding:'3px 5px' }}>
      <button onClick={() => set(zoom - 0.5)} style={zbtn} title="Zoom out">&minus;</button>
      <span className="f-mono" style={{ fontSize:'10px', color:'#5aa0e6', minWidth:'30px', textAlign:'center' }}>{zoom.toFixed(1)}&times;</span>
      <button onClick={() => set(zoom + 0.5)} style={zbtn} title="Zoom in">+</button>
      <button onClick={() => set(1)} style={{ ...zbtn, fontSize:'11px' }} title="Reset zoom">&#8635;</button>
    </div>
  );
}
function buildScenarioFromEntry(entry) {
  const cfg = (entry && entry.config) || {};
  const waves = cfg.waves || [];
  const force = cfg.force || {};
  const customThreats = (entry && entry.customThreats) || [];
  const customAssets = (entry && entry.customAssets) || [];
  const totalGH = (+cfg.totalGH) || 24;
  const map = cfg.map || 'capital';
  const schedule = [];
  waves.forEach(w => { const st = (+w.startGH) * 3600 * 1000, sp = (+w.spacingSec) * 1000; for (let i = 0; i < (+w.count); i++) schedule.push({ gt: st + i * sp, type: w.type, from: w.from }); });
  schedule.sort((a, b) => a.gt - b.gt);
  const totalTracks = waves.reduce((acc, w) => acc + (+w.count), 0);
  const usedKeys = [...new Set(waves.map(w => w.type))];
  const neededThreats = customThreats.filter(t => usedKeys.includes(t.key));
  const sc = {
    id: 'saved_' + ((entry && entry.when) || Date.now()), name: cfg.name || (entry && entry.name) || 'CUSTOM SCENARIO',
    subtitle: map === 'capital' ? 'CUSTOM · CAPITAL DEFENCE' : 'CUSTOM · BRIGADE AOR',
    difficulty: 'CUSTOM', totalGameHours: totalGH,
    realDuration: totalGH * 3600 * 1000 / TIME_COMPRESSION,
    schedule, phases: map === 'capital' ? STOLYTSIA_PHASES : IRON_WIND_PHASES,
    enemyEW: !!cfg.enemyEW, coldStart: !!cfg.coldStart,
    brief: 'Custom authored scenario: ' + waves.length + ' waves, ' + totalTracks + ' tracks over ' + totalGH + ' game-hours on the ' + map + ' map. All values illustrative and unclassified, for modelling only.',
    objectives: ['Defend assigned nodes', 'Manage interceptor economy', 'Adapt to the authored threat profile', 'Read the ISR-to-strike kill chain'],
    nodes: (cfg.useGeo && cfg.geoBounds && cfg.geoTargets && cfg.geoTargets.length) ? cfg.geoTargets.map(g => { const q = geoToPx(cfg.geoBounds, g.lat, g.lng); return { id: g.id, x: q.x, y: q.y, name: g.name, hp: g.hp, maxHp: g.maxHp, value: g.value, glyph: g.glyph, sym: g.sym, kind: g.kind }; }) : ((cfg.nodes && cfg.nodes.length) ? cfg.nodes.map(n => ({ ...n })) : undefined),
    geo: (cfg.useGeo && cfg.geoBounds && cfg.geoTargets && cfg.geoTargets.length) ? cfg.geoBounds : undefined,
    preplaced: [], inventory: Object.entries(force).filter(([k, n]) => (+n) > 0 && (CARDS[k] || customAssets.some(a => a.key === k))).map(([k, n]) => ({ card: k, count: +n, required: 0 })),
    altitudeRealism: cfg.altReal !== false,
    map, custom: true, adaptiveAdversary: !!cfg.adaptiveAdv, gnssSpoofing: !!cfg.gnssSpoof, theaterStock: (+cfg.theaterStock) > 0 ? +cfg.theaterStock : null,
  };
  return { sc, neededThreats, neededAssets: customAssets.filter(a => (+force[a.key]) > 0) };
}

// ============================================================================
// MAIN
// ============================================================================
function AppInner() {
  const [view, setView] = useState('menu');
  const [, forceTick] = useReducer(x => x + 1, 0);
  const gRef = useRef(null);
  const placedRef = useRef([]);
  const selectedCardRef = useRef(null);
  const hoveredCardRef = useRef(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [relocatingAsset, setRelocatingAsset] = useState(null);
  const [placingTeam, setPlacingTeam] = useState(false);
  const [scenarioId, setScenarioId] = useState('iron_wind');
  const [audioOn, setAudioOn] = useState(true);
  const [instructorMode, setInstructorMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1); // 1x..10x playback fast-forward
  const simSpeedRef = useRef(1); simSpeedRef.current = simSpeed;
  const [instructorNotes, setInstructorNotes] = useState([]);
  // 'demo' = demonstration (capital saturation scenarios run-through)
  // 'training' = brigade-level training (single player / multiplayer / instructor)
  const [gameMode, setGameMode] = useState('demo');

  const start = () => { setView('scenario'); };
  const startInstructor = () => { setInstructorMode(true); setView('scenario'); };
  const startDemo = () => { setGameMode('demo'); setInstructorMode(false); setView('scenario'); };
  const goTraining = () => { setGameMode('training'); setInstructorMode(false); setView('trainmenu'); };
  const endSession = () => {
    if (gRef.current) { gRef.current.result = { outcome: 'ended' }; setView('debrief'); }
  };
  const launchCustom = (sc, neededThreats, neededAssets) => {
    (neededThreats || []).forEach(t => { TT[t.key] = t.def; });
    (neededAssets || []).forEach(a => { CARDS[a.key] = a.def; });
    SCENARIOS[sc.id] = sc;
    setScenarioId(sc.id);
    setActiveScenario(sc.id);
    placedRef.current = [];
    selectedCardRef.current = null;
    setView('brief');
  };
  const chooseScenario = (id) => {
    setScenarioId(id);
    setActiveScenario(id);
    placedRef.current = [];
    selectedCardRef.current = null;
    setView('brief');
  };
  const goDeploy = () => setView('deploy');
  const beginRun = () => {
    setActiveScenario(scenarioId);
    gRef.current = newRunState(SCENARIO, placedRef.current);
    setPaused(false);
    setSimSpeed(1);
    setInstructorNotes([]);
    setView('running');
  };
  const togglePause = () => setPaused(p => !p);
  const addInstructorNote = (text) => {
    if (!gRef.current) return;
    setInstructorNotes(prev => [...prev, {
      gt: gRef.current.gameTime,
      dtg: fmtDTG(gRef.current.gameTime),
      text,
    }]);
  };

  function newRunState(sc, placed) {
    const preplaced = (sc.preplaced || []).map(p => ({
      id: uid(), cardId: p.card, x: p.x, y: p.y, facing: p.facing != null ? p.facing : 90,
    }));
    const allAssets = [...preplaced, ...placed];
    const isCold = !!sc.coldStart;
    // For the AURELIA capital scenario, derive time compression from the
    // player-selected session length (5/10/15 min) so the full attack plays
    // out in the chosen real time. Shorter = denser, higher-tempo saturation.
    let timeComp = TIME_COMPRESSION;
    if (sc.id === 'stolytsia_24') {
      const totalGameMs = (sc.totalGameHours || 12) * 3600 * 1000;
      timeComp = totalGameMs / (SELECTED_DURATION_MIN * 60 * 1000);
    }
    return {
      sc,
      timeComp,
      reinforcementsUsed: 0,
      selectedDurationMin: sc.id === 'stolytsia_24' ? SELECTED_DURATION_MIN : null,
      gameTime: 0, realElapsed: 0,
      spawnPtr: 0, phaseIdx: 0,
      theaterStock: sc.theaterStock != null ? sc.theaterStock : null,
      lastAdapt: 0, adaptiveSpawns: [], _lastComp: 0, _stockWarned: false,
      roe: 'TIGHT', // WPNS HOLD / TIGHT / FREE per STANAG
      // === RECON COVERAGE TRACKER ===
      // Per-region designation status: { sector, expiresGT, designatorType, classified }
      // Sectors: NE, E, SE
      // designatorType: 'orlan30' | 'zala' | 'forpost' | 'altius'
      reconCoverage: { NE: null, E: null, SE: null },
      threats: [],
      shots: [],
      missMarkers: [],
      blasts: [],
      intDrones: [],
      friendlyRecon: FRIENDLY_RECON.map(r => ({ ...r })),
      assets: allAssets.map(a => {
        const c = CARDS[a.cardId];
        const isAttached = !!c.attached;
        // COLD START: even attached assets begin in STANDBY (player must react)
        const startMode = isCold ? 'STANDBY' : (isAttached ? 'ENGAGE' : 'STANDBY');
        const startDeploying = isCold ? true : !isAttached;
        // INT crews use loadout-defined ammo count
        const loadoutId = a.loadout || DEFAULT_LOADOUT;
        const ammoOverride = c.isInterceptor && DRONE_LOADOUTS[loadoutId]
          ? DRONE_LOADOUTS[loadoutId].count
          : c.ammoMax;
        return {
          ...a,
          loadout: c.isInterceptor ? loadoutId : null,
          ammo: ammoOverride,
          hp: c.hp,
          maxHp: c.hp,
          mode: startMode,
          prevMode: startMode,
          firingCooldown: 0,
          deployingUntil: nowMs() + (startDeploying ? c.deployTime : 0),
          deploying: startDeploying,
          moveTarget: null,
          repairUntil: 0,
          damageWarn: false,
          emissionLevel: 0,
          facing: a.facing != null ? a.facing : 90,
          emissionTime: 0,
          compromisedAt: null,
          compromisedReason: null,
          engageRules: { ...(c.engageDefault || []).reduce((acc, k) => ({ ...acc, [k]: true }), {}) },
        };
      }),
      nodes: ((sc.nodes && sc.nodes.length) ? sc.nodes : nodesForScenario(sc)).map(n => ({ ...n })),
      alerts: [],
      log: [{ gt: 0, msg: isCold
        ? 'COLD START, assets in peacetime posture. React.'
        : `Mission start. Hold until H+${sc.totalGameHours || 48}.`, type: isCold ? 'crit' : 'wave' }],
      result: null,
      // Enemy EW node, visible asset on enemy side, degrades friendly Pk
      enemyEW: sc.enemyEW ? {
        x: 800, y: 250, hp: 3, maxHp: 3, alive: true,
        active: true,
        detectedByPlayer: false,
        type: 'ew',
      } : null,
      // Recon kill chain tracking, which recon UAVs have been killed (degrades subsequent strikes)
      reconKilled: { orlan10: 0, orlan30: 0, zala: 0, supercam: 0, eleron3: 0, tachyon: 0 },
      // Fire mission / CAS resource
      fireMission: {
        available: 3,           // total CAS strikes available
        cooldownUntil: 0,       // game-time
        active: null,           // { targetX, targetY, impactGT }
      },
      // Reload tickets, pending resupply for SAM systems
      reloads: [], // { assetId, amount, arrivalGT }
      // Per-hour event counter for AAR timeline
      hourBuckets: {}, // { hourIndex: { spawned, killed, leaked, alerts } }
      m: {
        threatsSpawned: 0, realThreatsSpawned: 0,
        threatsKilled: 0, decoysHit: 0,
        valueDestroyedK: 0, infraLostK: 0,
        spoofed: 0, theaterUsed: 0, theaterInit: sc.theaterStock != null ? sc.theaterStock : 0,
        classifyLat: [], engageLat: [], engagedCount: 0, commandActions: 0,
        leakedReal: 0, leakDmg: 0,
        weaponSpend: { patriot: 0, iris: 0, nasams: 0, crotale: 0, stinger: 0, gepard: 0, skynex: 0, interceptor: 0, mg: 0, ew: 0 },
        assetsLost: 0, repairs: 0, relocations: 0,
        intercepts: 0, intercept_misses: 0,
        compromises: 0, threatEvasions: 0, ewCounterStrikes: 0,
        intDronesLaunched: 0, intDronesHit: 0, intDronesLost: 0, intDronesMissed: 0,
        reconKills: 0, killChainBroken: 0, strikesAverted: 0,
        fireMissionsUsed: 0, ewNodeNeutralized: 0,
        reloadsRequested: 0, reloadsCompleted: 0,
      },
    };
  }

  const pushAlert = useCallback((msg, level = 'info', persistent = false) => {
    const g = gRef.current;
    if (!g) return;
    g.alerts.push({
      id: uid(), msg, level,
      expires: persistent ? Infinity : g.realElapsed + 15000,
      gt: g.gameTime,
      persistent,
    });
    if (g.alerts.length > 20) g.alerts.shift();
  }, []);

  const dismissAlert = (id) => {
    const g = gRef.current;
    if (!g) return;
    g.alerts = g.alerts.filter(a => a.id !== id);
  };

  const logEvent = useCallback((msg, type = 'info') => {
    const g = gRef.current;
    if (!g) return;
    g.log.unshift({ gt: g.gameTime, msg, type });
    if (g.log.length > 80) g.log.pop();
  }, []);

  // Commit a drone-interceptor crew DURING the attack (AURELIA reinforcement).
  // Enter placement mode: next map click positions a drone-interceptor team.
  const beginPlaceTeam = useCallback(() => {
    const g = gRef.current;
    if (!g) return;
    if ((g.reinforcementsUsed || 0) >= REINFORCE_MAX) {
      pushAlert('All 5 drone-interceptor teams already committed', 'warn');
      return;
    }
    setRelocatingAsset(null);
    setPlacingTeam(true);
    pushAlert('CLICK THE MAP to position the drone-interceptor team', 'info', 6000);
  }, [pushAlert]);

  // Place a drone-interceptor team at the clicked map coordinates.
  const placeTeamAt = (x, y) => {
    const g = gRef.current;
    if (!g) { setPlacingTeam(false); return; }
    if ((g.reinforcementsUsed || 0) >= REINFORCE_MAX) { setPlacingTeam(false); return; }
    if (x < FRIENDLY_BOUND.xMin || x > FRIENDLY_BOUND.xMax || y < FRIENDLY_BOUND.yMin || y > FRIENDLY_BOUND.yMax) {
      pushAlert('Place the team inside the friendly AOR', 'warn');
      return;
    }
    const c = CARDS['int_a'];
    const n = (g.reinforcementsUsed || 0) + 1;
    g.assets.push({
      id: uid(), cardId: 'int_a', x, y, alive: true,
      teamLabel: `DRONE TEAM ${n}`,
      loadout: 'sting', ammo: DRONE_LOADOUTS['sting'].count,
      hp: c.hp, maxHp: c.hp, mode: 'ENGAGE', prevMode: 'ENGAGE',
      firingCooldown: 0, deployingUntil: nowMs() + c.deployTime, deploying: true,
      moveTarget: null, repairUntil: 0, damageWarn: false, emissionLevel: 0,
      facing: 90, emissionTime: 0, compromisedAt: null, compromisedReason: null,
      engageRules: (c.engageDefault || []).reduce((acc, k) => ({ ...acc, [k]: true }), {}),
    });
    g.reinforcementsUsed = n;
    setPlacingTeam(false);
    logEvent(`Drone-interceptor team ${n} deployed (${n}/${REINFORCE_MAX})`, 'ok');
    pushAlert(`Drone team ${n} positioned, engaging in ${(c.deployTime / 1000).toFixed(0)}s`, 'ok', 6000);
  };

  // Master order: all assets to ENGAGE, weapons free. Engage rules stay as set;
  // the operator can still widen target classes per asset afterwards.
  const autoEngageAll = () => {
    const g = gRef.current;
    if (!g) return;
    g.roe = 'FREE';
    let n = 0;
    for (const a of g.assets) {
      if (!a.alive) continue;
      if (CARDS[a.cardId].attached) continue;
      if (a.deploying || a.mode === 'REPAIR' || a.mode === 'MOVING') continue;
      a.mode = 'ENGAGE'; a.prevMode = 'ENGAGE'; n++;
    }
    logEvent(`AUTO-ENGAGE ORDER, weapons free, ${n} assets active`, 'crit');
    pushAlert(`AUTO-ENGAGE: ${n} assets weapons-free`, 'phase', 8000);
  };

  // ============= AUDIO CUES =============
  const audioCtxRef = useRef(null);
  const getAudioCtx = () => {
    if (!audioOn) return null;
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      return audioCtxRef.current;
    } catch (e) { return null; }
  };
  const playTone = useCallback((freq, durMs, type = 'sine', vol = 0.15) => {
    if (!audioOn) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durMs / 1000);
  }, [audioOn]);
  const audioCue = useCallback((kind) => {
    if (!audioOn) return;
    if (kind === 'phase') playTone(660, 200, 'sine', 0.08);
    else if (kind === 'ballistic') { playTone(440, 100); setTimeout(() => playTone(660, 100), 150); setTimeout(() => playTone(440, 200), 300); }
    else if (kind === 'crit') playTone(280, 220, 'square', 0.12);
    else if (kind === 'warn') playTone(520, 120, 'triangle', 0.08);
    else if (kind === 'kill') playTone(880, 80, 'sine', 0.06);
    else if (kind === 'launch') playTone(740, 50, 'sine', 0.05);
    else if (kind === 'cas') { playTone(220, 150); setTimeout(() => playTone(180, 250), 180); }
  }, [audioOn, playTone]);

  // ============= GAME LOOP =============
  useEffect(() => {
    if (view !== 'running') return;
    let raf, last = nowMs();
    const loop = (t) => {
      const baseDt = Math.min(50, t - last); last = t;
      if (!paused) step(baseDt * (simSpeedRef.current || 1));
      forceTick();
      const g = gRef.current;
      if (!g) return;
      const totalGH = (g.sc.totalGameHours || 48);
      if (g.gameTime >= GH(totalGH)) { finish('victory'); return; }
      if (g.nodes.filter(n => n.kind !== 'forward').every(n => n.hp === 0)) { finish('lose'); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view, paused]);

  function step(dt) {
    const g = gRef.current;
    g.realElapsed += dt;
    const gameDt = dt * (g.timeComp || TIME_COMPRESSION);
    g.gameTime += gameDt;

    // Hour bucket, track event density per game-hour for AAR
    const hourIdx = Math.floor(g.gameTime / (3600 * 1000));
    if (!g.hourBuckets[hourIdx]) {
      g.hourBuckets[hourIdx] = { spawned: 0, killed: 0, leaked: 0, alerts: 0 };
    }

    // Phase progression
    let p = 0;
    for (let i = 0; i < PHASES.length; i++) {
      if (g.gameTime >= PHASES[i].gt) p = i;
    }
    if (p !== g.phaseIdx) {
      g.phaseIdx = p;
      logEvent(`=== ${PHASES[p].name}, ${PHASES[p].desc} ===`, 'wave');
      pushAlert(`${PHASES[p].name}: ${PHASES[p].desc}`, 'phase', false);
      audioCue('phase');
    }

    // Spawns
    while (g.spawnPtr < SPAWN_SCHEDULE.length && SPAWN_SCHEDULE[g.spawnPtr].gt <= g.gameTime) {
      const sp = SPAWN_SCHEDULE[g.spawnPtr];
      // KILL CHAIN: skip strike spawns if their corresponding recon was killed
      let skip = false;
      if ((sp.type === 'kab' || sp.type === 'kab_hvy') && g.reconKilled.orlan30 > 0) {
        // KAB strike requires Orlan-30 designator. If killed, ~70% chance of cancel
        if (Math.random() < 0.7) {
          skip = true;
          g.reconKilled.orlan30 = Math.max(0, g.reconKilled.orlan30 - 1);
          g.m.killChainBroken++;
          g.m.strikesAverted++;
          logEvent(`KILL CHAIN: ${TT[sp.type].code} strike CANCELLED, designator killed earlier`, 'ok');
          pushAlert(`Strike averted (${TT[sp.type].code}), designator down`, 'phase', 8000);
        }
      }
      if (sp.type === 'lancet' && g.reconKilled.zala > 0) {
        // Lancet hunter requires ZALA target acquisition
        if (Math.random() < 0.5) {
          skip = true;
          g.reconKilled.zala = Math.max(0, g.reconKilled.zala - 1);
          g.m.killChainBroken++;
          g.m.strikesAverted++;
          logEvent(`KILL CHAIN: ${TT[sp.type].code} strike CANCELLED, ZALA targeting lost`, 'ok');
        }
      }
      if (!skip) {
        spawnThreat(sp);
        g.hourBuckets[hourIdx].spawned++;
      }
      g.spawnPtr++;
    }

    // ADAPTIVE ADVERSARY: reactive spawns + periodic re-aim
    if (g.adaptiveSpawns && g.adaptiveSpawns.length) {
      for (let i = g.adaptiveSpawns.length - 1; i >= 0; i--) {
        if (g.adaptiveSpawns[i].gt <= g.gameTime) { spawnThreat(g.adaptiveSpawns[i]); g.adaptiveSpawns.splice(i, 1); }
      }
    }
    if (g.sc.adaptiveAdversary && g.gameTime - (g.lastAdapt || 0) > 22 * 60 * 1000) {
      g.lastAdapt = g.gameTime;
      adaptAdversary(g);
    }

    // Asset state machine
    g.assets.forEach(a => updateAsset(a, dt));

    // EW emission accumulator > counter-strike
    g.assets.forEach(a => {
      if (!a.alive || a.deploying) return;
      const c = CARDS[a.cardId];
      const _at = mapAssetType(a.cardId);
      const _bigRadar = ['patriot','nasams','iris'].includes(_at);
      const _emitter = c.isEW || _bigRadar || ['crotale','gepard','skynex'].includes(_at);
      if (_emitter && a.mode === 'ENGAGE') {
        a.emissionTime = (a.emissionTime || 0) + gameDt;
        const emissionMin = a.emissionTime / (60 * 1000);
        // Threshold: 2 game-minutes of continuous EW emission > enemy targets
        if (emissionMin > (_bigRadar ? 1.5 : 2.5) && !a.compromisedAt) {
          a.compromisedAt = g.gameTime;
          a.compromisedReason = _bigRadar ? 'radar emission detected' : 'emission detected';
          g.m.compromises++;
          pushAlert(`⚠ ${CARDS[a.cardId].name} EMISSION DETECTED, ENEMY HOMING (~5 min to strike)`, 'crit', true);
          logEvent(`SIGINT alert: ${CARDS[a.cardId].name} >2 min active. Counter-strike inbound.`, 'crit');
          // Schedule a Lancet/Iskander strike on this position
          const strikeDelay = (3 + Math.random() * 4) * 60 * 1000; // 3-7 game-min
          g.scheduledStrikes = g.scheduledStrikes || [];
          g.scheduledStrikes.push({
            atGameTime: g.gameTime + strikeDelay,
            type: _bigRadar ? (Math.random() < 0.6 ? 'iskander' : 'kh101') : (Math.random() < 0.5 ? 'lancet_of' : 'lancet'),
            targetX: a.x, targetY: a.y, fromVec: 'E',
            reason: 'counter-AD', forAssetId: a.id,
          });
        }
      } else if (a.mode !== 'ENGAGE') {
        // Decay emission counter when off-air
        a.emissionTime = Math.max(0, (a.emissionTime || 0) - gameDt * 0.5);
      }
    });

    // Execute scheduled counter-strikes
    if (g.scheduledStrikes && g.scheduledStrikes.length) {
      g.scheduledStrikes = g.scheduledStrikes.filter(ss => {
        if (g.gameTime >= ss.atGameTime) {
          g.m.ewCounterStrikes++;
          spawnThreat({ type: ss.type, from: ss.fromVec, targetXY: { x: ss.targetX, y: ss.targetY } });
          logEvent(`Counter-strike inbound: ${TT[ss.type].code} on compromised position (${ss.reason})`, 'crit');
          return false;
        }
        return true;
      });
    }

    // Threats
    g.threats.forEach(th => updateThreat(th, dt));

    // Auto-engage
    g.assets.forEach(a => {
      if (a.mode !== 'ENGAGE' || !a.alive || a.deploying) return;
      if (a.firingCooldown > 0) { a.firingCooldown -= dt; return; }
      autoEngage(a);
    });

    // Update friendly interceptor drones in flight
    updateIntDrones(dt, gameDt);

    // Hostile counter-AD
    g.threats.forEach(th => {
      if (!th.alive) return;
      const tt = TT[th.type];
      if (tt.target === 'ad_assets' && !th.targetAsset) {
        const emitters = g.assets.filter(a => a.alive && a.mode === 'ENGAGE' && !a.deploying && dist(th, a) < 320);
        if (emitters.length > 0) {
          const best = emitters.reduce((b, a) => {
            const va = m_shotCostK(mapAssetType(a.cardId)) - dist(th, a) * 2;
            const vb = m_shotCostK(mapAssetType(b.cardId)) - dist(th, b) * 2;
            return va > vb ? a : b;
          }, emitters[0]);
          th.targetAsset = best.id;
          logEvent(`${tt.code} acquired emission, hunting ${CARDS[best.cardId].name}`, 'crit');
        }
      }
    });

    // Alert cleanup (only non-persistent)
    g.alerts = g.alerts.filter(a => a.persistent || a.expires > g.realElapsed);

    // Decay miss markers
    g.missMarkers = g.missMarkers.filter(m => { m.age += dt; return m.age < 1500; });
    g.blasts = (g.blasts || []).filter(b => { b.age += dt; return b.age < (b.big ? 1400 : 1000); });
    g.shots = g.shots.filter(s => { s.age += dt; return s.age < s.life; });

    // Friendly recon UAV patrols: bounce within friendly area
    if (g.friendlyRecon) {
      g.friendlyRecon.forEach(r => {
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        if (r.x < FRIENDLY_BOUND.xMin + 30 || r.x > FRIENDLY_BOUND.xMax - 30) r.vx = -r.vx;
        if (r.y < FRIENDLY_BOUND.yMin + 30 || r.y > FRIENDLY_BOUND.yMax - 30) r.vy = -r.vy;
        if (Math.random() < 0.001) r.vy = (Math.random() - 0.5) * 0.05;
      });
    }

    // Fire mission impact resolution
    if (g.fireMission.active && g.gameTime >= g.fireMission.active.impactGT) {
      const fm = g.fireMission.active;
      // Hit: damage anything in 60px radius
      // Hit enemy EW node if in radius
      if (g.enemyEW && g.enemyEW.alive && Math.hypot(g.enemyEW.x - fm.targetX, g.enemyEW.y - fm.targetY) < 60) {
        g.enemyEW.hp = Math.max(0, g.enemyEW.hp - 2);
        if (g.enemyEW.hp === 0) {
          g.enemyEW.alive = false;
          g.enemyEW.active = false;
          g.m.ewNodeNeutralized++;
          logEvent('✓ ENEMY EW NODE NEUTRALIZED by fire mission. Friendly Pk restored.', 'ok');
          pushAlert('ENEMY EW NEUTRALIZED, Pk restored', 'phase', 12000);
          audioCue('kill');
        } else {
          logEvent(`Enemy EW node damaged (${g.enemyEW.hp}/${g.enemyEW.maxHp})`, 'ok');
        }
      }
      // Suppress nearby spawn-origin (cancel next 2 events from that bearing)
      g.fireMission.active = null;
      logEvent(`Fire mission impact at (${Math.round(fm.targetX)},${Math.round(fm.targetY)})`, 'ok');
      audioCue('cas');
    }
    if (g.fireMission.cooldownUntil > g.gameTime) {
      // still cooling down
    }

    // Reload arrivals
    if (g.reloads && g.reloads.length > 0) {
      g.reloads = g.reloads.filter(r => {
        if (g.gameTime >= r.arrivalGT) {
          const a = g.assets.find(x => x.id === r.assetId && x.alive);
          if (a) {
            const c = CARDS[a.cardId];
            a.ammo = Math.min(c.ammoMax, a.ammo + r.amount);
            g.m.reloadsCompleted++;
            logEvent(`✓ RESUPPLY: ${c.name} reloaded +${r.amount} (now ${a.ammo}/${c.ammoMax})`, 'ok');
            pushAlert(`${c.name} reloaded`, 'info', 6000);
          }
          return false;
        }
        return true;
      });
    }

    // Enemy EW node behavior, when active, all friendly Pk reduced (handled in autoEngage)
    // Detection: if any friendly recon is within 200px of EW node, mark detected
    if (g.enemyEW && g.enemyEW.alive && !g.enemyEW.detectedByPlayer) {
      const detected = (g.friendlyRecon || []).some(r => Math.hypot(r.x - g.enemyEW.x, r.y - g.enemyEW.y) < 200);
      if (detected) {
        g.enemyEW.detectedByPlayer = true;
        if (!SCENARIO.custom) {
          logEvent('S2: ENEMY EW NODE detected on east AOR, call fire mission', 'crit');
          pushAlert('ENEMY EW NODE DETECTED, request fire mission', 'crit', 30000);
        } else {
          logEvent('S2: ENEMY EW NODE detected, friendly Pk degraded in affected sector', 'crit');
          pushAlert('ENEMY EW NODE DETECTED, expect degraded Pk', 'crit', 30000);
        }
        audioCue('warn');
      }
    }
  }

  // === RECON-STRIKE DEPENDENCY MAP ===
  // Maps strike threat type > required recon designator type + soft/strict
  // 'strict' = no spawn if no designator. 'soft' = spawn but reduced PK / random target.
  const RECON_DEPENDENCY = {
    iskander:    { req: ['altius', 'forpost'],  mode: 'strict' },
    kinzhal:     { req: ['altius', 'forpost'],  mode: 'strict' },
    kab:         { req: ['orlan30'],            mode: 'strict' },
    kab_hvy:     { req: ['orlan30'],            mode: 'strict' },
    lancet:      { req: ['zala', 'orlan10'],    mode: 'strict' },
    lancet_of:   { req: ['zala'],               mode: 'strict' },
    kh101:       { req: ['altius', 'forpost'],  mode: 'soft' },
    kh22:        { req: ['altius', 'forpost'],  mode: 'soft' },
    kalibr:      { req: ['altius', 'forpost'],  mode: 'soft' },
    // Saturation/indirect: no recon dependency (continuous fires)
    geran1:      null,
    geran2:      null,
    geran2_jet:  null,
    arty:        null,
    arty_battery:null,
    mlrs:        null,
    mlrs_hvy:    null,
    mortar:      null,
  };

  // Sector classification (which region target is in)
  function getSector(x, y) {
    if (y < 220) return 'NE';
    if (y > 380) return 'SE';
    return 'E';
  }

  // Check if recon coverage is active for a sector + req types
  function hasReconCoverage(sector, reqTypes) {
    const g = gRef.current;
    if (!g.reconCoverage) return false;
    const cov = g.reconCoverage[sector];
    if (!cov) return false;
    if (g.gameTime > cov.expiresGT) return false;
    if (!reqTypes.includes(cov.designatorType)) return false;
    return true;
  }

  // Update recon coverage when a recon UAV spawns/dies
  function updateReconCoverage(threat, action) {
    const g = gRef.current;
    if (!g.reconCoverage) return;
    const reconTypes = ['orlan10', 'orlan30', 'zala', 'forpost', 'altius', 'supercam', 'eleron3'];
    if (!reconTypes.includes(threat.type)) return;
    const sector = getSector(threat.targetX || threat.x, threat.targetY || threat.y);

    if (action === 'spawn') {
      // Set coverage with timeout (designation lasts while UAV alive + 5 min after)
      // For UI purposes track designator type
      g.reconCoverage[sector] = {
        designatorType: threat.type,
        expiresGT: g.gameTime + 30 * 60 * 1000, // 30 game-min default coverage window
        threatId: threat.id,
        classifiedAt: null,
      };
      // Critical alert if Orlan-30 or ZALA - means strike incoming
      if (['orlan30', 'zala'].includes(threat.type) && threat.classified) {
        pushAlert(`DESIGNATION ACTIVE, ${TT[threat.type].name} illuminating ${sector} sector. Strike window OPEN.`, 'crit', 8000);
      }
    } else if (action === 'kill') {
      // Recon killed, coverage ends
      const cov = g.reconCoverage[sector];
      if (cov && cov.threatId === threat.id) {
        g.reconCoverage[sector] = null;
        logEvent(`✓ RECON KILLED: ${TT[threat.type].code} in ${sector}, designation broken`, 'ok');
        g.m.strikesAverted = (g.m.strikesAverted || 0) + 1;
      }
    }
  }

  function adaptAdversary(g) {
    const axes = ['N','NE','E','SE','S'];
    const cov = { N:0, NE:0, E:0, SE:0, S:0 };
    g.assets.filter(a => a.alive && !a.deploying).forEach(a => {
      let bestAx = 'E', bestD = Infinity;
      axes.forEach(ax => { const v = VECTORS[ax]; const d = (a.x - v.x) ** 2 + (a.y - v.y) ** 2; if (d < bestD) { bestD = d; bestAx = ax; } });
      cov[bestAx] += (CARDS[a.cardId].range || 50);
    });
    const weak = axes.reduce((w, ax) => cov[ax] < cov[w] ? ax : w, axes[0]);
    let reaimed = 0;
    for (let i = g.spawnPtr; i < SPAWN_SCHEDULE.length && reaimed < 40; i++) {
      if (Math.random() < 0.55) { SPAWN_SCHEDULE[i] = { ...SPAWN_SCHEDULE[i], from: weak }; reaimed++; }
    }
    logEvent(`ADVERSARY ADAPTS: shifting axis to probe your weak flank (${weak})`, 'crit');
    pushAlert(`Adversary adapting: next waves probing ${weak}`, 'phase', 9000);
    const emitters = g.assets.filter(a => a.alive && a.mode === 'ENGAGE' && !a.deploying);
    const newComp = g.m.compromises - (g._lastComp || 0);
    g._lastComp = g.m.compromises;
    if (emitters.length > 0 && (newComp > 0 || emitters.length >= 3)) {
      const big = emitters.reduce((b, a) => (CARDS[a.cardId].range || 0) > (CARDS[b.cardId].range || 0) ? a : b, emitters[0]);
      let ax = 'E', bestD = Infinity;
      axes.forEach(a2 => { const v = VECTORS[a2]; const d = (big.x - v.x) ** 2 + (big.y - v.y) ** 2; if (d < bestD) { bestD = d; ax = a2; } });
      g.adaptiveSpawns = g.adaptiveSpawns || [];
      const n = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) g.adaptiveSpawns.push({ gt: g.gameTime + (20 + k * 35) * 1000, type: Math.random() < 0.5 ? 'lancet' : 'lancet_of', from: ax });
      logEvent(`SIGINT located your emitters: SEAD package (${n}x) inbound from ${ax}`, 'crit');
      pushAlert(`SEAD package inbound from ${ax}, you are emitting`, 'crit', 9000);
    }
  }

  function spawnThreat(sp) {
    const g = gRef.current;
    const tt = TT[sp.type];

    // === RECON DEPENDENCY CHECK ===
    const dep = RECON_DEPENDENCY[sp.type];
    if (dep && dep.mode === 'strict') {
      // Need to know target sector first, predict
      const probableSector = sp.from === 'NE' ? 'NE' : (sp.from === 'SE' ? 'SE' : 'E');
      if (!hasReconCoverage(probableSector, dep.req)) {
        // Strike cancelled, no designator
        logEvent(`✗ ${TT[sp.type].code} STRIKE CANCELLED, no ${dep.req.join('/')} designator in ${probableSector}`, 'ok');
        g.m.strikesAverted = (g.m.strikesAverted || 0) + 1;
        return;
      }
    }
    // Soft dep: spawn but reduce accuracy (will apply at impact)
    let softDegraded = false;
    if (dep && dep.mode === 'soft') {
      const probableSector = sp.from === 'NE' ? 'NE' : (sp.from === 'SE' ? 'SE' : 'E');
      if (!hasReconCoverage(probableSector, dep.req)) {
        softDegraded = true;
      }
    }

    let origin = VECTORS[sp.from] || VECTORS.E;
    let tx, ty;
    if (sp.targetXY) {
      // Counter-strike on compromised position
      tx = sp.targetXY.x; ty = sp.targetXY.y;
    } else if (sp.paralleling) {
      const py = 100 + Math.random() * 380;
      tx = -50; ty = py;
    } else if (tt.indirect) {
      // Indirect fire: target a forward position, originate from just beyond FLOT
      const forwards = g.nodes.filter(n => n.hp > 0 && n.kind === 'forward');
      const target = forwards.length > 0
        ? forwards[Math.floor(Math.random() * forwards.length)]
        : g.nodes.filter(n => n.hp > 0).sort((a, b) => b.x - a.x)[0];
      if (!target) return;
      tx = target.x + (Math.random() - 0.5) * 40;
      ty = target.y + (Math.random() - 0.5) * 40;
      // Spawn just beyond visible right edge to give a brief warning band
      origin = { x: MAP_W + 10, y: target.y + (Math.random() - 0.5) * 80 };
    } else if (sp.type === 'kab') {
      // KAB: prefer forward STP positions (60%) but may target rear (40%)
      const forwards = g.nodes.filter(n => n.hp > 0 && n.kind === 'forward');
      const rears = g.nodes.filter(n => n.hp > 0 && n.kind !== 'forward');
      const pool = (Math.random() < 0.6 && forwards.length > 0) ? forwards : (rears.length > 0 ? rears : forwards);
      const target = pool[Math.floor(Math.random() * pool.length)];
      if (!target) return;
      tx = target.x; ty = target.y;
    } else {
      const target = tt.threat === 'kinetic' || (tt.dmg > 0)
        ? g.nodes.filter(n => n.hp > 0 && n.kind !== 'forward').sort((a, b) => b.value - a.value)[0]
          || g.nodes.filter(n => n.hp > 0).sort((a, b) => b.value - a.value)[0]
        : g.nodes[Math.floor(Math.random() * g.nodes.length)];
      if (!target) return;
      tx = target.x; ty = target.y;
    }
    const dx = tx - origin.x, dy = ty - origin.y, len = Math.hypot(dx, dy) || 1;
    const newThreat = {
      id: uid(), type: sp.type,
      x: origin.x, y: origin.y,
      vx: (dx / len) * tt.speed, vy: (dy / len) * tt.speed,
      classified: false, classifyProgress: 0,
      disabled: false, alive: true,
      paralleling: !!sp.paralleling,
      warningGiven: false,
      wanderPhase: Math.random() * Math.PI * 2,
      targetAsset: sp.targetXY ? null : null,
      targetX: tx, targetY: ty,
      spawnGT: g.gameTime,
      counterStrike: !!sp.targetXY,
      evading: null,
      evadeCount: 0,
      visibleSinceGT: null,
      indirect: !!tt.indirect,
      bearing: sp.from || 'E',
      softDegraded, // marks "spawned without recon support" - reduced PK at impact
    };
    g.threats.push(newThreat);
    // Register recon UAVs in coverage tracker
    updateReconCoverage(newThreat, 'spawn');
    g.m.threatsSpawned++;
    if (sp.type !== 'decoy' && sp.type !== 'emit_decoy') g.m.realThreatsSpawned++;
    logEvent(`CONTACT ${sp.from} > ${TT[sp.type].code}${sp.paralleling ? ' [PARALLELING]' : ''}${sp.targetXY ? ' [COUNTER-STRIKE]' : ''}${tt.indirect ? ' [INDIRECT]' : ''}`, 'contact');
    if (TT[sp.type].class === 'ballistic') {
      pushAlert(`⚠ BALLISTIC INBOUND: ${TT[sp.type].name}`, 'crit', true);
    }
    if (tt.indirect) {
      pushAlert(`⚠ INCOMING ${tt.code} on FORWARD POSITIONS`, 'warn', true);
    }
  }

  function updateThreat(th, dt) {
    if (!th.alive) return;
    const tt = TT[th.type];
    const g = gRef.current;

    // EW
    const inEW = g.assets.some(a =>
      a.alive && a.mode === 'ENGAGE' && CARDS[a.cardId].isEW && !a.deploying && dist(th, a) < CARDS[a.cardId].range);
    th.disabled = inEW && tt.ewVuln;

    // GNSS SPOOFING: navigation EW diverts GNSS/INS threats off course (non-kinetic)
    if (g.sc.gnssSpoofing && inEW && !tt.ewVuln && !th.spoofed && m_gnssVuln(tt) && Math.random() < 0.05) {
      th.spoofed = true; th.targetAsset = null; th.paralleling = false;
      g.m.spoofed = (g.m.spoofed || 0) + 1;
      g.m.valueDestroyedK += m_threatCostK(tt);
      const ex = th.x < MAP_W / 2 ? -120 : MAP_W + 120;
      const ey = th.y + (Math.random() - 0.5) * 200;
      const dxx = ex - th.x, dyy = ey - th.y, len = Math.hypot(dxx, dyy) || 1;
      th.vx = (dxx / len) * tt.speed; th.vy = (dyy / len) * tt.speed;
      th.color = '#2f80d6';
      logEvent(`${tt.code} GNSS spoofed, drifting off course (non-kinetic defeat)`, 'ok');
    }

    // Visual ID, only classify when within ANY asset's sensorRange
    const inSensor = g.assets.some(a => {
      if (!a.alive || a.deploying || a.mode === 'STANDBY' || a.mode === 'HIDDEN' || a.mode === 'REPAIR') return false;
      const c = CARDS[a.cardId];
      const sr = c.sensorRange || c.range;
      return dist(th, a) < sr;
    });
    if (!th.classified && inSensor) {
      // signature affects classify speed: huge classifies fast, tiny slow
      const sigMult = { huge: 0.5, large: 0.7, medium: 1.0, small: 1.3, tiny: 1.7 }[tt.signature || 'medium'];
      th.classifyProgress += dt;
      if (th.classifyProgress >= tt.classify * sigMult) {
        th.classified = true;
        if (!th.visibleSinceGT) th.visibleSinceGT = g.gameTime;
        if (th.spawnGT != null) g.m.classifyLat.push(g.gameTime - th.spawnGT);
        logEvent(`✓ Classified: ${tt.name}`, 'ok');
        // === DESIGNATION ALERTS ===
        // When adversary recon UAV is classified, warn Blue that strike window is open
        if (['orlan30', 'zala', 'altius', 'forpost'].includes(th.type)) {
          const sector = getSector(th.x, th.y);
          const designatesFor = {
            orlan30: 'KAB strike incoming',
            zala: 'Lancet strike incoming',
            altius: 'Cruise/Ballistic strike',
            forpost: 'Cruise/Ballistic strike',
          }[th.type] || 'Precision strike';
          pushAlert(`${tt.code} CLASSIFIED in ${sector}, ${designatesFor} likely. Engage to break kill chain.`, 'crit', 8000);
        }
      }
    }
    // Note: when out of sensor coverage, classify halts (but already-classified contacts stay classified)

    if (th.disabled) return;

    // Counter-strike: lock onto compromised asset position
    if (th.counterStrike && !th.targetAsset) {
      // try find a damaged/emitting asset near impact point
      const candidate = g.assets.find(a => a.alive && Math.abs(a.x - th.targetX) < 30 && Math.abs(a.y - th.targetY) < 30);
      if (candidate) th.targetAsset = candidate.id;
    }

    // Movement logic
    if (th.spoofed) { /* drifting off course after GNSS spoof, keep heading to map edge */ } else if (th.targetAsset) {
      const a = g.assets.find(x => x.id === th.targetAsset && x.alive);
      if (a) {
        const dx = a.x - th.x, dy = a.y - th.y, len = Math.hypot(dx, dy) || 1;
        th.vx = (dx / len) * tt.speed;
        th.vy = (dy / len) * tt.speed;
      }
    } else if (th.paralleling) {
      th.wanderPhase += dt * 0.001;
      const drift = Math.sin(th.wanderPhase) * 0.04;
      th.vy = drift;
      if (!th.warningGiven && th.x < 700 && th.x > 500) {
        th.warningGiven = true;
        pushAlert('⚠ PARALLELING RECON, BALLISTIC STRIKE LIKELY WITHIN 30 GAME-MIN', 'warn', true);
        logEvent('S2: paralleling recon trajectory, historical pattern indicates ballistic strike', 'crit');
      }
      if (th.x < 600 && Math.random() < 0.0008 && !th.wanderedIn) {
        th.wanderedIn = true;
        const target = g.nodes[Math.floor(Math.random() * g.nodes.length)];
        const dx = target.x - th.x, dy = target.y - th.y, len = Math.hypot(dx, dy);
        th.vx = (dx / len) * tt.speed;
        th.vy = (dy / len) * tt.speed;
        th.paralleling = false;
        logEvent(`${tt.code} deviated toward AOR, engagement window opened`, 'warn');
      }
    } else if (tt.avoid && tt.avoid > 0 && !th.evading) {
      // Threat avoidance: if approaching an active AD zone, may detour.
      // Custom (modelling) scenarios: cap evasions and stop loitering near the
      // target so a saturating OWA wave actually presses to impact instead of
      // circling forever. Demo/curated scenarios keep original behaviour.
      const evadeCap = g.sc.custom ? 2 : Infinity;
      const nearTarget = g.sc.custom && Math.hypot(th.targetX - th.x, th.targetY - th.y) < 150;
      const mayEvade = (th.evadeCount || 0) < evadeCap && !nearTarget;
      const threatening = mayEvade && g.assets.find(a => {
        if (!a.alive || a.deploying || a.mode !== 'ENGAGE') return false;
        if (CARDS[a.cardId].isEW) return false;
        return dist(th, a) < CARDS[a.cardId].range * 1.3;
      });
      if (threatening && Math.random() < tt.avoid * dt * 0.005) {
        // Detour: shift trajectory perpendicular to current vector
        const perpSign = Math.random() < 0.5 ? -1 : 1;
        const speed = Math.hypot(th.vx, th.vy) || tt.speed;
        const perpX = -th.vy / speed * perpSign;
        const perpY = th.vx / speed * perpSign;
        // new heading: 60% original + 40% perpendicular
        th.vx = th.vx * 0.6 + perpX * speed * 0.4;
        th.vy = th.vy * 0.6 + perpY * speed * 0.4;
        const newLen = Math.hypot(th.vx, th.vy) || 1;
        th.vx = (th.vx / newLen) * tt.speed;
        th.vy = (th.vy / newLen) * tt.speed;
        th.evading = g.gameTime;
        th.evadeCount = (th.evadeCount || 0) + 1;
        g.m.threatEvasions++;
        logEvent(`${tt.code} evading ${CARDS[threatening.cardId].name} fire envelope`, 'warn');
      }
    }
    // After evasion period, retarget toward goal. Custom scenarios recommit much
    // faster (45 game-sec) so detours are brief and the strike still lands.
    const recommitMs = g.sc.custom ? 45 * 1000 : 5 * 60 * 1000;
    if (th.evading && (g.gameTime - th.evading) > recommitMs) {
      th.evading = null;
      const dx = th.targetX - th.x, dy = th.targetY - th.y, len = Math.hypot(dx, dy);
      th.vx = (dx / len) * tt.speed;
      th.vy = (dy / len) * tt.speed;
    }
    // Custom scenarios: gentle homing keeps OWA/cruise converging on the assigned
    // target after any detour, instead of drifting off on a stale perpendicular heading.
    if (g.sc.custom && !th.evading && !th.targetAsset && !th.paralleling && !th.spoofed && tt.dmg > 0 && !tt.indirect) {
      const dx = th.targetX - th.x, dy = th.targetY - th.y, len = Math.hypot(dx, dy) || 1;
      th.vx = th.vx * 0.9 + (dx / len) * tt.speed * 0.1;
      th.vy = th.vy * 0.9 + (dy / len) * tt.speed * 0.1;
      const nl = Math.hypot(th.vx, th.vy) || 1;
      th.vx = (th.vx / nl) * tt.speed;
      th.vy = (th.vy / nl) * tt.speed;
    }

    th.x += th.vx * dt;
    th.y += th.vy * dt;

    if (th.x < -60 || th.x > MAP_W + 60 || th.y < -60 || th.y > MAP_H + 60) {
      th.alive = false;
      return;
    }

    // Hit asset
    if (th.targetAsset) {
      const a = g.assets.find(x => x.id === th.targetAsset && x.alive);
      if (a && dist(th, a) < 18) {
        a.hp = Math.max(0, a.hp - tt.dmg);
        a.damageWarn = true;
        th.alive = false;
        (g.blasts || (g.blasts = [])).push({ x: a.x, y: a.y, age: 0, big: tt.class === 'ballistic' || tt.class === 'glide' || tt.dmg > 1, cls: tt.class });
        logEvent(`✗ ${CARDS[a.cardId].name} HIT by ${tt.code} (-${tt.dmg}HP)`, 'crit');
        pushAlert(`${CARDS[a.cardId].name} struck by ${tt.code}`, 'crit', true);
        if (a.hp === 0) {
          a.alive = false;
          a.mode = 'DESTROYED';
          g.m.assetsLost++;
          logEvent(`!!! ${CARDS[a.cardId].name} DESTROYED`, 'crit');
          pushAlert(`${CARDS[a.cardId].name} DESTROYED, beyond field repair`, 'crit', true);
        }
        return;
      }
    }

    // Hit defended node
    const ttgt = g.nodes.find(n => n.hp > 0 && dist(th, n) < 14);
    if (ttgt && tt.dmg > 0) {
      th.alive = false;
      // softDegraded: spawned without recon support, 60% chance to miss the node
      if (th.softDegraded && Math.random() < 0.6) {
        g.missMarkers.push({ x: ttgt.x + (Math.random() - 0.5) * 40, y: ttgt.y + (Math.random() - 0.5) * 40, age: 0 });
        logEvent(`✓ ${tt.code} MISSED ${ttgt.name}, no recon support, target deviation`, 'ok');
        g.m.strikesAverted = (g.m.strikesAverted || 0) + 1;
        return;
      }
      ttgt.hp = Math.max(0, ttgt.hp - tt.dmg);
      g.m.leakedReal++;
      g.m.leakDmg += tt.dmg;
      g.m.infraLostK += (isCapital(g.sc) ? 40000 : 8000) * tt.dmg;
      (g.blasts || (g.blasts = [])).push({ x: ttgt.x, y: ttgt.y, age: 0, big: tt.class === 'ballistic' || tt.class === 'glide' || tt.dmg > 1, cls: tt.class });
      logEvent(`✗✗ ${ttgt.name} STRUCK by ${tt.code}${tt.dmg > 1 ? ` (-${tt.dmg}HP)` : ''}`, 'crit');
      pushAlert(`${ttgt.name} STRUCK by ${tt.code}`, 'crit', true);
      if (ttgt.hp === 0) {
        logEvent(`!!! ${ttgt.name} LOST`, 'crit');
        pushAlert(`${ttgt.name} LOST`, 'crit', true);
      }
    } else if (ttgt && tt.dmg === 0) {
      th.alive = false;
      logEvent(`${tt.code} reached AOR (no damage)`, 'warn');
    }
  }

  function updateAsset(a, dt) {
    if (!a.alive) return;
    if (a.deploying) {
      if (nowMs() >= a.deployingUntil) {
        a.deploying = false;
        logEvent(`${CARDS[a.cardId].name} deployment complete`, 'ok');
      }
      return;
    }
    if (a.mode === 'REPAIR') {
      if (nowMs() >= a.repairUntil) {
        a.hp = Math.min(a.maxHp, a.hp + 1);
        a.mode = a.prevMode || 'STANDBY';
        a.damageWarn = false;
        gRef.current.m.repairs++;
        logEvent(`${CARDS[a.cardId].name} repair complete (HP ${a.hp}/${a.maxHp})`, 'ok');
      }
      a.emissionLevel = 0;
      return;
    }
    if (a.mode === 'HIDDEN') { a.emissionLevel = 0; return; }
    if (a.mode === 'MOVING') {
      if (a.moveTarget) {
        const dx = a.moveTarget.x - a.x, dy = a.moveTarget.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 4) {
          a.x = a.moveTarget.x; a.y = a.moveTarget.y;
          a.moveTarget = null;
          a.mode = 'STANDBY';
          a.deploying = true;
          a.deployingUntil = nowMs() + CARDS[a.cardId].deployTime * 0.5;
          logEvent(`${CARDS[a.cardId].name} arrived; redeploying`, 'info');
        } else {
          const sp = CARDS[a.cardId].moveSpeed;
          a.x += (dx / len) * sp * dt;
          a.y += (dy / len) * sp * dt;
        }
      }
      a.emissionLevel = 0;
      return;
    }
    a.emissionLevel = a.mode === 'STANDBY' ? 0 : a.mode === 'ALERT' ? 1 : 2;
    if (a.firingCooldown > 0) a.firingCooldown -= dt;
  }

  function autoEngage(a) {
    const g = gRef.current;
    const c = CARDS[a.cardId];

    // Fire sector check, angle from asset to target must be within facing arc
    const inSector = (th) => {
      if (!c.sectorArc || c.sectorArc >= 360) return true;
      const dx = th.x - a.x, dy = th.y - a.y;
      const angleToTarget = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; // 0=E in math
      // Convert to compass: 0=N, 90=E. Math angle 0 = E so compass = (90 - mathAngle + 360) % 360
      const compassAngle = (90 - angleToTarget + 360) % 360;
      const halfArc = c.sectorArc / 2;
      const facing = a.facing % 360;
      let diff = Math.abs(compassAngle - facing);
      if (diff > 180) diff = 360 - diff;
      return diff <= halfArc;
    };

    let best = null;
    let bestPriority = -1;
    const roe = g.roe || 'TIGHT';
    g.threats.forEach(th => {
      if (!th.alive) return;
      if (dist(th, a) > c.range) return;
      // ROE check
      if (roe === 'HOLD') return; // weapons hold, no firing at all
      // Visual ID required for classified targets unless ROE is FREE
      if (!th.classified) {
        if (roe !== 'FREE') return; // TIGHT/HOLD require classification
      }
      // Fire-sector restriction
      if (!inSector(th)) return;
      const tt = TT[th.type];
      // Engage rules, player can disable classes per-asset
      const rules = a.engageRules || {};
      if (!rules[tt.class]) return;
      // ALTITUDE CEILING (opt-in via scenario.altitudeRealism), weapon must reach the threat band
      if (g.sc && g.sc.altitudeRealism && m_ceilIndex(c) < m_altIndex(tt)) return;
      // EW only fires (suppresses) ewVuln targets
      if (c.isEW && !tt.ewVuln) return;
      let prio = 0;
      if (tt.class === 'ballistic') prio = 100;
      else if (tt.class === 'cruise') prio = 80;
      else if (tt.class === 'glide') prio = 70;
      else if (tt.class === 'male') prio = 65;
      else if (tt.class === 'owa') prio = 60;
      else if (tt.class === 'tactical') prio = 40;
      else if (tt.class === 'recon') prio = 20;
      else if (tt.class === 'unknown') prio = 30;
      // Heavy SAMs penalize firing on cheap targets even if rule allows
      if (a.cardId === 'patriot' && tt.class !== 'ballistic' && tt.class !== 'cruise' && tt.class !== 'male') prio -= 30;
      if (a.cardId === 'iris_t' && (tt.class === 'tactical' || tt.class === 'recon')) prio -= 20;
      prio += (1 - dist(th, a) / c.range) * 10;
      if (prio > bestPriority) { bestPriority = prio; best = th; }
    });

    if (!best) return;
    if (a.ammo <= 0 && !c.isEW) return;

    const tt = TT[best.type];
    const assetType = mapAssetType(a.cardId);

    // INTERCEPTOR DRONE PATH: launch a drone entity, don't resolve hit yet
    if (c.isInterceptor) {
      // Use crew-selected loadout if set, else default
      const loadoutId = a.loadout || DEFAULT_LOADOUT;
      const loadout = DRONE_LOADOUTS[loadoutId] || DRONE_LOADOUTS[DEFAULT_LOADOUT];
      a.firingCooldown = c.firingDelay; // launch prep cycle
      a.ammo = Math.max(0, a.ammo - 1);
      g.m.weaponSpend[assetType] = (g.m.weaponSpend[assetType] || 0) + 1;
      g.m.intDronesLaunched++;
      if (best.firstEngagedGT == null) { best.firstEngagedGT = g.gameTime; g.m.engageLat.push(g.gameTime - (best.visibleSinceGT || best.spawnGT)); g.m.engagedCount++; }
      g.intDrones.push({
        id: uid(),
        x: a.x, y: a.y,
        vx: 0, vy: 0,
        targetThreatId: best.id,
        ownerAssetId: a.id,
        speed: loadout.droneSpeed,
        ageGT: 0,
        fuelMaxGT: loadout.fuelMin * 60 * 1000,
        color: loadout.color,
        loadoutId, // store loadout for Pk lookup at intercept
        abandoned: false,
        intercepted: false,
        expired: false,
        targetCode: tt.code,
      });
      logEvent(`${callsign(a.cardId)} [${loadout.name}] drone launched at ${tt.code}, ETA ${((dist(a, best) / (loadout.droneSpeed * TIME_COMPRESSION)) / 60).toFixed(1)} game-min`, 'info');
      return;
    }

    // CONVENTIONAL INSTANT-FIRE PATH (SAM/SHORAD/MANPADS/MG/EW)
    if (g.theaterStock != null && (assetType === 'patriot' || assetType === 'iris' || assetType === 'nasams')) {
      if (g.theaterStock <= 0) {
        if (!g._stockWarned) { g._stockWarned = true; pushAlert('THEATER STOCK DEPLETED, Patriot/IRIS/NASAMS winchester', 'crit', 12000); logEvent('Theater interceptor stockpile exhausted. High-end SAMs cannot fire.', 'crit'); }
        return;
      }
    }
    let baseP = (CARDS[a.cardId] && CARDS[a.cardId].pk && CARDS[a.cardId].pk[tt.class] != null) ? CARDS[a.cardId].pk[tt.class] : ((PK[assetType] || {})[tt.class] ?? 0.3);
    // ENEMY EW NODE: degrades data-link weapons (-25%)
    if (g.enemyEW && g.enemyEW.alive && g.enemyEW.active) {
      const dataLink = ['nasams', 'iris', 'patriot', 'crotale', 'interceptor'];
      if (dataLink.includes(assetType)) baseP *= 0.75;
    }
    const proxBoost = (1 - dist(best, a) / c.range) * 0.15;
    const finalP = clamp(baseP + proxBoost, 0.02, 0.95);
    const hit = Math.random() < finalP;

    a.firingCooldown = c.firingDelay;
    if (!c.isEW) a.ammo = Math.max(0, a.ammo - 1);
    if (g.theaterStock != null && (assetType === 'patriot' || assetType === 'iris' || assetType === 'nasams')) { g.theaterStock = Math.max(0, g.theaterStock - 1); g.m.theaterUsed = (g.m.theaterUsed || 0) + 1; }
    g.m.weaponSpend[assetType] = (g.m.weaponSpend[assetType] || 0) + 1;
    if (best.firstEngagedGT == null) { best.firstEngagedGT = g.gameTime; g.m.engageLat.push(g.gameTime - (best.visibleSinceGT || best.spawnGT)); g.m.engagedCount++; }

    g.shots.push({ x1: a.x, y1: a.y, x2: best.x, y2: best.y, color: c.color, age: 0, life: 600, hit });
    audioCue('launch');

    // Engaging an emission decoy compromises this asset's position
    if (best.type === 'emit_decoy' && !a.compromisedAt) {
      a.compromisedAt = g.gameTime;
      a.compromisedReason = 'fired on emission decoy';
      g.m.compromises++;
      pushAlert(`⚠ ${CARDS[a.cardId].name} POSITION COMPROMISED, emission decoy reported your fire`, 'crit', true);
      logEvent(`SIGINT alert: ${CARDS[a.cardId].name} fired on emit-decoy. Position transmitted.`, 'crit');
      g.scheduledStrikes = g.scheduledStrikes || [];
      g.scheduledStrikes.push({
        atGameTime: g.gameTime + (4 + Math.random() * 5) * 60 * 1000,
        type: Math.random() < 0.5 ? 'lancet_of' : 'iskander',
        targetX: a.x, targetY: a.y, fromVec: 'E',
        reason: 'decoy compromise',
      });
    }

    if (hit) {
      best.alive = false;
      g.m.threatsKilled++;
      g.m.valueDestroyedK += m_threatCostK(TT[best.type]);
      g.m.intercepts++;
      if (best.type === 'decoy' || best.type === 'emit_decoy') g.m.decoysHit++;
      // Update recon coverage (kill recon > break designation)
      updateReconCoverage(best, 'kill');
      // Recon kill, adds to kill chain tracking
      if (tt.class === 'recon' && g.reconKilled[best.type] != null) {
        g.reconKilled[best.type]++;
        g.m.reconKills++;
        logEvent(`✓ ${c.tag} > ${tt.code} HIT, recon kill registered (kill-chain disrupted)`, 'ok');
      } else {
        logEvent(`✓ ${c.tag} > ${tt.code} (P${(finalP*100).toFixed(0)}% HIT)`, 'ok');
      }
      audioCue('kill');
      const hourIdx = Math.floor(g.gameTime / (3600 * 1000));
      if (g.hourBuckets[hourIdx]) g.hourBuckets[hourIdx].killed++;
    } else {
      g.m.intercept_misses++;
      g.missMarkers.push({ x: best.x, y: best.y, age: 0 });
      logEvent(`✗ ${c.tag} > ${tt.code} (P${(finalP*100).toFixed(0)}% MISS, leaking)`, 'warn');
    }
  }

  // ============= INTERCEPTOR DRONE FLIGHT =============
  function updateIntDrones(dt, gameDt) {
    const g = gRef.current;
    if (!g.intDrones || g.intDrones.length === 0) return;

    // Find a fresh track for a loitering drone after a miss / lost target.
    // Requires the controlling battery (owner) to be alive (datalink), within seeker reach,
    // and a loadout that can actually engage the threat class.
    const reacquire = (d, excludeId) => {
      const owner = g.assets.find(x => x.id === d.ownerAssetId && x.alive && !x.deploying);
      if (!owner) return null;
      const ld = DRONE_LOADOUTS[d.loadoutId] || DRONE_LOADOUTS[DEFAULT_LOADOUT];
      let best = null, bestD = 230;
      g.threats.forEach(t => {
        if (!t.alive || t.indirect || t.id === excludeId) return;
        const cls = TT[t.type] && TT[t.type].class;
        const mod = ld.pkMod ? ld.pkMod[cls] : 0;
        if (!mod || mod <= 0) return;
        const dd = Math.hypot(t.x - d.x, t.y - d.y);
        if (dd < bestD) { bestD = dd; best = t; }
      });
      return best;
    };

    g.intDrones.forEach(d => {
      if (d.expired || d.intercepted) return;

      d.ageGT += gameDt;

      // Battery exhausted
      if (d.ageGT > d.fuelMaxGT) {
        d.expired = true;
        if (!d.abandoned) {
          // Reached fuel limit while still chasing, counted as miss
          g.m.intDronesMissed++;
          logEvent(`✗ Interceptor drone fuel out before reaching ${d.targetCode}`, 'warn');
        } else {
          // Already abandoned, drone fell from sky
          g.m.intDronesLost++;
          logEvent(`✗ Abandoned interceptor drone crashed (battery drained)`, 'warn');
        }
        return;
      }

      // Look for target
      const target = g.threats.find(t => t.id === d.targetThreatId && t.alive);

      if (!target) {
        // Target killed/lost before interception > drone has no purpose, drains
        if (!d.abandoned) {
          const nt = reacquire(d, d.targetThreatId);
          if (nt) {
            d.targetThreatId = nt.id; d.targetCode = TT[nt.type].code;
            g.m.intReattacks = (g.m.intReattacks || 0) + 1;
            logEvent(`Drone re-tasked to ${TT[nt.type].code}, previous track eliminated`, 'info');
            return;
          }
          d.abandoned = true;
          d.abandonedAt = g.gameTime;
          logEvent(`Drone target ${d.targetCode} eliminated, no datalink re-task, drone drains`, 'warn');
          // Crash within 0.5–2 game-min
          d.fuelMaxGT = Math.min(d.fuelMaxGT, d.ageGT + (0.5 + Math.random() * 1.5) * 60 * 1000);
        }
        // Continue forward (no target, just glides)
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        // off-map cleanup
        if (d.x < -40 || d.x > MAP_W + 40 || d.y < -40 || d.y > MAP_H + 40) {
          d.expired = true;
          g.m.intDronesLost++;
        }
        return;
      }

      // Home in
      const dx = target.x - d.x, dy = target.y - d.y;
      const len = Math.hypot(dx, dy) || 1;
      d.vx = (dx / len) * d.speed;
      d.vy = (dy / len) * d.speed;
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // Intercept check
      if (dist(d, target) < 12 && g.gameTime >= (d.cooldownGT || 0)) {
        const tt = TT[target.type];
        const baseP = (PK.interceptor || {})[tt.class] ?? 0.5;
        // Apply loadout pkMod (loadout-specific effectiveness against threat class)
        const loadout = DRONE_LOADOUTS[d.loadoutId] || DRONE_LOADOUTS[DEFAULT_LOADOUT];
        const loadoutMod = (loadout.pkMod && loadout.pkMod[tt.class] !== undefined) ? loadout.pkMod[tt.class] : 1.0;
        // Closing speed mismatch penalty: if target much faster than drone, reduce P
        const tSpeed = Math.hypot(target.vx, target.vy) || 0.05;
        const speedRatio = d.speed / tSpeed;
        const speedAdj = clamp(speedRatio * 0.5, 0.3, 1.2);
        const finalP = clamp(baseP * loadoutMod * speedAdj, 0.05, 0.95);
        const hit = Math.random() < finalP;

        if (hit) {
          d.intercepted = true;
          target.alive = false;
          g.m.threatsKilled++;
          g.m.valueDestroyedK += m_threatCostK(TT[target.type]);
          g.m.intercepts++;
          g.m.intDronesHit++;
          if (target.type === 'decoy' || target.type === 'emit_decoy') g.m.decoysHit++;
          // Update recon coverage (kill recon > break designation)
          updateReconCoverage(target, 'kill');
          logEvent(`✓ FPV INT [${loadout.name}] > ${tt.code} (P${(finalP*100).toFixed(0)}% HIT)`, 'ok');
        } else {
          g.m.intercept_misses++;
          g.missMarkers.push({ x: target.x, y: target.y, age: 0 });
          // Loitering re-attack: spend a little energy, hold a brief re-attack delay, and
          // re-acquire another track if the controlling battery is still alive (datalink).
          d.cooldownGT = g.gameTime + 30 * 1000;
          d.fuelMaxGT = Math.max(d.ageGT + 30 * 1000, d.fuelMaxGT - 1.5 * 60 * 1000);
          const owner = g.assets.find(x => x.id === d.ownerAssetId && x.alive && !x.deploying);
          if (owner) {
            const nt = reacquire(d, target.id);
            if (nt) {
              d.targetThreatId = nt.id; d.targetCode = TT[nt.type].code;
              g.m.intReattacks = (g.m.intReattacks || 0) + 1;
              logEvent(`✗ FPV INT missed ${tt.code} (P${(finalP*100).toFixed(0)}%), re-acquiring ${TT[nt.type].code}`, 'warn');
            } else {
              logEvent(`✗ FPV INT missed ${tt.code} (P${(finalP*100).toFixed(0)}%), loitering for re-attack`, 'warn');
            }
          } else {
            d.abandoned = true;
            d.fuelMaxGT = Math.min(d.fuelMaxGT, d.ageGT + (0.5 + Math.random() * 1.5) * 60 * 1000);
            logEvent(`✗ FPV INT missed ${tt.code}, datalink down (battery lost), drone drains`, 'warn');
          }
        }
      }
    });

    g.intDrones = g.intDrones.filter(d => !d.expired && !d.intercepted);
  }

  // ============= ASSET ACTIONS =============
  const setMode = (assetId, mode) => {
    const g = gRef.current;
    const a = g.assets.find(x => x.id === assetId);
    if (!a || !a.alive) { pushAlert(`Asset destroyed, cannot command`, 'warn'); return; }
    if (CARDS[a.cardId].attached) { pushAlert(`${CARDS[a.cardId].name} is ATTACHED, not under your control`, 'warn'); return; }
    if (a.deploying) { pushAlert(`${CARDS[a.cardId].name} still deploying`, 'warn'); return; }
    if (a.mode === 'REPAIR') { pushAlert(`${CARDS[a.cardId].name} under repair`, 'warn'); return; }
    if (a.mode === 'MOVING') { pushAlert(`${CARDS[a.cardId].name} relocating`, 'warn'); return; }
    a.prevMode = a.mode;
    a.mode = mode;
    logEvent(`${CARDS[a.cardId].name} > ${mode}`, 'info');
  };

  const beginRepair = (assetId) => {
    const g = gRef.current;
    const a = g.assets.find(x => x.id === assetId);
    if (!a || !a.alive) { pushAlert(`Asset destroyed, cannot repair`, 'crit'); return; }
    if (CARDS[a.cardId].attached) { pushAlert(`${CARDS[a.cardId].name} is ATTACHED, DIV handles repair`, 'warn'); return; }
    if (a.hp >= a.maxHp) { pushAlert(`${CARDS[a.cardId].name} at full HP`, 'info'); return; }
    a.prevMode = a.mode;
    a.mode = 'REPAIR';
    a.repairUntil = nowMs() + CARDS[a.cardId].repairTime;
    logEvent(`${CARDS[a.cardId].name} hidden, beginning field repair`, 'info');
  };

  const beginRelocate = (assetId) => {
    const g = gRef.current;
    const a = g.assets.find(x => x.id === assetId);
    if (!a) return;
    if (CARDS[a.cardId].attached) { pushAlert(`${CARDS[a.cardId].name} is ATTACHED, cannot relocate`, 'warn'); return; }
    setRelocatingAsset(assetId);
  };
  const completeRelocate = (x, y) => {
    if (!relocatingAsset) return;
    const g = gRef.current;
    const a = g.assets.find(z => z.id === relocatingAsset);
    if (!a || !a.alive) { setRelocatingAsset(null); return; }
    if (x < FRIENDLY_BOUND.xMin || x > FRIENDLY_BOUND.xMax || y < FRIENDLY_BOUND.yMin || y > FRIENDLY_BOUND.yMax) {
      pushAlert('Cannot relocate outside friendly AOR', 'warn');
      return;
    }
    a.moveTarget = { x, y };
    a.mode = 'MOVING';
    g.m.relocations++;
    g.m.commandActions = (g.m.commandActions||0)+1;
    a.emissionTime = 0;
    const wasComp = !!a.compromisedAt;
    a.compromisedAt = null; a.compromisedReason = null;
    if (g.scheduledStrikes) g.scheduledStrikes = g.scheduledStrikes.filter(ss => ss.forAssetId !== a.id);
    g.threats.forEach(t => { if (t.targetAsset === a.id) t.targetAsset = null; });
    logEvent(`${CARDS[a.cardId].name} relocating${wasComp ? ', breaking lock and defeating the counter-strike' : ''}`, 'info');
    setRelocatingAsset(null);
  };

  const setFacing = (assetId, deg) => {
    const g = gRef.current;
    const a = g.assets.find(x => x.id === assetId);
    if (!a || !a.alive) return;
    if (CARDS[a.cardId].attached) { pushAlert(`${CARDS[a.cardId].name} is ATTACHED, not under your control`, 'warn'); return; }
    if (a.deploying || a.mode === 'REPAIR' || a.mode === 'MOVING') {
      pushAlert(`${CARDS[a.cardId].name} cannot rotate now`, 'warn');
      return;
    }
    a.facing = deg;
    logEvent(`${CARDS[a.cardId].name} re-orienting to ${deg}°`, 'info');
  };

  const toggleEngageRule = (assetId, threatClass) => {
    const g = gRef.current;
    const a = g.assets.find(x => x.id === assetId);
    if (!a || !a.alive) return;
    if (CARDS[a.cardId].attached) { pushAlert(`${CARDS[a.cardId].name} is ATTACHED, engage rules locked`, 'warn'); return; }
    a.engageRules = a.engageRules || {};
    a.engageRules[threatClass] = !a.engageRules[threatClass];
    g.m.commandActions = (g.m.commandActions||0)+1;
    logEvent(`${CARDS[a.cardId].name} engage ${threatClass}: ${a.engageRules[threatClass] ? 'ON' : 'OFF'}`, 'info');
  };

  const setROE = (newRoe) => {
    const g = gRef.current;
    if (!g) return;
    if (!['HOLD', 'TIGHT', 'FREE'].includes(newRoe)) return;
    g.roe = newRoe;
    g.m.commandActions = (g.m.commandActions||0)+1;
    logEvent(`ROE CHANGED: WEAPONS ${newRoe}, all assets advised`, 'crit');
    pushAlert(`ROE: WPNS ${newRoe}`, 'phase', 8000);
    audioCue('warn');
  };

  // Instructor: inject unscheduled threat
  const instructorInject = (threatType, from) => {
    const g = gRef.current;
    if (!g) return;
    if (!TT[threatType]) return;
    spawnThreat({ type: threatType, from: from || 'E' });
    logEvent(`INSTRUCTOR INJECT: ${TT[threatType].code} from ${from || 'E'}`, 'crit');
    pushAlert(`INJECT: ${TT[threatType].code}`, 'crit', 6000);
    audioCue('warn');
  };
  // Instructor: kill specified asset (simulate damage)
  const instructorDamage = (kind) => {
    const g = gRef.current;
    if (!g) return;
    if (kind === 'random_node') {
      const live = g.nodes.filter(n => n.hp > 0 && n.kind !== 'forward');
      if (!live.length) return;
      const t = live[Math.floor(Math.random() * live.length)];
      t.hp = Math.max(0, t.hp - 1);
      g.m.leakDmg = (g.m.leakDmg || 0) + 1;
      logEvent(`INSTRUCTOR: ${t.name} damaged (-1 HP)`, 'crit');
    } else if (kind === 'random_asset') {
      const live = g.assets.filter(a => a.alive && !CARDS[a.cardId].attached);
      if (!live.length) return;
      const a = live[Math.floor(Math.random() * live.length)];
      a.hp = 0;
      a.alive = false;
      a.mode = 'DESTROYED';
      g.m.assetsLost = (g.m.assetsLost || 0) + 1;
      logEvent(`INSTRUCTOR: ${callsign(a.cardId)} destroyed`, 'crit');
    }
    audioCue('warn');
  };

  // Fire mission request: targets enemy EW node (if known) or arbitrary point
  const requestFireMission = (targetX, targetY) => {
    const g = gRef.current;
    if (!g) return;
    if (g.fireMission.available <= 0) {
      pushAlert('No fire missions remaining (CORPS limit)', 'warn');
      return;
    }
    if (g.gameTime < g.fireMission.cooldownUntil) {
      const wait = ((g.fireMission.cooldownUntil - g.gameTime) / (60 * 1000)).toFixed(1);
      pushAlert(`Fire mission on cooldown (${wait} game-min)`, 'warn');
      return;
    }
    if (g.fireMission.active) {
      pushAlert('Fire mission already in flight', 'warn');
      return;
    }
    // 5 game-min from request to impact (TOT, time on target)
    const impactGT = g.gameTime + 5 * 60 * 1000;
    g.fireMission.active = { targetX, targetY, impactGT, requestedGT: g.gameTime };
    g.fireMission.available--;
    g.fireMission.cooldownUntil = g.gameTime + 10 * 60 * 1000; // 10 game-min cooldown after impact
    g.m.fireMissionsUsed++;
    logEvent(`FIRE MISSION REQUESTED on (${Math.round(targetX)},${Math.round(targetY)}), TOT 5 game-min`, 'crit');
    pushAlert(`Fire mission inbound, TOT 5 game-min`, 'phase', 30000);
    audioCue('cas');
  };

  // Reload request: SAM systems can request resupply (20 game-min ETA)
  const requestReload = (assetId) => {
    const g = gRef.current;
    const a = g.assets.find(x => x.id === assetId);
    if (!a || !a.alive) return;
    const c = CARDS[a.cardId];
    // Any ammo-consuming asset can request resupply (SAM missiles via CORPS,
    // FPV drones + MG ammo via local logistics). EW has nothing to reload.
    if (c.isEW) {
      pushAlert(`${c.name} has no expendable munitions`, 'info');
      return;
    }
    // Check if reload already pending
    if (g.reloads.find(r => r.assetId === assetId)) {
      pushAlert(`${c.name} reload already in transit`, 'warn');
      return;
    }
    if (a.ammo >= c.ammoMax) {
      pushAlert(`${c.name} at full ammo`, 'info');
      return;
    }
    // SAM missiles come from CORPS depot (slow); FPV drones + MG ammo are
    // local resupply (faster). Interceptor crews reload a fresh drone magazine.
    const isLocal = c.isInterceptor || ['mg_a','mg_b','mg_c','mg_d','mg_e','mg_f','gepard','skynex','stinger','piorun'].includes(a.cardId);
    const eta = (isLocal ? 10 : 20) * 60 * 1000;
    const src = isLocal ? 'local logistics' : 'CORPS';
    g.reloads.push({ assetId, amount: c.ammoMax - a.ammo, arrivalGT: g.gameTime + eta });
    g.m.reloadsRequested++;
    logEvent(`${c.name} resupply request to ${src}, ETA ${isLocal ? 10 : 20} game-min`, 'info');
    pushAlert(`${c.name} resupply: ${isLocal ? 10 : 20} game-min ETA`, 'info', 12000);
  };

  function finish(outcome) { gRef.current.result = { outcome }; setView('debrief'); }

  // ============= RENDER =============
  return (
    <div className="min-h-screen w-full" style={{ background: '#102234', color: '#dde3ea' }}>
      <RisoStyles />
      {view === 'menu' && <MenuScreen onDemo={startDemo} onTraining={goTraining} onModelling={() => setView('modelling')} onLibrary={() => setView('library')} onMethodology={() => setView('methodology')} audioOn={audioOn} setAudioOn={setAudioOn} />}
      {view === 'methodology' && <MethodologyScreen onBack={() => setView('menu')} />}
      {view === 'library' && <LibraryScreen onBack={() => setView('menu')} />}
      {view === 'trainmenu' && <TrainingHubScreen onSingle={start} onMultiplayer={() => setView('mp_lobby')} onInstructor={startInstructor} onBack={() => setView('menu')} />}
      {view === 'mp_lobby' && (
        <MultiplayerWrapper onBack={() => setView('menu')} />
      )}
      {view === 'modelling' && <ModellingScreen onLaunch={launchCustom} onBack={() => setView('menu')} />}
      {view === 'scenario' && <ScenarioScreen gameMode={gameMode} onChoose={chooseScenario} onLaunchSaved={(entry) => { const r = buildScenarioFromEntry(entry); launchCustom(r.sc, r.neededThreats, r.neededAssets); }} onBack={() => setView(gameMode === 'training' ? 'trainmenu' : 'menu')} />}
      {view === 'brief' && <BriefScreen onContinue={goDeploy} onBack={() => setView('scenario')} />}
      {view === 'deploy' && (
        <DeployScreen placedRef={placedRef} selectedCardRef={selectedCardRef} hoveredCardRef={hoveredCardRef} gameMode={gameMode}
          onBegin={beginRun} onBack={() => setView('brief')} />
      )}
      {view === 'running' && gRef.current && (
        <RunScreen g={gRef.current}
          selectedAssetId={selectedAssetId} setSelectedAssetId={setSelectedAssetId}
          relocatingAsset={relocatingAsset}
          setMode={setMode} beginRepair={beginRepair} beginRelocate={beginRelocate}
          completeRelocate={completeRelocate} cancelRelocate={() => setRelocatingAsset(null)}
          setFacing={setFacing}
          toggleEngageRule={toggleEngageRule}
          requestFireMission={requestFireMission}
          requestReload={requestReload}
          setROE={setROE}
          instructorMode={instructorMode}
          paused={paused}
          togglePause={togglePause}
          simSpeed={simSpeed}
          setSimSpeed={setSimSpeed}
          instructorInject={instructorInject}
          instructorDamage={instructorDamage}
          instructorNotes={instructorNotes}
          addInstructorNote={addInstructorNote}
          audioOn={audioOn} setAudioOn={setAudioOn}
          onEnd={endSession} gameMode={gameMode}
          onDeployTeam={beginPlaceTeam} placingTeam={placingTeam}
          placeTeamAt={placeTeamAt} cancelPlaceTeam={() => setPlacingTeam(false)}
          onAutoEngage={autoEngageAll}
          dismissAlert={dismissAlert} />
      )}
      {view === 'debrief' && gRef.current && (
        <DebriefScreen g={gRef.current} instructorNotes={instructorNotes} instructorMode={instructorMode}
          onMenu={() => { setView('menu'); placedRef.current = []; setInstructorMode(false); setInstructorNotes([]); }} />
      )}
    </div>
  );
}

// ============================================================================
// ACCESS GATE – server-verified shared code. The App only renders once a valid
// session token is held. The token is checked against /api/auth (which holds the
// real code in a server env var), so the code is never present in this bundle.
// ============================================================================
export default function App() {
  const [state, setState] = useState('checking'); // 'checking' | 'locked' | 'open'

  useEffect(() => {
    let cancelled = false;
    const token = (() => { try { return localStorage.getItem('skywatch_access_token') || ''; } catch (e) { return ''; } })();
    if (!token) { setState('locked'); return; }
    fetch('/api/auth?token=' + encodeURIComponent(token))
      .then(r => r.json())
      .then(d => { if (!cancelled) setState(d && d.ok ? 'open' : 'locked'); })
      .catch(() => { if (!cancelled) setState('locked'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'open') return <AppInner />;
  if (state === 'checking') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0a1626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="f-mono" style={{ color: '#5d6b7a', fontSize: 12, letterSpacing: '0.2em' }}>CHECKING ACCESS…</span>
      </div>
    );
  }
  return <AccessGate onOpen={() => setState('open')} />;
}

function AccessGate({ onOpen }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d && d.ok && d.token) {
        try { localStorage.setItem('skywatch_access_token', d.token); } catch (e) {}
        onOpen();
        return;
      }
      if (r.status === 500 || (d && d.error === 'server_not_configured')) {
        setErr('Access is not configured on the server yet. Contact the administrator.');
      } else {
        setErr('Incorrect code. Please try again.');
      }
    } catch (e) {
      setErr('Network error. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0a1626', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="cls-banner" style={{ position: 'fixed', top: 0, left: 0, right: 0 }}>PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div style={{ width: 'min(420px, 94vw)', border: '1px solid #243d52', borderRadius: 8, background: '#0c1c2e', padding: '28px 26px' }}>
        <div className="f-mono" style={{ fontSize: 10, letterSpacing: '0.25em', color: '#5d6b7a', marginBottom: 8 }}>ACCESS REQUIRED</div>
        <h1 className="f-display" style={{ fontSize: 40, lineHeight: 1, letterSpacing: '0.06em', color: '#2f80d6', marginBottom: 6 }}>SKYWATCH</h1>
        <div className="f-mono" style={{ fontSize: 11, color: '#93a1b0', lineHeight: 1.5, marginBottom: 20 }}>
          Air-defence modelling &amp; scenario simulator. This tool is access-controlled. Enter the code you were given to continue.
        </div>
        <label className="f-mono" style={{ fontSize: 9, color: '#5d6b7a', display: 'block', marginBottom: 4 }}>ACCESS CODE</label>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          type="password"
          autoFocus
          placeholder="enter code"
          className="f-mono"
          style={{ width: '100%', fontSize: 14, padding: '10px 12px', background: '#0a1626', border: `1px solid ${err ? '#d24a44' : '#34516b'}`, borderRadius: 4, color: '#fff', letterSpacing: '0.1em', marginBottom: 12 }}
        />
        {err && <div className="f-mono" style={{ fontSize: 10, color: '#e0726b', marginBottom: 12 }}>{err}</div>}
        <button
          onClick={submit}
          disabled={busy || !code.trim()}
          className="f-display"
          style={{ width: '100%', fontSize: 14, padding: '11px', borderRadius: 4, border: `1px solid ${busy || !code.trim() ? '#243d52' : '#2f80d6'}`, background: busy || !code.trim() ? '#16293c' : 'rgba(47,128,214,0.16)', color: busy || !code.trim() ? '#5d6b7a' : '#fff', cursor: busy || !code.trim() ? 'not-allowed' : 'pointer', letterSpacing: '0.05em' }}>
          {busy ? 'CHECKING…' : 'ENTER'}
        </button>
        <div className="f-mono" style={{ fontSize: 8, color: '#5d6b7a', marginTop: 16, lineHeight: 1.5 }}>
          Access is verified on the server. Once accepted, this device stays signed in. All data in the tool is illustrative and open-source.
        </div>
      </div>
    </div>
  );
}

// ============================================================================
function RisoStyles() {
  return (
    <style>{`
      /* === NATO institutional palette (deep navy, APP-6 affiliation colours) === */
      :root {
        --bg-base: #0a1626;
        --bg-panel: #102234;
        --bg-panel-2: #16293c;
        --bg-elevated: #1e3349;
        --bg-overlay: #0a1626e8;

        --border-subtle: #16293c;
        --border-default: #243d52;
        --border-strong: #34516b;
        --border-accent: #44617b;

        --text-primary: #dde3ea;
        --text-secondary: #93a1b0;
        --text-tertiary: #5d6b7a;
        --text-inverted: #ffffff;

        /* MIL-STD-2525 / APP-6 affiliations */
        --mil-friend: #2f80d6;       /* friendly / own, NATO blue */
        --mil-friend-glow: #5aa0e6;
        --mil-friend-bg: rgba(47,128,214,0.14);
        --mil-hostile: #d24a44;      /* hostile, red */
        --mil-hostile-glow: #e0726b;
        --mil-hostile-bg: rgba(210,74,68,0.14);
        --mil-unknown: #d9a52f;      /* unknown, amber/yellow */
        --mil-unknown-glow: #e8bd55;
        --mil-unknown-bg: rgba(217,165,47,0.14);
        --mil-neutral: #2f80d6;      /* neutral, green */
        --mil-neutral-bg: rgba(47,128,214,0.14);

        --status-ok: #2f80d6;
        --status-warn: #d9a52f;
        --status-crit: #d24a44;
        --status-info: #2f80d6;
      }

      body, html, #root { background: var(--bg-base); color: var(--text-primary); }

      .f-display { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-weight: 700; letter-spacing: 0; }
      .f-typewriter { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-weight: 600; letter-spacing: 0.03em; }
      .f-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-weight: 400; }
      .f-cond { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-weight: 600; }
      .f-serif { font-family: 'IBM Plex Sans', system-ui, sans-serif; font-weight: 400; line-height: 1.5; }

      .riso-paper {
        background-color: var(--bg-base);
        background-image: radial-gradient(1100px 520px at 50% -8%, rgba(47,128,214,0.07), transparent 62%);
        color: var(--text-primary);
      }

      .stamp { display: inline-block; border: 1px solid var(--mil-hostile); color: var(--mil-hostile);
        padding: 3px 10px; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.14em;
        font-size: 10px; text-transform: uppercase; background: var(--mil-hostile-bg); }

      .cls-banner {
        background: var(--bg-panel);
        color: var(--text-secondary);
        letter-spacing: 0.14em;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10px;
        padding: 4px 10px;
        text-align: center;
        border-top: 1px solid var(--border-default);
        border-bottom: 1px solid var(--border-default);
        text-transform: uppercase;
      }

      .double-rule {
        border-top: 1px solid var(--border-default);
        margin: 0 0 4px 0;
      }

      /* === Buttons === */
      .btn-riso {
        font-family: 'IBM Plex Sans', sans-serif;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        border: 1px solid var(--mil-friend);
        background: var(--mil-friend-bg);
        color: var(--mil-friend-glow);
        padding: 9px 18px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.13s ease;
        border-radius: 3px;
      }
      .btn-riso:hover { background: var(--mil-friend); color: #fff; box-shadow: none; }
      .btn-riso:disabled { background: transparent; border-color: var(--border-subtle); color: var(--text-tertiary); cursor: not-allowed; box-shadow: none; }
      .btn-alt { background: transparent; border-color: var(--border-default); color: var(--text-secondary); }
      .btn-alt:hover { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border-strong); box-shadow: none; }

      /* === Nation flags (compact) === */
      .nation-flag { display: inline-block; width: 14px; height: 9px; border: 1px solid var(--border-default); vertical-align: middle; }
      .flag-US { background: linear-gradient(to bottom, #b22234 33%, #fff 33% 66%, #3c3b6e 66%); }
      .flag-DE { background: linear-gradient(to bottom, #000 33%, #dd0000 33% 66%, #ffce00 66%); }
      .flag-FR { background: linear-gradient(to right, #002395 33%, #fff 33% 66%, #ed2939 66%); }
      .flag-UK { background: #012169; }
      .flag-PL { background: linear-gradient(to bottom, #fff 50%, #dc143c 50%); }
      .flag-NO { background: #ed2939; }
      .flag-UA { background: linear-gradient(to bottom, #005bbb 50%, #ffd500 50%); }
      .flag-IT { background: linear-gradient(to right, #008C45 33%, #fff 33% 66%, #CD212A 66%); }
      .flag-IL { background: linear-gradient(to bottom, #0038b8 22%, #fff 22% 78%, #0038b8 78%); }
      .flag-KR { background: linear-gradient(to right, #cd2e3a 50%, #0047a0 50%); }
      .flag-SE { background: linear-gradient(to bottom, #006aa7 38%, #fecc00 38% 62%, #006aa7 62%); }
      .flag-CH { background: #d52b1e; }
      .flag-JP { background: radial-gradient(circle at 50% 50%, #bc002d 30%, #fff 30%); }
      .flag-IN { background: linear-gradient(to bottom, #ff9933 33%, #fff 33% 66%, #138808 66%); }
      .flag-RU { background: linear-gradient(to bottom, #fff 33%, #0039a6 33% 66%, #d52b1e 66%); }
      .flag-EU { background: #003399; }
      .flag-NATO { background: #1d4f91; }
      .flag-CN { background: linear-gradient(135deg, #de2910 70%, #ffde00 70%); }
      .flag-KP { background: linear-gradient(to bottom, #024fa2 26%, #fff 26% 33%, #ed1c27 33% 67%, #fff 67% 74%, #024fa2 74%); }
      .flag-NO\\/US { background: linear-gradient(to right, #ed2939 50%, #b22234 50%); }

      /* Performance grade colors */
      .grade-A { color: #2f80d6; } .grade-B { color: #2f80d6; }
      .grade-C { color: #d9a52f; } .grade-D { color: #d4995a; } .grade-F { color: #d24a44; }

      /* Animations */
      .pulse-emit { animation: emit 1.5s ease-in-out infinite; }
      @keyframes emit { 50% { opacity: 0.35; } }
      .alert-pulse { animation: alertpulse 0.8s ease-in-out infinite; }
      @keyframes alertpulse { 50% { opacity: 0.55; } }
      .glow-friendly { filter: drop-shadow(0 0 3px var(--mil-friend-glow)); }
      .glow-hostile { filter: drop-shadow(0 0 3px var(--mil-hostile-glow)); }
      .glow-unknown { filter: drop-shadow(0 0 3px var(--mil-unknown-glow)); }

      /* === Asset menu (dark dropdown) === */
      .asset-menu {
        position: absolute;
        background: var(--bg-panel);
        border: 1px solid var(--border-default);
        padding: 12px;
        font-family: 'IBM Plex Sans', sans-serif;
        min-width: 240px;
        max-width: 320px;
        z-index: 100;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px var(--border-subtle);
        color: var(--text-primary);
        border-radius: 4px;
      }
      .asset-menu button {
        display: block; width: 100%; text-align: left; padding: 7px 10px;
        margin: 3px 0;
        border: 1px solid var(--border-default);
        background: var(--bg-panel-2);
        color: var(--text-primary);
        font-family: 'IBM Plex Sans', sans-serif; font-size: 12px;
        cursor: pointer;
        border-radius: 2px;
        transition: all 0.12s;
      }
      .asset-menu button:hover:not(:disabled) {
        background: var(--mil-friend-bg);
        border-color: var(--mil-friend);
        color: var(--mil-friend);
      }
      .asset-menu button:disabled { opacity: 0.35; cursor: not-allowed; }
      .asset-menu button.danger { border-color: var(--mil-hostile); color: var(--mil-hostile); background: var(--mil-hostile-bg); }
      .asset-menu button.danger:hover:not(:disabled) { background: var(--mil-hostile); color: var(--text-inverted); }
      .asset-menu .mode-row { display: flex; gap: 4px; margin: 4px 0; }
      .asset-menu .mode-row button { flex: 1; text-align: center; }

      /* Alert cards */
      .alert-card {
        padding: 8px 10px; margin: 4px 0;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11px; line-height: 1.4;
        border-left: 3px solid;
        display: flex; gap: 8px; align-items: flex-start;
        border-radius: 2px;
      }
      .alert-card.info { border-color: var(--status-info); background: rgba(47,128,214,0.10); color: #5aa0e6; }
      .alert-card.warn { border-color: var(--status-warn); background: rgba(217,165,47,0.10); color: #d9a52f; }
      .alert-card.crit { border-color: var(--mil-hostile); background: rgba(210,74,68,0.10); color: var(--mil-hostile-glow); font-weight: 600; }
      .alert-card.phase { border-color: var(--mil-friend); background: var(--mil-friend-bg); color: var(--mil-friend-glow); font-weight: 600; }
      .alert-card .dismiss { background: none; border: 0; cursor: pointer; padding: 0; font-size: 14px; line-height: 1; flex-shrink: 0; color: inherit; opacity: 0.6; }
      .alert-card .dismiss:hover { opacity: 1; }

      /* Scrollbar (dark) */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: var(--bg-base); }
      ::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }

      /* Inputs (dark) */
      input, select, textarea {
        background: var(--bg-panel-2);
        color: var(--text-primary);
        border: 1px solid var(--border-default);
        padding: 6px 10px;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 12px;
        border-radius: 2px;
        outline: none;
      }
      input:focus, select:focus, textarea:focus {
        border-color: var(--mil-friend);
        box-shadow: 0 0 0 2px rgba(47,128,214,0.2);
      }

      /* COP card pattern */
      .cop-card {
        background: var(--bg-panel);
        border: 1px solid var(--border-default);
        border-radius: 3px;
        padding: 10px 12px;
        margin-bottom: 8px;
      }
      .cop-card-header {
        font-family: 'IBM Plex Sans', sans-serif;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        font-size: 10px;
        color: var(--text-secondary);
        padding-bottom: 6px;
        border-bottom: 1px solid var(--border-subtle);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
    `}</style>
  );
}

// ============================================================================
// MENU
// ============================================================================
function MultiplayerWrapper({ onBack }) {
  const [callsign, setCallsign] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [stage, setStage] = useState('entry'); // entry | lobby | game

  const mp = useMultiplayerHook(roomCode, callsign, enabled);

  // Auto-advance to game when phase changes
  React.useEffect(() => {
    if (mp.state?.phase === 'placing' || mp.state?.phase === 'running' || mp.state?.phase === 'ended') {
      setStage('game');
    } else if (mp.state?.phase === 'lobby' && stage === 'game') {
      setStage('lobby');
    }
  }, [mp.state?.phase]);

  if (stage === 'entry') {
    return (
      <EntryScreen
        callsign={callsign} setCallsign={setCallsign}
        roomCode={roomCode} setRoomCode={setRoomCode}
        onCreate={() => {
          if (!callsign) { alert('Enter callsign first'); return; }
          const code = generateRoomCodeFn();
          setRoomCode(code);
          setEnabled(true);
          setStage('lobby');
        }}
        onJoin={() => {
          if (!callsign || roomCode.length !== 4) { alert('Need callsign + 4-digit code'); return; }
          setEnabled(true);
          setStage('lobby');
        }}
        onBack={onBack}
      />
    );
  }
  if (stage === 'lobby') {
    return <LobbyView mp={mp} roomCode={roomCode} onBack={onBack} />;
  }
  if (stage === 'game') {
    return <MultiplayerGameView mp={mp} onLeave={onBack} />;
  }
  return null;
}

// useMultiplayer + generateRoomCode are imported at the top of this file

function EntryScreen({ callsign, setCallsign, roomCode, setRoomCode, onCreate, onJoin, onBack }) {
  return (
    <div className="min-h-screen riso-paper p-6 flex items-center justify-center">
      <div className="max-w-md w-full">
        <div className="cls-banner mb-6">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
        <div className="text-center mb-6">
          <div className="f-typewriter text-[10px] tracking-[0.2em] mb-2" style={{ color: 'var(--text-secondary)' }}>
            JATEC · MULTIPLAYER
          </div>
          <div className="f-display text-4xl" style={{ color: 'var(--mil-friend)', letterSpacing: '0.1em' }}>
            SKYWATCH NET
          </div>
        </div>
        <div className="cop-card">
          <div className="cop-card-header">OPERATOR CALLSIGN</div>
          <input value={callsign} onChange={e => setCallsign(e.target.value.toUpperCase().slice(0, 12))}
            placeholder="OPR-ALPHA" className="w-full f-mono text-sm" style={{ letterSpacing: '0.1em' }} />
        </div>
        <div className="cop-card">
          <div className="cop-card-header" style={{ color: 'var(--mil-friend)' }}>CREATE ROOM</div>
          <p className="f-mono text-[10px] mb-3" style={{ color: 'var(--text-secondary)' }}>
            Generate 4-digit room code, share with opponent.
          </p>
          <button onClick={onCreate} className="btn-riso w-full">CREATE ROOM ></button>
        </div>
        <div className="cop-card">
          <div className="cop-card-header" style={{ color: 'var(--mil-unknown)' }}>JOIN EXISTING</div>
          <input value={roomCode} onChange={e => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="0000" className="w-full f-mono text-2xl text-center mb-3"
            style={{ letterSpacing: '0.5em', padding: '10px' }} />
          <button onClick={onJoin} className="btn-riso w-full"
            style={{ borderColor: 'var(--mil-unknown)', color: 'var(--mil-unknown)', background: 'rgba(217,165,47,0.1)' }}>
            JOIN ROOM >
          </button>
        </div>
        <button onClick={onBack} className="btn-riso btn-alt w-full">‹ BACK</button>
      </div>
    </div>
  );
}

function LobbyView({ mp, roomCode, onBack }) {
  const myPlayer = mp.state?.players?.find(p => p.id === mp.youAre);
  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-3xl mx-auto pt-6">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="f-typewriter text-[10px] tracking-widest" style={{ color: 'var(--text-secondary)' }}>ROOM CODE</div>
            <div className="f-display text-5xl" style={{ letterSpacing: '0.25em', color: 'var(--mil-friend)' }}>{roomCode}</div>
          </div>
          <div className="text-right">
            <div className="f-typewriter text-[10px] tracking-widest" style={{ color: 'var(--text-secondary)' }}>STATUS</div>
            <div className="f-display text-xl"
              style={{ color: mp.connected ? 'var(--mil-neutral)' : 'var(--mil-hostile)' }}>
              {mp.connected ? '● LINKED' : '○ CONNECTING...'}
            </div>
          </div>
        </div>
        {mp.error && <div className="alert-card crit mb-3"><span>⚠</span>{mp.error}</div>}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <LobbySidePanel side="blue" label="BLUE · DEFENDER" color="var(--mil-friend)"
            players={(mp.state?.players || []).filter(p => p.side === 'blue')}
            myCid={mp.youAre} canPick={mp.state?.phase === 'lobby'}
            onPick={() => mp.actions.pickSide('blue')}
            onReady={() => mp.actions.setReady(!myPlayer?.ready)}
            myPlayer={myPlayer} />
          <LobbySidePanel side="red" label="RED · ATTACKER" color="var(--mil-hostile)"
            players={(mp.state?.players || []).filter(p => p.side === 'red')}
            myCid={mp.youAre} canPick={mp.state?.phase === 'lobby'}
            onPick={() => mp.actions.pickSide('red')}
            onReady={() => mp.actions.setReady(!myPlayer?.ready)}
            myPlayer={myPlayer} />
        </div>
        {mp.isHost && mp.state?.phase === 'lobby' && (
          <LobbyScenarioBuilder scenario={mp.state?.scenario} onSet={(sc) => mp.actions.setScenario(sc)} />
        )}
        {mp.isHost && mp.state?.phase === 'lobby' && (
          <div className="flex gap-2">
            <button onClick={() => mp.actions.startMatch()} className="btn-riso flex-1"
              style={canStartMatch(mp.state) ? {
                background: 'var(--mil-neutral)', borderColor: 'var(--mil-neutral)', color: 'var(--text-inverted)'
              } : undefined}>START MATCH ></button>
            <button onClick={onBack} className="btn-riso btn-alt">LEAVE</button>
          </div>
        )}
        {!mp.isHost && (
          <button onClick={onBack} className="btn-riso btn-alt w-full">LEAVE ROOM</button>
        )}
      </div>
    </div>
  );
}

function canStartMatch(state) {
  if (!state) return false;
  let blue = 0, red = 0;
  for (const p of state.players || []) {
    if (p.side === 'blue' && p.ready) blue++;
    if (p.side === 'red' && p.ready) red++;
  }
  return blue >= 1 && red >= 1;
}

function LobbySidePanel({ side, label, color, players, myCid, canPick, onPick, onReady, myPlayer }) {
  const myInThisSide = myPlayer?.side === side;
  return (
    <div className="cop-card" style={{ borderColor: color, borderWidth: '2px' }}>
      <div className="cop-card-header" style={{ color }}>{label}</div>
      <div className="space-y-1 mb-3 min-h-[60px]">
        {players.length === 0 && <div className="f-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>, empty, </div>}
        {players.map(p => (
          <div key={p.id} className="flex items-center justify-between f-mono text-[11px]">
            <span>{p.callsign}{p.isHost && <span style={{ color: 'var(--mil-unknown)' }}></span>}{p.id === myCid && <span style={{ color: 'var(--text-secondary)' }}> (you)</span>}</span>
            <span style={{ color: p.ready ? 'var(--mil-neutral)' : 'var(--text-tertiary)' }}>
              {p.ready ? '✓ READY' : '○ wait'}
            </span>
          </div>
        ))}
      </div>
      {canPick && !myInThisSide && (
        <button onClick={onPick} className="btn-riso w-full"
          style={{ background: color + '20', borderColor: color, color, padding: '6px', fontSize: '11px' }}>
          TAKE {side.toUpperCase()}
        </button>
      )}
      {myInThisSide && (
        <button onClick={onReady} className="btn-riso w-full"
          style={{ background: myPlayer?.ready ? 'var(--mil-neutral)' : 'transparent',
            color: myPlayer?.ready ? 'var(--text-inverted)' : color,
            borderColor: myPlayer?.ready ? 'var(--mil-neutral)' : color,
            padding: '6px', fontSize: '11px' }}>
          {myPlayer?.ready ? '✓ READY' : 'CLICK WHEN READY'}
        </button>
      )}
    </div>
  );
}

function LobbyScenarioBuilder({ scenario, onSet }) {
  const sc = scenario || { id: 'iron_wind', durationMin: 15, intensity: 'medium', blueBudget: 4000, redBudget: 5000 };
  return (
    <div className="cop-card">
      <div className="cop-card-header" style={{ color: 'var(--mil-unknown)' }}>SCENARIO BUILDER (HOST)</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>DURATION (real min)</label>
          <select value={sc.durationMin} onChange={e => {
            const d = parseInt(e.target.value);
            const m = { light: 0.6, medium: 1.0, heavy: 1.5, extreme: 2.0 }[sc.intensity] || 1.0;
            onSet({ ...sc, durationMin: d, redBudget: Math.round(d*60*m*0.8), blueBudget: Math.round(d*60*m*0.8*0.85) });
          }} className="w-full">
            <option value="10">10 min (quick demo)</option>
            <option value="15">15 min (standard demo)</option>
            <option value="30">30 min (training)</option>
            <option value="45">45 min</option>
            <option value="60">60 min</option>
          </select>
        </div>
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>INTENSITY</label>
          <select value={sc.intensity} onChange={e => {
            const v = e.target.value;
            const m = { light: 0.6, medium: 1.0, heavy: 1.5, extreme: 2.0 }[v];
            onSet({ ...sc, intensity: v, redBudget: Math.round(sc.durationMin*60*m*0.8), blueBudget: Math.round(sc.durationMin*60*m*0.8*0.85) });
          }} className="w-full">
            <option value="light">LIGHT</option>
            <option value="medium">MEDIUM</option>
            <option value="heavy">HEAVY</option>
            <option value="extreme">EXTREME</option>
          </select>
        </div>
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--mil-friend)' }}>BLUE {sc.blueBudget}pts</label>
        </div>
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--mil-hostile)' }}>RED {sc.redBudget}pts</label>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// METHODOLOGY & MATHEMATICS
// A standalone reference tab: how to drive the tool, and exactly what the
// engine computes. Every formula below is the one actually used in the code.
// ============================================================================
function Formula({ children }) {
  return (
    <pre className="f-mono" style={{ fontSize: 11, lineHeight: 1.6, color: '#cdd6e0', background: '#0a1626', border: '1px solid #243d52', borderRadius: 4, padding: '10px 12px', margin: '8px 0', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{children}</pre>
  );
}
function MBlock({ n, title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="f-display" style={{ fontSize: 17, color: '#d9a52f', marginBottom: 6 }}>
        <span style={{ color: '#5d6b7a', fontSize: 13 }}>{n}</span> {title}
      </div>
      <div className="f-serif" style={{ fontSize: 13.5, lineHeight: 1.65, color: '#dde3ea' }}>{children}</div>
    </div>
  );
}
function MethodologyScreen({ onBack }) {
  const [tab, setTab] = React.useState('how'); // 'how' | 'math' | 'limits'
  const TABS = [['how', 'HOW TO USE IT'], ['math', 'THE MATHEMATICS'], ['limits', 'LIMITS & PROVENANCE']];
  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-3xl mx-auto pt-4">
        <button onClick={onBack} className="btn-riso btn-alt mb-4" style={{ padding: '6px 14px', fontSize: 12 }}>‹ BACK</button>
        <h1 className="f-display" style={{ fontSize: 34, lineHeight: 1, letterSpacing: '0.05em', color: '#2f80d6' }}>METHODOLOGY</h1>
        <div className="f-mono text-[11px] mt-1 mb-4" style={{ color: '#93a1b0' }}>HOW THE TOOL IS DRIVEN AND WHAT THE ENGINE COMPUTES</div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="f-display"
              style={{ fontSize: 12, padding: '6px 14px', border: `2px solid ${tab === k ? '#2f80d6' : '#243d52'}`, borderRadius: 4, background: tab === k ? '#2f80d6' : 'transparent', color: tab === k ? '#0a1626' : '#dde3ea', cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'how' && (
          <div>
            <MBlock n="1" title="Build the defence, in stages">
              The left rail is a checklist. Each stage collapses; the badge on a closed stage tells you what is already in it.
              <ul style={{ margin: '8px 0 0 16px', listStyle: 'disc' }}>
                <li><strong>Region.</strong> Pick the countries to model. The map fits to them.</li>
                <li><strong>Targets.</strong> Click the map to place what you are defending. Type sets hit points and value.</li>
                <li><strong>SAM.</strong> Guided missile systems, quick picks plus the full SAM library.</li>
                <li><strong>EW / SIGINT / radars.</strong> Sensors detect but never fire. Passive stations cannot be found by anti-radiation missiles. EW soft-kills drones without spending a round.</li>
                <li><strong>Air patrol.</strong> Place a fighter, then draw its patrol route. It flies the route and turns to intercept what it detects.</li>
                <li><strong>Interceptor drones</strong> and <strong>small fire groups</strong> are the cheap inner layers.</li>
                <li><strong>Weather</strong> and <strong>options</strong> set season, visibility, wind, night, jamming and the optional realism factors.</li>
              </ul>
            </MBlock>
            <MBlock n="2" title="Compose the attack">
              The right rail has two modes. <strong>Simple</strong> picks a threat, a direction, a target and a count, and routes it automatically. <strong>Enhanced</strong> lets you draw the route by hand with an altitude per waypoint; dropping a waypoint near a target snaps it exactly onto that target.
              Ballistic and hypersonic weapons cannot be routed by hand: they fly a fixed trajectory, so you set an aim point and one launch point.
              Waves stack, each with its own start time from H-hour and spacing between rounds.
            </MBlock>
            <MBlock n="3" title="Lock, run, read">
              <strong>LOCK MAP + RINGS</strong> freezes the laydown. <strong>START</strong> runs it. Playback speed only changes how fast you watch: 1x is real time, and the physics is identical at every speed.
              During the run a track is drawn <span style={{ color: '#4f9d77' }}>green when at least one radar holds it</span> and <span style={{ color: '#d24a44' }}>red when nothing can see it</span>, so leakers are obvious.
              <strong> MONTE-CARLO</strong> repeats the same plan many times with different random draws and reports means with 95% confidence intervals: use it for any conclusion, not a single run.
            </MBlock>
            <MBlock n="4" title="Reading the report honestly">
              Intercept rate is kills over total tracks, including decoys. Protection is measured against threats that actually resolved. If a raid is still airborne when the time limit is reached, those tracks are reported separately as unresolved and are never counted as hits.
              Cost exchange compares the value you destroyed with what you spent to do it; winning on kills while losing on exchange is still a bad plan.
            </MBlock>
          </div>
        )}

        {tab === 'math' && (
          <div>
            <MBlock n="1" title="Determinism and time">
              The engine is a pure function of the plan and a seed. The same plan with the same seed produces a byte-identical result, which is what makes Monte-Carlo meaningful and lets you compare two laydowns fairly.
              Randomness comes from a seeded generator (mulberry32), never from the system clock. Simulation time advances in fixed steps; playback speed is a display accelerator only.
            </MBlock>

            <MBlock n="2" title="Detection: the radar horizon">
              Detection is computed separately from engagement. A battery cannot fire at what it does not hold, which is why low-flying cruise missiles leak past long-range systems.
              The geometric horizon between a mast and a target is
              <Formula>{`d_horizon (km) = 4.12 · ( √h_mast(m) + √h_target(m) )`}</Formula>
              A mast at 30 m sees a target at 100 m out to about 64 km, but the same mast sees a 50 m sea-skimmer at only about 52 km. An airborne radar has an effective mast of several thousand metres, which is why fighters and AWACS see low movers so much further.
              The usable detection range is the smaller of the system's rated range and this horizon.
            </MBlock>

            <MBlock n="3" title="Track quality">
              How well a threat is held drives the shot. Quality rises with the number of sensors on it and falls for low fliers and under jamming:
              <Formula>{`q = 0.72 + 0.12 · min(3, n_sensors)
    − 0.14  if the track is terrain-following
    − 0.05  if the track is low
    − 0.14  if jammed
q = clamp(q, 0.45, 1.08)`}</Formula>
              One sensor gives about 0.84; three or more give about 1.08. This is the mechanism by which adding a radar improves the kill rate of batteries that were already in range.
            </MBlock>

            <MBlock n="4" title="The kill-probability chain">
              A single shot's probability is the system's base figure against that threat class, multiplied by everything that degrades it:
              <Formula>{`pk = basePk
   × weather
   × crosswind × icing × temperature   (optically guided systems only)
   × trackQuality(n_sensors, altitude, jamming)
   × crewFatigue
   × saturation
   × reliability
pk = clamp(pk, 0, 0.98)`}</Formula>
              Nothing ever reaches certainty: the 0.98 ceiling stands in for the residual failures no model captures.
            </MBlock>

            <MBlock n="5" title="Salvo">
              Firing more than one round at the same track is treated as independent attempts:
              <Formula>{`Pk_salvo = 1 − (1 − pk)^shots`}</Formula>
              Two shots at pk 0.6 give 0.84, not 1.2. This is why a shoot-shoot doctrine burns inventory fast for diminishing returns, and the effect is visible in the cost-exchange line of the report.
            </MBlock>

            <MBlock n="6" title="Saturation">
              A battery can only guide so many engagements at once. Beyond its channel count, quality degrades:
              <Formula>{`saturation = 1                      if tracks ≤ channels
           = max(0.45, 1 − 0.10 · (tracks − channels))`}</Formula>
              Channels come from the launcher count you set per battery. This is the mathematical core of a saturation raid: the attacker does not need to defeat the missile, only the number of things it can shoot at simultaneously.
            </MBlock>

            <MBlock n="7" title="Crew fatigue (optional)">
              Over a long engagement, performance decays:
              <Formula>{`fatigue = 1 − min(0.22, max(0, (hours − 2) · 0.045))`}</Formula>
              Flat for the first two hours, then falling to a floor of about 0.78. It is a switch in the options stage, so you can compare a fresh crew against a fatigued one directly.
            </MBlock>

            <MBlock n="8" title="Threat kinematics">
              Threats fly real trajectories rather than sliding along a line.
              <strong> Turn radius</strong> follows from speed and the sustained g the airframe can pull:
              <Formula>{`R = V² / (g · n)        g = 9.81 m/s²`}</Formula>
              A cruise missile at 800 km/h pulling 5 g turns in about 1.0 km; a Shahed at 185 km/h pulling 2.5 g needs about 0.1 km, but its low speed leaves it exposed far longer.
              <strong> Terminal phase:</strong> most threats accelerate and descend onto the target, so speed changes over the flight (a Shahed dives at roughly 1.6 times its cruise speed).
              <strong> Ballistic tracks</strong> fly a depressed arc. While the warhead is in flight the Earth turns beneath it, so the ground track bows sideways:
              <Formula>{`f  = 2 · Ω · sin(latitude)          Ω = 7.292e-5 rad/s
d  = ½ · f · V · t²                (lateral deflection)`}</Formula>
              Guidance corrects the impact point, so the arc bows but the target is still hit. It matters because the bowed path crosses different radar coverage than a straight line would.
            </MBlock>

            <MBlock n="9" title="Command and information delay">
              Between holding a track and launching, every battery waits:
              <Formula>{`delay = reaction_time + C2_delay`}</Formula>
              Roughly 10 s for a large SAM, 7 s for a medium system, 4 s for a gun, 6 s for a fighter once cued. Centralised command and a cold start add more. During the delay the threat keeps closing, which converts time directly into distance and sometimes into a leaker.
              Point-defence systems that are themselves under attack bypass the chain: self-defence engagements are automatic, with a modest accuracy bonus.
            </MBlock>

            <MBlock n="10" title="SEAD, DEAD and attrition">
              Air-defence sites are targetable. Each has hit points by class, and a site at zero is disabled: its radar goes off and it stops firing, which reopens the corridor it was covering. This is the mechanism to test whether a laydown is resilient or merely dense.
            </MBlock>

            <MBlock n="11" title="Monte-Carlo and confidence">
              A single run is one draw from a distribution. The batch mode repeats the identical plan with different seeds and reports mean, standard deviation, a 95% confidence interval and the 10th, 50th and 90th percentiles.
              <Formula>{`CI₉₅ = mean ± 1.96 · σ / √N`}</Formula>
              If two laydowns have overlapping intervals, the difference between them is not established, however different the single runs looked.
            </MBlock>

            <MBlock n="12" title="Cost exchange">
              Every intercept has a price and every threat has a value:
              <Formula>{`exchange = value destroyed / cost of the defence spend`}</Formula>
              An exchange below 1 means the defence spent more than it saved. Against cheap mass this is the decisive metric, and it is the reason the cheap layers exist at all.
            </MBlock>
          </div>
        )}

        {tab === 'limits' && (
          <div>
            <MBlock n="1" title="What this is">
              A transparent, deterministic model for reasoning about air-defence laydowns and attack composition. Its value is in the relationships it makes visible: horizon against altitude, delay against closing speed, channels against raid size, cost against mass.
            </MBlock>
            <MBlock n="2" title="What the numbers are">
              Every system figure comes from open sources: manufacturer material, public reference works and published analysis, normalised for internal consistency. They are illustrative and are <strong>not</strong> validated operational analysis, not intelligence, and not suitable for operational planning. Where a real figure is classified or disputed, a plausible open value is used.
            </MBlock>
            <MBlock n="3" title="What is not modelled">
              <ul style={{ margin: '4px 0 0 16px', listStyle: 'disc' }}>
                <li>Terrain masking and multipath; the horizon is geometric only.</li>
                <li>Detailed seeker physics, countermeasures and ECCM duels.</li>
                <li>Communications architecture beyond a single lumped delay per battery.</li>
                <li>Logistics and resupply beyond a per-battery reload timer.</li>
                <li>Human decision making: engagement doctrine is a rule set you configure, not an operator.</li>
              </ul>
            </MBlock>
            <MBlock n="4" title="How to use results responsibly">
              Compare, do not predict. The tool is sound for asking whether laydown A leaks more than laydown B under the same attack, and unsound for claiming a specific intercept percentage against a real raid. Always run Monte-Carlo before concluding anything, and quote the interval rather than the mean.
            </MBlock>
          </div>
        )}
      </div>
      <div className="cls-banner mt-10">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
    </div>
  );
}

function MenuScreen({ onDemo, onTraining, onModelling, onLibrary, onMethodology, audioOn, setAudioOn }) {
  const [info, setInfo] = React.useState(null); // 'prov' | 'facil' | null
  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-4xl mx-auto pt-6 relative">
        {/* Institutional endorsement bar, Project Mercury + NATO-JATEC */}
        <div className="flex items-center justify-between gap-4 mb-5 pb-4" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-4">
            <img src={PM_LOGO} alt="Project Mercury NATO"
              style={{ width: 72, height: 72, display: 'block' }} />
            <div>
              <div className="f-display text-base" style={{ color: '#dde3ea', letterSpacing: '0.1em' }}>PROJECT <span style={{ fontWeight: 800 }}>MERCURY</span></div>
              <div className="f-typewriter text-[9px] tracking-[0.22em] mt-0.5" style={{ color: '#93a1b0' }}>TEAM 5 · COMMAND &amp; LEADERSHIP</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="f-display" style={{ color: '#dde3ea', letterSpacing: '0.14em', fontSize: '30px', lineHeight: 1 }}>JATEC</div>
              <div className="f-typewriter text-[8px] tracking-[0.12em] mt-1" style={{ color: '#93a1b0' }}>JOINT ANALYSIS, TRAINING<br />&amp; EDUCATION CENTRE</div>
            </div>
            <img src={JATEC_LOGO} alt="NATO Joint Analysis, Training and Education Centre"
              style={{ height: 92, width: 'auto', borderRadius: 4, background: '#ffffff', padding: 5, display: 'block' }} />
          </div>
        </div>

        {/* Hero */}
        <div className="f-mono text-[10px] tracking-[0.25em] mb-2" style={{ color: '#5d6b7a' }}>AIR DEFENCE MODELLING / OPEN-SOURCE / ILLUSTRATIVE</div>
        <h1 className="f-display" style={{ fontSize: '46px', lineHeight: 1, letterSpacing: '0.06em', color: '#2f80d6' }}>SKYWATCH</h1>
        <div className="f-mono text-[12px] mt-1" style={{ color: '#93a1b0', letterSpacing: '0.06em' }}>AIR DEFENCE MODELLING &amp; SCENARIO SIMULATOR</div>
        <div className="f-mono text-[12px] mt-3 mb-1 max-w-2xl" style={{ color: '#93a1b0', lineHeight: 1.5 }}>
          A standalone tool for modelling air-defence engagements. Lay down defence systems, compose attack waves, run a deterministic simulation, and study the outcomes. All figures are illustrative and derived entirely from open sources.
        </div>
        <div className="double-rule mt-4 mb-6" />

        <button onClick={onModelling}
          className="text-left p-5 border-2 transition-colors w-full"
          style={{ borderColor: '#d9a52f', background: 'rgba(217,165,47,0.06)' }}>
          <div className="f-display text-2xl mb-1" style={{ color: '#d9a52f' }}>OPEN THE MODELLING TOOL ></div>
          <div className="f-mono text-[12px]" style={{ color: '#93a1b0', lineHeight: 1.5 }}>
            Lay down defences, compose the attack, and run the simulation. Author custom threats, edit system parameters for the session, and save, load or export your scenarios and libraries. Illustrative and open-source.
          </div>
        </button>
        <button onClick={onLibrary}
          className="text-left p-5 border-2 transition-colors mt-4 w-full"
          style={{ borderColor: '#5aa0e6', background: 'rgba(47,128,214,0.06)' }}>
          <div className="f-display text-2xl mb-1" style={{ color: '#5aa0e6' }}>SYSTEMS LIBRARY ></div>
          <div className="f-mono text-[12px]" style={{ color: '#93a1b0', lineHeight: 1.5 }}>
            Reference catalogue, two sides. DEFENCE: NATO and partner air defence (SAM, MANPADS, guns &amp; lasers, interceptor drones, EW). OFFENSIVE: threats (ballistic, cruise, glide bombs, OWA / loitering, recon, UCAV). Open-source characteristics plus the calibrated in-model profile. Edit parameters for the session or import your own libraries.
          </div>
        </button>
        <button onClick={onMethodology}
          className="text-left p-5 border-2 transition-colors mt-4 w-full"
          style={{ borderColor: '#4f9d77', background: 'rgba(79,157,119,0.06)' }}>
          <div className="f-display text-2xl mb-1" style={{ color: '#4f9d77' }}>METHODOLOGY &amp; INSTRUCTIONS &gt;</div>
          <div className="f-mono text-[12px]" style={{ color: '#93a1b0', lineHeight: 1.5 }}>
            How to drive the tool, and exactly what the engine computes: radar horizon, track quality, the kill-probability chain, salvo and saturation, kinematics, command delay, Monte-Carlo confidence and cost exchange. Every formula shown is the one used in the code, with an honest statement of limits.
          </div>
        </button>
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button onClick={() => setAudioOn(!audioOn)}
            className="btn-riso btn-alt"
            style={{ padding: '8px 16px', fontSize: '13px' }}>
            AUDIO: {audioOn ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => setInfo('facil')} className="btn-riso btn-alt" style={{ padding: '8px 16px', fontSize: '13px' }}>
            FACILITATOR MODE
          </button>
          <button onClick={() => setInfo('prov')} className="btn-riso btn-alt" style={{ padding: '8px 16px', fontSize: '13px' }}>
            DATA &amp; MODEL PROVENANCE
          </button>
        </div>
      </div>
      {info && <MenuInfoModal kind={info} onClose={() => setInfo(null)} />}
      <div className="cls-banner mt-10">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
    </div>
  );
}

// Presenter script + data/model provenance, shown over the menu for the experts session.
function MenuInfoModal({ kind, onClose }) {
  const isProv = kind === 'prov';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(6,14,24,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(680px, 94vw)', maxHeight: '86vh', overflowY: 'auto', background: '#102234', border: '1px solid #34516b', borderRadius: 6 }}>
        <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #243d52' }}>
          <span className="f-display" style={{ fontSize: 18, color: '#2f80d6', letterSpacing: '0.04em' }}>{isProv ? 'DATA & MODEL PROVENANCE' : 'FACILITATOR MODE · PRESENTER SCRIPT'}</span>
          <button onClick={onClose} className="btn-riso btn-alt" style={{ padding: '6px 12px', fontSize: 12 }}>CLOSE</button>
        </div>
        <div style={{ padding: '16px' }}>
          {isProv ? (
            <div className="f-mono" style={{ fontSize: 12, color: '#dde3ea', lineHeight: 1.65 }}>
              <p style={{ marginBottom: 10 }}><span style={{ color: '#56a0e0' }}>Status.</span> This is a training and concept-demonstration tool, not a validated operational-analysis model. All numeric outputs are <strong>illustrative and order-of-magnitude</strong>.</p>
              <p style={{ marginBottom: 10 }}><span style={{ color: '#56a0e0' }}>Data sources.</span> System characteristics (ranges, speeds, warheads) are compiled from the Brave1 marketplace and public OSINT, cross-checked against open reporting. Probability-of-kill values are expert estimate, not measured firing-table data.</p>
              <p style={{ marginBottom: 10 }}><span style={{ color: '#56a0e0' }}>Method.</span> Two layers: a playable tactical engine (dynamic range compressed so all threat classes fit one screen) and an operational layer that runs <strong>real relative speeds</strong> and a 200-trial Monte-Carlo. Weather, salvo doctrine, radar horizon and the ISR-to-strike kill chain are modelled qualitatively.</p>
              <p style={{ marginBottom: 10 }}><span style={{ color: '#56a0e0' }}>Caveats.</span> Cost-exchange figures are simplified; EW is folded into Pk rather than modelled as a separate layer; playback timing is compressed. Do not read precision into the numbers; read <em>relationships and trade-offs</em>.</p>
              <p><span style={{ color: '#56a0e0' }}>Classification.</span> PUBLIC. All data generated from open sources. Illustrative only: no classified information, no operational laydowns, no real unit data.</p>
            </div>
          ) : (
            <div className="f-mono" style={{ fontSize: 12, color: '#dde3ea', lineHeight: 1.6 }}>
              <p style={{ color: '#93a1b0', marginBottom: 12 }}>A 6-8 minute guided pass for an experts audience. Open the matching screen as you go.</p>
              {[
                ['1 · Frame it (30s)', 'State up front: this is a conditionally-open tool for experience exchange, wargaming and modelling, illustrative and unclassified. Not a decision-support model.'],
                ['2 · DEMONSTRATION (2 min)', 'Run the scripted demo. Narrate the layered defence: strategic assets take cruise/ballistic; brigade SHORAD/MANPADS take OWA/glide; C-UAS takes tactical drones; EW degrades the recon-strike kill chain. Use the SPD control to fast-forward quiet stretches.'],
                ['3 · The decision space (1 min)', 'Point out weapon-target pairing economy: do not spend a Patriot round on a Shahed. Show classification delay, sector arcs, and emission/compromise risk.'],
                ['4 · MODELLING + OPERATIONAL PLAN (2 min)', 'Author a small wave, open OPERATIONAL PLAN, place batteries on the map, LOCK MAP + RINGS, PLAY ATTACK at 2x-5x, then run MONTE-CARLO x200. Read the leaker distribution and interceptor expenditure, not a single number.'],
                ['5 · Hand to the experts (1-2 min)', 'Ask: are the movement and engagement relationships right? Where would you set salvo doctrine and C2 posture? What is missing for your use case? Capture answers for the AAR.'],
                ['Key relationships to stress', 'Shahed ~185 km/h vs cruise ~800 km/h vs ballistic streak; Patriot aero 160 km but ABM footprint only ~25 km; layered Pk multiplies, single-layer leaks. Numbers are order-of-magnitude.'],
              ].map(([h, b], i) => (
                <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < 5 ? '1px solid #243d52' : 'none' }}>
                  <div className="f-display" style={{ fontSize: 13, color: '#2f80d6', marginBottom: 3 }}>{h}</div>
                  <div style={{ color: '#dde3ea' }}>{b}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function flagCodes(country) {
  if (!country) return [];
  const s = country.replace(/\(\+/g, '/').replace(/[()]/g, ' ');
  const toks = s.split('/').map(t => t.trim().toLowerCase()).filter(Boolean);
  const codes = [];
  const add = c => { if (c && !codes.includes(c)) codes.push(c); };
  toks.forEach(t => {
    if (/ussr|soviet|russia/.test(t)) add('RU');
    else if (/china|prc/.test(t)) add('CN');
    else if (/dprk|north korea/.test(t)) add('KP');
    else if (/usa|united states/.test(t)) add('US');
    else if (/german/.test(t)) add('DE');
    else if (/franc|french/.test(t)) add('FR');
    else if (/ital/.test(t)) add('IT');
    else if (/israel/.test(t)) add('IL');
    else if (/korea/.test(t)) add('KR');
    else if (/united kingdom|britain/.test(t) || t === 'uk') add('UK');
    else if (/norw/.test(t)) add('NO');
    else if (/swed/.test(t)) add('SE');
    else if (/pol(and|ish)/.test(t)) add('PL');
    else if (/switz|swiss/.test(t)) add('CH');
    else if (/japan/.test(t)) add('JP');
    else if (/india/.test(t)) add('IN');
    else if (/ukrain/.test(t) || t === 'ua') add('UA');
    else if (t === 'eu' || /european union/.test(t)) add('EU');
    else if (/nato|consortium|partner/.test(t)) add('NATO');
  });
  return codes;
}

function CountryTag({ country }) {
  const codes = flagCodes(country);
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5" style={{ border: '1px solid #243d52', borderRadius: 3 }}>
      {codes.map((c, i) => <span key={i} className={`nation-flag flag-${c}`} title={c} />)}
      <span className="f-mono text-[10px]" style={{ color: '#93a1b0' }}>{country}</span>
    </span>
  );
}

const AD_ANCHORS = [[1, 30], [1.5, 38], [2.5, 48], [4, 75], [5.5, 80], [6.5, 105], [8, 110], [11, 160], [25, 200], [30, 220], [40, 240], [50, 280], [160, 380]];
function kmToPx(km) {
  if (km == null || isNaN(km)) return null;
  const A = AD_ANCHORS;
  if (km <= A[0][0]) return Math.max(8, Math.round(A[0][1] * km / A[0][0]));
  if (km >= A[A.length - 1][0]) return A[A.length - 1][1];
  for (let i = 0; i < A.length - 1; i++) {
    const [k0, p0] = A[i], [k1, p1] = A[i + 1];
    if (km >= k0 && km <= k1) return Math.round(p0 + (p1 - p0) * (km - k0) / (k1 - k0));
  }
  return null;
}
function deriveDefenceGame(cat, rangeKm, altKm) {
  const km = rangeKm;
  if (cat === 'EW') return { rangePx: 95, ceiling: 'med', engage: ['tactical', 'recon'], pk: 'ew', ammoMax: 100, isEW: true };
  if (cat === 'INTERCEPTOR') return { rangePx: 280, ceiling: 'med', engage: ['owa', 'recon'], pk: 'interceptor', ammoMax: 6, isInterceptor: true };
  if (cat === 'GUN_LASER') return { rangePx: kmToPx(km) || 40, ceiling: 'low', engage: ['owa', 'tactical', 'recon'], pk: 'gun', ammoMax: 120 };
  if (cat === 'MANPADS') return { rangePx: kmToPx(km) || 100, ceiling: 'med', engage: ['owa', 'male', 'tactical', 'recon'], pk: 'manpads', ammoMax: 5 };
  let pk, engage, ceiling;
  if (km != null && km >= 80) { pk = 'aero_long'; engage = ['cruise', 'glide', 'owa', 'male']; }
  else if (km != null && km >= 30) { pk = 'med_sam'; engage = ['cruise', 'glide', 'owa', 'male']; }
  else { pk = 'point_sam'; engage = ['cruise', 'owa', 'tactical']; }
  if (altKm != null && altKm >= 30) ceiling = 'ball';
  else if (altKm != null && altKm >= 12) ceiling = 'high';
  else if (altKm != null && altKm >= 5) ceiling = 'med';
  else ceiling = 'high';
  return { rangePx: kmToPx(km) || 160, ceiling, engage, pk, ammoMax: 8 };
}
function deriveOffensiveGame(tab) {
  const map = {
    BALLISTIC: { class: 'ballistic', speed: 0.28, ceiling: 'ball', signature: 'huge', ewVuln: false, dmg: 2, avoid: 0 },
    CRUISE: { class: 'cruise', speed: 0.10, ceiling: 'low', signature: 'large', ewVuln: false, dmg: 1, avoid: 0.05 },
    GLIDE: { class: 'glide', speed: 0.05, ceiling: 'med', signature: 'medium', ewVuln: true, dmg: 2, avoid: 0 },
    OWA: { class: 'owa', speed: 0.05, ceiling: 'low', signature: 'medium', ewVuln: false, dmg: 1, avoid: 0.18 },
    RECON: { class: 'recon', speed: 0.04, ceiling: 'med', signature: 'small', ewVuln: true, dmg: 0, avoid: 0.10 },
    MALE: { class: 'male', speed: 0.05, ceiling: 'high', signature: 'medium', ewVuln: false, dmg: 1, avoid: 0.10 },
  };
  return { ...(map[tab] || map.BALLISTIC) };
}
function libLoad(side) {
  try { const v = localStorage.getItem('skywatch_lib_custom_' + side); return v ? JSON.parse(v) : []; } catch { return []; }
}
function libSave(side, arr) {
  try { localStorage.setItem('skywatch_lib_custom_' + side, JSON.stringify(arr)); } catch (e) { /* storage full or blocked */ }
}
function downloadJSON(filename, data) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { /* noop */ }
}

function LibraryScreen({ onBack }) {
  const [side, setSide] = useState('defence');
  const [customDef, setCustomDef] = useState(() => libLoad('defence'));
  const [customOff, setCustomOff] = useState(() => libLoad('offensive'));
  const [ttxEdits, setTtxEdits] = useState(() => { try { return JSON.parse(localStorage.getItem('skywatch_ttx_edits') || '{}'); } catch { return {}; } });
  const [editingKey, setEditingKey] = useState(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef(null);
  const xlsxRef = useRef(null);
  const custom = side === 'defence' ? customDef : customOff;
  const setCustom = side === 'defence' ? setCustomDef : setCustomOff;
  const baseLib = side === 'defence' ? AD_LIBRARY : OFFENSIVE_LIBRARY;

  function persist(arr) { setCustom(arr); libSave(side, arr); }
  function persistTtx(next) { setTtxEdits(next); try { localStorage.setItem('skywatch_ttx_edits', JSON.stringify(next)); } catch (e) {} }
  function saveTtx(name, patch) {
    const key = (name || '').toLowerCase();
    const next = { ...ttxEdits, [key]: { ...(ttxEdits[key] || {}), ...patch } };
    persistTtx(next); setEditingKey(null);
  }
  function clearTtx(name) {
    const key = (name || '').toLowerCase();
    const next = { ...ttxEdits }; delete next[key]; persistTtx(next);
  }
  function addEntry(entry) {
    persist([...custom, { ...entry, _custom: true, _id: 'c' + Date.now() + Math.floor(Math.random() * 1000) }]);
    setAdding(false);
  }
  function deleteEntry(id) { persist(custom.filter(e => e._id !== id)); }
  function resetCustom() { if (window.confirm('Remove all custom ' + side + ' entries on this device?')) persist([]); }
  function exportLib() {
    const all = [...baseLib, ...custom].map(({ _custom, _id, ...rest }) => rest);
    downloadJSON('skywatch-' + side + '-library.json', all);
  }
  function onImportFile(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let data;
      try { data = JSON.parse(r.result); } catch { window.alert('Import failed: not valid JSON.'); return; }
      if (!Array.isArray(data)) { window.alert('Import failed: expected a JSON array of systems.'); return; }
      const seen = new Set([...baseLib, ...custom].map(e => (e.name || '').toLowerCase()));
      const added = [];
      data.forEach(e => {
        const nm = (e && e.name || '').toLowerCase();
        if (!nm || seen.has(nm)) return;
        seen.add(nm);
        added.push({ ...e, _custom: true, _id: 'c' + Date.now() + Math.floor(Math.random() * 100000) });
      });
      if (!added.length) { window.alert('Nothing imported: all system names already present.'); return; }
      persist([...custom, ...added]);
      window.alert('Imported ' + added.length + ' system(s) into the ' + side + ' library on this device.');
    };
    r.readAsText(f);
  }

  // ---- Excel round-trip: one workbook holds both libraries ----
  function onImportXlsx(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let wb;
      try { wb = XLSX.read(new Uint8Array(r.result), { type: 'array' }); }
      catch (err) { window.alert('Import failed: this does not look like a readable workbook.'); return; }
      const sheetName = side === 'defence' ? 'DEFENCE' : 'OFFENSIVE';
      // accept the matching sheet, or a single-sheet file the user built themselves
      const ws = wb.Sheets[sheetName]
        || wb.Sheets[wb.SheetNames.find(n => n.toUpperCase() === sheetName)]
        || (wb.SheetNames.length === 1 ? wb.Sheets[wb.SheetNames[0]] : null);
      if (!ws) { window.alert('Import failed: no "' + sheetName + '" sheet in this workbook. Export a template first to see the expected columns.'); return; }
      let rows;
      try { rows = XLSX.utils.sheet_to_json(ws, { defval: '' }); }
      catch (err) { window.alert('Import failed: could not read the rows.'); return; }
      if (!rows.length) { window.alert('Nothing imported: the ' + sheetName + ' sheet is empty.'); return; }
      const seen = new Set([...baseLib, ...custom].map(e => (e.name || '').toLowerCase()));
      const added = []; let skipped = 0, unnamed = 0;
      rows.forEach(row => {
        const e = entryFromLibRow(row, side === 'defence' ? 'DEFENCE' : 'OFFENSIVE');
        if (!e) { unnamed++; return; }
        const nm = e.name.toLowerCase();
        if (seen.has(nm)) { skipped++; return; }
        seen.add(nm);
        added.push({ ...e, _custom: true, _id: 'c' + Date.now() + Math.floor(Math.random() * 100000) });
      });
      if (!added.length) {
        window.alert('Nothing new imported. ' + skipped + ' row(s) already present' + (unnamed ? ', ' + unnamed + ' row(s) had no name' : '') + '.');
        return;
      }
      persist([...custom, ...added]);
      window.alert('Imported ' + added.length + ' system(s) into the ' + side + ' library on this device.'
        + (skipped ? '\n' + skipped + ' already present, skipped.' : '')
        + (unnamed ? '\n' + unnamed + ' row(s) had no name, skipped.' : ''));
    };
    r.readAsArrayBuffer(f);
  }

  const btn = (label, onClick, color) => (
    <button onClick={onClick} className="f-display text-[11px] px-3 h-9 border-2"
      style={{ borderColor: color, color: color, background: 'transparent', borderRadius: 4 }}>{label}</button>
  );

  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-5xl mx-auto pt-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="f-display" style={{ fontSize: '40px', lineHeight: 1, color: '#dde3ea' }}>SYSTEMS <span style={{ color: side === 'defence' ? '#2f80d6' : '#d24a44' }}>LIBRARY</span></h1>
            <div className="f-typewriter text-[10px] tracking-[0.2em] mt-1" style={{ color: '#93a1b0' }}>{side === 'defence' ? `NATO & PARTNERS AIR DEFENCE · ${AD_LIBRARY.length + customDef.length} SYSTEMS` : `RU / DPRK / PRC OFFENSIVE · ${OFFENSIVE_LIBRARY.length + customOff.length} SYSTEMS`}</div>
          </div>
          <button onClick={onBack} className="btn-riso btn-alt" style={{ padding: '8px 16px', fontSize: '13px' }}>‹ MENU</button>
        </div>
        <div className="flex flex-wrap items-center gap-1 mb-4">
          <button onClick={() => setSide('defence')} className="f-display text-[13px] px-4 h-10 border-2"
            style={{ borderColor: '#2f80d6', background: side === 'defence' ? '#2f80d6' : 'transparent', color: side === 'defence' ? '#0a1626' : '#2f80d6', borderRadius: 4 }}>DEFENCE</button>
          <button onClick={() => setSide('offensive')} className="f-display text-[13px] px-4 h-10 border-2"
            style={{ borderColor: '#d24a44', background: side === 'offensive' ? '#d24a44' : 'transparent', color: side === 'offensive' ? '#0a1626' : '#d24a44', borderRadius: 4 }}>OFFENSIVE (THREAT)</button>
          <span style={{ flex: 1 }} />
          {btn('+ ADD SYSTEM', () => setAdding(true), '#2f80d6')}
          {btn('IMPORT JSON', () => fileRef.current && fileRef.current.click(), '#5aa0e6')}
          {btn('EXPORT JSON', exportLib, '#5aa0e6')}
          {btn('IMPORT XLSX', () => xlsxRef.current && xlsxRef.current.click(), '#4f9d77')}
          {btn('EXPORT XLSX', () => exportLibraryWorkbook(customDef, customOff), '#4f9d77')}
          {custom.length > 0 && btn('RESET (' + custom.length + ')', resetCustom, '#93a1b0')}
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} style={{ display: 'none' }} />
          <input ref={xlsxRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onImportXlsx} style={{ display: 'none' }} />
        </div>
        <div className="double-rule mb-4" />
        {side === 'defence'
          ? <DefenceLibrary custom={customDef} onDelete={deleteEntry} ttxEdits={ttxEdits} onSaveTtx={saveTtx} onClearTtx={clearTtx} editingKey={editingKey} setEditingKey={setEditingKey} />
          : <OffensiveLibrary custom={customOff} onDelete={deleteEntry} ttxEdits={ttxEdits} onSaveTtx={saveTtx} onClearTtx={clearTtx} editingKey={editingKey} setEditingKey={setEditingKey} />}
      </div>
      <div className="cls-banner mt-10">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      {adding && <AddSystemForm side={side} onAdd={addEntry} onCancel={() => setAdding(false)} />}
    </div>
  );
}

function DefenceLibrary({ custom, onDelete, ttxEdits, onSaveTtx, onClearTtx, editingKey, setEditingKey }) {
  const [cat, setCat] = useState('SAM');
  const applyTtx = (s) => { const e = ttxEdits && ttxEdits[(s.name || '').toLowerCase()]; if (!e) return s; const g = { ...(s.game || {}), ...(e.game || {}) }; return { ...s, ...e, game: s.game ? g : s.game, _ttx: true }; };
  const all = [...AD_LIBRARY, ...(custom || [])].map(applyTtx);
  const items = all.filter(s => s.cat === cat);
  const fams = [];
  const byFam = {};
  items.forEach(s => { if (!byFam[s.family]) { byFam[s.family] = []; fams.push(s.family); } byFam[s.family].push(s); });
  const PK_LABEL = { abm_long: 'ABM / long', aero_long: 'aero long-range', med_sam: 'medium SAM', point_sam: 'point SAM', shorad: 'SHORAD', manpads: 'MANPADS', gun: 'gun / AAA', ew: 'EW (non-kinetic)', interceptor: 'interceptor drone' };
  return (
    <>
      <div className="border border-[#243d52] p-2 mb-4 f-mono text-[10px]" style={{ color: '#93a1b0', background: '#102234', lineHeight: 1.5 }}>
        Figures are real-world open-source estimates (late 2025 / early 2026), illustrative only. <span style={{ color: '#2f80d6' }}>● DEPLOYABLE</span> systems carry an in-game reach calibrated to the tactical map: relative proportions and engagement envelopes preserved, ranges compressed so a single battery does not blanket the AOR. Strategic BMD (THAAD, Aegis, Arrow) is reference only.
      </div>
      <div className="flex flex-wrap gap-1 mb-4">
        {AD_CATEGORIES.map(c => {
          const n = all.filter(s => s.cat === c.key).length;
          const on = cat === c.key;
          return (
            <button key={c.key} onClick={() => setCat(c.key)}
              className="f-display text-[12px] px-3 h-9 border-2"
              style={{ borderColor: on ? '#2f80d6' : '#243d52', background: on ? '#2f80d6' : 'transparent', color: on ? '#0a1626' : '#dde3ea', borderRadius: 4 }}>
              {c.label} <span style={{ opacity: 0.7 }}>({n})</span>
            </button>
          );
        })}
      </div>
      {fams.map(fam => (
        <div key={fam} className="mb-5">
          <div className="f-display text-lg mb-2" style={{ color: '#d9a52f' }}>{fam}</div>
          <div className="space-y-2">
            {byFam[fam].map((s, i) => <SystemRow key={s._id || i} s={s} PK_LABEL={PK_LABEL} onDelete={onDelete} onSaveTtx={onSaveTtx} onClearTtx={onClearTtx} editingKey={editingKey} setEditingKey={setEditingKey} />)}
          </div>
        </div>
      ))}
    </>
  );
}

function OffensiveLibrary({ custom, onDelete, ttxEdits, onSaveTtx, onClearTtx, editingKey, setEditingKey }) {
  const [cat, setCat] = useState('BALLISTIC');
  const applyTtx = (s) => { const e = ttxEdits && ttxEdits[(s.name || '').toLowerCase()]; if (!e) return s; const g = { ...(s.game || {}), ...(e.game || {}) }; return { ...s, ...e, game: s.game ? g : s.game, _ttx: true }; };
  const all = [...OFFENSIVE_LIBRARY, ...(custom || [])].map(applyTtx);
  const items = all.filter(s => s.tab === cat);
  const groups = [];
  const byC = {};
  items.forEach(s => { if (!byC[s.country]) { byC[s.country] = []; groups.push(s.country); } byC[s.country].push(s); });
  const CLS_LABEL = { ballistic: 'ballistic', cruise: 'cruise', glide: 'glide bomb', owa: 'OWA / loitering', recon: 'recon', male: 'MALE UCAV' };
  return (
    <>
      <div className="border border-[#243d52] p-2 mb-4 f-mono text-[10px]" style={{ color: '#93a1b0', background: '#102234', lineHeight: 1.5 }}>
        Threat catalogue, real-world open-source estimates (late 2025 / early 2026), illustrative only. <span style={{ color: '#d24a44' }}>● USABLE</span> threats carry an in-game profile (class, speed, RCS, EW-vulnerability) anchored to the engine; these are Ukraine-relevant RU systems and DPRK SRBMs in Russian use. China and strategic ICBM / SLBM are reference only.
      </div>
      <div className="flex flex-wrap gap-1 mb-4">
        {OFFENSIVE_CATEGORIES.map(c => {
          const n = all.filter(s => s.tab === c.key).length;
          const on = cat === c.key;
          return (
            <button key={c.key} onClick={() => setCat(c.key)}
              className="f-display text-[12px] px-3 h-9 border-2"
              style={{ borderColor: on ? '#d24a44' : '#243d52', background: on ? '#d24a44' : 'transparent', color: on ? '#0a1626' : '#dde3ea', borderRadius: 4 }}>
              {c.label} <span style={{ opacity: 0.7 }}>({n})</span>
            </button>
          );
        })}
      </div>
      {groups.map(g => (
        <div key={g} className="mb-5">
          <div className="f-display text-lg mb-2 flex items-center gap-2" style={{ color: '#d9a52f' }}>
            <span className={`nation-flag flag-${flagCodes(g)[0] || ''}`} />{g}
          </div>
          <div className="space-y-2">
            {byC[g].map((s, i) => <OffensiveRow key={s._id || i} s={s} CLS_LABEL={CLS_LABEL} onDelete={onDelete} onSaveTtx={onSaveTtx} onClearTtx={onClearTtx} editingKey={editingKey} setEditingKey={setEditingKey} />)}
          </div>
        </div>
      ))}
    </>
  );
}

// Inline editor to override a system's key parameters for the current session.
// Edits are stored by system name and applied to the library. Illustrative only.
function TtxEditor({ s, kind, onSave }) {
  const g = s.game || {};
  const [rangePx, setRangePx] = useState(g.rangePx != null ? g.rangePx : '');
  const [pk, setPk] = useState(g.pk != null ? g.pk : '');
  const [ammoMax, setAmmoMax] = useState(g.ammoMax != null ? g.ammoMax : '');
  const [rangeText, setRangeText] = useState(s.rangeText || '');
  const [altText, setAltText] = useState(s.altText || '');
  const [speedText, setSpeedText] = useState(s.speedText || '');
  const num = (v) => (v === '' || v == null ? undefined : +v);
  const field = (label, val, setVal, ph) => (
    <label className="f-mono text-[9px]" style={{ color: '#93a1b0', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label}
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={ph || ''} style={{ fontSize: 11, padding: '3px 5px', background: '#0a1626', border: '1px solid #34516b', borderRadius: 3, color: '#fff', width: '100%' }} />
    </label>
  );
  function save() {
    const patch = { rangeText, altText, speedText };
    const gp = {};
    if (rangePx !== '') gp.rangePx = num(rangePx);
    if (pk !== '') gp.pk = num(pk);
    if (ammoMax !== '') gp.ammoMax = num(ammoMax);
    if (Object.keys(gp).length) patch.game = gp;
    onSave(patch);
  }
  return (
    <div className="mt-2 p-2.5 border" style={{ borderColor: '#d9a52f', background: 'rgba(217,165,47,0.05)', borderRadius: 4 }}>
      <div className="f-mono text-[9px] mb-2" style={{ color: '#d9a52f' }}>EDIT PARAMETERS FOR THIS SESSION (illustrative, open-source)</div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        {field('RANGE (text)', rangeText, setRangeText, 'e.g. 40 km')}
        {field('ALTITUDE (text)', altText, setAltText, 'e.g. 12 km')}
        {field('SPEED (text)', speedText, setSpeedText, 'e.g. Mach 5')}
      </div>
      {s.deployable && s.game && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          {field('IN-GAME REACH (px)', rangePx, setRangePx, String(g.rangePx || ''))}
          {field('Pk (0-1)', pk, setPk, String(g.pk || ''))}
          {field('AMMO', ammoMax, setAmmoMax, String(g.ammoMax || ''))}
        </div>
      )}
      <button onClick={save} className="f-display text-[11px] px-3 h-8 border-2" style={{ borderColor: '#4f9d77', color: '#4f9d77', borderRadius: 4 }}>SAVE FOR SESSION</button>
    </div>
  );
}

function SystemRow({ s, PK_LABEL, onDelete, onSaveTtx, onClearTtx, editingKey, setEditingKey }) {
  const dep = s.deployable && s.game;
  const rowKey = (s.name || '').toLowerCase();
  const isEditing = editingKey === 'def:' + rowKey;
  const reachPct = dep && s.game.rangePx ? Math.min(100, (s.game.rangePx / 400) * 100) : 0;
  const chips = [];
  if (s.rangeText) chips.push(['RANGE', s.rangeText]);
  if (s.altText) chips.push(['ALT', s.altText]);
  if (s.speedText) chips.push(['SPEED', s.speedText]);
  if (s.cat === 'SAM') {
    if (s.launchers) chips.push(['LCHR/BTY', String(s.launchers)]);
    if (s.perLauncher) chips.push(['MSL/LCHR', String(s.perLauncher)]);
    if (s.radar) chips.push(['RADAR', s.radar]);
    if (s.costMissile) chips.push(['$/MSL', s.costMissile]);
    if (s.costBattery) chips.push(['$/BTY', s.costBattery]);
  } else if (s.cat === 'MANPADS') {
    if (s.guidance) chips.push(['GUIDANCE', s.guidance]);
    if (s.mass) chips.push(['MASS', s.mass]);
    if (s.costMissile) chips.push(['$/MSL', s.costMissile]);
  } else if (s.cat === 'GUN_LASER') {
    if (s.armament) chips.push(['ARMAMENT', s.armament]);
    if (s.rof) chips.push(['ROF/PARAM', s.rof]);
    if (s.fcs) chips.push(['FCS', s.fcs]);
    if (s.shotCost) chips.push(['$/SHOT', s.shotCost]);
  } else if (s.cat === 'INTERCEPTOR') {
    if (s.ceilText) chips.push(['CEILING', s.ceilText]);
    if (s.endurance) chips.push(['ENDURANCE', s.endurance]);
    if (s.guidance) chips.push(['GUIDANCE', s.guidance]);
    if (s.missile) chips.push(['KILL', s.missile]);
    if (s.cost) chips.push(['UNIT $', s.cost]);
  }
  return (
    <div className="border border-[#243d52] p-2.5" style={{ background: '#142536' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="f-display text-[14px]" style={{ color: '#dde3ea' }}>{s.name}</span>
        {s.country && <CountryTag country={s.country} />}
        {s.cls && <span className="f-mono text-[10px]" style={{ color: '#5d6b7a' }}>{s.cls}</span>}
        <span style={{ flex: 1 }} />
        {dep
          ? <span className="f-mono text-[10px]" style={{ color: '#2f80d6' }}>● DEPLOYABLE</span>
          : <span className="f-mono text-[10px]" style={{ color: '#5d6b7a' }}>○ REFERENCE</span>}
        {s._custom && <span className="f-mono text-[10px]" style={{ color: '#d9a52f' }}>CUSTOM</span>}
        {s._ttx && <span className="f-mono text-[10px]" style={{ color: '#d9a52f' }}>EDITED</span>}
        {onSaveTtx && <button onClick={() => setEditingKey(isEditing ? null : 'def:' + rowKey)} className="f-mono text-[10px]" style={{ color: isEditing ? '#d9a52f' : '#5aa0e6', border: '1px solid ' + (isEditing ? '#d9a52f' : '#34516b'), borderRadius: 3, padding: '1px 6px' }}>{isEditing ? 'CLOSE' : 'EDIT'}</button>}
        {s._ttx && onClearTtx && <button onClick={() => onClearTtx(s.name)} title="Reset to open-source default" className="f-mono text-[10px]" style={{ color: '#93a1b0', border: '1px solid #34516b', borderRadius: 3, padding: '1px 6px' }}>RESET</button>}
        {s._custom && onDelete && <button onClick={() => onDelete(s._id)} title="Delete" className="f-mono text-[12px] leading-none" style={{ color: '#d24a44', padding: '0 2px' }}>×</button>}
      </div>
      {isEditing && <TtxEditor s={s} kind="defence" onSave={(patch) => onSaveTtx(s.name, patch)} />}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 f-mono text-[10px]">
          {chips.map(([k, v], i) => (
            <span key={i}><span style={{ color: '#5d6b7a' }}>{k} </span><span style={{ color: '#dde3ea' }}>{v}</span></span>
          ))}
        </div>
      )}
      {dep && (
        <div className="mt-2">
          <div className="flex items-center gap-2 f-mono text-[10px]">
            <span style={{ color: '#2f80d6', minWidth: 60 }}>IN-GAME</span>
            <div style={{ flex: 1, height: 6, background: '#0a1626', border: '1px solid #243d52', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: reachPct + '%', height: '100%', background: '#2f80d6' }} />
            </div>
            <span style={{ color: '#93a1b0', minWidth: 78, textAlign: 'right' }}>reach {s.game.rangePx}px</span>
          </div>
          <div className="f-mono text-[9px] mt-1" style={{ color: '#5d6b7a' }}>
            Pk {PK_LABEL[s.game.pk] || s.game.pk} · vs {(s.game.engage || []).join('/')} · ammo {s.game.ammoMax}
          </div>
        </div>
      )}
      {s.notes && <div className="f-serif text-[11px] mt-1.5" style={{ color: '#93a1b0', lineHeight: 1.4 }}>{s.notes}</div>}
    </div>
  );
}

function OffensiveRow({ s, CLS_LABEL, onDelete, onSaveTtx, onClearTtx, editingKey, setEditingKey }) {
  const u = s.usable && s.game;
  const rowKey = (s.name || '').toLowerCase();
  const isEditing = editingKey === 'off:' + rowKey;
  const chips = [];
  if (s.category) chips.push(['CATEGORY', s.category]);
  if (s.rangeText) chips.push(['RANGE', s.rangeText]);
  if (s.speedText) chips.push(['SPEED', s.speedText]);
  if (s.warhead) chips.push(['WARHEAD', s.warhead]);
  if (s.guidance) chips.push(['GUIDANCE', s.guidance]);
  if (s.platform) chips.push(['PLATFORM', s.platform]);
  if (s.cost && s.cost.toLowerCase() !== 'n/a') chips.push(['EST. COST', s.cost]);
  const SIG_LABEL = { huge: 'very large', large: 'large', medium: 'medium', small: 'small' };
  return (
    <div className="border border-[#243d52] p-2.5" style={{ background: '#142536' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="f-display text-[14px]" style={{ color: '#dde3ea' }}>{s.name}</span>
        {s.country && <CountryTag country={s.country} />}
        {s.type && <span className="f-mono text-[10px]" style={{ color: '#5d6b7a' }}>{s.type}</span>}
        <span style={{ flex: 1 }} />
        {u
          ? <span className="f-mono text-[10px]" style={{ color: '#d24a44' }}>● USABLE</span>
          : <span className="f-mono text-[10px]" style={{ color: '#5d6b7a' }}>○ REFERENCE</span>}
        {s._custom && <span className="f-mono text-[10px]" style={{ color: '#d9a52f' }}>CUSTOM</span>}
        {s._ttx && <span className="f-mono text-[10px]" style={{ color: '#d9a52f' }}>EDITED</span>}
        {onSaveTtx && <button onClick={() => setEditingKey(isEditing ? null : 'off:' + rowKey)} className="f-mono text-[10px]" style={{ color: isEditing ? '#d9a52f' : '#5aa0e6', border: '1px solid ' + (isEditing ? '#d9a52f' : '#34516b'), borderRadius: 3, padding: '1px 6px' }}>{isEditing ? 'CLOSE' : 'EDIT'}</button>}
        {s._ttx && onClearTtx && <button onClick={() => onClearTtx(s.name)} title="Reset to open-source default" className="f-mono text-[10px]" style={{ color: '#93a1b0', border: '1px solid #34516b', borderRadius: 3, padding: '1px 6px' }}>RESET</button>}
        {s._custom && onDelete && <button onClick={() => onDelete(s._id)} title="Delete" className="f-mono text-[12px] leading-none" style={{ color: '#d24a44', padding: '0 2px' }}>×</button>}
      </div>
      {isEditing && <TtxEditor s={s} kind="offensive" onSave={(patch) => onSaveTtx(s.name, patch)} />}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 f-mono text-[10px]">
          {chips.map(([k, v], i) => (
            <span key={i}><span style={{ color: '#5d6b7a' }}>{k} </span><span style={{ color: '#dde3ea' }}>{v}</span></span>
          ))}
        </div>
      )}
      {u && (
        <div className="mt-2 f-mono text-[9px]" style={{ color: '#5d6b7a' }}>
          <span style={{ color: '#d24a44' }}>IN-GAME THREAT </span>
          class {CLS_LABEL[s.game.class] || s.game.class} · speed {s.game.speed} · alt {s.game.ceiling} · RCS {SIG_LABEL[s.game.signature] || s.game.signature} · dmg {s.game.dmg}{s.game.ewVuln ? ' · EW-vulnerable' : ''}
        </div>
      )}
      {s.notes && <div className="f-serif text-[11px] mt-1.5" style={{ color: '#93a1b0', lineHeight: 1.4 }}>{s.notes}</div>}
    </div>
  );
}

function FLbl({ children }) { return <div className="f-mono text-[9px] tracking-wider mb-0.5" style={{ color: '#5d6b7a' }}>{children}</div>; }

function AddSystemForm({ side, onAdd, onCancel }) {
  const [f, setF] = useState(side === 'defence'
    ? { cat: 'SAM', family: '', name: '', country: '', cls: '', rangeKm: '', altKm: '', speed: '', cost: '', notes: '', deployable: true }
    : { tab: 'BALLISTIC', country: 'Russia', name: '', category: '', type: '', range: '', speed: '', warhead: '', guidance: '', platform: '', cost: '', notes: '', usable: true });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const ist = { background: '#0a1626', border: '1px solid #243d52', color: '#dde3ea', borderRadius: 3 };
  const num = v => (v === '' || v == null) ? null : Number(v);
  const accent = side === 'defence' ? '#2f80d6' : '#d24a44';

  function save() {
    if (!f.name.trim()) { window.alert('Name is required.'); return; }
    let e;
    if (side === 'defence') {
      if (!f.family.trim()) { window.alert('Family is required (e.g. NASAMS, Patriot, Stinger).'); return; }
      const km = num(f.rangeKm), altKm = num(f.altKm);
      e = { cat: f.cat, family: f.family.trim(), name: f.name.trim(), country: f.country.trim(), cls: f.cls.trim(), missile: f.cls.trim(),
        rangeKm: km, rangeText: km != null ? '~' + km + ' km' : '', altKm, altText: altKm != null ? '~' + altKm + ' km' : '',
        speedText: f.speed.trim(), costMissile: f.cost.trim(), notes: f.notes.trim(), deployable: !!f.deployable };
      if (f.deployable) e.game = deriveDefenceGame(f.cat, km, altKm);
    } else {
      const g = deriveOffensiveGame(f.tab);
      const m = (f.range.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      e = { country: f.country.trim() || 'Russia', name: f.name.trim(), category: f.category.trim(), type: f.type.trim(),
        rangeText: f.range.trim(), rangeKm: m.length ? Math.max(...m) : null, speedText: f.speed.trim(),
        warhead: f.warhead.trim(), guidance: f.guidance.trim(), platform: f.platform.trim(), cost: f.cost.trim(),
        notes: f.notes.trim(), tab: f.tab, threatClass: g.class, usable: !!f.usable };
      if (f.usable) e.game = g;
    }
    onAdd(e);
  }

  return (
    <div className="fixed inset-0 flex items-start justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', zIndex: 100, overflowY: 'auto' }}>
      <div className="w-full max-w-2xl border-2 my-6" style={{ borderColor: accent, background: '#102234' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #243d52' }}>
          <div className="f-display text-lg" style={{ color: accent }}>ADD {side === 'defence' ? 'AIR DEFENCE' : 'THREAT'} SYSTEM</div>
          <button onClick={onCancel} className="f-mono text-[14px]" style={{ color: '#93a1b0' }}>×</button>
        </div>
        <div className="p-4 space-y-3">
          {side === 'defence' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>CATEGORY</FLbl>
                  <select value={f.cat} onChange={e => set('cat', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist}>
                    {AD_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div><FLbl>COUNTRY (e.g. USA, France / Italy)</FLbl><input value={f.country} onChange={e => set('country', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>FAMILY (e.g. NASAMS)</FLbl><input value={f.family} onChange={e => set('family', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
                <div><FLbl>NAME / VARIANT</FLbl><input value={f.name} onChange={e => set('name', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <div><FLbl>CLASS / MISSILE</FLbl><input value={f.cls} onChange={e => set('cls', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><FLbl>RANGE (km)</FLbl><input type="number" value={f.rangeKm} onChange={e => set('rangeKm', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
                <div><FLbl>ALTITUDE (km)</FLbl><input type="number" value={f.altKm} onChange={e => set('altKm', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
                <div><FLbl>SPEED (text)</FLbl><input value={f.speed} onChange={e => set('speed', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <div><FLbl>COST (e.g. ~$1.5M)</FLbl><input value={f.cost} onChange={e => set('cost', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              <label className="flex items-center gap-2 f-mono text-[12px]" style={{ color: '#dde3ea' }}>
                <input type="checkbox" checked={f.deployable} onChange={e => set('deployable', e.target.checked)} /> Deployable, gets an in-game reach calibrated from range
              </label>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>CLASS</FLbl>
                  <select value={f.tab} onChange={e => set('tab', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist}>
                    {OFFENSIVE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div><FLbl>COUNTRY</FLbl><input value={f.country} onChange={e => set('country', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <div><FLbl>NAME / DESIGNATION</FLbl><input value={f.name} onChange={e => set('name', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>CATEGORY</FLbl><input value={f.category} onChange={e => set('category', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
                <div><FLbl>TYPE</FLbl><input value={f.type} onChange={e => set('type', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>RANGE</FLbl><input value={f.range} onChange={e => set('range', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
                <div><FLbl>SPEED</FLbl><input value={f.speed} onChange={e => set('speed', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>WARHEAD / PAYLOAD</FLbl><input value={f.warhead} onChange={e => set('warhead', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
                <div><FLbl>GUIDANCE / ACCURACY</FLbl><input value={f.guidance} onChange={e => set('guidance', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>LAUNCH PLATFORM</FLbl><input value={f.platform} onChange={e => set('platform', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
                <div><FLbl>EST. COST</FLbl><input value={f.cost} onChange={e => set('cost', e.target.value)} className="w-full f-mono text-[12px] px-2 py-1.5" style={ist} /></div>
              </div>
              <label className="flex items-center gap-2 f-mono text-[12px]" style={{ color: '#dde3ea' }}>
                <input type="checkbox" checked={f.usable} onChange={e => set('usable', e.target.checked)} /> Usable in-game, gets a threat profile derived from class
              </label>
            </>
          )}
          <div><FLbl>NOTES</FLbl><textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} className="w-full f-serif text-[12px] px-2 py-1.5" style={ist} /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid #243d52' }}>
          <button onClick={onCancel} className="btn-riso btn-alt" style={{ padding: '8px 16px', fontSize: '13px' }}>CANCEL</button>
          <button onClick={save} className="f-display text-[13px] px-4 h-10 border-2" style={{ borderColor: accent, background: accent, color: '#0a1626', borderRadius: 4 }}>SAVE TO LIBRARY</button>
        </div>
      </div>
    </div>
  );
}

function TrainingHubScreen({ onSingle, onMultiplayer, onInstructor, onBack }) {
  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-4xl mx-auto pt-6 relative">
        <div className="flex items-center justify-between gap-4 mb-5 pb-4" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-4">
            <img src={PM_LOGO} alt="Project Mercury NATO" style={{ width: 56, height: 56, display: 'block' }} />
            <div>
              <div className="f-typewriter text-[10px] tracking-[0.3em]" style={{ color: '#5d6b7a' }}>SKYWATCH · TRAINING</div>
              <div className="f-display text-2xl" style={{ color: '#2f80d6' }}>BRIGADE AIR DEFENCE</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="f-display" style={{ color: '#dde3ea', letterSpacing: '0.14em', fontSize: '26px', lineHeight: 1 }}>JATEC</div>
              <div className="f-typewriter text-[8px] tracking-[0.12em] mt-1" style={{ color: '#93a1b0' }}>JOINT ANALYSIS, TRAINING<br />&amp; EDUCATION CENTRE</div>
            </div>
            <img src={JATEC_LOGO} alt="NATO JATEC" style={{ height: 82, width: 'auto', borderRadius: 4, background: '#fff', padding: 5, display: 'block' }} />
          </div>
        </div>

        <div className="f-mono text-[13px] mb-6 max-w-2xl" style={{ color: '#93a1b0', lineHeight: 1.5 }}>
          Brigade / battalion / company air-defence training against repeated mass UAS attacks. Select a mode. ISR-strike kill-chain logic is active: an inbound Orlan or other ISR drone signals a follow-on ballistic / KAB strike, break the chain.
        </div>

        <div className="grid grid-cols-1 gap-3 mb-6">
          <button onClick={onSingle} className="text-left p-4 border-2"
            style={{ borderColor: '#2f80d6', background: 'rgba(47,128,214,0.06)' }}>
            <div className="f-display text-xl" style={{ color: '#2f80d6' }}>SINGLE PLAYER ></div>
            <div className="f-mono text-[12px]" style={{ color: '#93a1b0' }}>One commander, one brigade AOR. Iron Wind (48h) · Cold Strike (8h surprise) · Active Combat (24h high-tempo).</div>
          </button>
          <button onClick={onMultiplayer} className="text-left p-4 border-2"
            style={{ borderColor: '#d24a44', background: 'rgba(210,74,68,0.06)' }}>
            <div className="f-display text-xl" style={{ color: '#d24a44' }}>⚡ MULTIPLAYER (BETA) ></div>
            <div className="f-mono text-[12px]" style={{ color: '#93a1b0' }}>Multiple leaders share the air picture and split sectors / authority under one attack.</div>
          </button>
          <button onClick={onInstructor} className="text-left p-4 border-2"
            style={{ borderColor: '#b8893a', background: 'rgba(184,137,58,0.06)' }}>
            <div className="f-display text-xl" style={{ color: '#b8893a' }}>INSTRUCTOR MODE ></div>
            <div className="f-mono text-[12px]" style={{ color: '#93a1b0' }}>Run an evaluated serial: pause, inject threats, damage assets, and annotate leader decisions for the AAR.</div>
          </button>
        </div>

        <button onClick={onBack} className="btn-riso btn-alt">‹ BACK TO MODE SELECT</button>
      </div>
      <div className="cls-banner mt-10">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
    </div>
  );
}

// ============================================================================
// BRIEF
// ============================================================================
function ScenarioScreen({ gameMode, onChoose, onLaunchSaved, onBack }) {
  // Demonstration = capital saturation run-through · Training = brigade level
  const scenarioOrder = gameMode === 'training'
    ? ['iron_wind', 'cold_strike', 'active_combat']
    : ['stolytsia_24'];
  const [savedScn] = React.useState(() => { try { return JSON.parse(localStorage.getItem('sw_scenarios_v1') || '[]'); } catch (e) { return []; } });
  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-5xl mx-auto pt-8">
        <div className="f-typewriter text-xs tracking-[0.25em]" style={{ color: '#5d6b7a' }}>HQ // 4TH MECH DIV // TRAINING DIRECTORATE</div>
        <h1 className="f-display mt-2" style={{ fontSize: '32px', lineHeight: 1, letterSpacing: '0.02em', color: '#2f80d6' }}>
          MISSION SELECT
        </h1>
        <div className="f-cond text-lg mb-4" style={{ color: '#d9a52f' }}>CHOOSE TRAINING SCENARIO</div>
        <div className="double-rule mb-6" />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {scenarioOrder.map(id => {
            const sc = SCENARIOS[id];
            const diffColor = { MEDIUM: '#2f80d6', HARD: '#d4995a', EXTREME: '#d24a44' }[sc.difficulty] || '#2f80d6';
            return (
              <div key={id} className="border-2 border-[#243d52] p-4 cursor-pointer hover:bg-[#2f80d6]/5"
                onClick={() => onChoose(id)}
                style={{ background: '#102234' }}>
                <div className="flex items-baseline justify-between mb-2">
                  <div className="f-display text-xl" style={{ color: '#2f80d6' }}>{sc.name}</div>
                  <span className="f-typewriter text-[10px] px-2 py-0.5"
                    style={{ background: diffColor, color: '#102234' }}>
                    {sc.difficulty}
                  </span>
                </div>
                <div className="f-cond text-xs mb-3" style={{ color: '#d9a52f' }}>{sc.subtitle}</div>
                <p className="f-serif text-[12px] leading-relaxed mb-3" style={{ color: '#dde3ea' }}>
                  {sc.brief.length > 280 ? sc.brief.slice(0, 280) + '…' : sc.brief}
                </p>
                <div className="border-t border-[#243d52]/30 pt-2 mt-2 f-mono text-[10px]" style={{ color: '#5d6b7a' }}>
                  <div>Duration: {sc.totalGameHours}h game / {Math.round(sc.realDuration / 60000)}min real</div>
                  <div>Threats: {sc.schedule.length}</div>
                  <div>{sc.coldStart && <span style={{ color: '#d24a44', fontWeight: 'bold' }}>⚠ COLD START</span>}{sc.coldStart && sc.enemyEW && ' · '}{sc.enemyEW && <span style={{ color: '#d24a44', fontWeight: 'bold' }}>⚠ ENEMY EW</span>}</div>
                </div>
                <button className="btn-riso mt-3 w-full" style={{ padding: '8px', fontSize: '13px' }}>
                  SELECT >
                </button>
              </div>
            );
          })}
        </div>

        {savedScn.length > 0 && (
          <div className="mt-8">
            <div className="f-cond text-lg mb-1" style={{ color: '#d9a52f' }}>YOUR MODELLED SCENARIOS</div>
            <div className="f-mono text-[10px] mb-3" style={{ color: '#5d6b7a' }}>Saved in the Scenario Modeller on this device. Scroll and launch directly.</div>
            <div className="space-y-2" style={{ maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
              {savedScn.slice().sort((a,b)=>(b.when||0)-(a.when||0)).map(entry => {
                const cfg = entry.config || {};
                const waves = cfg.waves || [];
                const tracks = waves.reduce((acc,w)=>acc+(+w.count||0),0);
                return (
                  <div key={entry.when} className="border-2 border-[#243d52] p-3 flex items-center justify-between gap-3" style={{ background: '#102234' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="f-display text-base" style={{ color: '#2f80d6' }}>{entry.name || cfg.name || 'Untitled'}</div>
                      <div className="f-mono text-[10px] mt-1" style={{ color: '#5d6b7a' }}>{(cfg.map === 'capital' ? 'CAPITAL' : 'BRIGADE')} · {waves.length} waves · {tracks} tracks · {(+cfg.totalGH)||0}h{cfg.coldStart ? ' · COLD START' : ''}{cfg.enemyEW ? ' · ENEMY EW' : ''}</div>
                    </div>
                    <button onClick={() => onLaunchSaved && onLaunchSaved(entry)} className="btn-riso" style={{ padding: '8px 14px', fontSize: '13px', flex: 'none' }}>LAUNCH ></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={onBack} className="btn-riso btn-alt mt-6">‹ BACK TO MENU</button>
      </div>
      <div className="cls-banner mt-10">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
    </div>
  );
}

function BriefScreen({ onContinue, onBack }) {
  const counts = {};
  SPAWN_SCHEDULE.forEach(s => { counts[s.type] = (counts[s.type] || 0) + 1; });
  const totalGH = SCENARIO.totalGameHours || 48;
  const isCustom = !!SCENARIO.custom;
  const threatNames = Object.keys(counts).map(k => (TT[k] ? TT[k].name : k) + ' ×' + counts[k]);
  const forceList = (SCENARIO.inventory || []).map(it => (CARDS[it.card] ? (it.count + '× ' + CARDS[it.card].name) : null)).filter(Boolean);
  const briefNodes = activeNodes(SCENARIO);
  const nodeList = briefNodes.map(n => n.name || n.sym);
  const geoStr = SCENARIO.geo ? (((SCENARIO.geo.n + SCENARIO.geo.s) / 2).toFixed(3) + '°N, ' + ((SCENARIO.geo.e + SCENARIO.geo.w) / 2).toFixed(3) + '°E, AO ' + geoKmWidth(SCENARIO.geo).toFixed(0) + ' km wide') : null;
  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-4xl mx-auto pt-6">
        {/* OPORD header, NATO standard */}
        <div className="border-2 border-[#243d52] mb-4" style={{ background: '#102234' }}>
          <div className="px-3 py-1 flex items-center justify-between"
            style={{ background: '#2f80d6', color: '#102234' }}>
            <span className="f-display tracking-widest text-xs">OPORD</span>
            <span className="f-typewriter text-[10px]">DTG: {fmtDTG(0)}</span>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-3 gap-x-4 f-mono text-[11px]" style={{ color: '#dde3ea' }}>
              <div><span style={{ color: '#5d6b7a' }}>OPORD NO:</span> 26-{String(Math.floor(Math.random() * 9000) + 1000)}</div>
              <div><span style={{ color: '#5d6b7a' }}>ISSUING HQ:</span> {isCustom ? 'IAMD TRAINING CELL' : '1ST MECH BDE / TAC CP'}</div>
              <div><span style={{ color: '#5d6b7a' }}>OPERATION:</span> {SCENARIO.name}</div>
              <div><span style={{ color: '#5d6b7a' }}>REFERENCES:</span> ATP-3.3.7, AJP-3.3</div>
              <div><span style={{ color: '#5d6b7a' }}>TIME ZONE:</span> ZULU</div>
              <div><span style={{ color: '#5d6b7a' }}>TASK ORG:</span> {isCustom ? 'Custom IAMD package' : 'Multinational Bde IAMD'}</div>
            </div>
          </div>
        </div>

        <h1 className="f-display" style={{ fontSize: '32px', lineHeight: 1, letterSpacing: '0.02em', color: '#2f80d6' }}>{SCENARIO.name}</h1>
        <div className="f-cond text-lg mb-3" style={{ color: '#d9a52f' }}>{SCENARIO.subtitle}</div>
        <div className="double-rule mb-4" />

        {/* PARAGRAPH 1, SITUATION */}
        <ParagraphSection num="1" title="SITUATION">
          <SubSection title="a. Enemy Forces">
            <p className="f-serif text-[13px] leading-relaxed">{SCENARIO.brief}</p>
            <p className="f-serif text-[13px] leading-relaxed mt-2">
              {isCustom
                ? <span>Authored threat profile, <strong>{Object.values(counts).reduce((a, b) => a + b, 0)} tracks</strong> across {Object.keys(counts).length} threat types: {threatNames.join(', ')}.</span>
                : <span>Adversary employs <strong>recon-strike complex</strong>: ISR (Orlan-10/30, ZALA, SuperCam) cues precision fires (Iskander, Kh-101, Kalibr, Kh-22). Loitering munitions (Geran-2, Lancet-3, Lancet-OF/fiber-optic) hunt AD assets via SIGINT. KAB glide bombs delivered after Orlan-30 designation.</span>}
              {SCENARIO.enemyEW && <span> <strong style={{ color: '#d24a44' }}>EW NODE active in adversary AOR</strong>, degrades data-link weapons by 25%.</span>}
              {SCENARIO.coldStart && <span> <strong style={{ color: '#d24a44' }}>COLD START, strike begins H+0 with no warning.</strong></span>}
            </p>
          </SubSection>
          <SubSection title="b. Friendly Forces">
            <div className="f-serif text-[13px] leading-relaxed">
              {isCustom
                ? <span><strong>Task-organised IAMD laydown</strong> for this scenario: {forceList.length ? forceList.join(', ') : 'assets as allocated in the force builder'}. Strategic ATTACHED batteries, where present, auto-engage cruise and ballistic; remaining cells are player-controlled.</span>
                : <span><strong>1st Mech Bde (multinational)</strong>, 3× mech bn FLOT, bde arty bn rear, tank reserve TF, recon co flanks, engr co, BSB rear. <strong> CORPS/DIV attached:</strong> PATRIOT PAC-3 battery (TANGO-1), IRIS-T SLM detachment (IRIS-1), auto-engage strategic threats, view-only. <strong> Bde-organic AD:</strong> NASAMS, Crotale, Gepard, Skynex, MANPADS, EW jammers, FPV interceptor squadrons (3 crews), C-UAS MG teams (6 crews).</span>}
            </div>
          </SubSection>
          <SubSection title="c. Civilian / Environment">
            <div className="f-serif text-[13px] leading-relaxed">
              {isCustom
                ? <span>{geoStr ? ('Real-world AO: ' + geoStr + '. Satellite terrain; scale bar shown on the tactical map.') : ('Operating area on the ' + SCENARIO.map + ' map, mixed terrain.')} Civilian populated areas in rear sectors. NO civilian air traffic expected. Weather: VFR, wind 270°/15kts. Daylight throughout {totalGH}-hour mission.</span>
                : <span>AOR east of Berezh, mixed terrain, civilian populated areas in rear sectors. NO civilian air traffic expected. Weather: VFR, wind 270°/15kts. Daylight throughout {totalGH}-hour mission.</span>}
            </div>
          </SubSection>
        </ParagraphSection>

        {/* PARAGRAPH 2, MISSION */}
        <ParagraphSection num="2" title="MISSION">
          <p className="f-serif text-[14px] leading-relaxed font-bold" style={{ color: '#2f80d6' }}>
            {isCustom
              ? <span>IAMD cell defends {briefNodes.length} assigned nodes ({nodeList.slice(0, 8).join(', ')}{nodeList.length > 8 ? ', and others' : ''}) against the authored air and missile threat from H+0 to H+{totalGH} in order to preserve these assets and the protected population.</span>
              : <span>1st Mech Bde IAMD cell defends bde rear-area C2/sustainment nodes (BDE TAC, FARP-2, ATP-3, R-2) against adversary air and missile threats from H+0 to H+{totalGH} in order to preserve combat power for offensive operations and protect civilian population in AOR.</span>}
          </p>
        </ParagraphSection>

        {/* PARAGRAPH 3, EXECUTION */}
        <ParagraphSection num="3" title="EXECUTION">
          <SubSection title="a. Commander's Intent">
            <p className="f-serif text-[13px] leading-relaxed">
              <strong>Purpose:</strong> Deny adversary the ability to disrupt bde sustainment and command-and-control through aerial attack.
              <br/><strong>Method:</strong> Layered defense, strategic ATTACHED assets engage cruise/ballistic; bde-organic SHORAD/MANPADS engages OWA/MALE/glide; C-UAS teams engage tactical drones; EW degrades adversary recon-strike kill chain.
              <br/><strong>End State:</strong> All rear C2 nodes operational at H+{totalGH}, &gt;60% organic AD assets combat-effective.
            </p>
          </SubSection>
          <SubSection title="b. Concept of Operations">
            <p className="f-serif text-[13px] leading-relaxed">
              Phased defense over {totalGH} game-hours. Anticipate {Object.values(counts).reduce((a, b) => a + b, 0)} threat events across {PHASES.length} operational phases.
              Priority of fires: <strong>ballistic &gt; cruise &gt; glide &gt; OWA &gt; tactical &gt; recon</strong>.
              ROE: WPNS TIGHT initially, engage classified hostile only. Commander may transition to WPNS FREE
              during saturation phases at discretion. Patriot/IRIS-T fire control retained at DIV/CORPS, bde does not allocate.
            </p>
          </SubSection>
          <SubSection title="c. Tasks to Subordinate Units">
            <div className="grid grid-cols-2 gap-x-4 f-serif text-[12px]">
              <div><strong>SAM Cell:</strong> Engage cruise/glide/MALE. Coordinate with attached PATRIOT for ballistic handoff.</div>
              <div><strong>SHORAD Cell:</strong> Engage OWA, low-altitude tactical. Repel saturation attacks.</div>
              <div><strong>C-UAS Cell:</strong> FPV interceptors against OWA/recon. MG teams last-line vs FPV strike.</div>
              <div><strong>EW Cell:</strong> Jam adversary control links, Geran/Orlan/FPV (EW-vulnerable). Cycle emissions to avoid SIGINT lock.</div>
              <div><strong>S-2:</strong> Classify contacts via sensor footprint. Identify paralleling Orlan = ballistic warning.</div>
              <div><strong>Fires Cell:</strong> Request CAS / fire mission from CORPS for adversary EW node neutralization (3 available).</div>
            </div>
          </SubSection>
          <SubSection title="d. Coordinating Instructions">
            <div className="f-serif text-[12px] leading-relaxed">
              <strong>Engagement priorities:</strong> Listed above. <strong>Visual ID required</strong> under WPNS TIGHT (default ROE).
              <strong> Threat objectives:</strong>
              <ul className="ml-4 mt-1 space-y-0.5">
                {SCENARIO.objectives.map((o, i) => (
                  <li key={i}>● {o}</li>
                ))}
              </ul>
            </div>
          </SubSection>
        </ParagraphSection>

        {/* PARAGRAPH 4, SUSTAINMENT */}
        <ParagraphSection num="4" title="SUSTAINMENT">
          <SubSection title="a. Logistics">
            <p className="f-serif text-[13px] leading-relaxed">
              CL V (ammunition) limited per organic asset capacity. Patriot/IRIS-T/NASAMS/Crotale eligible for CORPS reload (ETA 20 min/request).
              C-UAS team ammunition replenished from BSB. CL III (fuel) supplied from FARP-2, protect at all costs.
            </p>
          </SubSection>
          <SubSection title="b. Medical">
            <p className="f-serif text-[13px] leading-relaxed">
              R-2 medical facility supports bde personnel. CASEVAC via FARP-2 to R-2. Loss of either degrades bde combat
              effectiveness, both protected nodes in AD priority list.
            </p>
          </SubSection>
        </ParagraphSection>

        {/* PARAGRAPH 5, COMMAND AND SIGNAL */}
        <ParagraphSection num="5" title="COMMAND AND SIGNAL">
          <SubSection title="a. Command">
            <div className="f-serif text-[13px] leading-relaxed">
              <strong>Bde Cdr:</strong> @ BDE MAIN (rear). <strong>AD Cdr (you):</strong> @ BDE TAC.
              <strong> Succession:</strong> AD Cdr > SAM Cell Chief > SHORAD Cell Chief.
              <strong> Attached fires:</strong> CORPS PATRIOT, DIV IRIS-T, coordinate via Air Operations Cell, no direct bde control.
            </div>
          </SubSection>
          <SubSection title="b. Signal">
            <div className="f-serif text-[12px] leading-relaxed">
              <strong>NET CTRL:</strong> AD Cdr (this terminal). <strong>Reporting:</strong> All cells report contacts/engagements via
              event log. <strong>Alerts:</strong> System auto-alert on phase transitions, ballistic indications, EW counter-strike threats,
              position compromises, and CAS impacts. <strong>FREQ:</strong> SECURE / NIPR-equivalent.
              <strong> CALLSIGN list:</strong> Patriot=TANGO-1 · IRIS=IRIS-1 · NASAMS=KILO-1 · Crotale=CROTALE-1 ·
              FPV INT crews=ALPHA/BRAVO/CHARLIE-#-1 · EW=WHISKEY-# · MG teams=MIKE-#.
            </div>
          </SubSection>
        </ParagraphSection>

        {/* THREAT INVENTORY remains as appendix */}
        <div className="border-2 border-[#243d52] p-4 mb-6 mt-6">
          <div className="f-display text-base mb-2" style={{ color: '#d9a52f' }}>APPENDIX A, ESTIMATED THREAT INVENTORY ({totalGH}H)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 f-mono text-[11px]">
            {Object.entries(counts).map(([type, n]) => {
              const tt = TT[type];
              return (
                <div key={type} className="flex items-center gap-2">
                  <span style={{ color: tt.color, fontSize: '12px' }}>■</span>
                  <span className="flex-1">{tt.code}</span>
                  <span style={{ color: '#5d6b7a' }}>×{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onContinue} className="btn-riso">ACKNOWLEDGE BRIEF, PROCEED TO DEPLOYMENT ></button>
          <button onClick={onBack} className="btn-riso btn-alt">‹ BACK</button>
        </div>
      </div>
      <div className="cls-banner mt-10">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
    </div>
  );
}

// Helper components for OPORD format
function ParagraphSection({ num, title, children }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline gap-3 border-b-2 border-[#243d52] pb-1 mb-2">
        <span className="f-display text-lg" style={{ color: '#2f80d6' }}>{num}.</span>
        <span className="f-display text-lg" style={{ color: '#2f80d6' }}>{title}</span>
      </div>
      <div className="pl-6 space-y-3">{children}</div>
    </div>
  );
}
function SubSection({ title, children }) {
  return (
    <div>
      <div className="f-typewriter text-[11px] tracking-widest mb-1" style={{ color: '#d9a52f' }}>{title}</div>
      {children}
    </div>
  );
}

// ============================================================================
// DEPLOY
// ============================================================================
function DeployScreen({ placedRef, selectedCardRef, hoveredCardRef, onBegin, onBack, gameMode }) {
  const [, fu] = useReducer(x => x + 1, 0);
  const placed = placedRef.current;
  const planning = gameMode !== 'demo' || !!(SCENARIO && SCENARIO.custom);
  const [showCoverage, setShowCoverage] = useState(true);
  const [mapZoom, setMapZoom] = useState(1);
  const adList = planning ? [
    ...((SCENARIO.preplaced || []).map(p => ({ x: p.x, y: p.y, cardId: p.card }))),
    ...placed.map(p => ({ x: p.x, y: p.y, cardId: p.cardId })),
  ].filter(a => CARDS[a.cardId] && !CARDS[a.cardId].isEW) : [];
  const _cover = (n) => adList.filter(a => Math.hypot(a.x - n.x, a.y - n.y) <= (CARDS[a.cardId].range || 0));
  const placedCount = (id) => placed.filter(p => p.cardId === id).length;
  const allReq = SCENARIO.inventory.filter(i => !CARDS[i.card].attached).every(i => placedCount(i.card) >= i.required);

  const onMapClick = (e) => {
    if (!selectedCardRef.current) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const c = pt.matrixTransform(svg.getScreenCTM().inverse());
    if (c.x < FRIENDLY_BOUND.xMin || c.x > FRIENDLY_BOUND.xMax ||
        c.y < FRIENDLY_BOUND.yMin || c.y > FRIENDLY_BOUND.yMax) return;
    const inv = SCENARIO.inventory.find(i => i.card === selectedCardRef.current);
    if (placedCount(selectedCardRef.current) >= inv.count) return;
    placedRef.current.push({
      id: uid(), cardId: selectedCardRef.current,
      x: c.x, y: c.y, alive: true,
      loadout: CARDS[selectedCardRef.current].isInterceptor ? DEFAULT_LOADOUT : null,
    });
    fu();
  };
  const removePlaced = (id) => { placedRef.current = placedRef.current.filter(p => p.id !== id); fu(); };
  const setLoadout = (id, loadoutId) => {
    const p = placedRef.current.find(p => p.id === id);
    if (p) { p.loadout = loadoutId; fu(); }
  };

  // Auto-deploy all assets per NATO IAMD layered laydown doctrine.
  const executeLaydown = () => {
    if (placedRef.current.length > 0) {
      if (!window.confirm('Replace current deployment with doctrinal laydown?')) return;
    }
    placedRef.current = [];
    for (const inv of SCENARIO.inventory) {
      if (CARDS[inv.card].attached) continue;
      const pos = DOCTRINAL_LAYDOWN[inv.card];
      if (!pos) continue;
      placedRef.current.push({
        id: uid(), cardId: inv.card,
        x: pos.x, y: pos.y, alive: true,
        loadout: CARDS[inv.card].isInterceptor ? DEFAULT_LOADOUT : null,
      });
    }
    fu();
  };

  const showCardId = hoveredCardRef.current || selectedCardRef.current;
  const showCard = showCardId ? CARDS[showCardId] : null;

  return (
    <div className="min-h-screen riso-paper p-3">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-[1400px] mx-auto pt-3">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="f-typewriter text-xs tracking-widest" style={{ color: '#5d6b7a' }}>{SCENARIO.name} // ASSET DEPLOYMENT</div>
            <h1 className="f-display text-3xl" style={{ color: '#2f80d6' }}>POSITION YOUR ASSETS</h1>
          </div>
          <div className="text-right">
            <div className="f-cond text-sm">All assets begin at STANDBY when mission starts.</div>
            {isCapital(SCENARIO) && (
              <div className="flex items-center gap-1 justify-end mt-2 mb-1">
                <span className="f-typewriter text-[10px] mr-1" style={{ color: '#5d6b7a' }}>SESSION:</span>
                {[5, 10, 15].map(m => (
                  <button key={m} onClick={() => { SELECTED_DURATION_MIN = m; fu(); }}
                    className="f-display text-[11px] px-2 py-1"
                    style={{
                      background: SELECTED_DURATION_MIN === m ? 'var(--mil-friend)' : 'var(--bg-panel-2)',
                      color: SELECTED_DURATION_MIN === m ? 'var(--text-inverted)' : 'var(--mil-friend)',
                      border: '1px solid var(--mil-friend)', letterSpacing: '0.05em',
                    }}
                    title={`${m}-minute saturation session`}>
                    {m} MIN
                  </button>
                ))}
              </div>
            )}
            <button onClick={executeLaydown} className="btn-riso mt-2"
              style={{ background: 'var(--mil-unknown-bg)', borderColor: 'var(--mil-unknown)', color: 'var(--mil-unknown)', fontWeight: 700 }}
              title="Auto-deploy all assets per NATO IAMD layering doctrine">
              ◇ DOCTRINAL LAYDOWN
            </button>
            <button onClick={onBegin} disabled={!allReq} className="btn-riso mt-2 ml-2">DEPLOY & BEGIN ></button>
            <button onClick={onBack} className="btn-riso btn-alt ml-2 mt-2">‹ BACK</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-3">
          <div className="border-2 border-[#243d52] relative" style={{ background: '#16293c' }}>
            {SCENARIO.geo && <GeoBackground geo={SCENARIO.geo} />}
            {!SCENARIO.geo && <ZoomControls zoom={mapZoom} setZoom={setMapZoom} />}
            <div style={{ overflow:'auto', maxHeight: (mapZoom > 1 && !SCENARIO.geo) ? '78vh' : 'none', position:'relative', zIndex:1 }}>
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width:((SCENARIO.geo?1:mapZoom)*100)+'%', minWidth:'100%', height:'auto', display:'block' }} className={`${selectedCardRef.current ? 'cursor-crosshair' : 'cursor-default'}`} onClick={onMapClick}>
              <TopographyLayer />
              <FriendlyAreaOverlay />
              <FLOTAndPhaseLines />
              <UnitsLayer />
              {planning && showCoverage && (
                <g>
                  {adList.map((a, i) => {
                    const c = CARDS[a.cardId];
                    return <circle key={'cov' + i} cx={a.x} cy={a.y} r={c.range} fill={c.color} fillOpacity="0.05" stroke={c.color} strokeOpacity="0.32" strokeWidth="0.6" />;
                  })}
                </g>
              )}
              <DefendedNodes nodes={activeNodes(SCENARIO)} />

              {/* Show preplaced attached assets greyed-out on map */}
              {(SCENARIO.preplaced || []).map((p, i) => {
                const card = CARDS[p.card];
                return (
                  <g key={'pp' + i} opacity="0.7">
                    <circle cx={p.x} cy={p.y} r="22" fill="rgba(139,31,31,0.10)" stroke="#d24a44" strokeWidth="0.8" strokeDasharray="3,3" />
                    <rect x={p.x - 18} y={p.y - 11} width="36" height="22" rx="2"
                      fill="rgba(210,74,68,0.12)" stroke="#d24a44" strokeWidth="2" strokeDasharray="2,2" />
                    <text x={p.x} y={p.y - 2} fontSize="9" textAnchor="middle" className="f-display" fill="#d24a44">{card.tag}</text>
                    <text x={p.x} y={p.y + 8} fontSize="6" textAnchor="middle" className="f-typewriter" fill="#d24a44">ATTACHED</text>
                    <text x={p.x} y={p.y + 22} fontSize="7" textAnchor="middle" className="f-typewriter" fill="#d24a44">{card.echelon === 'corps' ? 'CORPS' : 'DIV'}</text>
                  </g>
                );
              })}

              {placed.map(p => <DeployedAssetVis key={p.id} asset={p} onRemove={() => removePlaced(p.id)} />)}
              {selectedCardRef.current && (
                <text x={MAP_W / 2} y={MAP_H - 12} textAnchor="middle" fontSize="11" fill="#d9a52f" className="f-typewriter">
                  Click in your AOR to place {CARDS[selectedCardRef.current].name}
                </text>
              )}
            </svg>
            </div>
          </div>

          <div className="space-y-3">
            {planning && (
              <div className="border-2 border-[#243d52] p-3" style={{ background: '#102234' }}>
                <div className="flex items-center justify-between">
                  <div className="f-display text-lg" style={{ color: '#d9a52f' }}>DEFENDED ASSET LIST</div>
                  <button onClick={() => setShowCoverage(v => !v)} className="f-mono text-[10px]" style={{ color: showCoverage ? '#5aa0e6' : '#5d6b7a', border: '1px solid #243d52', padding: '2px 7px', borderRadius: '2px', background: 'transparent', cursor: 'pointer' }}>{showCoverage ? 'RINGS ON' : 'RINGS OFF'}</button>
                </div>
                <div className="text-[11px] f-mono mb-2" style={{ color: '#5d6b7a' }}>Coverage of priority assets by your current laydown.</div>
                {(() => {
                  const cnts = activeNodes(SCENARIO).map(n => _cover(n).length);
                  const gaps = cnts.filter(x => x === 0).length, thin = cnts.filter(x => x === 1).length, lay = cnts.filter(x => x >= 2).length;
                  return (
                    <div className="f-mono text-[11px] mb-2 flex gap-3">
                      <span style={{ color: '#2f80d6' }}>{lay} layered</span>
                      <span style={{ color: '#d9a52f' }}>{thin} thin</span>
                      <span style={{ color: gaps > 0 ? '#d24a44' : '#5d6b7a' }}>{gaps} gap{gaps === 1 ? '' : 's'}</span>
                    </div>
                  );
                })()}
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {activeNodes(SCENARIO).slice().sort((x, y) => (y.value || 0) - (x.value || 0)).map(n => {
                    const cov = _cover(n), cnt = cov.length;
                    const st = cnt === 0 ? { t: 'GAP', c: '#d24a44' } : cnt === 1 ? { t: 'THIN', c: '#d9a52f' } : { t: 'LAYERED', c: '#2f80d6' };
                    const cls = new Set(); cov.forEach(a => (CARDS[a.cardId].engageDefault || []).forEach(k => cls.add(k)));
                    const Badge = (lbl, key) => (<span style={{ color: cls.has(key) ? '#5aa0e6' : '#39424d', border: '1px solid', borderColor: cls.has(key) ? '#243d52' : '#16293c', padding: '0 4px', borderRadius: '2px', fontSize: '9px', marginRight: '3px' }}>{lbl}</span>);
                    return (
                      <div key={n.id} style={{ borderLeft: '3px solid ' + st.c, background: '#16293c', padding: '5px 8px', borderRadius: '2px' }}>
                        <div className="flex items-center justify-between">
                          <span className="f-mono text-[11px]" style={{ color: '#eef2f6' }}>{'★'.repeat(n.value || 1)} {n.name}</span>
                          <span className="f-mono text-[10px]" style={{ color: st.c, fontWeight: 'bold' }}>{st.t}{cnt > 0 ? ' ·' + cnt : ''}</span>
                        </div>
                        <div className="mt-1 f-mono">{Badge('OWA', 'owa')}{Badge('CRU', 'cruise')}{Badge('BAL', 'ballistic')}{Badge('GLD', 'glide')}{Badge('TAC', 'tactical')}{Badge('REC', 'recon')}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="border-2 border-[#243d52] p-3" style={{ background: '#102234' }}>
              <div className="f-display text-lg" style={{ color: '#d9a52f' }}>INVENTORY</div>
              <div className="text-[11px] f-mono mb-2" style={{ color: '#5d6b7a' }}>
                Brigade-organic. Patriot/IRIS-T attached from CORPS/DIV (shown on map, not yours to place).
              </div>
              <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
                {SCENARIO.inventory.filter(inv => (SCENARIO.custom || !CARDS[inv.card].attached)).map(inv => {
                  const card = CARDS[inv.card];
                  const remaining = inv.count - placedCount(inv.card);
                  const isSelected = selectedCardRef.current === inv.card;
                  const isExhausted = remaining === 0;
                  return (
                    <div key={inv.card}
                      onClick={() => { if (isExhausted) return; selectedCardRef.current = isSelected ? null : inv.card; fu(); }}
                      onMouseEnter={() => { hoveredCardRef.current = inv.card; fu(); }}
                      onMouseLeave={() => { hoveredCardRef.current = null; fu(); }}
                      className={`border-2 p-2 cursor-pointer ${isSelected ? 'bg-[#2f80d6] text-[#102234]' : isExhausted ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#2f80d6]/10'}`}
                      style={{ borderColor: card.color }}>
                      <div className="flex items-center gap-2">
                        <span className={`nation-flag flag-${card.nation}`} />
                        <div className="f-display text-sm" style={{ color: isSelected ? '#d9a52f' : card.color }}>{card.tag}</div>
                        <div className="flex-1 f-cond text-[11px] font-bold leading-tight">{card.name}</div>
                        <div className="f-mono text-xs">{remaining}/{inv.count}{inv.required > 0 && remaining > 0 && <span className="ml-1" style={{ color: '#d9a52f' }}>!</span>}</div>
                      </div>
                      <div className="text-[10px] f-mono mt-1 opacity-70">RNG {card.range} / AMMO {card.ammoMax} / HP {card.hp}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {showCard && (
              <div className="border-2 border-[#243d52] p-3" style={{ background: '#102234', borderColor: showCard.color }}>
                <div className="text-[10px] f-typewriter tracking-widest" style={{ color: '#5d6b7a' }}>ASSET DOSSIER</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`nation-flag flag-${showCard.nation}`} />
                  <div className="f-display text-base leading-tight" style={{ color: showCard.color }}>{showCard.name}</div>
                </div>
                <div className="text-[11px] f-mono mt-2 leading-tight">
                  {showCard.weapon && <>Weapon: <span style={{ color: 'var(--mil-friend)' }}>{showCard.weapon}</span><br/></>}
                  Range: {showCard.range}<br/>
                  Ammo: {showCard.ammoMax}<br/>
                  HP: {showCard.hp} (repair: {(showCard.repairTime/1000).toFixed(0)}s real)<br/>
                  Deploy: {(showCard.deployTime/1000).toFixed(0)}s real<br/>
                  Firing delay: {(showCard.firingDelay/1000).toFixed(1)}s real
                </div>
                <div className="border-t border-[#243d52]/30 mt-2 pt-2">
                  <div className="text-[11px] f-mono mb-1"><strong>Pₖ vs threat class:</strong></div>
                  <div className="grid grid-cols-3 gap-x-3 f-mono text-[10px]">
                    {Object.entries((CARDS[showCardId] && CARDS[showCardId].pk) || PK[mapAssetType(showCardId)] || {}).map(([cls, p]) => (
                      <div key={cls}>{cls}: <strong>{(p*100).toFixed(0)}%</strong></div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Drone loadout selector, for placed INT crews */}
            {placed.filter(p => CARDS[p.cardId].isInterceptor).length > 0 && (
              <div className="border-2 border-[#243d52] p-3 mt-3" style={{ background: '#102234' }}>
                <div className="text-[10px] f-typewriter tracking-widest mb-2" style={{ color: '#d9a52f' }}>
                  FPV INTERCEPTOR LOADOUTS
                </div>
                <div className="text-[10px] f-mono mb-2" style={{ color: '#93a1b0' }}>
                  Each crew selects ammunition mix per mission. PK and capacity vary.
                </div>
                {placed.filter(p => CARDS[p.cardId].isInterceptor).map(p => {
                  const c = CARDS[p.cardId];
                  const currentLoadout = p.loadout || DEFAULT_LOADOUT;
                  return (
                    <div key={p.id} className="border-t border-[#243d52]/30 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
                      <div className="f-display text-xs mb-1" style={{ color: c.color }}>
                        {callsign(p.cardId)}, {c.name}
                      </div>
                      <div className="grid grid-cols-1 gap-1">
                        {Object.entries(DRONE_LOADOUTS).map(([id, ld]) => {
                          const isCurrent = currentLoadout === id;
                          return (
                            <button key={id}
                              onClick={() => setLoadout(p.id, id)}
                              className="text-left p-1.5 border f-mono text-[10px] flex items-center gap-2"
                              style={{
                                background: isCurrent ? ld.color : '#102234',
                                color: isCurrent ? '#102234' : '#dde3ea',
                                borderColor: ld.color,
                              }}>
                              <span style={{ fontSize: '13px' }}>{ld.icon}</span>
                              <span className="flex-1">
                                <strong>{ld.name}</strong> · {ld.count}× drones · spd {ld.droneSpeed} · fuel {ld.fuelMin}m
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="text-[9px] f-mono mt-1 italic" style={{ color: '#5d6b7a' }}>
                        {DRONE_LOADOUTS[currentLoadout]?.desc}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="cls-banner mt-3">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
    </div>
  );
}

// ============================================================================
// MAP LAYERS
// ============================================================================
function TopoFieldMap() {
  // Dark topographic field map (brigade AOR), rivers, forests, hills, MSR, villages.
  return (
    <g>
      <defs>
        <linearGradient id="cop-bg-f" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0a1626" />
          <stop offset="100%" stopColor="#0a1626" />
        </linearGradient>
        <pattern id="mgrs-grid-f" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#16293c" strokeWidth="0.6" opacity="0.7" />
        </pattern>
        <pattern id="forest-f" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="2.5" fill="#243a26" opacity="0.7" />
          <circle cx="2" cy="2" r="1.5" fill="#243a26" opacity="0.5" />
        </pattern>
      </defs>

      <rect width={MAP_W} height={MAP_H} fill="url(#cop-bg-f)" />

      {/* Rivers */}
      <path d={TERRAIN.river} fill="none" stroke="#28465e" strokeWidth="6" opacity="0.6" />
      <path d={TERRAIN.river} fill="none" stroke="#3a6486" strokeWidth="1.2" opacity="0.4" />

      {/* Forests */}
      {TERRAIN.forests.map((f, i) => (
        <g key={i}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="url(#forest-f)" />
          <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="none" stroke="#243a26" strokeWidth="0.5" opacity="0.6" strokeDasharray="2,2" />
        </g>
      ))}

      {/* Hills, contour rings */}
      {TERRAIN.hills.map((h, i) => (
        <g key={i}>
          <circle cx={h.x} cy={h.y} r={h.r} fill="none" stroke="#34516b" strokeWidth="0.6" opacity="0.6" />
          <circle cx={h.x} cy={h.y} r={h.r * 0.6} fill="none" stroke="#34516b" strokeWidth="0.6" opacity="0.7" />
        </g>
      ))}

      {/* Grid */}
      <rect width={MAP_W} height={MAP_H} fill="url(#mgrs-grid-f)" />

      {/* Roads */}
      <path d={TERRAIN.msr} fill="none" stroke="#243d52" strokeWidth="3" opacity="0.7" />
      <path d={TERRAIN.msr} fill="none" stroke="#44617b" strokeWidth="1" opacity="0.5" strokeDasharray="6,3" />
      <path d={TERRAIN.northRoad} fill="none" stroke="#34516b" strokeWidth="2" opacity="0.5" />
      <path d={TERRAIN.southRoad} fill="none" stroke="#34516b" strokeWidth="2" opacity="0.5" />
      <path d={TERRAIN.conn1} fill="none" stroke="#34516b" strokeWidth="1.4" opacity="0.4" />
      <path d={TERRAIN.conn2} fill="none" stroke="#34516b" strokeWidth="1.4" opacity="0.4" />
      <text x={52} y={284} fontSize="9" fill="#5d6b7a" className="f-typewriter">MSR</text>

      {/* Villages, urban blocks */}
      {TERRAIN.villages.map(v => {
        const s = v.size === 'md' ? 14 : 9;
        return (
          <g key={v.name}>
            <rect x={v.x - s/2} y={v.y - s/2} width={s} height={s} fill="#1c2530" stroke="#243d52" strokeWidth="0.8" />
            <text x={v.x + s/2 + 3} y={v.y + 2} fontSize="9" fill="#93a1b0" className="f-typewriter">{v.name}</text>
          </g>
        );
      })}

      {/* Coordinate labels */}
      <text x={6} y={14} fontSize="9" fill="#243d52" className="f-typewriter" opacity="0.7">36ULH 12</text>
      <text x={MAP_W - 70} y={14} fontSize="9" fill="#243d52" className="f-typewriter" opacity="0.7">36ULH 42</text>

      {/* AOR header */}
      <g>
        <rect x={MAP_W / 2 - 110} y={6} width={220} height={20} fill="rgba(22,27,34,0.92)" stroke="#243d52" strokeWidth="0.5" />
        <text x={MAP_W / 2} y={20} textAnchor="middle" fontSize="11" fill="#dde3ea" className="f-typewriter" style={{ letterSpacing: '0.12em' }}>BRIGADE AOR · EAST OF BEREZH</text>
      </g>

      {/* North arrow */}
      <g transform="translate(40, 70)">
        <polygon points="0,-12 5,8 0,4 -5,8" fill="#93a1b0" />
        <text x="0" y="22" textAnchor="middle" fontSize="9" fill="#93a1b0" className="f-typewriter" style={{ letterSpacing: '0.15em' }}>N</text>
      </g>

      {/* Scale bar */}
      <g transform={`translate(${MAP_W - 135}, ${MAP_H - 24})`}>
        <line x1="0" y1="0" x2="100" y2="0" stroke="#93a1b0" strokeWidth="2" />
        <line x1="0" y1="-3" x2="0" y2="3" stroke="#93a1b0" strokeWidth="1.5" />
        <line x1="100" y1="-3" x2="100" y2="3" stroke="#93a1b0" strokeWidth="1.5" />
        <text x="50" y="-6" fontSize="8" fill="#93a1b0" className="f-typewriter" textAnchor="middle">5 km</text>
      </g>
    </g>
  );
}

function GeoGridOverlay() {
  return (
    <g>
      <rect width={MAP_W} height={MAP_H} fill="#0a1626" opacity="0.16" />
      {Array.from({length:8}).map((_,i)=><line key={'ggx'+i} x1={(i+1)*100} y1={0} x2={(i+1)*100} y2={MAP_H} stroke="#93a1b0" strokeWidth="0.4" opacity="0.15" />)}
      {Array.from({length:5}).map((_,i)=><line key={'ggy'+i} x1={0} y1={(i+1)*100} x2={MAP_W} y2={(i+1)*100} stroke="#93a1b0" strokeWidth="0.4" opacity="0.15" />)}
    </g>
  );
}
function TopographyLayer() {
  if (SCENARIO && SCENARIO.geo) return <GeoGridOverlay />;
  // Brigade-level scenarios use the original rural/topographic field map.
  if (!isCapital(SCENARIO)) return <TopoFieldMap />;

  // AURELIA, fictional allied capital. Operational map = darkened satellite
  // imagery (Brussels-based geography) + command overlay. City centre ~ (372,286).
  const CX = 372, CY = 286;

  const corridors = [
    { d: `M 884 70 Q 650 150 ${CX} ${CY}`, color: '#e0c45a', w: 2.2, dash: '' },
    { d: `M 898 205 Q 680 245 ${CX} ${CY}`, color: '#e0c45a', w: 2.2, dash: '' },
    { d: `M 888 470 Q 660 400 ${CX} ${CY}`, color: '#e0c45a', w: 2.2, dash: '' },
    { d: `M 884 115 Q 640 195 ${CX} ${CY}`, color: '#93a1b0', w: 1.5, dash: '5,4' },
    { d: `M 898 360 Q 670 330 ${CX} ${CY}`, color: '#93a1b0', w: 1.5, dash: '5,4' },
    { d: `M 868 540 Q 700 480 600 400 Q 480 330 ${CX} ${CY}`, color: '#e0975a', w: 2.2, dash: '' },
    { d: `M 898 292 Q 720 300 600 295 Q 470 290 ${CX} ${CY}`, color: '#e0975a', w: 2.2, dash: '' },
    { d: `M 898 250 L ${CX} ${CY}`, color: '#e06b6b', w: 2.6, dash: '' },
    { d: `M 868 150 Q 640 120 ${CX} ${CY}`, color: '#5aa0e6', w: 1.4, dash: '3,5' },
  ];

  return (
    <g>
      <defs>
        <radialGradient id="city-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2f80d6" stopOpacity="0.30" />
          <stop offset="55%" stopColor="#2f80d6" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#2f80d6" stopOpacity="0" />
        </radialGradient>
        <pattern id="mgrs-grid" width="90" height="90" patternUnits="userSpaceOnUse">
          <path d="M 90 0 L 0 0 0 90" fill="none" stroke="#44617b" strokeWidth="0.5" opacity="0.25" />
        </pattern>
      </defs>

      {/* Satellite base */}
      <image href={AURELIA_SAT} x="0" y="0" width={MAP_W} height={MAP_H}
        preserveAspectRatio="xMidYMid slice" />
      {/* Dark tactical overlay so symbology reads on top */}
      <rect width={MAP_W} height={MAP_H} fill="#0a1626" opacity="0.30" />
      {/* Subtle UTM grid */}
      <rect width={MAP_W} height={MAP_H} fill="url(#mgrs-grid)" />

      {/* City-centre defended zone, the Pentagon */}
      <circle cx={CX} cy={CY} r="125" fill="url(#city-glow)" />
      <polygon
        points={`${CX-2},${CY-46} ${CX+44},${CY-12} ${CX+27},${CY+40} ${CX-30},${CY+40} ${CX-46},${CY-12}`}
        fill="rgba(47,128,214,0.10)" stroke="#5aa0e6" strokeWidth="1.8" opacity="0.9" />
      <text x={CX} y={CY - 54} textAnchor="middle" fontSize="11" fill="#dde3ea" className="f-display" style={{ letterSpacing: '0.12em' }}>AURELIA CENTRE</text>

      {/* Coordinate labels */}
      <text x={6} y={14} fontSize="9" fill="#93a1b0" className="f-typewriter" opacity="0.8">31UDS 78</text>
      <text x={MAP_W - 70} y={14} fontSize="9" fill="#93a1b0" className="f-typewriter" opacity="0.8">31UDS 12</text>

      {/* AOR header */}
      <g>
        <rect x={MAP_W / 2 - 130} y={6} width={260} height={20} fill="rgba(10,14,19,0.85)" stroke="#243d52" strokeWidth="0.5" />
        <text x={MAP_W / 2} y={20} textAnchor="middle" fontSize="11" fill="#dde3ea" className="f-typewriter" style={{ letterSpacing: '0.12em' }}>AOR · AURELIA CAPITAL AD SECTOR</text>
      </g>

      {/* North arrow */}
      <g transform="translate(40, 70)">
        <polygon points="0,-12 5,8 0,4 -5,8" fill="#eef2f6" />
        <text x="0" y="22" textAnchor="middle" fontSize="9" fill="#eef2f6" className="f-typewriter" style={{ letterSpacing: '0.15em' }}>N</text>
      </g>

      {/* Scale bar */}
      <g transform={`translate(${MAP_W - 135}, ${MAP_H - 24})`}>
        <line x1="0" y1="0" x2="100" y2="0" stroke="#eef2f6" strokeWidth="2" />
        <line x1="0" y1="-3" x2="0" y2="3" stroke="#eef2f6" strokeWidth="1.5" />
        <line x1="100" y1="-3" x2="100" y2="3" stroke="#eef2f6" strokeWidth="1.5" />
        <text x="50" y="-6" fontSize="8" fill="#eef2f6" className="f-typewriter" textAnchor="middle">5 km</text>
      </g>
    </g>
  );
}

function FriendlyAreaOverlay() {
  return (
    <g>
      <rect
        x={FRIENDLY_BOUND.xMin} y={FRIENDLY_BOUND.yMin}
        width={FRIENDLY_BOUND.xMax - FRIENDLY_BOUND.xMin}
        height={FRIENDLY_BOUND.yMax - FRIENDLY_BOUND.yMin}
        fill="rgba(47,128,214,0.04)"
        stroke="#2f80d6" strokeWidth="1" strokeDasharray="4,3" opacity="0.5"
      />
      <text x={FRIENDLY_BOUND.xMin + 6} y={FRIENDLY_BOUND.yMin + 14} fill="#2f80d6" className="f-typewriter" fontSize="10" opacity="0.7">
        BLUE AOR · DEPLOYMENT
      </text>
    </g>
  );
}

function FLOTAndPhaseLines() {
  // Capital scenario: no front line, show threat-approach axes instead of FLOT.
  if (isCapital(SCENARIO)) {
    return (
      <g>
        {/* Threat approach corridors from NE / E / SE */}
        <text x={MAP_W - 150} y={45} className="f-typewriter" fontSize="10" fill="#d24a44" opacity="0.9" letterSpacing="0.15em">THREAT AXES</text>
        {[{x: 880, y: 110, label: 'NE'}, {x: 890, y: 290, label: 'E'}, {x: 880, y: 470, label: 'SE'}].map((p, i) => (
          <g key={i}>
            <text x={p.x} y={p.y} fill="#d24a44" className="f-typewriter" fontSize="11" fontWeight="700" textAnchor="end" opacity="0.85">◀ {p.label}</text>
          </g>
        ))}
        {/* Bearing markers at spawn vectors */}
        {Object.entries(VECTORS).map(([k, v]) => (
          <text key={k} x={v.x - 4} y={v.y + 3} fill="#d24a44" className="f-typewriter" fontSize="11" fontWeight="600" textAnchor="end" opacity="0.6">{k}</text>
        ))}
      </g>
    );
  }
  return (
    <g>
      {/* FLOT line - dashed orange/red boundary */}
      <path d={FLOT_PATH} fill="none" stroke="#d24a44" strokeWidth="2" opacity="0.85" />
      <path d={FLOT_PATH} fill="none" stroke="#d24a44" strokeWidth="0.6" strokeDasharray="3,3" transform="translate(3,0)" opacity="0.5" />
      <text x={MAP_W - 130} y={45} className="f-typewriter" fontSize="10" fill="#d24a44" opacity="0.9" letterSpacing="0.15em">FLOT</text>
      <text x={780} y={100} className="f-display" fontSize="13" fill="#d24a44" letterSpacing="0.1em">RED FORCE</text>
      <text x={780} y={114} className="f-typewriter" fontSize="9" fill="#d24a44" opacity="0.7">contesting MSR</text>

      {/* Adversary EW/SAM positions - hostile diamonds */}
      {[{x: 820, y: 200}, {x: 830, y: 320}, {x: 850, y: 430}].map((p, i) => (
        <g key={i}>
          <rect x={p.x - 14} y={p.y - 9} width="28" height="18"
            fill="rgba(210,74,68,0.20)" stroke="#d24a44" strokeWidth="1.5" />
          <line x1={p.x - 10} y1={p.y - 5} x2={p.x + 10} y2={p.y + 5} stroke="#d24a44" strokeWidth="1.2" />
          <line x1={p.x - 10} y1={p.y + 5} x2={p.x + 10} y2={p.y - 5} stroke="#d24a44" strokeWidth="1.2" />
        </g>
      ))}
      {/* Bearing markers */}
      {Object.entries(VECTORS).map(([k, v]) => (
        <text key={k} x={v.x - 4} y={v.y + 3} fill="#d24a44" className="f-typewriter" fontSize="11" fontWeight="600" textAnchor="end" opacity="0.85">{k}</text>
      ))}
    </g>
  );
}

function UnitsLayer() {
  // Capital defence has no deployed brigade battle order, hide unit symbols.
  if (isCapital(SCENARIO)) return null;
  // Render brigade battle order as NATO-style unit symbols, scaled by echelon
  const renderSymbol = (u) => {
    // Size by echelon, bde > bn > coy > plt > sec
    const dim = {
      bde: { w: 26, h: 16, fontSize: 7, labelFontSize: 7, sizeFontSize: 7 },
      bn:  { w: 22, h: 13, fontSize: 6, labelFontSize: 6.5, sizeFontSize: 6 },
      coy: { w: 16, h: 11, fontSize: 6, labelFontSize: 5.5, sizeFontSize: 5.5 },
      plt: { w: 11, h: 8,  fontSize: 5, labelFontSize: 5, sizeFontSize: 5 },
      sec: { w: 8,  h: 6,  fontSize: 4.5, labelFontSize: 4.5, sizeFontSize: 4.5 },
    }[u.kind] || { w: 14, h: 10, fontSize: 5, labelFontSize: 5, sizeFontSize: 5 };

    const w = dim.w, h = dim.h;
    const x = u.x - w/2, y = u.y - h/2;
    const symStroke = '#2f80d6'; // NATO friendly blue
    const symFill = 'rgba(47,128,214,0.12)';

    // Type icon inside the rectangle, scale strokes/dots to symbol size
    const ix = u.x, iy = u.y;
    const typeIcons = {
      inf: <g>
        <line x1={x + 2} y1={y + 2} x2={x + w - 2} y2={y + h - 2} stroke={symStroke} strokeWidth={u.kind === 'plt' ? 0.7 : 0.9} />
        <line x1={x + w - 2} y1={y + 2} x2={x + 2} y2={y + h - 2} stroke={symStroke} strokeWidth={u.kind === 'plt' ? 0.7 : 0.9} />
      </g>,
      arm: <ellipse cx={ix} cy={iy} rx={w/2 - 3} ry={h/2 - 2} fill="none" stroke={symStroke} strokeWidth={u.kind === 'plt' ? 0.9 : 1.2} />,
      arty: <circle cx={ix} cy={iy} r={u.kind === 'sec' ? 1.1 : (u.kind === 'plt' ? 1.4 : 2)} fill={symStroke} />,
      mortar: <g>
        <line x1={ix} y1={y + 2} x2={ix} y2={y + h - 2} stroke={symStroke} strokeWidth="1" />
        <line x1={x + 3} y1={iy} x2={x + w - 3} y2={iy} stroke={symStroke} strokeWidth="1" />
      </g>,
      recon: <g>
        <line x1={x + 2} y1={y + h - 2} x2={ix} y2={y + 2} stroke={symStroke} strokeWidth="0.9" />
        <line x1={ix} y1={y + 2} x2={x + w - 2} y2={y + h - 2} stroke={symStroke} strokeWidth="0.9" />
      </g>,
      engr: <rect x={ix - (u.kind === 'plt' ? 2.5 : 4)} y={iy - 2} width={u.kind === 'plt' ? 5 : 8} height="4" fill="none" stroke={symStroke} strokeWidth="0.9" />,
      log: <text x={ix} y={iy + 3} fontSize={u.kind === 'plt' ? 5 : 7} textAnchor="middle" fill={symStroke} className="f-typewriter">L</text>,
      cp: <g>
        <line x1={ix} y1={y + 2} x2={ix} y2={y + h - 2} stroke={symStroke} strokeWidth="1.2" />
        <line x1={x + 3} y1={y + 3} x2={ix} y2={iy} stroke={symStroke} strokeWidth="0.9" />
      </g>,
      med: <g>
        <line x1={ix} y1={y + 3} x2={ix} y2={y + h - 3} stroke={symStroke} strokeWidth="1.2" />
        <line x1={x + 4} y1={iy} x2={x + w - 4} y2={iy} stroke={symStroke} strokeWidth="1.2" />
      </g>,
      at: <g>
        {/* Antitank: "AT" inside rectangle */}
        <text x={ix} y={iy + (u.kind === 'plt' ? 2 : 3)} fontSize={u.kind === 'plt' ? 5 : 7} textAnchor="middle" fill={symStroke} className="f-typewriter" fontWeight="bold">AT</text>
      </g>,
    };

    // Hide full label for very small units to avoid clutter
    const showLabel = u.kind !== 'plt' && u.kind !== 'sec';

    return (
      <g key={u.id} style={{ pointerEvents: 'none' }} opacity={u.kind === 'plt' || u.kind === 'sec' ? 0.7 : 0.88}>
        {/* Size indicator above (smaller for plt/sec) */}
        <text x={u.x} y={y - 1.5} fontSize={dim.sizeFontSize} fill={symStroke} textAnchor="middle" className="f-typewriter" letterSpacing={u.size === '•••' ? 0 : 1}>
          {u.size}
        </text>
        {/* Rectangle */}
        <rect x={x} y={y} width={w} height={h} fill={symFill} stroke={symStroke} strokeWidth={u.kind === 'plt' || u.kind === 'sec' ? 0.7 : 1} />
        {/* Type icon */}
        {typeIcons[u.type] || null}
        {/* Designation left of symbol (but only for coy and above to avoid clutter) */}
        {u.kind !== 'plt' && u.kind !== 'sec' && (
          <text x={u.x - w/2 - 2} y={u.y + 3} fontSize={dim.fontSize} fill={symStroke} textAnchor="end" className="f-typewriter">
            {u.name}
          </text>
        )}
        {/* Plt/sec name above the size indicator */}
        {(u.kind === 'plt' || u.kind === 'sec') && (
          <text x={u.x + w/2 + 1} y={u.y + 2} fontSize={4.5} fill={symStroke} textAnchor="start" className="f-typewriter">
            {u.name}
          </text>
        )}
        {/* Full label below, only for company+ */}
        {showLabel && (
          <text x={u.x} y={u.y + h/2 + 8} fontSize={dim.labelFontSize} fill="#93a1b0" textAnchor="middle" className="f-typewriter" opacity="0.7">
            {u.label}
          </text>
        )}
      </g>
    );
  };

  return (
    <g>
      {/* Battalion AOR boundaries */}
      {BN_BOUNDARIES.map((b, i) => (
        <g key={'bnb' + i} opacity="0.5">
          <line x1={FRIENDLY_BOUND.xMin + 30} y1={b.y} x2={650} y2={b.y}
            stroke="#2f80d6" strokeWidth="0.7" strokeDasharray="6,4,2,4" opacity="0.5" />
          <text x={650} y={b.y - 3} fontSize="6.5" fill="#2f80d6" textAnchor="end" className="f-typewriter" opacity="0.7">
            {b.label}
          </text>
        </g>
      ))}
      {UNITS.map(renderSymbol)}
    </g>
  );
}


function DefendedNodes({ nodes }) {
  return (
    <g>
      {nodes.map(n => {
        const dead = n.hp === 0;
        const isForward = n.kind === 'forward';
        const stroke = isForward ? '#b8893a' : '#2f80d6';
        const fill = isForward ? '#16293c' : '#102234';
        return (
          <g key={n.id} opacity={dead ? 0.3 : 1}>
            {isForward ? (
              <polygon
                points={`${n.x},${n.y - 12} ${n.x + 14},${n.y + 8} ${n.x - 14},${n.y + 8}`}
                fill={fill} stroke={stroke} strokeWidth="2"
              />
            ) : (
              <rect x={n.x - 16} y={n.y - 11} width="32" height="22" fill={fill} stroke={stroke} strokeWidth="2" />
            )}
            <text x={n.x} y={n.y + (isForward ? 4 : -1)} fill={stroke} fontSize="8" textAnchor="middle" className="f-typewriter">{n.sym}</text>
            {!isForward && <text x={n.x} y={n.y + 9} fill={stroke} fontSize="8" textAnchor="middle" className="f-typewriter">{n.glyph}</text>}
            <text x={n.x} y={n.y + 26} fill="#dde3ea" fontSize="9" textAnchor="middle" className="f-cond" fontWeight="700">{n.name}</text>
            {n.maxHp && (
              <g transform={`translate(${n.x - n.maxHp * 4}, ${n.y - (isForward ? 22 : 18)})`}>
                {Array.from({ length: n.maxHp }).map((_, i) => (
                  <rect key={i} x={i * 8} y="0" width="6" height="3" fill={i < n.hp ? stroke : '#102234'} stroke={stroke} strokeWidth="0.5" />
                ))}
              </g>
            )}
            {dead && <line x1={n.x - 18} y1={n.y - 14} x2={n.x + 18} y2={n.y + 14} stroke="#d9a52f" strokeWidth="2.5" />}
          </g>
        );
      })}
    </g>
  );
}

function DeployedAssetVis({ asset, onRemove }) {
  const c = CARDS[asset.cardId];
  return (
    <g>
      <circle cx={asset.x} cy={asset.y} r={c.range}
        fill={c.color === '#d9a52f' ? 'rgba(210,74,68,0.05)' : 'rgba(33,62,92,0.04)'}
        stroke={c.color} strokeWidth="0.7" strokeDasharray="3,3" />
      <g onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ cursor: 'pointer' }}>
        <rect x={asset.x - 18} y={asset.y - 11} width="36" height="22" rx="2" fill="#102234" stroke={c.color} strokeWidth="2" />
        <text x={asset.x} y={asset.y - 2} fontSize="9" textAnchor="middle" className="f-display" fill={c.color}>{c.tag}</text>
        <text x={asset.x} y={asset.y + 8} fontSize="7" textAnchor="middle" className="f-typewriter" fill={c.color}>{c.nation}</text>
      </g>
    </g>
  );
}

// ============================================================================
// RUN
// ============================================================================
function RunScreen({ g, selectedAssetId, setSelectedAssetId, relocatingAsset, setMode, beginRepair, beginRelocate, completeRelocate, cancelRelocate, setFacing, toggleEngageRule, requestFireMission, requestReload, setROE, instructorMode, paused, togglePause, simSpeed, setSimSpeed, instructorInject, instructorDamage, instructorNotes, addInstructorNote, audioOn, setAudioOn, onEnd, gameMode, onDeployTeam, placingTeam, placeTeamAt, cancelPlaceTeam, onAutoEngage, dismissAlert }) {
  const [menuPos, setMenuPos] = useState(null);
  const [fireMissionTargeting, setFireMissionTargeting] = useState(false);
  const onAssetClick = (a, evt) => {
    if (relocatingAsset || fireMissionTargeting || placingTeam) return;
    if (!a.alive) return;
    const rect = evt.target.closest('svg').getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    setSelectedAssetId(a.id);
    setMenuPos({ x: Math.min(x + 10, rect.width - 240), y: Math.min(y, rect.height - 280) });
  };
  const onMapClick = (e) => {
    if (placingTeam) {
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const c = pt.matrixTransform(svg.getScreenCTM().inverse());
      placeTeamAt(c.x, c.y);
      return;
    }
    if (relocatingAsset) {
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const c = pt.matrixTransform(svg.getScreenCTM().inverse());
      completeRelocate(c.x, c.y);
      return;
    }
    if (fireMissionTargeting) {
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const c = pt.matrixTransform(svg.getScreenCTM().inverse());
      requestFireMission(c.x, c.y);
      setFireMissionTargeting(false);
      return;
    }
    setSelectedAssetId(null);
    setMenuPos(null);
  };
  const closeMenu = () => { setSelectedAssetId(null); setMenuPos(null); };
  const selectedAsset = g.assets.find(a => a.id === selectedAssetId);
  const phase = PHASES[g.phaseIdx];

  return (
    <div className="min-h-screen riso-paper p-2">
      <div className="max-w-[1400px] mx-auto">
        <RunHeader g={g} phase={phase} audioOn={audioOn} setAudioOn={setAudioOn} onEnd={onEnd} gameMode={gameMode} onDeployTeam={onDeployTeam} simSpeed={simSpeed} setSimSpeed={setSimSpeed} />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-2 mt-2 items-start">
          <div className="relative">
            <BattleMap g={g} onAssetClick={onAssetClick} onMapClick={onMapClick}
              relocatingAsset={relocatingAsset} fireMissionTargeting={fireMissionTargeting} placingTeam={placingTeam} />
            {placingTeam && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 f-display tracking-widest"
                style={{ background: '#3c6e3c', color: '#fff', fontSize: '14px' }}>
                CLICK MAP TO POSITION DRONE TEAM ({REINFORCE_MAX - (g.reinforcementsUsed || 0)} LEFT), <button onClick={cancelPlaceTeam} style={{ marginLeft: 8, textDecoration: 'underline', background: 'transparent', border: 0, color: '#fff', cursor: 'pointer' }}>CANCEL</button>
              </div>
            )}
            {selectedAsset && menuPos && (
              <AssetMenu asset={selectedAsset} pos={menuPos}
                onSetMode={setMode} onRepair={beginRepair} onRelocate={beginRelocate}
                onSetFacing={setFacing} onToggleEngageRule={toggleEngageRule}
                onRequestReload={requestReload}
                onClose={closeMenu} />
            )}
            {fireMissionTargeting && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 f-display tracking-widest"
                style={{ background: '#d24a44', color: '#102234', fontSize: '14px' }}>
                CLICK TARGET FOR CAS / FIRE MISSION, <button onClick={() => setFireMissionTargeting(false)} style={{ marginLeft: 12, textDecoration: 'underline', background: 'transparent', border: 0, color: '#102234', cursor: 'pointer' }}>CANCEL</button>
              </div>
            )}
            {/* Command bar, horizontal, in normal flow directly under the map */}
            <div className="mt-2 border-2 border-[#243d52] flex items-center gap-2 px-2.5 py-2 flex-wrap"
              style={{ background: '#102234' }}>
              <button
                onClick={() => onAutoEngage && onAutoEngage()}
                className="f-display text-[12px] px-3 h-9 border-2 flex items-center gap-1"
                style={{ background: '#3c6e3c', color: '#eafaea', borderColor: '#2f80d6', letterSpacing: '0.04em', borderRadius: '4px' }}
                title="All assets to ENGAGE, weapons free. You can still widen target classes per asset afterwards.">
                ⚡ AUTO-ENGAGE
              </button>
              {gameMode === 'demo' && (
                <button
                  onClick={() => onDeployTeam && onDeployTeam()}
                  disabled={(g.reinforcementsUsed || 0) >= REINFORCE_MAX}
                  className="f-display text-[12px] px-3 h-9 border-2 flex items-center gap-1"
                  style={{
                    background: (g.reinforcementsUsed || 0) >= REINFORCE_MAX ? '#102234' : '#1d4f7a',
                    color: (g.reinforcementsUsed || 0) >= REINFORCE_MAX ? '#5d6b7a' : '#dcebf7',
                    borderColor: '#2f80d6', letterSpacing: '0.04em', borderRadius: '4px',
                  }}
                  title="Select and place a drone-interceptor team on the map">
                  ⊕ DRONE TEAM ({REINFORCE_MAX - (g.reinforcementsUsed || 0)})
                </button>
              )}
              {!SCENARIO.custom && (
              <button
                onClick={() => setFireMissionTargeting(true)}
                disabled={g.fireMission.available <= 0 || g.fireMission.active || g.gameTime < g.fireMission.cooldownUntil}
                className="f-display text-[12px] px-3 h-9 border-2 flex items-center gap-1"
                style={{ borderRadius: '4px',
                  background: g.fireMission.available > 0 && !g.fireMission.active ? '#7a3a36' : '#1e3349',
                  color: g.fireMission.available > 0 && !g.fireMission.active ? '#e8d6d4' : '#5d6b7a',
                  borderColor: '#7a3a36' }}>
                FIRE MISSION ({g.fireMission.available}){g.fireMission.active ? ' · FLIGHT' : (g.gameTime < g.fireMission.cooldownUntil ? ' · CD' : '')}
              </button>
              )}
              <div style={{ width: '1px', height: '26px', background: '#243d52', margin: '0 2px' }} />
              <span className="f-typewriter text-[9px] tracking-widest" style={{ color: '#93a1b0' }}>ROE</span>
              <div className="flex" style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid #44617b' }}>
                {['HOLD', 'TIGHT', 'FREE'].map(roe => {
                  const colors = { HOLD: '#2f80d6', TIGHT: '#e8bd55', FREE: '#d24a44' };
                  const active = (g.roe || 'TIGHT') === roe;
                  return (
                    <button key={roe}
                      onClick={() => setROE && setROE(roe)}
                      className="f-display text-[11px] px-2.5 h-9"
                      style={{
                        background: active ? colors[roe] : 'transparent',
                        color: active ? '#102234' : colors[roe],
                      }}>
                      {roe}
                    </button>
                  );
                })}
              </div>
            </div>
            {relocatingAsset && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 f-display tracking-widest"
                style={{ background: '#d9a52f', color: '#102234', fontSize: '14px' }}>
                CLICK ON MAP TO RELOCATE, <button onClick={cancelRelocate} style={{ marginLeft: 12, textDecoration: 'underline', background: 'transparent', border: 0, color: '#102234', cursor: 'pointer' }}>CANCEL</button>
              </div>
            )}
            {paused && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ background: 'rgba(22,41,60,0.30)', zIndex: 50 }}>
                <div className="px-8 py-4 f-display tracking-widest"
                  style={{ background: '#2f80d6', color: '#102234', fontSize: '32px', border: '4px double #102234' }}>
                  PAUSED, INSTRUCTOR INTERVENTION
                </div>
              </div>
            )}
          </div>
          {instructorMode ? (
            <InstructorPanel g={g}
              paused={paused} togglePause={togglePause}
              onInject={instructorInject}
              onDamage={instructorDamage}
              notes={instructorNotes}
              onAddNote={addInstructorNote}
              dismissAlert={dismissAlert} />
          ) : (
            <RunSidebar g={g} dismissAlert={dismissAlert} />
          )}
        </div>
        <RunBottom g={g} />
      </div>
    </div>
  );
}

function RunHeader({ g, phase, audioOn, setAudioOn, onEnd, gameMode, onDeployTeam, simSpeed, setSimSpeed }) {
  const totalGH = (g.sc.totalGameHours || 48);
  const effectiveDurationMs = g.selectedDurationMin ? g.selectedDurationMin * 60000 : g.sc.realDuration;
  const remainingMs = effectiveDurationMs - g.realElapsed;
  const progressPct = (g.gameTime / GH(totalGH)) * 100;
  const roe = g.roe || 'TIGHT';
  const roeColor = { HOLD: '#2f80d6', TIGHT: '#e8bd55', FREE: '#d24a44' }[roe] || '#5d6b7a';
  return (
    <div className="border-2 border-[#243d52]" style={{ background: '#102234' }}>
      {/* Top strip: NATO/JATEC branding + classification */}
      <div className="px-3 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-[#243d52]/40"
        style={{ background: '#2f80d6', color: '#102234' }}>
        <div className="flex items-center gap-3">
          <span className="f-display text-[11px] tracking-widest">NATO / JATEC</span>
          <span className="f-typewriter text-[9px]" style={{ color: '#93a1b0' }}>
            JOINT ANALYSIS, TRAINING AND EDUCATION CENTRE
          </span>
        </div>
        <span className="f-typewriter text-[10px] tracking-[0.3em]">
          PUBLIC // OPEN-SOURCE // ILLUSTRATIVE
        </span>
      </div>

      {/* Operational header */}
      <div className="flex items-stretch flex-wrap">
        <div className="px-3 py-2 border-r-2 border-[#243d52]">
          <div className="f-display text-xs" style={{ color: '#d9a52f' }}>{g.sc.name}</div>
          <div className="f-cond text-xs" style={{ color: '#93a1b0' }}>{g.sc.subtitle}</div>
        </div>
        <div className="px-3 py-2 border-r-2 border-[#243d52] f-mono text-sm flex flex-col justify-center">
          <div className="text-[9px]" style={{ color: '#5d6b7a' }}>DTG</div>
          <div className="font-bold text-[13px] tracking-wider">{fmtDTG(g.gameTime)}</div>
        </div>
        <div className="px-3 py-2 border-r-2 border-[#243d52] f-mono text-xs flex flex-col justify-center">
          <div className="text-[9px]" style={{ color: '#5d6b7a' }}>MISSION TIME / REMAINING</div>
          <div>
            <span className="font-bold">{fmtGameTime(g.gameTime)}</span>
            <span className="ml-2" style={{ color: '#5d6b7a' }}>({fmtRealTime(remainingMs)} left)</span>
          </div>
        </div>
        <div className="px-3 py-2 border-r-2 border-[#243d52] flex flex-col justify-center">
          <div className="text-[9px] f-mono" style={{ color: '#5d6b7a' }}>PHASE</div>
          <span className="px-2 py-0.5 f-display text-[11px]" style={{ background: '#d9a52f', color: '#102234' }}>{phase.name}</span>
        </div>
        <div className="px-3 py-2 border-r-2 border-[#243d52] flex flex-col justify-center">
          <div className="text-[9px] f-mono" style={{ color: '#5d6b7a' }}>ROE</div>
          <span className="px-2 py-0.5 f-display text-[11px]"
            style={{ background: roeColor, color: '#102234' }}>WPNS {roe}</span>
        </div>
        <div className="flex items-center px-3 gap-3 f-mono text-xs flex-wrap">
          {g.nodes.filter(n => n.kind !== 'forward').map(n => (
            <div key={n.id} className="flex items-center gap-1">
              <span style={{ color: '#2f80d6' }}>{n.glyph}</span>
              <span className="f-cond font-bold">{n.name}</span>
              <span style={{ color: n.hp === 0 ? '#d9a52f' : '#dde3ea' }}>{n.hp}/{n.maxHp}</span>
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 px-3 py-2 border-l-2 border-[#243d52]">
          {setSimSpeed && (
            <div className="flex items-center gap-1" title="Playback speed (fast-forward). 1x is real tempo.">
              <span className="f-mono text-[9px]" style={{ color: '#5d6b7a' }}>SPD</span>
              {[1, 2, 5, 10].map(s => (
                <button key={s} onClick={() => setSimSpeed(s)}
                  className="f-mono text-[10px] px-1.5 py-0.5 border"
                  style={{ background: simSpeed === s ? '#2f80d6' : '#102234', borderColor: '#243d52', color: simSpeed === s ? '#102234' : '#93a1b0' }}>
                  {s}x
                </button>
              ))}
            </div>
          )}
          {onDeployTeam && gameMode === 'demo' && (
            <button onClick={onDeployTeam}
              disabled={(g.reinforcementsUsed || 0) >= REINFORCE_MAX}
              className="f-display text-xs px-3 py-0.5 border"
              style={{
                background: (g.reinforcementsUsed || 0) >= REINFORCE_MAX ? '#102234' : '#3c6e3c',
                borderColor: '#2f80d6',
                color: (g.reinforcementsUsed || 0) >= REINFORCE_MAX ? '#5d6b7a' : '#cfe6cf',
                letterSpacing: '0.05em',
              }}
              title="Commit a Sting drone-interceptor crew to the sector now">
              ⊕ DRONE TEAM ({REINFORCE_MAX - (g.reinforcementsUsed || 0)})
            </button>
          )}
          <button onClick={() => setAudioOn && setAudioOn(!audioOn)}
            className="f-typewriter text-xs px-2 py-0.5 border border-[#243d52]"
            style={{ background: audioOn ? '#2f80d6' : '#102234', color: audioOn ? '#102234' : '#dde3ea' }}>
            {audioOn ? 'ON' : 'OFF'}
          </button>
          {onEnd && (
            <button onClick={() => { if (window.confirm(gameMode === 'training' ? 'End the training session and go to the after-action review?' : 'End the demonstration and go to the after-action review?')) onEnd(); }}
              className="f-display text-xs px-3 py-0.5 border"
              style={{ background: '#d24a44', borderColor: '#d24a44', color: '#fff', letterSpacing: '0.08em' }}
              title="End the session and show the after-action review">
              ⏹ {gameMode === 'training' ? 'END TRAINING' : 'END'}
            </button>
          )}
        </div>
      </div>
      <div className="h-2 border-t border-[#243d52]" style={{ background: '#16293c' }}>
        <div style={{ width: `${progressPct}%`, height: '100%', background: '#2f80d6', transition: 'width 200ms' }} />
      </div>
    </div>
  );
}

function BattleMap({ g, onAssetClick, onMapClick, relocatingAsset, fireMissionTargeting, placingTeam }) {
  const [mapZoom, setMapZoom] = React.useState(1);
  return (
    <div className="border-2 border-[#243d52] relative" style={{ background: '#16293c' }}>
      {SCENARIO.geo && <GeoBackground geo={SCENARIO.geo} />}
      {!SCENARIO.geo && <ZoomControls zoom={mapZoom} setZoom={setMapZoom} />}
      <div style={{ overflow:'auto', maxHeight: (mapZoom > 1 && !SCENARIO.geo) ? '78vh' : 'none', position:'relative', zIndex:1 }}>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{ width:((SCENARIO.geo?1:mapZoom)*100)+'%', minWidth:'100%', height:'auto', display:'block' }}
        className={`${relocatingAsset || fireMissionTargeting || placingTeam ? 'cursor-crosshair' : 'cursor-default'}`}
        onClick={onMapClick}>
        <TopographyLayer />
        <FriendlyAreaOverlay />
        <FLOTAndPhaseLines />
        <UnitsLayer />

        {/* Enemy EW node (if scenario has one and detected) */}
        {g.enemyEW && g.enemyEW.alive && (
          <g style={{ pointerEvents: 'none' }}>
            {/* Pulsing emission ring (always visible, intel knows it's there) */}
            <circle cx={g.enemyEW.x} cy={g.enemyEW.y} r="40"
              fill="none" stroke="#d24a44" strokeWidth="0.8" strokeDasharray="2,3" opacity="0.4">
              <animate attributeName="r" from="30" to="60" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite" />
            </circle>
            {/* EW symbol (jagged radio waves) */}
            <rect x={g.enemyEW.x - 14} y={g.enemyEW.y - 9} width="28" height="18"
              fill="rgba(210,74,68,0.12)" stroke="#d24a44" strokeWidth="2" strokeDasharray="3,2" />
            <text x={g.enemyEW.x} y={g.enemyEW.y - 1} fontSize="9" textAnchor="middle"
              className="f-display" fill="#d24a44" fontWeight="bold">EW</text>
            <text x={g.enemyEW.x} y={g.enemyEW.y + 8} fontSize="6" textAnchor="middle"
              className="f-typewriter" fill="#d24a44">RU JAMMER</text>
            {/* HP indicator */}
            <g transform={`translate(${g.enemyEW.x - g.enemyEW.maxHp * 4}, ${g.enemyEW.y - 16})`}>
              {Array.from({ length: g.enemyEW.maxHp }).map((_, i) => (
                <rect key={i} x={i * 8} y="0" width="6" height="3"
                  fill={i < g.enemyEW.hp ? '#d24a44' : 'rgba(210,74,68,0.12)'} stroke="#d24a44" strokeWidth="0.5" />
              ))}
            </g>
            {g.enemyEW.detectedByPlayer && (
              <text x={g.enemyEW.x} y={g.enemyEW.y + 22} fontSize="6.5" textAnchor="middle"
                className="f-typewriter" fill="#d24a44" fontWeight="bold">⚠ DETECTED</text>
            )}
          </g>
        )}

        {/* Fire mission incoming marker */}
        {g.fireMission && g.fireMission.active && (() => {
          const fm = g.fireMission.active;
          const totalTime = fm.impactGT - fm.requestedGT;
          const elapsed = g.gameTime - fm.requestedGT;
          const progress = clamp(elapsed / totalTime, 0, 1);
          const r = 60 * (1 - progress * 0.3);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <circle cx={fm.targetX} cy={fm.targetY} r={r}
                fill="rgba(139,31,31,0.10)" stroke="#d24a44" strokeWidth="1.5" strokeDasharray="4,3">
                <animate attributeName="opacity" from="0.3" to="0.8" dur="0.7s" repeatCount="indefinite" />
              </circle>
              <line x1={fm.targetX - 12} y1={fm.targetY} x2={fm.targetX + 12} y2={fm.targetY} stroke="#d24a44" strokeWidth="1.5" />
              <line x1={fm.targetX} y1={fm.targetY - 12} x2={fm.targetX} y2={fm.targetY + 12} stroke="#d24a44" strokeWidth="1.5" />
              <text x={fm.targetX} y={fm.targetY - r - 6} fontSize="9" fill="#d24a44" textAnchor="middle" className="f-display" fontWeight="bold">
                CAS TOT
              </text>
              <text x={fm.targetX} y={fm.targetY - r - 16} fontSize="7" fill="#d24a44" textAnchor="middle" className="f-mono">
                {((fm.impactGT - g.gameTime) / 60000).toFixed(1)}m
              </text>
            </g>
          );
        })()}

        {/* Asset ranges, full circle if sectorArc=360, wedge if narrower */}
        {g.assets.filter(a => a.alive).map(a => {
          const c = CARDS[a.cardId];
          if (a.mode === 'STANDBY' || a.mode === 'HIDDEN') return null;
          const isEngage = a.mode === 'ENGAGE';
          const arc = c.sectorArc || 360;
          const fill = isEngage ? 'rgba(33,62,92,0.07)' : 'rgba(33,62,92,0.02)';
          const stroke = c.color;
          if (arc >= 360) {
            return (
              <circle key={'r' + a.id} cx={a.x} cy={a.y} r={c.range}
                fill={fill} stroke={stroke} strokeWidth={isEngage ? 1.2 : 0.6}
                strokeDasharray={isEngage ? '0' : '3,3'}
                opacity={isEngage ? 0.7 : 0.5} />
            );
          }
          // wedge
          const facing = a.facing || 90;
          const half = arc / 2;
          // compass facing: 0=N, 90=E. Convert to math: math = 90 - compass
          const startCompass = (facing - half + 360) % 360;
          const endCompass = (facing + half) % 360;
          const toMath = (c) => ((90 - c + 360) % 360) * Math.PI / 180;
          const a1 = toMath(endCompass);   // larger compass = smaller math = start of arc going counter-clockwise
          const a2 = toMath(startCompass);
          const x1 = a.x + c.range * Math.cos(a1);
          const y1 = a.y - c.range * Math.sin(a1);
          const x2 = a.x + c.range * Math.cos(a2);
          const y2 = a.y - c.range * Math.sin(a2);
          const largeArc = arc > 180 ? 1 : 0;
          const path = `M ${a.x} ${a.y} L ${x1} ${y1} A ${c.range} ${c.range} 0 ${largeArc} 0 ${x2} ${y2} Z`;
          return (
            <g key={'r' + a.id}>
              <path d={path} fill={fill} stroke={stroke} strokeWidth={isEngage ? 1.2 : 0.6}
                strokeDasharray={isEngage ? '0' : '3,3'} opacity={isEngage ? 0.7 : 0.5} />
            </g>
          );
        })}

        {/* Sensor coverage (visual ID zone), outer ring when ALERT/ENGAGE */}
        {g.assets.filter(a => a.alive && (a.mode === 'ALERT' || a.mode === 'ENGAGE') && !a.deploying).map(a => {
          const c = CARDS[a.cardId];
          if (!c.sensorRange || c.sensorRange <= c.range) return null;
          return (
            <circle key={'sn' + a.id} cx={a.x} cy={a.y} r={c.sensorRange}
              fill="none" stroke="#5a8b6c" strokeWidth="0.5" strokeDasharray="1,4" opacity="0.4" />
          );
        })}

        {/* Compromise indicator */}
        {g.assets.filter(a => a.alive && a.compromisedAt).map(a => (
          <g key={'cp' + a.id}>
            <circle cx={a.x} cy={a.y} r="22" fill="none" stroke="#d24a44" strokeWidth="1" strokeDasharray="2,2" opacity="0.7" />
            <text x={a.x} y={a.y - 24} fontSize="8" fill="#d24a44" textAnchor="middle" className="f-typewriter">COMPROMISED</text>
          </g>
        ))}

        {/* EW emission */}
        {g.assets.filter(a => a.alive && CARDS[a.cardId].isEW && a.mode === 'ENGAGE' && !a.deploying).map(a => (
          <circle key={'ew' + a.id} cx={a.x} cy={a.y} r={CARDS[a.cardId].range}
            fill="rgba(90,82,48,0.10)" stroke="#93a1b0" strokeWidth="1" strokeDasharray="2,2" />
        ))}

        {/* Move targets */}
        {g.assets.filter(a => a.alive && a.mode === 'MOVING' && a.moveTarget).map(a => (
          <g key={'m' + a.id}>
            <line x1={a.x} y1={a.y} x2={a.moveTarget.x} y2={a.moveTarget.y} stroke="#d9a52f" strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
            <circle cx={a.moveTarget.x} cy={a.moveTarget.y} r="6" fill="none" stroke="#d9a52f" strokeWidth="1.5" />
            <line x1={a.moveTarget.x - 4} y1={a.moveTarget.y} x2={a.moveTarget.x + 4} y2={a.moveTarget.y} stroke="#d9a52f" strokeWidth="1" />
            <line x1={a.moveTarget.x} y1={a.moveTarget.y - 4} x2={a.moveTarget.x} y2={a.moveTarget.y + 4} stroke="#d9a52f" strokeWidth="1" />
          </g>
        ))}

        {/* Miss markers (layered defense visualization) */}
        {g.missMarkers.map((m, i) => {
          const op = 1 - m.age / 1500;
          const r = 4 + m.age * 0.012;
          return <circle key={i} cx={m.x} cy={m.y} r={r} fill="none" stroke="#5d6b7a" strokeWidth="1" opacity={op} />;
        })}

        {/* Impact blasts (ballistic / glide / heavy = larger) */}
        {(g.blasts || []).map((b, i) => {
          const ttl = b.big ? 1400 : 1000;
          const p = Math.max(0, 1 - b.age / ttl);
          const base = b.big ? 26 : 13;
          const r = base * (0.4 + (1 - p) * 0.85);
          const col = b.cls === 'ballistic' ? '#ffd36b' : (b.cls === 'glide' ? '#ff9d5a' : '#ff6b4a');
          return (
            <g key={'bl' + i} style={{ pointerEvents: 'none' }} opacity={p}>
              <circle cx={b.x} cy={b.y} r={r} fill="none" stroke={col} strokeWidth={b.big ? 2.4 : 1.5} />
              <circle cx={b.x} cy={b.y} r={r * 0.5} fill={col} opacity={0.45 * p} />
              {b.big && <circle cx={b.x} cy={b.y} r={r * 1.55} fill="none" stroke={col} strokeWidth="0.8" opacity={0.5 * p} />}
              {b.big && p > 0.55 && <text x={b.x} y={b.y - r - 5} fontSize="9" textAnchor="middle" className="f-display" fill={col} fontWeight="bold">IMPACT</text>}
            </g>
          );
        })}

        {/* Shots */}
        {g.shots.map((s, i) => {
          const p = 1 - s.age / s.life;
          return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke={s.hit ? s.color : '#5d6b7a'} strokeWidth={s.hit ? 1.6 : 0.8}
            strokeDasharray={s.hit ? '0' : '2,2'} opacity={p} />;
        })}

        <DefendedNodes nodes={g.nodes} />

        {/* Friendly recon UAVs patrolling */}
        {(g.friendlyRecon || []).map(r => (
          <g key={'fr' + r.id}>
            <circle cx={r.x} cy={r.y} r={r.range} fill="rgba(47,128,214,0.04)" stroke="#2f80d6" strokeWidth="0.4" strokeDasharray="2,3" opacity="0.5" />
            <circle cx={r.x} cy={r.y} r="6" fill="#102234" stroke="#2f80d6" strokeWidth="1.5" />
            <circle cx={r.x} cy={r.y} r="2" fill="#2f80d6" />
            <line x1={r.x - r.vx * 80} y1={r.y - r.vy * 80} x2={r.x} y2={r.y} stroke="#2f80d6" strokeWidth="0.6" opacity="0.5" strokeDasharray="2,2" />
            <text x={r.x + 9} y={r.y + 3} fontSize="8" fill="#2f80d6" className="f-typewriter">{r.code}</text>
          </g>
        ))}

        {/* Friendly FPV interceptor drones in flight */}
        {(g.intDrones || []).map(d => {
          const fuelPct = clamp(1 - d.ageGT / d.fuelMaxGT, 0, 1);
          const fillColor = d.abandoned ? '#5d6b7a' : '#d9a52f';
          return (
            <g key={'id' + d.id}>
              {/* Flight trail back ~30px */}
              <line x1={d.x - d.vx * 30} y1={d.y - d.vy * 30} x2={d.x} y2={d.y}
                stroke={fillColor} strokeWidth="0.6" opacity="0.5" strokeDasharray="2,2" />
              {/* Drone marker, small triangle pointing in direction of motion */}
              <polygon points={(() => {
                const ang = Math.atan2(d.vy, d.vx);
                const sz = 4;
                const px = d.x + Math.cos(ang) * sz;
                const py = d.y + Math.sin(ang) * sz;
                const lx = d.x + Math.cos(ang + 2.5) * sz;
                const ly = d.y + Math.sin(ang + 2.5) * sz;
                const rx = d.x + Math.cos(ang - 2.5) * sz;
                const ry = d.y + Math.sin(ang - 2.5) * sz;
                return `${px},${py} ${lx},${ly} ${rx},${ry}`;
              })()} fill={fillColor} stroke="#dde3ea" strokeWidth="0.5" />
              {/* Fuel/state label */}
              {d.abandoned ? (
                <text x={d.x + 6} y={d.y - 4} fontSize="7" fill="#d24a44" className="f-mono">DRAIN</text>
              ) : fuelPct < 0.3 && (
                <text x={d.x + 6} y={d.y - 4} fontSize="7" fill="#d4995a" className="f-mono">LOW</text>
              )}
            </g>
          );
        })}

        {/* Assets */}
        {g.assets.filter(a => a.alive).map(a => <AssetVis key={a.id} a={a} onClick={onAssetClick} />)}

        {/* Threats, NOT clickable, no pointer cursor */}
        {/* Adversary RECON FOOTPRINTS, visible only when recon UAV is classified */}
        {g.threats.filter(t => t.alive && t.classified
            && ['orlan10', 'orlan30', 'zala', 'forpost', 'altius', 'supercam', 'eleron3'].includes(t.type))
          .map(t => {
            const tt = TT[t.type];
            const rangeBy = { orlan10: 80, orlan30: 110, zala: 70, forpost: 130, altius: 180, supercam: 60, eleron3: 50 };
            const rng = rangeBy[t.type] || 80;
            const isDesignator = ['orlan30', 'zala', 'altius', 'forpost'].includes(t.type);
            const color = isDesignator ? '#d24a44' : '#d9a52f';
            return (
              <g key={'rec-fp' + t.id} className="alert-pulse">
                <circle cx={t.x} cy={t.y} r={rng}
                  fill={isDesignator ? 'rgba(210,74,68,0.06)' : 'rgba(217,165,47,0.05)'}
                  stroke={color} strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
                {isDesignator && (
                  <text x={t.x} y={t.y - rng - 4} fontSize="9" fill={color}
                    textAnchor="middle" className="f-typewriter" fontWeight="600">
                    DESIGNATING · {tt.code}
                  </text>
                )}
              </g>
            );
          })}

        {g.threats.filter(t => t.alive).map(th => <ThreatVis key={th.id} th={th} />)}

        {/* Direction indicators for incoming threats, visible at map edge near where they'll arrive */}
        {g.threats.filter(t => t.alive).map(th => {
          const tt = TT[th.type];
          // Show edge indicator if threat is near edge OR off-screen
          const margin = 25;
          const offX = th.x < margin || th.x > MAP_W - margin;
          const offY = th.y < margin || th.y > MAP_H - margin;
          if (!offX && !offY) return null;
          const ex = clamp(th.x, 14, MAP_W - 14);
          const ey = clamp(th.y, 14, MAP_H - 14);
          const speed = Math.hypot(th.vx, th.vy) || 1;
          const ux = th.vx / speed, uy = th.vy / speed;
          const arrowSize = tt.class === 'ballistic' ? 13 : 9;
          const ang = Math.atan2(uy, ux);
          const tip = `${ex + Math.cos(ang) * arrowSize},${ey + Math.sin(ang) * arrowSize}`;
          const lwing = `${ex + Math.cos(ang + 2.5) * arrowSize},${ey + Math.sin(ang + 2.5) * arrowSize}`;
          const rwing = `${ex + Math.cos(ang - 2.5) * arrowSize},${ey + Math.sin(ang - 2.5) * arrowSize}`;
          return (
            <g key={'oa' + th.id} style={{ pointerEvents: 'none' }}>
              <polygon points={`${tip} ${lwing} ${rwing}`} fill={tt.color} stroke="#dde3ea" strokeWidth="1" opacity="0.7" />
              <text x={ex - Math.cos(ang) * 16} y={ey - Math.sin(ang) * 16 - 2} fontSize="8" fill={tt.color} className="f-mono" textAnchor="middle" fontWeight="bold">
                {th.classified ? tt.code : 'UNK'}
              </text>
            </g>
          );
        })}

        {/* Incoming spawn predictor, show inbound bearing for next ~3 game-min of upcoming threats */}
        {(() => {
          const upcoming = [];
          for (let i = g.spawnPtr; i < SPAWN_SCHEDULE.length; i++) {
            const sp = SPAWN_SCHEDULE[i];
            const dt_gm = (sp.gt - g.gameTime) / (60 * 1000);
            if (dt_gm > 3) break;
            if (dt_gm < 0) continue;
            upcoming.push({ sp, eta: dt_gm });
          }
          // Group by bearing
          const byBearing = {};
          upcoming.forEach(u => {
            const b = u.sp.from || 'E';
            if (!byBearing[b]) byBearing[b] = [];
            byBearing[b].push(u);
          });
          return Object.entries(byBearing).map(([bearing, group]) => {
            const v = VECTORS[bearing] || VECTORS.E;
            // Position at edge for that bearing, slightly inset
            const ex = clamp(v.x, 18, MAP_W - 18);
            const ey = clamp(v.y, 18, MAP_H - 18);
            const minEta = Math.min(...group.map(g => g.eta));
            const maxEta = Math.max(...group.map(g => g.eta));
            // Direction: toward map center (relative to edge)
            const cx = MAP_W / 2, cy = MAP_H / 2;
            const ang = Math.atan2(cy - ey, cx - ex);
            const arrSz = 16;
            const tip = `${ex + Math.cos(ang) * arrSz},${ey + Math.sin(ang) * arrSz}`;
            const lwing = `${ex + Math.cos(ang + 2.5) * arrSz},${ey + Math.sin(ang + 2.5) * arrSz}`;
            const rwing = `${ex + Math.cos(ang - 2.5) * arrSz},${ey + Math.sin(ang - 2.5) * arrSz}`;
            const hasBallistic = group.some(u => TT[u.sp.type].class === 'ballistic');
            const hasIndirect = group.some(u => TT[u.sp.type].indirect);
            const fill = hasBallistic ? '#d24a44' : hasIndirect ? '#d24a44' : '#5d6b7a';
            return (
              <g key={'pred-' + bearing} style={{ pointerEvents: 'none' }} opacity="0.55">
                <polygon points={`${tip} ${lwing} ${rwing}`} fill={fill} stroke="#dde3ea" strokeWidth="0.8" />
                <text x={ex} y={ey - 18} fontSize="8" fill={fill} className="f-mono" textAnchor="middle" fontWeight="bold">
                  {group.length}× IN ~{minEta < 0.5 ? '<1' : Math.round(minEta)}–{Math.round(Math.max(1, maxEta))}m
                </text>
                <text x={ex} y={ey - 8} fontSize="7" fill={fill} className="f-mono" textAnchor="middle">
                  {bearing}
                </text>
              </g>
            );
          });
        })()}
      </svg>
      </div>
    </div>
  );
}

function AssetVis({ a, onClick }) {
  const c = CARDS[a.cardId];
  const modeColor = {
    STANDBY: '#93a1b0', ALERT: '#e8bd55', ENGAGE: '#2f80d6',
    HIDDEN: '#93a1b0', REPAIR: '#d4995a', MOVING: '#d9a52f', DESTROYED: '#d24a44',
  }[a.mode] || c.color;
  // Facing arrow for sectored assets
  const arc = c.sectorArc || 360;
  const showArrow = arc < 360 && a.mode !== 'STANDBY' && a.mode !== 'HIDDEN' && !a.deploying;
  const facing = a.facing || 90;
  // compass to math: math = 90 - compass
  const mathAngle = (90 - facing) * Math.PI / 180;
  const arrowLen = 16;
  const ax = a.x + Math.cos(mathAngle) * arrowLen;
  const ay = a.y - Math.sin(mathAngle) * arrowLen;
  return (
    <g onClick={(e) => { e.stopPropagation(); onClick(a, e); }} style={{ cursor: 'pointer' }}>
      {a.hp < a.maxHp && (
        <circle cx={a.x} cy={a.y + 14} r="3" fill={a.hp / a.maxHp < 0.5 ? '#d24a44' : '#d9a52f'} />
      )}
      {showArrow && (
        <g>
          <line x1={a.x} y1={a.y} x2={ax} y2={ay} stroke={modeColor} strokeWidth="1.5" />
          <circle cx={ax} cy={ay} r="2" fill={modeColor} />
        </g>
      )}
      <rect x={a.x - 18} y={a.y - 11} width="36" height="22" rx="2"
        fill={a.deploying ? '#2a3340' : '#102234'}
        stroke={a.damageWarn ? '#d24a44' : c.color}
        strokeWidth={a.damageWarn ? 2.5 : 2}
        className={a.damageWarn ? 'alert-pulse' : ''}
      />
      <text x={a.x} y={a.y - 1} fontSize="9" textAnchor="middle" className="f-display" fill={c.color}>{c.tag}</text>
      <text x={a.x} y={a.y + 8} fontSize="7" textAnchor="middle" className="f-typewriter" fill={modeColor} style={{ fontWeight: 600 }}>{a.mode}</text>
      {a.deploying && <text x={a.x} y={a.y + 22} fontSize="7" textAnchor="middle" className="f-typewriter" fill="#d9a52f">DEPLOYING</text>}
      {a.mode === 'ENGAGE' && !a.deploying && (
        <circle cx={a.x} cy={a.y} r="22" fill="none" stroke="#2f80d6" strokeWidth="0.8" className="pulse-emit" />
      )}
      {a.mode === 'REPAIR' && <text x={a.x + 22} y={a.y - 6} fontSize="9" fill="#d4995a">⚒</text>}
      {a.compromisedAt && <text x={a.x - 22} y={a.y - 6} fontSize="9" fill="#d24a44">⚠</text>}
    </g>
  );
}

function ThreatVis({ th }) {
  const tt = TT[th.type];
  const s = 9;
  let symEl;
  switch (tt.sym) {
    case 'D': symEl = <polygon points={`${th.x},${th.y - s} ${th.x + s},${th.y} ${th.x},${th.y + s} ${th.x - s},${th.y}`} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />; break;
    case 'T': symEl = <polygon points={`${th.x},${th.y - s} ${th.x + s},${th.y + s - 1} ${th.x - s},${th.y + s - 1}`} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />; break;
    case 'O': symEl = <circle cx={th.x} cy={th.y} r={s - 1} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />; break;
    case 'S': symEl = <polygon points={`${th.x},${th.y - s} ${th.x + 3},${th.y - 3} ${th.x + s},${th.y - 3} ${th.x + 4},${th.y + 2} ${th.x + 6},${th.y + s} ${th.x},${th.y + 4} ${th.x - 6},${th.y + s} ${th.x - 4},${th.y + 2} ${th.x - s},${th.y - 3} ${th.x - 3},${th.y - 3}`} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />; break;
    case 'star': symEl = <polygon points={`${th.x},${th.y - s - 1} ${th.x + 3},${th.y - 2} ${th.x + s + 1},${th.y - 1} ${th.x + 4},${th.y + 3} ${th.x + 5},${th.y + s + 1} ${th.x},${th.y + 5} ${th.x - 5},${th.y + s + 1} ${th.x - 4},${th.y + 3} ${th.x - s - 1},${th.y - 1} ${th.x - 3},${th.y - 2}`} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />; break;
    case 'box': symEl = (
      <g>
        <rect x={th.x - s} y={th.y - s/2} width={s * 2} height={s} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />
        <line x1={th.x - s} y1={th.y - s/2} x2={th.x - s + 4} y2={th.y - s/2 - 4} stroke="#dde3ea" strokeWidth="1" />
        <line x1={th.x + s} y1={th.y - s/2} x2={th.x + s - 4} y2={th.y - s/2 - 4} stroke="#dde3ea" strokeWidth="1" />
      </g>
    ); break;
    case 'shell': symEl = (
      <g>
        <ellipse cx={th.x} cy={th.y} rx={s - 2} ry={s - 4} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />
        <line x1={th.x - 4} y1={th.y - 4} x2={th.x + 4} y2={th.y + 4} stroke="#102234" strokeWidth="1.2" />
        <line x1={th.x - 4} y1={th.y + 4} x2={th.x + 4} y2={th.y - 4} stroke="#102234" strokeWidth="1.2" />
      </g>
    ); break;
    case 'arrow':
      const dx = th.vx, dy = th.vy, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, px = -uy, py = ux;
      symEl = <polygon points={`${th.x + ux * s},${th.y + uy * s} ${th.x - ux * s + px * 4},${th.y - uy * s + py * 4} ${th.x - ux * (s - 3)},${th.y - uy * (s - 3)} ${th.x - ux * s - px * 4},${th.y - uy * s - py * 4}`} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />;
      break;
    default: symEl = <rect x={th.x - s} y={th.y - s} width={s * 2} height={s * 2} fill={tt.color} stroke="#dde3ea" strokeWidth="1" />;
  }
  const isCritical = tt.class === 'ballistic';
  // Threats are NOT clickable, pointer-events: none on the group
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={th.x - th.vx * 30} y1={th.y - th.vy * 30} x2={th.x} y2={th.y}
        stroke={tt.color} strokeWidth={isCritical ? 1.2 : 0.7} opacity="0.5" strokeDasharray="2,2" />
      {th.disabled && <circle cx={th.x} cy={th.y} r="14" fill="none" stroke="#93a1b0" strokeWidth="1" strokeDasharray="2,2" />}
      {isCritical && (
        <circle cx={th.x} cy={th.y} r="14" fill="none" stroke={tt.color} strokeWidth="1" opacity="0.6">
          <animate attributeName="r" from="10" to="22" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.7" to="0" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
      {th.targetAsset && (
        <circle cx={th.x} cy={th.y} r="11" fill="none" stroke="#d24a44" strokeWidth="1.5" strokeDasharray="3,2" />
      )}
      {symEl}
      <text x={th.x + 14} y={th.y + 3} fill="#dde3ea" fontSize="9" className="f-mono">
        {th.classified ? tt.code : 'UNK'}
      </text>
      {th.paralleling && <text x={th.x + 14} y={th.y - 6} fill="#d9a52f" fontSize="8" className="f-mono">PARA</text>}
      {th.wanderedIn && <text x={th.x + 14} y={th.y - 6} fill="#d24a44" fontSize="8" className="f-mono">DEVIATED</text>}
    </g>
  );
}

function AssetMenu({ asset, pos, onSetMode, onRepair, onRelocate, onSetFacing, onToggleEngageRule, onRequestReload, onClose }) {
  const c = CARDS[asset.cardId];
  const isAttached = !!c.attached;
  const cantCommand = isAttached || asset.deploying || asset.mode === 'REPAIR' || asset.mode === 'MOVING';
  const ALL_CLASSES = ['ballistic', 'cruise', 'glide', 'male', 'owa', 'tactical', 'recon', 'unknown'];
  // Resupply available for SAM systems (player can request even for ATTACHED, CORPS will deliver)
  const reloadable = !c.isEW;
  const isLocalReload = c.isInterceptor || ['mg_a','mg_b','mg_c','mg_d','mg_e','mg_f','gepard','skynex','stinger','piorun'].includes(asset.cardId);
  const ammoLow = asset.ammo < c.ammoMax;
  return (
    <div className="asset-menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`nation-flag flag-${c.nation}`} />
        <div className="f-display text-base" style={{ color: c.color }}>{callsign(asset.cardId)}</div>
        <div className="flex-1 f-cond text-[10px] font-bold" style={{ color: '#93a1b0' }}>{c.name}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 0, padding: '0 4px', cursor: 'pointer' }}>×</button>
      </div>

      <div className="text-[10px] f-mono mb-2" style={{ color: '#5d6b7a' }}>
        POSN: {fmtMGRS(asset.x, asset.y)} · BRG: {String(Math.round(asset.facing || 90)).padStart(3, '0')}°M
      </div>

      {isAttached && (
        <div className="text-[10px] f-mono mb-2 p-1.5"
          style={{ color: '#d24a44', background: 'rgba(210,74,68,0.12)', border: '1px solid #d24a44' }}>
          ⚠ ATTACHED ASSET, {c.echelon === 'corps' ? 'CORPS' : 'DIV'} CONTROL.
          Engages strategic threats automatically. View only, you cannot move, repair, or override engage rules.
        </div>
      )}

      <div className="text-[10px] f-mono mb-2" style={{ color: '#5d6b7a' }}>
        HP {asset.hp}/{asset.maxHp} · AMMO {asset.ammo}/{c.ammoMax} · MODE {asset.mode}
        {asset.deploying && <span style={{ color: '#d9a52f' }}> · DEPLOYING</span>}
        {asset.compromisedAt && <span style={{ color: '#d24a44' }}> · COMPROMISED</span>}
      </div>

      <div className="border-t border-[#243d52]/30 pt-2 mb-2">
        <div className="text-[10px] f-mono mb-1" style={{ color: '#5d6b7a' }}>ENGAGE MODE</div>
        <div className="mode-row">
          {['STANDBY', 'ALERT', 'ENGAGE'].map(m => (
            <button key={m} onClick={() => onSetMode(asset.id, m)} disabled={cantCommand}
              style={{ background: asset.mode === m ? '#2f80d6' : '#fff', color: asset.mode === m ? '#102234' : '#dde3ea' }}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {(c.sectorArc || 360) < 360 && (
        <div className="border-t border-[#243d52]/30 pt-2 mb-2">
          <div className="text-[10px] f-mono mb-1" style={{ color: '#5d6b7a' }}>FACING ({c.sectorArc}° arc, current {asset.facing}°)</div>
          <div className="mode-row">
            {[
              { l: 'N', v: 0 }, { l: 'NE', v: 45 }, { l: 'E', v: 90 }, { l: 'SE', v: 135 },
              { l: 'S', v: 180 }, { l: 'SW', v: 225 }, { l: 'W', v: 270 }, { l: 'NW', v: 315 },
            ].map(d => (
              <button key={d.l} onClick={() => onSetFacing(asset.id, d.v)} disabled={cantCommand}
                style={{ background: asset.facing === d.v ? '#2f80d6' : '#fff', color: asset.facing === d.v ? '#102234' : '#dde3ea', fontSize: '10px', padding: '4px 2px' }}>
                {d.l}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-[#243d52]/30 pt-2 mb-2">
        <div className="text-[10px] f-mono mb-1" style={{ color: '#5d6b7a' }}>
          ENGAGEMENT RULES, click to toggle which threat classes this asset will engage
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
          {ALL_CLASSES.map(cls => {
            const on = !!(asset.engageRules && asset.engageRules[cls]);
            return (
              <button key={cls} onClick={() => onToggleEngageRule(asset.id, cls)}
                disabled={isAttached}
                style={{
                  background: on ? '#2f80d6' : '#fff',
                  color: on ? '#102234' : '#dde3ea',
                  fontSize: '9px', padding: '4px 2px', textAlign: 'center',
                  border: `1px solid ${on ? '#2f80d6' : '#5d6b7a'}`,
                }}>
                {cls.toUpperCase()}
              </button>
            );
          })}
        </div>
        <div className="text-[9px] f-mono mt-1" style={{ color: '#5d6b7a' }}>
          ⓘ Heavy SAMs (PAC3/IRIS-T) deprioritize cheap targets even if rule allows.
          Save them for ballistic/cruise/MALE.
        </div>
      </div>

      <div className="border-t border-[#243d52]/30 pt-2">
        <div className="text-[10px] f-mono mb-1" style={{ color: '#5d6b7a' }}>ACTIONS</div>
        <button onClick={() => { onRepair(asset.id); onClose(); }}
          disabled={cantCommand || asset.hp >= asset.maxHp}>
          🔧 Hide & Field Repair ({(c.repairTime/1000).toFixed(0)}s real)
        </button>
        <button onClick={() => { onRelocate(asset.id); onClose(); }}
          disabled={cantCommand}>
          📍 Relocate
        </button>
        <button onClick={() => { onSetMode(asset.id, 'HIDDEN'); onClose(); }}
          disabled={cantCommand || asset.mode === 'HIDDEN'}>
          👁 Go Hidden
        </button>
        {reloadable && (
          <button onClick={() => { onRequestReload && onRequestReload(asset.id); onClose(); }}
            disabled={!ammoLow}
            style={{ borderColor: ammoLow ? '#2f80d6' : undefined, color: ammoLow ? '#2f80d6' : undefined }}>
            {c.isInterceptor
              ? `🔄 Reload Drones (${isLocalReload ? 10 : 20} game-min ETA)`
              : `📦 Request Resupply, ${isLocalReload ? 'local' : 'CORPS'} (${isLocalReload ? 10 : 20} game-min ETA)`}
          </button>
        )}
        {asset.hp === 0 && (
          <div className="text-[10px] f-mono mt-2 p-1" style={{ color: '#d24a44', background: 'rgba(210,74,68,0.12)' }}>
            ASSET DESTROYED, beyond field repair. Permanent loss.
          </div>
        )}
      </div>
    </div>
  );
}

function InstructorPanel({ g, paused, togglePause, onInject, onDamage, notes, onAddNote, dismissAlert }) {
  const [noteText, setNoteText] = React.useState('');
  const [injectType, setInjectType] = React.useState('iskander');
  const [injectFrom, setInjectFrom] = React.useState('E');

  const submitNote = () => {
    if (noteText.trim()) {
      onAddNote(noteText.trim());
      setNoteText('');
    }
  };

  const injectOptions = [
    'iskander', 'kinzhal', 'kh101', 'kalibr', 'kh22',
    'kab', 'geran2', 'lancet', 'lancet_of', 'fpv', 'fpv_of',
    'orlan10', 'orlan30', 'zala', 'arty', 'mlrs',
    'emit_decoy',
  ];

  return (
    <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '600px' }}>
      {/* Instructor banner */}
      <div className="px-2 py-1 f-display text-center tracking-widest"
        style={{ background: '#b8893a', color: '#102234', fontSize: '11px' }}>
        INSTRUCTOR / OBSERVER MODE
      </div>

      {/* Pause/resume */}
      <div className="border-2 p-2" style={{ background: '#102234', borderColor: '#b8893a' }}>
        <div className="f-display text-base mb-2" style={{ color: '#b8893a' }}>EXERCISE CONTROL</div>
        <button
          onClick={togglePause}
          className="btn-riso w-full"
          style={{
            background: paused ? '#2f80d6' : '#2f80d6',
            borderColor: paused ? '#2f80d6' : '#2f80d6',
            padding: '8px',
          }}>
          {paused ? '▶ RESUME EXERCISE' : 'PAUSE EXERCISE'}
        </button>
        <div className="text-[10px] f-mono mt-1" style={{ color: '#5d6b7a' }}>
          Use during AAR / coaching moments
        </div>
      </div>

      {/* Injects */}
      <div className="border-2 p-2" style={{ background: '#102234', borderColor: '#b8893a' }}>
        <div className="f-display text-base mb-2" style={{ color: '#b8893a' }}>SCENARIO INJECTS</div>
        <div className="text-[10px] f-mono mb-2" style={{ color: '#5d6b7a' }}>
          Add unscheduled events to test reactions
        </div>
        <div className="flex gap-1 mb-2">
          <select value={injectType} onChange={e => setInjectType(e.target.value)}
            className="flex-1 p-1 border border-[#243d52] f-mono text-[10px]">
            {injectOptions.map(t => (
              <option key={t} value={t}>{TT[t]?.code || t} ({TT[t]?.name || t})</option>
            ))}
          </select>
          <select value={injectFrom} onChange={e => setInjectFrom(e.target.value)}
            className="p-1 border border-[#243d52] f-mono text-[10px]">
            <option value="E">E</option>
            <option value="NE">NE</option>
            <option value="SE">SE</option>
            <option value="N">N</option>
            <option value="S">S</option>
          </select>
        </div>
        <button onClick={() => onInject(injectType, injectFrom)}
          className="btn-riso w-full"
          style={{ background: '#d24a44', borderColor: '#d24a44', padding: '6px', fontSize: '11px' }}>
          INJECT THREAT >
        </button>
        <div className="border-t border-[#243d52]/30 mt-2 pt-2 grid grid-cols-2 gap-1">
          <button onClick={() => onDamage('random_node')}
            className="btn-riso" style={{ padding: '4px', fontSize: '10px' }}>
            Damage random node
          </button>
          <button onClick={() => onDamage('random_asset')}
            className="btn-riso" style={{ padding: '4px', fontSize: '10px' }}>
            Destroy random asset
          </button>
        </div>
      </div>

      {/* Observation notes */}
      <div className="border-2 p-2" style={{ background: '#102234', borderColor: '#b8893a' }}>
        <div className="f-display text-base mb-2" style={{ color: '#b8893a' }}>OBSERVER NOTES</div>
        <div className="text-[10px] f-mono mb-2" style={{ color: '#5d6b7a' }}>
          Captured for post-mission AAR
        </div>
        <div className="flex gap-1 mb-2">
          <input
            type="text" value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitNote()}
            placeholder="Note observation..."
            className="flex-1 p-1 border border-[#243d52] f-mono text-[10px]"
            style={{ background: '#fff' }}
          />
          <button onClick={submitNote}
            className="btn-riso"
            style={{ padding: '4px 8px', fontSize: '10px', background: '#b8893a', borderColor: '#b8893a' }}>
            +
          </button>
        </div>
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {notes.length === 0 && (
            <div className="f-mono text-[10px] italic" style={{ color: '#5d6b7a' }}>, no notes yet, </div>
          )}
          {notes.slice().reverse().map((n, i) => (
            <div key={i} className="border-l-2 pl-2 py-1 f-mono text-[10px]"
              style={{ borderColor: '#b8893a', background: 'rgba(90,48,16,0.04)' }}>
              <div style={{ color: '#b8893a', fontWeight: 'bold' }}>{n.dtg}</div>
              <div>{n.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Live state stats (instructor sees full intel) */}
      <div className="border-2 p-2" style={{ background: '#102234', borderColor: '#b8893a' }}>
        <div className="f-display text-base mb-2" style={{ color: '#b8893a' }}>LIVE INTEL (FULL VISIBILITY)</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 f-mono text-[10px]">
          <div>Active threats: <strong>{g.threats.filter(t => t.alive).length}</strong></div>
          <div>Drones in flight: <strong>{(g.intDrones || []).length}</strong></div>
          <div>Assets up: <strong>{g.assets.filter(a => a.alive).length}</strong></div>
          <div>Recon kills: <strong>{g.m.reconKills || 0}</strong></div>
          <div>Strikes averted: <strong>{g.m.strikesAverted || 0}</strong></div>
          <div>EW counter-strikes: <strong>{g.m.ewCounterStrikes || 0}</strong></div>
          <div>Compromises: <strong>{g.m.compromises || 0}</strong></div>
          <div>Decoys engaged: <strong>{g.m.decoysHit || 0}</strong></div>
        </div>
      </div>

      {/* Recent log (instructor view) */}
      <div className="border-2 p-2" style={{ background: '#102234', borderColor: '#b8893a' }}>
        <div className="f-display text-base mb-2" style={{ color: '#b8893a' }}>EVENT LOG</div>
        <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
          {g.log.slice(0, 25).map((l, i) => {
            const colors = { wave: '#2f80d6', contact: '#d9a52f', ok: '#2f80d6', warn: '#d4995a', crit: '#d24a44', info: '#93a1b0' };
            return (
              <div key={i} className="f-mono text-[9px] leading-tight" style={{ color: colors[l.type] || '#dde3ea' }}>
                <span style={{ color: '#5d6b7a' }}>{fmtGameTime(l.gt)}</span> · {l.msg}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RunSidebar({ g, dismissAlert }) {
  return (
    <div className="space-y-2">
      {g.theaterStock != null && (
        <div className="border-2 p-2 f-mono text-[12px]" style={{ background:'rgba(47,128,214,0.12)', borderColor:'#2f80d6', color:'#eef2f6' }}>
          THEATER INTERCEPTORS: <span style={{ color: g.theaterStock>0?'#5aa0e6':'#d24a44', fontWeight:'bold' }}>{g.theaterStock}</span> <span style={{ color:'#93a1b0' }}>(Patriot / IRIS / NASAMS pool)</span>
        </div>
      )}
      {g.alerts.length > 0 && (
        <div className="border-2 p-2" style={{ background: 'rgba(217,165,47,0.12)', borderColor: '#e8bd55' }}>
          <div className="f-display text-base" style={{ color: '#e8bd55' }}>⚠ ALERTS</div>
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {g.alerts.slice().reverse().map(a => (
              <div key={a.id} className={`alert-card ${a.level}`}>
                <span style={{ color: '#5d6b7a', minWidth: 50 }}>{fmtGameTime(a.gt)}</span>
                <span style={{ flex: 1 }}>{a.msg}</span>
                <button className="dismiss" onClick={() => dismissAlert(a.id)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-2 border-[#243d52] p-2" style={{ background: '#102234' }}>
        <div className="f-display text-base" style={{ color: '#d9a52f' }}>ASSETS</div>
        <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
          {g.assets.map(a => {
            const c = CARDS[a.cardId];
            const modeColor = {
              STANDBY: '#93a1b0', ALERT: '#e8bd55', ENGAGE: '#2f80d6',
              HIDDEN: '#93a1b0', REPAIR: '#d4995a', MOVING: '#d9a52f', DESTROYED: '#d24a44',
            }[a.mode] || '#dde3ea';
            return (
              <div key={a.id} className="border border-[#243d52]/40 p-1.5">
                <div className="flex items-center gap-2">
                  <span className={`nation-flag flag-${c.nation}`} />
                  <span className="f-display text-xs" style={{ color: a.alive ? c.color : '#d24a44' }}>{c.tag}</span>
                  <span className="flex-1 f-cond text-[11px] font-bold leading-tight">{c.name}</span>
                  <span className="f-display text-[10px]" style={{ color: modeColor }}>{a.mode}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 f-mono text-[9px]">
                  <span style={{ color: '#5d6b7a' }}>HP {a.hp}/{a.maxHp}</span>
                  <span style={{ color: '#5d6b7a' }}>AMMO {a.ammo}</span>
                  {a.deploying && <span style={{ color: '#d9a52f' }}>DEPLOYING</span>}
                </div>
                <div className="flex gap-0.5 h-1 mt-0.5">
                  {Array.from({ length: a.maxHp }).map((_, i) => (
                    <div key={i} style={{ flex: 1, background: i < a.hp ? c.color : '#16293c', border: '0.5px solid #dde3ea' }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-2 border-[#243d52] p-2" style={{ background: '#102234' }}>
        <div className="f-display text-base" style={{ color: '#d9a52f' }}>CONTACTS</div>
        {g.threats.filter(t => t.alive).length === 0 && <div className="f-mono text-xs" style={{ color: '#5d6b7a' }}>, sky clear, </div>}
        <div className="space-y-0.5 max-h-[120px] overflow-hidden">
          {g.threats.filter(t => t.alive).slice(0, 6).map(th => {
            const tt = TT[th.type];
            const isFiberOptic = th.type === 'fpv_of' || th.type === 'lancet_of';
            const isEmitDecoy = th.type === 'emit_decoy';
            return (
              <div key={th.id} className="flex items-center gap-2 text-[10px] f-mono">
                <span style={{ color: tt.color, fontSize: '12px' }}>■</span>
                <span style={{ flex: 1 }}>{th.classified ? tt.code : 'UNK'}</span>
                {tt.class === 'ballistic' && <span style={{ color: '#d24a44', fontWeight: 'bold' }}>[!]</span>}
                {isFiberOptic && th.classified && <span style={{ color: '#d24a44', fontWeight: 'bold' }} title="Fiber-optic, EW immune">OF</span>}
                {isEmitDecoy && th.classified && <span style={{ color: '#d4995a', fontWeight: 'bold' }} title="Emission decoy, do not engage">DCY</span>}
                {th.disabled && <span style={{ color: '#93a1b0' }}>EW</span>}
                {th.paralleling && <span style={{ color: '#e8bd55' }}>PARA</span>}
                {th.evading && <span style={{ color: '#5d6b7a' }}>EVD</span>}
                {th.targetAsset && <span style={{ color: '#d24a44' }}>HUNT</span>}
                {th.counterStrike && <span style={{ color: '#d24a44' }}>C/S</span>}
              </div>
            );
          })}
        </div>
      </div>

      {g.intDrones && g.intDrones.length > 0 && (
        <div className="border-2 p-2" style={{ background: 'rgba(210,74,68,0.05)', borderColor: '#d9a52f' }}>
          <div className="f-display text-base" style={{ color: '#d9a52f' }}>FPV DRONES IN FLIGHT</div>
          <div className="space-y-0.5 max-h-[100px] overflow-y-auto">
            {g.intDrones.map(d => {
              const fuelPct = clamp(1 - d.ageGT / d.fuelMaxGT, 0, 1);
              return (
                <div key={d.id} className="flex items-center gap-2 text-[10px] f-mono">
                  <span style={{ fontSize: '11px', color: d.abandoned ? '#5d6b7a' : '#d9a52f' }}>▲</span>
                  <span style={{ flex: 1 }}>{d.abandoned ? 'ABANDONED' : `> ${d.targetCode}`}</span>
                  <span style={{ color: fuelPct < 0.3 ? '#d24a44' : '#93a1b0' }}>{(fuelPct * 100).toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RunBottom({ g }) {
  const colors = { contact: '#d9a52f', ok: '#2f80d6', warn: '#5d6b7a', crit: '#d24a44', wave: '#2f80d6', info: '#93a1b0' };
  return (
    <div className="mt-2 border-2 border-[#243d52] p-2 h-32 overflow-hidden" style={{ background: '#102234' }}>
      <div className="f-display text-sm" style={{ color: '#d9a52f' }}>EVENT LOG</div>
      <div className="space-y-0.5 f-mono text-[10px] mt-1 max-h-[100px] overflow-y-auto">
        {g.log.slice(0, 14).map((e, i) => (
          <div key={i} className="flex gap-3">
            <span style={{ color: '#5d6b7a', minWidth: 60 }}>{fmtGameTime(e.gt)}</span>
            <span style={{ color: colors[e.type] || '#dde3ea' }}>{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// DEBRIEF
// ============================================================================
function DebriefScreen({ g, instructorNotes, instructorMode, onMenu }) {
  const m = g.m;
  const realKilled = m.threatsKilled - m.decoysHit;
  const successRate = m.realThreatsSpawned > 0 ? (1 - m.leakedReal / m.realThreatsSpawned) : 0;
  const spendK = Object.entries(m.weaponSpend||{}).reduce((acc,[t,n])=>acc+(n||0)*m_shotCostK(t),0);
  const valueK = m.valueDestroyedK||0;
  const infraK = m.infraLostK||0;
  const exch = spendK>0 ? valueK/spendK : 0;
  const perKillK = realKilled>0 ? spendK/realKilled : 0;
  const fmtM = (k)=> '$'+(k/1000).toFixed(k>=1000?1:2)+'M';
  // ---- data-driven AAR (Q3/Q4) ----
  const _shots = m.intercepts + m.intercept_misses;
  const _missPct = _shots>0 ? Math.round(m.intercept_misses/_shots*100) : 0;
  const keyNodes = (g.nodes||[]).map(n=>n.name).filter(Boolean).slice(0,5).join(', ') || 'all assigned nodes';
  const aarWell=[], aarPoor=[], aarSustain=[], aarImprove=[];
  if (m.leakedReal===0) { aarWell.push(`Zero leakage: all ${m.realThreatsSpawned} real threats stopped short of the nodes.`); aarSustain.push('Sustain the layered coverage that produced zero leakage.'); }
  else { aarPoor.push(`${m.leakedReal} threats leaked through for ${m.leakDmg} HP of node damage.`); aarImprove.push('Close the coverage gap on the leak axis; push SHORAD and gun groups forward of the nodes they protect.'); }
  if (infraK>0) aarPoor.push(`Infrastructure value lost: ${fmtM(infraK)}.`);
  if (spendK>0 && exch>=1) { aarWell.push(`Positive cost exchange (${exch.toFixed(1)}x): ${fmtM(valueK)} destroyed for ${fmtM(spendK)}.`); aarSustain.push('Maintain interceptor economy: guns and drone-interceptors on cheap OWA, missiles held for high-value tracks.'); }
  else if (spendK>0) { aarPoor.push(`Negative cost exchange: spent ${fmtM(spendK)} to destroy ${fmtM(valueK)} of threats.`); aarImprove.push('Rebalance weapon-to-threat matching; stop spending high-end missiles on low-cost drones.'); }
  if (m.decoysHit>0) { aarPoor.push(`${m.decoysHit} interceptor(s) wasted on decoys.`); aarImprove.push('Train decoy discrimination: hold fire on emission decoys or service them with guns.'); }
  else if (_shots>0) aarWell.push('No interceptors wasted on decoys.');
  if (m.strikesAverted>0) { aarWell.push(`${m.strikesAverted} strike(s) averted by breaking the recon-strike kill chain.`); aarSustain.push('Keep contesting adversary ISR early to break kill chains before strikes launch.'); }
  if (m.reconKills>0) aarWell.push(`${m.reconKills} adversary ISR platform(s) eliminated.`);
  if (m.compromises>0) {
    aarPoor.push(`${m.compromises} position compromise(s): emitters radiated too long and were located.`);
    if (m.relocations>0) aarSustain.push('Sustain shoot-and-scoot: relocating radars after firing defeated counter-fire.');
    else aarImprove.push('Enforce emission control: cap radar ENGAGE time and relocate immediately after each firing window.');
  }
  if (m.assetsLost>0) { aarPoor.push(`${m.assetsLost} AD asset(s) lost to counter-fire.`); aarImprove.push('Disperse and relocate high-value radars; never leave a big emitter static under counter-AD.'); }
  else aarWell.push('All AD assets survived.');
  if ((m.spoofed||0)>0) { aarWell.push(`${m.spoofed} threat(s) spoofed off course by navigation EW (non-kinetic, $0).`); aarSustain.push('Lean on navigation EW: it defeats GNSS-guided drones and cruise at zero interceptor cost.'); }
  if ((m.theaterInit||0)>0 && (m.theaterUsed||0) >= (m.theaterInit||0)) { aarPoor.push(`Theater interceptor pool exhausted (all ${m.theaterInit} high-end rounds used).`); aarImprove.push('Ration high-end interceptors; let SHORAD and guns service cheap OWA so the theater pool lasts.'); }
  if (_shots>0 && _missPct>40) { aarPoor.push(`High intercept miss rate (${_missPct}%).`); aarImprove.push('Engage within optimal range; avoid long-range low-Pk shots that burn rounds.'); }
  if ((m.reloadsRequested||0) > (m.reloadsCompleted||0)) aarImprove.push('Pre-stage reloads; rearm cycles lagged demand during saturation.');
  if (perKillK>800) aarPoor.push(`High cost per kill: ${fmtM(perKillK)}.`);
  if (!aarSustain.length) aarSustain.push('Sustain the engagement-priority discipline that held the line.');
  if (!aarImprove.length) aarImprove.push('Refine sensor coverage and ROE transition timing between phases.');
  const _take=(arr,n)=>arr.slice(0,n);
  // ---- measurement & data layer ----
  const _avg = (arr)=> arr && arr.length ? arr.reduce((a,x)=>a+x,0)/arr.length : 0;
  const _GTm = 60*1000;
  const avgClassifyMin = +(_avg(m.classifyLat)/_GTm).toFixed(1);
  const avgEngageMin = +(_avg(m.engageLat)/_GTm).toFixed(1);
  const assetsTotal = (g.assets||[]).length || 1;
  const assetsAlive = (g.assets||[]).filter(a=>a.alive).length;
  const sc_protection = clamp(successRate, 0, 1);
  const sc_economy = spendK<=0 ? 0.6 : clamp(exch/2, 0, 1);
  const sc_surv = clamp(assetsAlive/assetsTotal, 0, 1);
  const sc_resp = clamp(1 - avgEngageMin/10, 0, 1);
  const score = Math.round(100*(0.40*sc_protection + 0.20*sc_economy + 0.20*sc_surv + 0.20*sc_resp));
  const scoreColor = score>=75 ? '#2f80d6' : score>=50 ? '#b8893a' : '#d24a44';
  const savedRef = React.useRef(false);
  React.useEffect(() => {
    if (savedRef.current) return; savedRef.current = true;
    try {
      const prev = JSON.parse(localStorage.getItem('sw_sessions_v1') || '[]');
      prev.push({ when: Date.now(), scenario: (g.sc && g.sc.name) || 'custom', score, successPct: Math.round(successRate*100), avgClassifyMin, avgEngageMin, commandActions: m.commandActions||0, spendK: Math.round(spendK), valueK: Math.round(valueK), leaked: m.leakedReal||0 });
      localStorage.setItem('sw_sessions_v1', JSON.stringify(prev.slice(-50)));
    } catch(e) {}
  }, []);
  let sessions = []; try { sessions = JSON.parse(localStorage.getItem('sw_sessions_v1')||'[]'); } catch(e) { sessions = []; }
  const exportSession = () => {
    const data = {
      tool:'SKYWATCH', exportedAt:new Date().toISOString(),
      scenario:{ name:(g.sc&&g.sc.name)||'custom', map:g.sc&&g.sc.map, totalGameHours:g.sc&&g.sc.totalGameHours, flags:{ altitudeRealism:!!(g.sc&&g.sc.altitudeRealism), adaptiveAdversary:!!(g.sc&&g.sc.adaptiveAdversary), gnssSpoofing:!!(g.sc&&g.sc.gnssSpoofing), theaterStock:(g.sc&&g.sc.theaterStock)||null } },
      score:{ total:score, protection:+sc_protection.toFixed(2), economy:+sc_economy.toFixed(2), survivability:+sc_surv.toFixed(2), responsiveness:+sc_resp.toFixed(2) },
      decision:{ avgTimeToClassifyMin:avgClassifyMin, avgTimeToFirstEngageMin:avgEngageMin, threatsEngaged:m.engagedCount||0, commandActions:m.commandActions||0 },
      outcome:{ successPct:Math.round(successRate*100), realThreats:m.realThreatsSpawned, killed:realKilled, leaked:m.leakedReal, assetsLost:m.assetsLost, compromises:m.compromises, relocations:m.relocations, spoofed:m.spoofed||0, strikesAverted:m.strikesAverted },
      economy:{ interceptionSpendK:Math.round(spendK), valueDestroyedK:Math.round(valueK), infraLostK:Math.round(infraK), exchange:+exch.toFixed(2), costPerKillK:Math.round(perKillK), theaterUsed:m.theaterUsed||0, theaterInit:m.theaterInit||0 },
      weaponSpend:m.weaponSpend||{},
      events:(g.log||[]).slice().reverse().map(l=>({ gt:l.gt, type:l.type, msg:l.msg })),
    };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`skywatch_session_${Date.now()}.json`; a.click();
  };
  const exportCSV = () => {
    const rows = [ ['metric','value'], ['scenario',(g.sc&&g.sc.name)||'custom'], ['score',score], ['protection',sc_protection.toFixed(2)], ['economy',sc_economy.toFixed(2)], ['survivability',sc_surv.toFixed(2)], ['responsiveness',sc_resp.toFixed(2)], ['success_pct',Math.round(successRate*100)], ['real_threats',m.realThreatsSpawned], ['killed',realKilled], ['leaked',m.leakedReal], ['assets_lost',m.assetsLost], ['avg_classify_min',avgClassifyMin], ['avg_engage_min',avgEngageMin], ['threats_engaged',m.engagedCount||0], ['command_actions',m.commandActions||0], ['spend_k',Math.round(spendK)], ['value_destroyed_k',Math.round(valueK)], ['infra_lost_k',Math.round(infraK)], ['exchange',exch.toFixed(2)], ['cost_per_kill_k',Math.round(perKillK)], ['spoofed',m.spoofed||0], ['theater_used',m.theaterUsed||0], ['compromises',m.compromises], ['relocations',m.relocations], ['strikes_averted',m.strikesAverted] ];
    const csv = rows.map(r=>r.join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`skywatch_session_${Date.now()}.csv`; a.click();
  };
  const nodeHpPct = g.nodes.reduce((s, n) => s + n.hp, 0) / g.nodes.reduce((s, n) => s + n.maxHp, 0);
  const survivedAssets = g.assets.filter(a => a.alive).length;
  const totalAssets = g.assets.length;
  const assetSurvival = totalAssets > 0 ? survivedAssets / totalAssets : 1;
  const missionScore = (successRate * 0.4 + nodeHpPct * 0.4 + assetSurvival * 0.2) * 100;
  const interceptRate = (m.intercepts + m.intercept_misses) > 0
    ? m.intercepts / (m.intercepts + m.intercept_misses) : 0;

  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-4xl mx-auto pt-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="f-typewriter text-xs tracking-widest" style={{ color: '#5d6b7a' }}>AAR</div>
          <div className="stamp">{g.result.outcome === 'victory' ? 'RELIEF ACHIEVED' : g.result.outcome === 'ended' ? 'SESSION ENDED' : 'OBJECTIVE LOST'}</div>
        </div>
        <h1 className="f-display" style={{ fontSize: '32px', lineHeight: 1, letterSpacing: '0.02em', color: '#2f80d6' }}>{g.sc.name}</h1>
        <div className="f-cond text-lg mb-4" style={{ color: '#d9a52f' }}>{(g.sc.totalGameHours || 48)}-HOUR DEBRIEF</div>
        <div className="double-rule mb-6" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { l: 'MISSION SCORE', v: missionScore.toFixed(0), u: '/100', g: grade(missionScore) },
            { l: 'INTERCEPT RATE', v: `${(interceptRate * 100).toFixed(0)}%`, u: '', g: grade(interceptRate * 100) },
            { l: 'NODE INTEGRITY', v: `${(nodeHpPct * 100).toFixed(0)}%`, u: '', g: grade(nodeHpPct * 100) },
            { l: 'AD SURVIVAL', v: `${survivedAssets}/${totalAssets}`, u: '', g: grade(assetSurvival * 100) },
          ].map((x, i) => (
            <div key={i} className="border-2 border-[#243d52] p-3" style={{ background: '#102234' }}>
              <div className="text-[10px] tracking-widest f-typewriter" style={{ color: '#5d6b7a' }}>{x.l}</div>
              <div className="flex items-baseline gap-1 mt-1">
                <div className="f-display text-3xl" style={{ color: x.g.c }}>{x.v}</div>
                <div className="f-mono text-xs" style={{ color: '#5d6b7a' }}>{x.u}</div>
              </div>
              <div className="mt-1 f-display text-sm" style={{ color: x.g.c }}>GRADE {x.g.l}</div>
            </div>
          ))}
        </div>

        <div className="f-mono text-[9px] mb-6" style={{ color: '#5d6b7a', letterSpacing: '0.04em' }}>
          ILLUSTRATIVE · UNCLASSIFIED · NOT VALIDATED OA. Scores and engagement outcomes derive from order-of-magnitude coefficients (public OSINT, expert estimate), not authoritative TTP or validated operational analysis.
        </div>

        <div className="border-2 p-4 mb-6" style={{ background:'#102234', borderColor: scoreColor }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="f-display text-xl" style={{ color:'#d9a52f' }}>COMMAND SCORE</div>
            <div className="f-display" style={{ fontSize:'40px', lineHeight:1, color:scoreColor }}>{score}<span className="f-mono text-[12px]" style={{ color:'#5d6b7a' }}> / 100</span></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {[['Protection',sc_protection],['Economy',sc_economy],['Survivability',sc_surv],['Responsiveness',sc_resp]].map(([lbl2,v])=>(
              <div key={lbl2}>
                <div className="f-mono text-[10px] flex justify-between" style={{ color:'#93a1b0' }}><span>{lbl2}</span><span>{Math.round(v*100)}</span></div>
                <div style={{ height:6, background:'#0a1626', borderRadius:3, overflow:'hidden', marginTop:2 }}><div style={{ width:`${Math.round(v*100)}%`, height:'100%', background:scoreColor }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="border-2 border-[#243d52] p-4" style={{ background:'#102234' }}>
            <div className="f-display text-xl mb-2" style={{ color:'#d9a52f' }}>DECISION TEMPO</div>
            <div className="f-mono text-[12px] space-y-1" style={{ color:'#dde3ea' }}>
              <div className="flex justify-between"><span>Avg time to classify</span><span style={{ color:'#5aa0e6' }}>{avgClassifyMin} min</span></div>
              <div className="flex justify-between"><span>Avg time to first engagement</span><span style={{ color:'#5aa0e6' }}>{avgEngageMin} min</span></div>
              <div className="flex justify-between"><span>Threats engaged</span><span>{m.engagedCount||0}</span></div>
              <div className="flex justify-between"><span>Command actions</span><span>{m.commandActions||0}</span></div>
            </div>
            <div className="f-mono text-[10px] mt-2" style={{ color:'#5d6b7a' }}>Command actions = ROE changes, engage-rule edits, relocations.</div>
          </div>
          <div className="border-2 border-[#243d52] p-4" style={{ background:'#102234' }}>
            <div className="f-display text-xl mb-2 flex items-center justify-between" style={{ color:'#d9a52f' }}>PROGRESSION <span className="f-mono text-[10px]" style={{ color:'#5d6b7a' }}>recent sessions</span></div>
            <div className="f-mono text-[11px] space-y-1" style={{ color:'#dde3ea' }}>
              {sessions.slice(-5).map((sx,i)=>(
                <div key={i} className="flex justify-between"><span style={{ color:'#93a1b0' }}>{new Date(sx.when).toLocaleDateString()} · {sx.scenario}</span><span>{sx.score}</span></div>
              ))}
              <div className="flex justify-between" style={{ borderTop:'1px solid #243d52', paddingTop:3, marginTop:2 }}><span style={{ color:scoreColor }}>this run</span><span style={{ color:scoreColor, fontWeight:'bold' }}>{score}</span></div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={exportSession} className="btn-riso btn-alt" style={{ padding:'6px 12px', fontSize:'11px' }}>EXPORT JSON</button>
              <button onClick={exportCSV} className="btn-riso btn-alt" style={{ padding:'6px 12px', fontSize:'11px' }}>EXPORT CSV</button>
            </div>
          </div>
        </div>

        <div className="border-2 border-[#243d52] p-4 mb-6" style={{ background: '#102234' }}>
          <div className="f-display text-xl mb-2" style={{ color: '#d9a52f' }}>COST EXCHANGE <span className="f-mono text-[10px]" style={{ color:'#5d6b7a' }}>(illustrative open-source $)</span></div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 f-mono text-[12px]" style={{ color:'#dde3ea' }}>
            <div className="flex justify-between"><span>Interception spend</span><span style={{ color:'#c8924e' }}>{fmtM(spendK)}</span></div>
            <div className="flex justify-between"><span>Threat value destroyed</span><span style={{ color:'#2f80d6' }}>{fmtM(valueK)}</span></div>
            <div className="flex justify-between"><span>Infrastructure lost</span><span style={{ color: infraK>0?'#d24a44':'#2f80d6' }}>{fmtM(infraK)}</span></div>
            <div className="flex justify-between"><span>Cost per kill</span><span>{fmtM(perKillK)}</span></div>
          </div>
          <div className="mt-3 f-mono text-[12px]" style={{ color: spendK>valueK ? '#d24a44' : '#2f80d6', lineHeight:1.5 }}>
            {spendK>valueK
              ? `Negative exchange: spent ${fmtM(spendK)} to destroy ${fmtM(valueK)} of threats. Cheap mass forced expensive interceptors. Put guns and drone-interceptors on low-cost OWA, hold missiles for high-value tracks.`
              : `Positive exchange: ${fmtM(valueK)} destroyed for ${fmtM(spendK)} (${exch.toFixed(1)}x). Interceptor economy held.`}
          </div>
        </div>

        <div className="border-2 border-[#243d52] p-4 mb-6" style={{ background: '#102234' }}>
          <div className="f-display text-xl mb-2" style={{ color: '#d9a52f' }}>EXPENDITURE</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 f-mono text-[12px]">
            {[
              ['Real threats spawned', m.realThreatsSpawned],
              ['Real threats killed', realKilled],
              ['Real threats leaked', m.leakedReal, m.leakedReal > 0],
              ['Total node damage (HP)', m.leakDmg, m.leakDmg > 0],
              ['Decoy hits (waste)', m.decoysHit, m.decoysHit > 0],
              ['Position compromises', m.compromises || 0, (m.compromises || 0) > 0],
              ['Counter-AD strikes received', m.ewCounterStrikes || 0, (m.ewCounterStrikes || 0) > 0],
              ['Threats evading AD', m.threatEvasions || 0],
              ['AD assets lost', m.assetsLost, m.assetsLost > 0],
              ['Field repairs', m.repairs],
              ['Relocations', m.relocations],
              ['Intercept attempts', m.intercepts + m.intercept_misses],
              ['Intercept misses', m.intercept_misses, m.intercept_misses > 0],
              ['Recon kills (kill-chain disruption)', m.reconKills || 0],
              ['Strikes averted via kill-chain', m.strikesAverted || 0],
              ['Fire missions used', m.fireMissionsUsed || 0],
              ['Enemy EW node neutralized', m.ewNodeNeutralized || 0],
              ['Resupply requests', m.reloadsRequested || 0],
              ['Resupply completed', m.reloadsCompleted || 0],
              ['Interceptor drones launched', m.intDronesLaunched || 0],
              ['Interceptor drones hit', m.intDronesHit || 0],
              ['Interceptor drones lost (target killed first)', m.intDronesLost || 0, (m.intDronesLost || 0) > 0],
              ['Interceptor drones missed', m.intDronesMissed || 0, (m.intDronesMissed || 0) > 0],
              ...Object.entries(m.weaponSpend).filter(([k, v]) => v > 0).map(([k, v]) => [`${k.toUpperCase()} fired`, v]),
            ].map(([k, v, alert], i) => (
              <div key={i} className="flex justify-between border-b border-[#243d52]/20 pb-0.5">
                <span style={{ color: '#93a1b0' }}>{k}</span>
                <span className="font-bold" style={{ color: alert ? '#d24a44' : '#dde3ea' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AAR TIMELINE, hourly event density */}
        {g.hourBuckets && Object.keys(g.hourBuckets).length > 0 && (
          <div className="border-2 border-[#243d52] p-4 mb-6" style={{ background: '#102234' }}>
            <div className="f-display text-xl mb-2" style={{ color: '#d9a52f' }}>AAR TIMELINE, HOURLY EVENT DENSITY</div>
            <div className="text-[10px] f-mono mb-3" style={{ color: '#5d6b7a' }}>
              SPAWNED (orange) · KILLED (green) · LEAKED (red), bar height = count per game-hour
            </div>
            {(() => {
              const totalH = g.sc.totalGameHours || 48;
              const buckets = [];
              let maxCount = 1;
              for (let h = 0; h < totalH; h++) {
                const b = g.hourBuckets[h] || { spawned: 0, killed: 0, leaked: 0, alerts: 0 };
                buckets.push({ h, ...b });
                maxCount = Math.max(maxCount, b.spawned, b.killed, b.leaked);
              }
              const barW = Math.max(8, Math.min(20, 720 / totalH));
              const chartH = 80;
              return (
                <svg viewBox={`0 0 ${totalH * barW + 50} ${chartH + 30}`} className="w-full h-auto">
                  {buckets.map(b => {
                    const x = b.h * barW + 30;
                    const sH = (b.spawned / maxCount) * chartH;
                    const kH = (b.killed / maxCount) * chartH;
                    const lH = (b.leaked / maxCount) * chartH;
                    return (
                      <g key={b.h}>
                        <rect x={x} y={chartH - sH} width={(barW - 2) / 3} height={sH} fill="#d9a52f" />
                        <rect x={x + (barW - 2) / 3} y={chartH - kH} width={(barW - 2) / 3} height={kH} fill="#2f80d6" />
                        <rect x={x + 2 * (barW - 2) / 3} y={chartH - lH} width={(barW - 2) / 3} height={lH} fill="#d24a44" />
                        {b.h % Math.max(1, Math.floor(totalH / 12)) === 0 && (
                          <text x={x + barW / 2} y={chartH + 10} fontSize="7" fill="#93a1b0" textAnchor="middle" className="f-mono">
                            H+{b.h}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {/* X-axis */}
                  <line x1="30" y1={chartH} x2={totalH * barW + 30} y2={chartH} stroke="#dde3ea" strokeWidth="0.8" />
                  {/* Y-axis label */}
                  <text x="2" y="10" fontSize="7" fill="#93a1b0" className="f-mono">{maxCount}</text>
                  <text x="2" y={chartH - 2} fontSize="7" fill="#93a1b0" className="f-mono">0</text>
                </svg>
              );
            })()}
          </div>
        )}

        {/* NATO 4-question AAR framework */}
        <div className="border-2 border-[#243d52] p-4 mb-6" style={{ background: '#102234' }}>
          <div className="f-display text-xl mb-2" style={{ color: '#2f80d6' }}>STRUCTURED AAR (NATO 4-QUESTION FORMAT)</div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="border-l-4 pl-3 py-2" style={{ borderColor: '#2f80d6' }}>
              <div className="f-typewriter text-[10px] tracking-widest mb-1" style={{ color: '#d9a52f' }}>1. WHAT WAS SUPPOSED TO HAPPEN?</div>
              <div className="f-serif text-[12px] leading-relaxed">
                Defend the assigned nodes ({keyNodes}) against {g.sc.totalGameHours}-hour adversary IAMD pressure and maintain their structural integrity.
                Prioritise ballistic to long-range SAM, OWA to organic SHORAD and gun groups, tactical strike threats to C-UAS.
              </div>
            </div>
            <div className="border-l-4 pl-3 py-2" style={{ borderColor: '#d9a52f' }}>
              <div className="f-typewriter text-[10px] tracking-widest mb-1" style={{ color: '#d9a52f' }}>2. WHAT ACTUALLY HAPPENED?</div>
              <div className="f-serif text-[12px] leading-relaxed">
                {g.m.realThreatsSpawned || 0} threats spawned · {(g.m.threatsKilled || 0) - (g.m.decoysHit || 0)} engaged ·
                {g.m.leakedReal || 0} leaked through · {g.m.leakDmg || 0} HP damage taken ·
                {g.m.assetsLost || 0} AD assets lost ·
                {g.m.compromises || 0} position compromises ·
                {g.m.reconKills || 0} adversary recon eliminated ·
                {g.m.strikesAverted || 0} strikes averted via kill-chain disruption.
              </div>
            </div>
            <div className="border-l-4 pl-3 py-2" style={{ borderColor: '#2f80d6' }}>
              <div className="f-typewriter text-[10px] tracking-widest mb-1" style={{ color: '#2f80d6' }}>3. WHAT WENT WELL / POORLY?</div>
              <div className="f-serif text-[12px] leading-relaxed">
                {_take(aarWell,4).length>0 && <div className="mb-1"><span className="f-mono text-[11px]" style={{ color:'#2f80d6' }}>WELL  </span>{_take(aarWell,4).join('  ')}</div>}
                {_take(aarPoor,4).length>0 && <div><span className="f-mono text-[11px]" style={{ color:'#d24a44' }}>POORLY  </span>{_take(aarPoor,4).join('  ')}</div>}
                {aarWell.length===0 && aarPoor.length===0 && <em>Nominal serial, no notable deviations.</em>}
              </div>
            </div>
            <div className="border-l-4 pl-3 py-2" style={{ borderColor: '#b8893a' }}>
              <div className="f-typewriter text-[10px] tracking-widest mb-1" style={{ color: '#b8893a' }}>4. WHAT WE WILL SUSTAIN / IMPROVE?</div>
              <div className="f-serif text-[12px] leading-relaxed">
                <div className="mb-1"><span className="f-mono text-[11px]" style={{ color:'#2f80d6' }}>SUSTAIN  </span>{_take(aarSustain,3).join('  ')}</div>
                <div><span className="f-mono text-[11px]" style={{ color:'#b8893a' }}>IMPROVE  </span>{_take(aarImprove,3).join('  ')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Instructor notes (if any) */}
        {instructorNotes && instructorNotes.length > 0 && (
          <div className="border-2 p-4 mb-6" style={{ background: '#102234', borderColor: '#b8893a' }}>
            <div className="f-display text-xl mb-2" style={{ color: '#b8893a' }}>INSTRUCTOR OBSERVATIONS</div>
            <div className="space-y-2">
              {instructorNotes.map((n, i) => (
                <div key={i} className="border-l-4 pl-3 py-1" style={{ borderColor: '#b8893a' }}>
                  <div className="f-mono text-[10px]" style={{ color: '#b8893a' }}>
                    <strong>{n.dtg}</strong> · {fmtGameTime(n.gt)}
                  </div>
                  <div className="f-serif text-[13px]">{n.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onMenu} className="btn-riso">‹ MENU</button>
          <button onClick={() => window.print()} className="btn-riso btn-alt">🖨 PRINT AAR</button>
        </div>
      </div>
      <div className="cls-banner mt-8">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
    </div>
  );
}


// =====================================================================
// MODELLING / SCENARIO BUILDER  (custom threats + wave authoring)
// Reads module-level TT, CARDS, GH, SCENARIOS, VECTORS, TIME_COMPRESSION,
// STOLYTSIA_PHASES, IRON_WIND_PHASES, COMMON_PREPLACED, CAPITAL/COMMON_INVENTORY.
// =====================================================================
const M_ALT = {
  noe:  { label: 'NOE  (<100 m)',     classify: 2500, sig: 'tiny'   },
  low:  { label: 'Low  (0.1-1 km)',   classify: 2100, sig: 'small'  },
  med:  { label: 'Med  (1-5 km)',     classify: 1700, sig: 'medium' },
  high: { label: 'High (5-12 km)',    classify: 1200, sig: 'large'  },
  ball: { label: 'Ballistic arc',     classify: 800,  sig: 'huge'   },
};
const M_NAV = {
  gnss_ins:   { label: 'GNSS / INS',          ewVuln: false, avoid: 0.05, note: 'GNSS-jam divertable' },
  fiber:      { label: 'Fiber-optic',         ewVuln: false, avoid: 0.00, note: 'EW immune' },
  radio:      { label: 'Radio / FPV link',    ewVuln: true,  avoid: 0.00, note: 'Link-jam vulnerable' },
  optical_ai: { label: 'Optical / AI terminal',ewVuln: false, avoid: 0.10, note: 'EW resistant' },
  laser:      { label: 'Laser-designated',    ewVuln: false, avoid: 0.00, note: 'Needs designator' },
};
const M_CLASSES = ['owa','cruise','ballistic','glide','recon','tactical','male','indirect','unknown'];
const M_RCS = ['', 'tiny','small','medium','large','huge'];
const M_BEAR = ['N','NE','E','SE','S'];
const M_ASSET_KINDS = {
  sam_long:    { label:'Long-range SAM',        mapAs:'nasams',      range:220, ammoMax:8,   firingDelay:4000, deployTime:18000, ceiling:'high', engage:['cruise','glide','owa','male'], hp:2 },
  sam_abm:     { label:'Heavy SAM (ABM)',       mapAs:'patriot',     range:360, ammoMax:6,   firingDelay:6000, deployTime:30000, ceiling:'ball', engage:['ballistic','cruise','male'], hp:3 },
  shorad:      { label:'SHORAD',                mapAs:'gepard',      range:80,  ammoMax:12,  firingDelay:1500, deployTime:5000,  ceiling:'med',  engage:['owa','tactical','recon'], hp:2 },
  manpads:     { label:'MANPADS',               mapAs:'stinger',     range:110, ammoMax:5,   firingDelay:2500, deployTime:3000,  ceiling:'med',  engage:['owa','male'], hp:1 },
  gun:         { label:'Gun / AAA',             mapAs:'zu23',        range:48,  ammoMax:120, firingDelay:800,  deployTime:1200,  ceiling:'low',  engage:['owa','tactical','recon'], hp:1 },
  interceptor: { label:'Interceptor drone crew',mapAs:'interceptor', range:280, ammoMax:6,   firingDelay:5000, deployTime:2000,  ceiling:'med',  engage:['owa','recon'], hp:1, isInterceptor:true, droneSpeed:0.20, droneFuelMin:12 },
  ew:          { label:'EW suite',              mapAs:'ew',          range:95,  ammoMax:100, firingDelay:0,    deployTime:4000,  ceiling:'med',  engage:['tactical','recon'], hp:2, isEW:true },
};
// Per-class Pk profiles for catalog variants (engine prefers CARDS[id].pk if present).
const AD_PK = {
  abm_long:  { ballistic:0.82, cruise:0.70, glide:0.55, owa:0.45, male:0.80, tactical:0.10, recon:0.20, unknown:0.15, indirect:0 },
  aero_long: { ballistic:0.15, cruise:0.78, glide:0.62, owa:0.60, male:0.85, tactical:0.20, recon:0.35, unknown:0.20, indirect:0 },
  med_sam:   { ballistic:0.05, cruise:0.72, glide:0.60, owa:0.70, male:0.80, tactical:0.40, recon:0.50, unknown:0.30, indirect:0 },
  point_sam: { ballistic:0.0,  cruise:0.55, glide:0.55, owa:0.72, male:0.50, tactical:0.62, recon:0.55, unknown:0.35, indirect:0 },
  shorad:    { ballistic:0.0,  cruise:0.18, glide:0.22, owa:0.66, male:0.30, tactical:0.60, recon:0.66, unknown:0.32, indirect:0 },
  manpads:   { ballistic:0.0,  cruise:0.18, glide:0.28, owa:0.55, male:0.40, tactical:0.42, recon:0.46, unknown:0.25, indirect:0 },
  gun:       { ballistic:0.0,  cruise:0.05, glide:0.08, owa:0.45, male:0.10, tactical:0.50, recon:0.55, unknown:0.20, indirect:0 },
};
// Allied / Ukrainian-operated air defence catalogue. Families with selectable modifications (variants).
// A variant with baseCard reuses an existing tuned card; otherwise a card is injected into CARDS below.
const ALLIED_AD = [
  { key:'patriot', family:'Patriot', nation:'US', role:'sam', mapAs:'patriot', echelons:['strategic','corps'], variants:[
    { id:'pac2',    name:'PAC-2 GEM-T', range:360, ammoMax:8,  ceiling:'high', engage:['cruise','glide','owa','male'],        pk:'aero_long' },
    { id:'pac3',    name:'PAC-3 CRI',   baseCard:'patriot' },
    { id:'pac3mse', name:'PAC-3 MSE',   range:400, ammoMax:12, ceiling:'ball', engage:['ballistic','cruise','glide','male'],  pk:'abm_long' },
  ]},
  { key:'sampt', family:'SAMP/T', nation:'FR/IT', role:'sam', mapAs:'patriot', echelons:['strategic','corps'], variants:[
    { id:'b1', name:'Aster 30 B1', range:360, ammoMax:8, ceiling:'high', engage:['cruise','glide','owa','male'],       pk:'aero_long' },
    { id:'ng', name:'NG (B1NT)',   range:400, ammoMax:8, ceiling:'ball', engage:['ballistic','cruise','glide','male'], pk:'abm_long' },
  ]},
  { key:'sa10', family:'S-300', nation:'UA', role:'sam', mapAs:'patriot', echelons:['strategic','corps'], variants:[
    { id:'ps',  name:'PS (SA-10b)', range:330, ammoMax:8, ceiling:'high', engage:['cruise','glide','owa','male'], pk:'aero_long' },
    { id:'pmu', name:'PMU-1',       range:380, ammoMax:8, ceiling:'high', engage:['cruise','glide','owa','male'], pk:'aero_long' },
    { id:'v1',  name:'V1 (SA-12)',  range:360, ammoMax:8, ceiling:'ball', engage:['ballistic','cruise','male'],   pk:'abm_long' },
  ]},
  { key:'hawk', family:'HAWK', nation:'US', role:'sam', mapAs:'nasams', echelons:['corps','brigade'], variants:[
    { id:'p3', name:'Phase III', range:210, ammoMax:6, ceiling:'high', engage:['cruise','glide','owa','male'], pk:'aero_long' },
  ]},
  { key:'iris', family:'IRIS-T', nation:'DE', role:'sam', mapAs:'iris', echelons:['strategic','corps','brigade'], variants:[
    { id:'slm', name:'SLM (medium)', baseCard:'iris_t' },
    { id:'sls', name:'SLS (short)',  range:140, ammoMax:8, ceiling:'med', engage:['cruise','glide','owa'], pk:'point_sam' },
  ]},
  { key:'nasams', family:'NASAMS', nation:'NO/US', role:'sam', mapAs:'nasams', echelons:['corps','brigade'], variants:[
    { id:'amraam', name:'AMRAAM',    baseCard:'nasams' },
    { id:'er',     name:'AMRAAM-ER', range:280, ammoMax:8, ceiling:'high', engage:['cruise','glide','owa','male'], pk:'med_sam' },
  ]},
  { key:'buk', family:'Buk', nation:'UA', role:'sam', mapAs:'nasams', echelons:['corps','brigade'], variants:[
    { id:'m1',  name:'M1 (SA-11)', range:230, ammoMax:8, ceiling:'high', engage:['cruise','glide','owa','male'],       pk:'med_sam' },
    { id:'m12', name:'M1-2',       range:250, ammoMax:8, ceiling:'high', engage:['ballistic','cruise','glide','male'], pk:'med_sam' },
  ]},
  { key:'tor', family:'Tor', nation:'UA', role:'shorad', mapAs:'crotale', echelons:['corps','brigade','battalion'], variants:[
    { id:'m1', name:'Tor-M1 (SA-15)', range:120, ammoMax:8, ceiling:'med', engage:['cruise','glide','owa','tactical'], pk:'point_sam' },
  ]},
  { key:'crotale', family:'Crotale', nation:'FR', role:'shorad', mapAs:'crotale', echelons:['corps','brigade','battalion'], variants:[
    { id:'ng', name:'Crotale NG', baseCard:'crotale' },
  ]},
  { key:'osa', family:'Osa', nation:'UA', role:'shorad', mapAs:'crotale', echelons:['brigade','battalion'], variants:[
    { id:'akm', name:'Osa-AKM (SA-8)', range:100, ammoMax:6, ceiling:'med', engage:['cruise','owa','tactical'], pk:'point_sam' },
  ]},
  { key:'gepard', family:'Gepard', nation:'DE', role:'gun', mapAs:'gepard', echelons:['corps','brigade','battalion'], variants:[
    { id:'a', name:'35mm SPAAG', baseCard:'gepard' },
  ]},
  { key:'skynex', family:'Skynex', nation:'DE', role:'gun', mapAs:'skynex', echelons:['strategic','corps','brigade'], variants:[
    { id:'ahead', name:'35mm AHEAD', baseCard:'skynex' },
  ]},
  { key:'tunguska', family:'Tunguska', nation:'UA', role:'gun', mapAs:'gepard', echelons:['brigade','battalion'], variants:[
    { id:'m1', name:'2K22 (SA-19)', range:90, ammoMax:32, ceiling:'low', engage:['owa','tactical','recon'], pk:'shorad' },
  ]},
  { key:'shilka', family:'Shilka', nation:'UA', role:'gun', mapAs:'gepard', echelons:['brigade','battalion'], variants:[
    { id:'m4', name:'ZSU-23-4', range:50, ammoMax:50, ceiling:'noe', engage:['owa','tactical','recon'], pk:'gun' },
  ]},
  { key:'stinger', family:'Stinger', nation:'US', role:'manpads', mapAs:'stinger', echelons:['corps','brigade','battalion'], variants:[
    { id:'fim92', name:'FIM-92', baseCard:'stinger' },
  ]},
  { key:'piorun', family:'Piorun', nation:'PL', role:'manpads', mapAs:'stinger', echelons:['brigade','battalion'], variants:[
    { id:'p', name:'MANPADS', baseCard:'piorun' },
  ]},
  { key:'mistral', family:'Mistral', nation:'FR', role:'manpads', mapAs:'stinger', echelons:['brigade','battalion'], variants:[
    { id:'m3', name:'Mistral 3', range:65, ammoMax:6, ceiling:'low', engage:['owa','tactical','recon','cruise'], pk:'manpads' },
  ]},
  { key:'igla', family:'Igla', nation:'UA', role:'manpads', mapAs:'stinger', echelons:['brigade','battalion'], variants:[
    { id:'s', name:'Igla-S (SA-24)', range:55, ammoMax:6, ceiling:'low', engage:['owa','tactical','recon'], pk:'manpads' },
  ]},
  { key:'zu23', family:'ZU-23-2', nation:'UA', role:'gun', mapAs:'zu23', echelons:['brigade','battalion'], variants:[
    { id:'g', name:'23mm towed', baseCard:'mg_a' },
  ]},
  { key:'hmg', family:'C-UAS MG team', nation:'UA', role:'gun', mapAs:'hmg', echelons:['brigade','battalion'], variants:[
    { id:'127', name:'12.7mm HMG', baseCard:'mg_b' },
  ]},
  { key:'ew', family:'EW jammer', nation:'UA', role:'ew', mapAs:'ew', echelons:['strategic','corps','brigade','battalion'], variants:[
    { id:'cuas', name:'C-UAS jammer', baseCard:'ew_a' },
  ]},
  { key:'fpvint', family:'FPV interceptor', nation:'UA', role:'interceptor', mapAs:'interceptor', echelons:['corps','brigade','battalion'], variants:[
    { id:'eo', name:'EO/AI interceptor', baseCard:'int_a' },
  ]},
];
const adCardId = (fam, v) => v.baseCard ? v.baseCard : ('ad_' + fam.key + '_' + v.id);
const adRange = (v) => (v.baseCard && CARDS[v.baseCard]) ? CARDS[v.baseCard].range : v.range;
ALLIED_AD.forEach(fam => {
  const rd = ({ sam:{fd:4500,ms:0.05,dt:18000,hp:2,rt:45000}, shorad:{fd:2000,ms:0.07,dt:8000,hp:2,rt:25000}, gun:{fd:1100,ms:0.08,dt:6000,hp:2,rt:20000}, manpads:{fd:2000,ms:0.10,dt:3000,hp:1,rt:15000} })[fam.role] || { fd:3000,ms:0.06,dt:10000,hp:2,rt:30000 };
  fam.variants.forEach(v => {
    if (v.baseCard) return;
    const id = 'ad_' + fam.key + '_' + v.id;
    if (CARDS[id]) return;
    CARDS[id] = {
      tag: fam.key.slice(0,4).toUpperCase(), name: fam.family + ' ' + v.name, nation: fam.nation,
      range: v.range, sensorRange: Math.round(v.range * 1.25), ammoMax: v.ammoMax,
      firingDelay: rd.fd, moveSpeed: rd.ms, deployTime: rd.dt, color: '#2f80d6',
      hp: rd.hp, repairTime: rd.rt, sectorArc: 360,
      echelon: (fam.echelons && fam.echelons[fam.echelons.length - 1]) || 'bde',
      attached: false, engageDefault: v.engage, ceiling: v.ceiling,
      mapAs: fam.mapAs, pk: (AD_PK[v.pk] || AD_PK.med_sam), custom: true,
    };
  });
});
const M_ECHELONS = {
  strategic: { label:'Strategic (city)', sub:'National IAMD of a city: area and ABM SAM layered over point defence.', systems:{ patriot:{v:'pac3mse',n:1}, sa10:{v:'v1',n:1}, iris:{v:'slm',n:2}, nasams:{v:'amraam',n:1}, skynex:{v:'ahead',n:2}, stinger:{v:'fim92',n:2}, ew:{v:'cuas',n:1} } },
  corps:     { label:'Corps', sub:'Operational layered AD: medium and long-range SAM plus SHORAD.', systems:{ patriot:{v:'pac3',n:1}, iris:{v:'slm',n:1}, nasams:{v:'amraam',n:2}, tor:{v:'m1',n:1}, gepard:{v:'a',n:2}, stinger:{v:'fim92',n:2}, fpvint:{v:'eo',n:2}, ew:{v:'cuas',n:1} } },
  brigade:   { label:'Brigade', sub:'Brigade-organic AD plus attached area SAM.', systems:{ nasams:{v:'amraam',n:1}, iris:{v:'sls',n:1}, tor:{v:'m1',n:1}, gepard:{v:'a',n:2}, stinger:{v:'fim92',n:2}, piorun:{v:'p',n:1}, fpvint:{v:'eo',n:2}, hmg:{v:'127',n:2}, ew:{v:'cuas',n:1} } },
  battalion: { label:'Battalion', sub:'Short-range air defence and C-UAS only.', systems:{ gepard:{v:'a',n:1}, stinger:{v:'fim92',n:2}, piorun:{v:'p',n:2}, igla:{v:'s',n:1}, zu23:{v:'g',n:2}, hmg:{v:'127',n:2}, fpvint:{v:'eo',n:1}, ew:{v:'cuas',n:1} } },
};
function buildEchelonForce(lvl) {
  const f = {}, vs = {}; const sys = ((M_ECHELONS[lvl] || {}).systems) || {};
  Object.entries(sys).forEach(([fk, spec]) => {
    const fam = ALLIED_AD.find(x => x.key === fk); if (!fam) return;
    const v = fam.variants.find(x => x.id === spec.v) || fam.variants[0];
    vs[fk] = v.id; f[adCardId(fam, v)] = spec.n;
  });
  return { f, vs };
}
const M_KMH = 0.05 / 180;
const m_clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const m_load = (k,d)=>{ try { return JSON.parse(localStorage.getItem(k) || d); } catch(e){ return JSON.parse(d); } };
const m_symFor = (cls)=> cls==='recon' ? 'O' : cls==='ballistic' ? 'D' : cls==='cruise' ? 'arrow' : cls==='tactical' ? 'S' : cls==='male' ? 'arrow' : cls==='indirect' ? 'shell' : 'D';

function ModellingScreen({ onLaunch, onBack }) {
  const inp = { width:'100%', background:'#0a1626', color:'#eef2f6', border:'1px solid #243d52', padding:'6px 8px', borderRadius:'4px', fontSize:'13px', fontFamily:'inherit' };
  const lbl = { display:'block', marginBottom:'3px', fontSize:'10px', letterSpacing:'0.08em', color:'#93a1b0' };

  const [name,setName]       = React.useState('CUSTOM SCENARIO');
  const [map,setMap]         = React.useState('capital');
  const [totalGH,setTotalGH] = React.useState(12);
  const [enemyEW,setEnemyEW] = React.useState(false);
  const [coldStart,setCold]  = React.useState(false);
  const [customThreats,setCustomThreats] = React.useState(()=>m_load('sw_threats_v1','[]'));
  const [waves,setWaves]     = React.useState([]);
  const [saved,setSaved]     = React.useState(()=>m_load('sw_scenarios_v1','[]'));
  const [nodes,setNodes] = React.useState([]);
  const [nodeType,setNodeType] = React.useState('gov');
  const [useGeo,setUseGeo] = React.useState(false);
  const [geoTargets,setGeoTargets] = React.useState([]);
  const [geoBounds,setGeoBounds] = React.useState(null);
  const [altReal,setAltReal] = React.useState(true);
  const [adaptiveAdv,setAdaptiveAdv] = React.useState(false);
  const [gnssSpoof,setGnssSpoof] = React.useState(false);
  const [theaterStock,setTheaterStock] = React.useState(0);
  const [echelon,setEchelon] = React.useState('brigade');
  const [force,setForce] = React.useState(() => buildEchelonForce('brigade').f);
  const [variantSel,setVariantSel] = React.useState(() => buildEchelonForce('brigade').vs);
  const [customAssets,setCustomAssets] = React.useState(()=>m_load('sw_assets_v1','[]'));
  const [af,setAf] = React.useState({ name:'', kind:'sam_long', nation:'NATO', range:'', ammoMax:'', ceiling:'', engage:[] });
  const [tf,setTf] = React.useState({ name:'', side:'RU', cls:'owa', speedKmh:180, altBand:'low', warheadKg:50, navigation:'gnss_ins', rcs:'', target:'infrastructure' });
  const [wf,setWf] = React.useState({ type:'geran2', from:'E', count:6, spacingSec:30, startGH:1 });
  const [opPlan,setOpPlan] = React.useState(true);
  const resolveThreatMeta = React.useCallback((type)=>{
    const t = TT[type] || (customThreats.find(c=>c.key===type)||{}).def;
    const cls = t ? t.class : 'owa';
    const kmh = (t && t.speed) ? Math.round(t.speed / M_KMH) : ({owa:185,cruise:800,glide:700,ballistic:6500,male:200,recon:120,tactical:160,indirect:300,unknown:160}[cls]||200);
    const maneuver = t && t.maneuver != null ? t.maneuver : (cls === 'cruise' ? 1.0 : cls === 'owa' ? 0.45 : cls === 'glide' ? 0.2 : 0);
    const gLimit = t && t.gLimit != null ? t.gLimit : (cls === 'cruise' ? 5 : cls === 'owa' ? 2.5 : cls === 'glide' ? 3 : cls === 'ballistic' ? 0.5 : 4);
    return { family: cls, kmh, dmg: t ? (t.dmg||1) : 1, maneuver, gLimit, mirv: (t && t.mirv) || 0, mirvSplitKm: (t && t.mirvSplitKm) || 0 };
  }, [customThreats]);
  const threatOptions = React.useMemo(()=>{
    const fams = ['ballistic','cruise','glide','owa','male','tactical'];
    const base = Object.entries(TT)
      .filter(([k,t]) => fams.includes(t.class) || k === 'decoy')
      .map(([k,t]) => ({ key:k, label: `${t.name} · ${t.class}` }));
    const cust = customThreats.map(c => ({ key: c.key, label: `${(c.def && c.def.name) || c.key} · custom` }));
    return [...base, ...cust];
  }, [customThreats]);

  const persistThreats=(list)=>{ setCustomThreats(list); try{localStorage.setItem('sw_threats_v1',JSON.stringify(list));}catch(e){} };
  const persistSaved=(list)=>{ setSaved(list); try{localStorage.setItem('sw_scenarios_v1',JSON.stringify(list));}catch(e){} };
  const persistAssets=(list)=>{ setCustomAssets(list); try{localStorage.setItem('sw_assets_v1',JSON.stringify(list));}catch(e){} };
  const toggleEng=(cl)=>setAf(prev=>({ ...prev, engage: prev.engage.includes(cl) ? prev.engage.filter(x=>x!==cl) : [...prev.engage, cl] }));
  const buildAsset=()=>{
    if(!af.name.trim()) return;
    const k=M_ASSET_KINDS[af.kind];
    const eng=(af.engage && af.engage.length) ? af.engage : k.engage;
    const def={ tag:(af.name.replace(/[^a-z0-9]/gi,'').slice(0,6)||'CUST').toUpperCase(), name:af.name.slice(0,28), nation:af.nation||'CUST', range:(+af.range)||k.range, sensorRange:Math.round(((+af.range)||k.range)*1.25), ammoMax:(+af.ammoMax)||k.ammoMax, firingDelay:k.firingDelay, moveSpeed:0.08, deployTime:k.deployTime, color:'#2f80d6', hp:k.hp, repairTime:30000, sectorArc:360, echelon:'bde', attached:false, engageDefault:eng, ceiling:af.ceiling||k.ceiling, mapAs:k.mapAs, custom:true, ...(k.isInterceptor?{isInterceptor:true,droneSpeed:k.droneSpeed,droneFuelMin:k.droneFuelMin}:{}), ...(k.isEW?{isEW:true}:{}) };
    const key=`casset_${Date.now().toString(36)}${Math.floor(Math.random()*99)}`;
    persistAssets([...customAssets,{ key, def }]);
    setAf({ ...af, name:'' });
  };
  const delAsset=(key)=>persistAssets(customAssets.filter(a=>a.key!==key));

  const catalogKeys = Object.keys(TT).filter(k=>!TT[k].custom);
  const threatLabel = (k)=> TT[k] ? `${TT[k].name} [${TT[k].code}]` : (customThreats.find(t=>t.key===k)?.def.name || k);
  const allThreatKeys = [...catalogKeys, ...customThreats.map(t=>t.key)];

  const buildThreat=()=>{
    if(!tf.name.trim()){ return; }
    const a=M_ALT[tf.altBand], n=M_NAV[tf.navigation], isUA=tf.side==='UA';
    const def={
      name: tf.name.toUpperCase().slice(0,22),
      code: (tf.name.replace(/[^a-z0-9]/gi,'').slice(0,8) || 'CUSTOM').toUpperCase(),
      class: tf.cls,
      speed: m_clamp((+tf.speedKmh)*M_KMH, 0.02, 0.45),
      classify: a.classify,
      ewVuln: n.ewVuln,
      color: isUA ? '#2f80d6' : '#d24a44',
      sym: m_symFor(tf.cls),
      dmg: (+tf.warheadKg)>=100 ? 2 : 1,
      hint: `${isUA?'UA':'RU'} ${tf.cls}. ${n.note}. ~${tf.speedKmh} km/h, ${tf.warheadKg} kg.`,
      avoid: n.avoid,
      signature: tf.rcs || a.sig,
      custom: true, side: tf.side, speedKmh:+tf.speedKmh, altBand: tf.altBand, warheadKg:+tf.warheadKg, navigation: tf.navigation,
      ...(tf.target==='ad_assets' ? { target:'ad_assets' } : {}),
    };
    const key = `cst_${Date.now().toString(36)}${Math.floor(Math.random()*99)}`;
    persistThreats([...customThreats, { key, def }]);
    setTf({ ...tf, name:'' });
  };
  const delThreat=(key)=>persistThreats(customThreats.filter(t=>t.key!==key));

  const addWave=()=>{
    if((+wf.count)<1) return;
    setWaves([...waves, { ...wf, count:+wf.count, spacingSec:+wf.spacingSec, startGH:+wf.startGH, id:Date.now()+Math.random() }]);
  };
  const delWave=(id)=>setWaves(waves.filter(w=>w.id!==id));
  const totalTracks = waves.reduce((s,w)=>s+(+w.count),0);

  const buildSchedule=()=>{
    const ev=[];
    waves.forEach(w=>{ const st=(+w.startGH)*3600*1000, sp=(+w.spacingSec)*1000; for(let i=0;i<(+w.count);i++) ev.push({ gt: st+i*sp, type: w.type, from: w.from }); });
    return ev.sort((a,b)=>a.gt-b.gt);
  };
  const buildScenario=()=>{
    const schedule=buildSchedule();
    const usedKeys=[...new Set(waves.map(w=>w.type))];
    const neededThreats=customThreats.filter(t=>usedKeys.includes(t.key));
    const sc={
      id:`custom_${Date.now()}`, name: name||'CUSTOM SCENARIO',
      subtitle: map==='capital' ? 'CUSTOM · CAPITAL DEFENCE' : 'CUSTOM · BRIGADE AOR',
      difficulty:'CUSTOM', totalGameHours:+totalGH,
      realDuration:(+totalGH)*3600*1000/TIME_COMPRESSION,
      schedule, phases: map==='capital' ? STOLYTSIA_PHASES : IRON_WIND_PHASES,
      enemyEW:!!enemyEW, coldStart:!!coldStart,
      brief:`Custom authored scenario: ${waves.length} waves, ${totalTracks} tracks over ${totalGH} game-hours on the ${map} map. All values illustrative and unclassified, for modelling only.`,
      objectives:['Defend assigned nodes','Manage interceptor economy','Adapt to the authored threat profile','Read the ISR-to-strike kill chain'],
      nodes: (useGeo && geoBounds && geoTargets.length) ? geoTargets.map(g => { const q = geoToPx(geoBounds, g.lat, g.lng); return { id: g.id, x: q.x, y: q.y, name: g.name, hp: g.hp, maxHp: g.maxHp, value: g.value, glyph: g.glyph, sym: g.sym, kind: g.kind }; }) : (nodes.length ? nodes.map(n => ({ ...n })) : undefined),
      geo: (useGeo && geoBounds && geoTargets.length) ? geoBounds : undefined,
      preplaced: [], inventory: Object.entries(force).filter(([k,n]) => (+n)>0 && (CARDS[k] || customAssets.some(a=>a.key===k))).map(([k,n]) => ({ card:k, count:+n, required:0 })), altitudeRealism: !!altReal,
      map, custom:true, adaptiveAdversary: !!adaptiveAdv, gnssSpoofing: !!gnssSpoof, theaterStock: (+theaterStock)>0 ? +theaterStock : null,
    };
    return { sc, neededThreats, neededAssets: customAssets.filter(a => (+force[a.key])>0) };
  };

  const validate=()=>{
    if(!waves.length){ alert('Add at least one wave.'); return false; }
    for(const w of waves){ if(!TT[w.type] && !customThreats.find(t=>t.key===w.type)){ alert('A wave references a deleted custom threat. Remove or recreate it.'); return false; } }
    if(waves.some(w=>(+w.startGH)>(+totalGH))) { if(!confirm('Some waves start after the session ends and will not fire. Launch anyway?')) return false; }
    return true;
  };
  const launch=()=>{ if(!validate()) return; const { sc, neededThreats, neededAssets }=buildScenario(); onLaunch(sc, neededThreats, neededAssets); };

  const saveScenario=()=>{
    const nm = (name||'Untitled').trim();
    const usedKeys=[...new Set(waves.map(w=>w.type))];
    const entry={ name:nm, when:Date.now(), config:{ name:nm, map, totalGH:+totalGH, enemyEW:!!enemyEW, coldStart:!!coldStart, altReal:!!altReal, adaptiveAdv:!!adaptiveAdv, gnssSpoof:!!gnssSpoof, theaterStock:(+theaterStock)||0, echelon, force, variantSel, nodes, useGeo, geoTargets, geoBounds, waves }, customThreats: customThreats.filter(t=>usedKeys.includes(t.key)), customAssets };
    persistSaved([entry, ...saved.filter(s=>s.name!==nm)].slice(0,30));
  };
  const loadConfig=(cfg, threats, assets)=>{
    setName(cfg.name); setMap(cfg.map); setTotalGH(cfg.totalGH); setEnemyEW(!!cfg.enemyEW); setCold(!!cfg.coldStart); setAltReal(cfg.altReal!==false); setAdaptiveAdv(!!cfg.adaptiveAdv); setGnssSpoof(!!cfg.gnssSpoof); setTheaterStock(cfg.theaterStock||0); setEchelon(cfg.echelon||'brigade'); setForce(cfg.force||buildEchelonForce(cfg.echelon||'brigade').f); setVariantSel(cfg.variantSel||buildEchelonForce(cfg.echelon||'brigade').vs); setNodes(cfg.nodes||[]); setUseGeo(!!cfg.useGeo); setGeoTargets(cfg.geoTargets||[]); setGeoBounds(cfg.geoBounds||null);
    setWaves((cfg.waves||[]).map(w=>({ ...w, id:Date.now()+Math.random() })));
    if(threats && threats.length){ const merged=[...customThreats]; threats.forEach(t=>{ if(!merged.find(m=>m.key===t.key)) merged.push(t); }); persistThreats(merged); }
    if(assets && assets.length){ const merged=[...customAssets]; assets.forEach(a=>{ if(!merged.find(m=>m.key===a.key)) merged.push(a); }); persistAssets(merged); }
  };
  const delSaved=(when)=>persistSaved(saved.filter(s=>s.when!==when));

  const exportJSON=()=>{
    const usedKeys=[...new Set(waves.map(w=>w.type))];
    const data={ config:{ name, map, totalGH:+totalGH, enemyEW:!!enemyEW, coldStart:!!coldStart, altReal:!!altReal, adaptiveAdv:!!adaptiveAdv, gnssSpoof:!!gnssSpoof, theaterStock:(+theaterStock)||0, echelon, force, variantSel, nodes, useGeo, geoTargets, geoBounds, waves }, customThreats: customThreats.filter(t=>usedKeys.includes(t.key)), customAssets };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${(name||'scenario').replace(/\s+/g,'_')}.json`; a.click();
  };
  const importJSON=(e)=>{
    const f=e.target.files && e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{ try{ const d=JSON.parse(r.result); if(d.config){ loadConfig(d.config, d.customThreats, d.customAssets); } else { alert('JSON missing config block.'); } }catch(err){ alert('Could not parse JSON.'); } e.target.value=''; };
    r.readAsText(f);
  };

  const exportLibrary=()=>{
    const data={ version:1, kind:'skywatch-library', threats: customThreats, assets: customAssets };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='skywatch_library.json'; a.click();
  };
  const importLibrary=(e)=>{
    const f=e.target.files && e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{ try{
      const d=JSON.parse(r.result);
      const nt=Array.isArray(d.threats)?d.threats:[]; const na=Array.isArray(d.assets)?d.assets:[];
      if(!nt.length && !na.length){ alert('No threats or assets found in library file.'); e.target.value=''; return; }
      const mt=[...customThreats]; nt.forEach(t=>{ if(t&&t.key&&t.def&&!mt.find(x=>x.key===t.key)) mt.push(t); }); persistThreats(mt);
      const ma=[...customAssets]; na.forEach(a=>{ if(a&&a.key&&a.def&&!ma.find(x=>x.key===a.key)) ma.push(a); }); persistAssets(ma);
      alert('Library loaded (merged): +'+nt.length+' threats, +'+na.length+' assets.');
    }catch(err){ alert('Could not parse library JSON.'); } e.target.value=''; };
    r.readAsText(f);
  };

  const adCurV = (fam) => fam.variants.find(x => x.id === (variantSel[fam.key] || fam.variants[0].id)) || fam.variants[0];
  const changeVariant = (fam, newVid) => {
    const oc = adCardId(fam, adCurV(fam));
    const nv = fam.variants.find(x => x.id === newVid) || fam.variants[0];
    const nc = adCardId(fam, nv);
    setForce(f => { const nf = { ...f }; const c = nf[oc] || 0; delete nf[oc]; if (c > 0) nf[nc] = c; return nf; });
    setVariantSel(sv => ({ ...sv, [fam.key]: newVid }));
  };
  const bumpForce = (fam, d) => { const cid = adCardId(fam, adCurV(fam)); setForce(f => { const n = Math.max(0, (f[cid]||0) + d); const nf = { ...f, [cid]: n }; if (n===0) delete nf[cid]; return nf; }); };
  const bumpKey = (key, d) => setForce(f => { const n = Math.max(0, (f[key]||0) + d); const nf = { ...f, [key]: n }; if (n===0) delete nf[key]; return nf; });
  const pickEchelon = (lvl) => { const r = buildEchelonForce(lvl); setEchelon(lvl); setForce(r.f); setVariantSel(r.vs); };
  const famList = ALLIED_AD.filter(fam => !fam.echelons || fam.echelons.includes(echelon));
  const placeNode = (e) => {
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const c = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = Math.round(c.x), y = Math.round(c.y);
    if (x < 0 || x > MAP_W || y < 0 || y > MAP_H) return;
    const near = nodes.find(n => Math.hypot(n.x - x, n.y - y) < 16);
    if (near) { setNodes(nodes.filter(n => n !== near)); return; }
    const t = NODE_TYPES.find(z => z.key === nodeType) || NODE_TYPES[0];
    const cnt = nodes.filter(n => n.typeKey === t.key).length + 1;
    setNodes([...nodes, { id: t.key + '_' + Date.now(), x, y, name: t.sym + (cnt > 1 ? ('-' + cnt) : ''), hp: t.hp, maxHp: t.hp, value: t.value, glyph: t.glyph, sym: t.sym, kind: t.kind, typeKey: t.key }]);
  };
  const bumpNodeHp = (id, d) => setNodes(ns => ns.map(n => { if (n.id !== id) return n; const h = Math.max(1, Math.min(6, n.hp + d)); return { ...n, hp: h, maxHp: h }; }));
  const removeNode = (id) => setNodes(ns => ns.filter(n => n.id !== id));
  const bumpGeoHp = (id, d) => setGeoTargets(ns => ns.map(n => { if (n.id !== id) return n; const h = Math.max(1, Math.min(6, n.hp + d)); return { ...n, hp: h, maxHp: h }; }));
  const removeGeoTarget = (id) => setGeoTargets(ns => ns.filter(n => n.id !== id));
  const tlPos=(gh)=> m_clamp(((+gh)/((+totalGH)||1))*100, 0, 100);

  return (
    <div className="min-h-screen riso-paper p-6">
      {opPlan && <OperationalPlan waves={waves} resolveThreat={resolveThreatMeta} threatOptions={threatOptions} onClose={()=>{ setOpPlan(false); onBack && onBack(); }} />}
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3" style={{ borderBottom:'1px solid var(--border-default)' }}>
          <div>
            <div className="f-display text-2xl" style={{ color:'#d9a52f' }}>MODELLING / SCENARIO BUILDER</div>
            <div className="f-mono text-[11px]" style={{ color:'#93a1b0' }}>Author threats and waves, then launch into the live engine. Illustrative / UNCLASSIFIED only.</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="btn-riso btn-alt" style={{ padding:'8px 14px', fontSize:'13px' }}>‹ BACK</button>
            <button onClick={launch} className="btn-riso" style={{ padding:'8px 18px', fontSize:'14px', borderColor:'#d9a52f', color:'#d9a52f' }}>▶ LAUNCH SCENARIO</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT */}
          <div className="space-y-4">
            <div className="cop-card">
              <div className="cop-card-header" style={{ color:'var(--mil-unknown)' }}>SCENARIO</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label style={lbl}>NAME</label>
                  <input style={inp} value={name} onChange={e=>setName(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>MAP</label>
                  <select style={inp} value={map} onChange={e=>setMap(e.target.value)}>
                    <option value="capital">Capital (AURELIA)</option>
                    <option value="brigade">Brigade AOR</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>SESSION (game-hours)</label>
                  <select style={inp} value={totalGH} onChange={e=>setTotalGH(+e.target.value)}>
                    <option value="6">6 h</option><option value="12">12 h</option><option value="24">24 h</option><option value="48">48 h</option>
                  </select>
                </div>
                <label className="f-mono text-[12px] flex items-center gap-2" style={{ color:'#eef2f6' }}>
                  <input type="checkbox" checked={enemyEW} onChange={e=>setEnemyEW(e.target.checked)} /> Enemy EW node
                </label>
                <label className="f-mono text-[12px] flex items-center gap-2" style={{ color:'#eef2f6' }}>
                  <input type="checkbox" checked={coldStart} onChange={e=>setCold(e.target.checked)} /> Cold start
                </label>
                <label className="f-mono text-[12px] flex items-center gap-2 col-span-2" style={{ color:'#eef2f6' }}>
                  <input type="checkbox" checked={altReal} onChange={e=>setAltReal(e.target.checked)} /> Altitude realism (ceilings gate engagement)
                </label>
                <label className="f-mono text-[12px] flex items-center gap-2 col-span-2" style={{ color:'#eef2f6' }}>
                  <input type="checkbox" checked={adaptiveAdv} onChange={e=>setAdaptiveAdv(e.target.checked)} /> Adaptive adversary (re-aims to your weak axis, SEAD vs emitters)
                </label>
                <label className="f-mono text-[12px] flex items-center gap-2 col-span-2" style={{ color:'#eef2f6' }}>
                  <input type="checkbox" checked={gnssSpoof} onChange={e=>setGnssSpoof(e.target.checked)} /> GNSS spoofing (EW diverts GNSS/INS drones and cruise)
                </label>
                <div className="col-span-2"><label style={lbl}>THEATER HIGH-END INTERCEPTORS (Patriot/IRIS/NASAMS pool, 0 = unlimited)</label><input style={inp} type="number" value={theaterStock} onChange={e=>setTheaterStock(e.target.value)} /></div>
                <div className="col-span-2" style={{ borderTop:'1px solid #243d52', paddingTop:'12px', marginTop:'4px' }}>
                  <label style={lbl}>PLANNING LEVEL (echelon)</label>
                  <div className="flex flex-wrap gap-2 mb-2 mt-1">
                    {Object.entries(M_ECHELONS).map(([k,v])=>(
                      <button key={k} onClick={()=>pickEchelon(k)} className="btn-riso" style={{ padding:'5px 11px', fontSize:'11px', background: echelon===k?'rgba(47,128,214,0.18)':'transparent', borderColor: echelon===k?'#2f80d6':'#243d52', color: echelon===k?'#5aa0e6':'#93a1b0' }}>{v.label}</button>
                    ))}
                  </div>
                  <div className="f-mono text-[10px] mb-2" style={{ color:'#5d6b7a' }}>{M_ECHELONS[echelon].sub} Pick systems and counts below; this becomes your placeable force.</div>
                  <div className="space-y-1" style={{ maxHeight:'210px', overflowY:'auto' }}>
                    {famList.map(fam => { const v=adCurV(fam); const cid=adCardId(fam,v); const cnt=force[cid]||0; return (
                      <div key={fam.key} className="flex items-center justify-between" style={{ padding:'5px 9px', background: cnt>0?'#16293c':'#102234', border:'1px solid '+(cnt>0?'#243d52':'#16293c'), borderRadius:'3px' }}>
                        <div style={{ minWidth:0, flex:1, overflow:'hidden' }}>
                          <div className="f-mono text-[11px]" style={{ color: cnt>0?'#eef2f6':'#dde3ea' }}>{fam.family} <span style={{ color:'#5d6b7a' }}>{fam.nation}</span></div>
                          {fam.variants.length>1 ? (
                            <select value={v.id} onChange={e=>changeVariant(fam,e.target.value)} className="f-mono text-[10px]" style={{ marginTop:'3px', background:'#0a1626', color:'#5aa0e6', border:'1px solid #243d52', borderRadius:'2px', padding:'1px 4px', maxWidth:'205px' }}>
                              {fam.variants.map(vv => <option key={vv.id} value={vv.id}>{vv.name} &middot; R{adRange(vv)}</option>)}
                            </select>
                          ) : (<span className="f-mono text-[9px]" style={{ color:'#5d6b7a' }}>{v.name} &middot; R{adRange(v)}</span>)}
                        </div>
                        <div className="flex items-center gap-2" style={{ flex:'none', marginLeft:'8px' }}>
                          <button onClick={()=>bumpForce(fam,-1)} style={{ width:'21px', height:'21px', background:'#0a1626', border:'1px solid #243d52', color:'#93a1b0', borderRadius:'2px', cursor:'pointer', lineHeight:1, fontSize:'13px' }}>&minus;</button>
                          <span className="f-mono text-[12px]" style={{ color: cnt>0?'#5aa0e6':'#5d6b7a', minWidth:'14px', textAlign:'center' }}>{cnt}</span>
                          <button onClick={()=>bumpForce(fam,1)} style={{ width:'21px', height:'21px', background:'#0a1626', border:'1px solid #243d52', color:'#5aa0e6', borderRadius:'2px', cursor:'pointer', lineHeight:1, fontSize:'13px' }}>+</button>
                        </div>
                      </div>
                    );})}
                    {customAssets.length>0 && <div className="f-mono text-[9px] mt-2 mb-1" style={{ color:'#5d6b7a', letterSpacing:'0.08em' }}>YOUR MODELLED ASSETS</div>}
                    {customAssets.map(a => { const cnt=force[a.key]||0; return (
                      <div key={a.key} className="flex items-center justify-between" style={{ padding:'5px 9px', background: cnt>0?'#16293c':'#102234', border:'1px solid '+(cnt>0?'#243d52':'#16293c'), borderRadius:'3px' }}>
                        <div style={{ minWidth:0, overflow:'hidden' }}>
                          <span className="f-mono text-[11px]" style={{ color: cnt>0?'#eef2f6':'#dde3ea' }}>{a.def.name}</span>
                          <span className="f-mono text-[9px] ml-2" style={{ color:'#5d6b7a' }}>{a.def.tag} &middot; R{a.def.range} &middot; custom</span>
                        </div>
                        <div className="flex items-center gap-2" style={{ flex:'none', marginLeft:'8px' }}>
                          <button onClick={()=>bumpKey(a.key,-1)} style={{ width:'21px', height:'21px', background:'#0a1626', border:'1px solid #243d52', color:'#93a1b0', borderRadius:'2px', cursor:'pointer', lineHeight:1, fontSize:'13px' }}>&minus;</button>
                          <span className="f-mono text-[12px]" style={{ color: cnt>0?'#5aa0e6':'#5d6b7a', minWidth:'14px', textAlign:'center' }}>{cnt}</span>
                          <button onClick={()=>bumpKey(a.key,1)} style={{ width:'21px', height:'21px', background:'#0a1626', border:'1px solid #243d52', color:'#5aa0e6', borderRadius:'2px', cursor:'pointer', lineHeight:1, fontSize:'13px' }}>+</button>
                        </div>
                      </div>
                    );})}
                  </div>
                </div>
              </div>
            </div>

            <div className="cop-card">
              <div className="cop-card-header" style={{ color:'var(--mil-hostile)' }}>THREAT MODELLER</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label style={lbl}>NAME</label><input style={inp} value={tf.name} onChange={e=>setTf({...tf,name:e.target.value})} placeholder="e.g. SHAHED-238" /></div>
                <div><label style={lbl}>SIDE</label><select style={inp} value={tf.side} onChange={e=>setTf({...tf,side:e.target.value})}><option value="RU">RU (hostile)</option><option value="UA">UA</option></select></div>
                <div><label style={lbl}>CLASS</label><select style={inp} value={tf.cls} onChange={e=>setTf({...tf,cls:e.target.value})}>{M_CLASSES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
                <div><label style={lbl}>SPEED (km/h)</label><input style={inp} type="number" value={tf.speedKmh} onChange={e=>setTf({...tf,speedKmh:e.target.value})} /></div>
                <div><label style={lbl}>ALTITUDE</label><select style={inp} value={tf.altBand} onChange={e=>setTf({...tf,altBand:e.target.value})}>{Object.entries(M_ALT).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
                <div><label style={lbl}>WARHEAD (kg)</label><input style={inp} type="number" value={tf.warheadKg} onChange={e=>setTf({...tf,warheadKg:e.target.value})} /></div>
                <div><label style={lbl}>NAVIGATION</label><select style={inp} value={tf.navigation} onChange={e=>setTf({...tf,navigation:e.target.value})}>{Object.entries(M_NAV).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
                <div><label style={lbl}>RCS (auto if blank)</label><select style={inp} value={tf.rcs} onChange={e=>setTf({...tf,rcs:e.target.value})}>{M_RCS.map(r=><option key={r} value={r}>{r||'(from altitude)'}</option>)}</select></div>
                <div><label style={lbl}>TARGETS</label><select style={inp} value={tf.target} onChange={e=>setTf({...tf,target:e.target.value})}><option value="infrastructure">Infrastructure / nodes</option><option value="ad_assets">Hunts AD assets</option></select></div>
              </div>
              <button onClick={buildThreat} className="btn-riso btn-alt mt-3" style={{ padding:'7px 14px', fontSize:'12px' }}>+ ADD THREAT TO LIBRARY</button>
              {customThreats.length>0 && (
                <div className="mt-3 space-y-1" style={{ maxHeight:'150px', overflowY:'auto' }}>
                  {customThreats.map(t=>(
                    <div key={t.key} className="flex items-center justify-between f-mono text-[11px]" style={{ padding:'4px 8px', background:'#16293c', border:'1px solid #243d52', borderRadius:'4px' }}>
                      <span style={{ color: t.def.side==='UA' ? '#5aa0e6' : '#d24a44' }}>{t.def.name}</span>
                      <span style={{ color:'#93a1b0' }}>{t.def.class} · {t.def.speedKmh}km/h · {t.def.warheadKg}kg · {t.def.navigation}{t.def.ewVuln?' · EW-vuln':''}</span>
                      <button onClick={()=>delThreat(t.key)} style={{ color:'#d24a44', background:'none', border:'none', cursor:'pointer' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cop-card">
              <div className="cop-card-header" style={{ color:'var(--mil-friend)' }}>ASSET / INTERCEPTOR MODELLER</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label style={lbl}>NAME</label><input style={inp} value={af.name} onChange={e=>setAf({...af,name:e.target.value})} placeholder="e.g. SAMP/T" /></div>
                <div><label style={lbl}>KIND</label><select style={inp} value={af.kind} onChange={e=>setAf({...af,kind:e.target.value})}>{Object.entries(M_ASSET_KINDS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
                <div><label style={lbl}>NATION</label><input style={inp} value={af.nation} onChange={e=>setAf({...af,nation:e.target.value})} /></div>
                <div><label style={lbl}>REACH (def {M_ASSET_KINDS[af.kind].range})</label><input style={inp} type="number" value={af.range} onChange={e=>setAf({...af,range:e.target.value})} placeholder={String(M_ASSET_KINDS[af.kind].range)} /></div>
                <div><label style={lbl}>AMMO (def {M_ASSET_KINDS[af.kind].ammoMax})</label><input style={inp} type="number" value={af.ammoMax} onChange={e=>setAf({...af,ammoMax:e.target.value})} placeholder={String(M_ASSET_KINDS[af.kind].ammoMax)} /></div>
                <div className="col-span-2"><label style={lbl}>CEILING</label><select style={inp} value={af.ceiling} onChange={e=>setAf({...af,ceiling:e.target.value})}><option value="">kind default ({M_ASSET_KINDS[af.kind].ceiling})</option>{Object.entries(M_ALT).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
                <div className="col-span-2"><label style={lbl}>ENGAGES (blank = kind default)</label>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {['owa','cruise','ballistic','glide','recon','tactical','male'].map(cl=>(
                      <label key={cl} className="f-mono text-[11px] flex items-center gap-1" style={{ color:'#eef2f6' }}>
                        <input type="checkbox" checked={af.engage.includes(cl)} onChange={()=>toggleEng(cl)} /> {cl}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <button onClick={buildAsset} className="btn-riso btn-alt mt-3" style={{ padding:'7px 14px', fontSize:'12px' }}>+ ADD ASSET TO LIBRARY</button>
              {customAssets.length>0 && (
                <div className="mt-3 space-y-1" style={{ maxHeight:'130px', overflowY:'auto' }}>
                  {customAssets.map(a=>(
                    <div key={a.key} className="flex items-center justify-between f-mono text-[11px]" style={{ padding:'4px 8px', background:'#16293c', border:'1px solid #243d52', borderRadius:'4px' }}>
                      <span style={{ color:'#5aa0e6' }}>{a.def.name}</span>
                      <span style={{ color:'#93a1b0' }}>{a.def.mapAs} · R{a.def.range} · {a.def.ammoMax}rds · ceil {a.def.ceiling} · {(a.def.engageDefault||[]).join('/')}</span>
                      <button onClick={()=>delAsset(a.key)} style={{ color:'#d24a44', background:'none', border:'none', cursor:'pointer' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT */}
          <div className="space-y-4">
            <div className="cop-card">
              <div className="cop-card-header" style={{ color:'var(--mil-friend)' }}>WAVES  ·  {totalTracks} tracks</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label style={lbl}>THREAT</label><select style={inp} value={wf.type} onChange={e=>setWf({...wf,type:e.target.value})}>
                  <optgroup label="Catalog">{catalogKeys.map(k=><option key={k} value={k}>{threatLabel(k)}</option>)}</optgroup>
                  {customThreats.length>0 && <optgroup label="Custom">{customThreats.map(t=><option key={t.key} value={t.key}>{t.def.name}</option>)}</optgroup>}
                </select></div>
                <div><label style={lbl}>AXIS</label><select style={inp} value={wf.from} onChange={e=>setWf({...wf,from:e.target.value})}>{M_BEAR.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
                <div><label style={lbl}>COUNT</label><input style={inp} type="number" value={wf.count} onChange={e=>setWf({...wf,count:e.target.value})} /></div>
                <div><label style={lbl}>SPACING (sec)</label><input style={inp} type="number" value={wf.spacingSec} onChange={e=>setWf({...wf,spacingSec:e.target.value})} /></div>
                <div><label style={lbl}>START (game-hour)</label><input style={inp} type="number" step="0.1" value={wf.startGH} onChange={e=>setWf({...wf,startGH:e.target.value})} /></div>
              </div>
              <button onClick={addWave} className="btn-riso btn-alt mt-3" style={{ padding:'7px 14px', fontSize:'12px' }}>+ ADD WAVE</button>
              {waves.length>0 && (
                <div className="mt-3 space-y-1" style={{ maxHeight:'160px', overflowY:'auto' }}>
                  {waves.map((w,i)=>(
                    <div key={w.id} className="flex items-center justify-between f-mono text-[11px]" style={{ padding:'4px 8px', background:'#16293c', border:'1px solid #243d52', borderRadius:'4px' }}>
                      <span style={{ color:'#eef2f6' }}>{i+1}. {threatLabel(w.type)}</span>
                      <span style={{ color:'#93a1b0' }}>{w.count}× from {w.from} · {w.spacingSec}s · H+{w.startGH}</span>
                      <button onClick={()=>delWave(w.id)} style={{ color:'#d24a44', background:'none', border:'none', cursor:'pointer' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button onClick={()=>setOpPlan(true)}
              className="w-full text-left"
              style={{ padding:'12px 14px', border:'1px solid #2f80d6', borderRadius:'6px', background:'rgba(47,128,214,0.08)', cursor:'pointer' }}>
              <div className="f-mono" style={{ fontSize:'9px', color:'#56a0e0', letterSpacing:'0.1em', marginBottom:'4px' }}>MODELLING FLOW · 1 FORCES &amp; ATTACK (this screen) → 2 REGION &amp; LAYDOWN → 3 SIMULATION → 4 REPORT</div>
              <div className="f-display" style={{ fontSize:'15px', color:'#2f80d6', letterSpacing:'0.03em' }}>OPEN SIMULATOR · REGION, LAYDOWN, RUN ▸</div>
              <div className="f-mono" style={{ fontSize:'10px', color:'#93a1b0', lineHeight:1.5, marginTop:'3px' }}>
                Choose the defended region (Ukraine, NATO capitals, or a selection of NATO countries plus Ukraine, all capitals labelled), place batteries from the defence library with km-true rings, lock the map, author or import the attack matrix (recent strike patterns included), then run the animated simulation or Monte-Carlo and get a report. {totalTracks} tracks will be imported from this builder.
              </div>
            </button>

            <div className="cop-card">
              <div className="cop-card-header" style={{ color:'var(--mil-unknown)' }}>TIMELINE  (0 → {totalGH} h)</div>
              <div style={{ position:'relative', height:`${Math.max(40, waves.length*18+8)}px` }}>
                {waves.map((w,i)=>{
                  const span = Math.max(1.5, ((+w.count-1)*(+w.spacingSec)/3600 / ((+totalGH)||1))*100);
                  return (
                    <div key={w.id} title={threatLabel(w.type)} style={{ position:'absolute', top:`${i*18}px`, left:`${tlPos(w.startGH)}%`, width:`${span}%`, height:'12px', background: (TT[w.type] && TT[w.type].color) || '#d24a44', opacity:0.8, borderRadius:'3px', minWidth:'6px' }} />
                  );
                })}
                {waves.length===0 && <div className="f-mono text-[11px]" style={{ color:'#5d6b7a' }}>Add waves to see the timeline.</div>}
              </div>
            </div>

            <div className="cop-card">
              <div className="cop-card-header" style={{ color:'var(--mil-enemy)' }}>ENEMY TARGETS &middot; DEFENDED ASSETS</div>
              <div className="flex gap-2 mb-2">
                <button onClick={()=>setUseGeo(false)} className="btn-riso" style={{ padding:'4px 9px', fontSize:'10px', background: !useGeo?'rgba(47,128,214,0.18)':'transparent', borderColor: !useGeo?'#2f80d6':'#243d52', color: !useGeo?'#5aa0e6':'#93a1b0' }}>Fixed map ({map})</button>
                <button onClick={()=>setUseGeo(true)} className="btn-riso" style={{ padding:'4px 9px', fontSize:'10px', background: useGeo?'rgba(47,128,214,0.18)':'transparent', borderColor: useGeo?'#2f80d6':'#243d52', color: useGeo?'#5aa0e6':'#93a1b0' }}>Real-world map</button>
              </div>
              <div className="f-mono text-[10px] mb-2" style={{ color:'#5d6b7a' }}>{useGeo ? 'Pan and zoom the satellite to your area, click to drop targets, click a marker to remove. Scale bar is shown bottom-left.' : ('Pick a type, click the map to place a target. Click a marker to remove. If none placed, the ' + map + ' default targets are used.')}</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {NODE_TYPES.map(t => (
                  <button key={t.key} onClick={() => setNodeType(t.key)} className="btn-riso" style={{ padding:'3px 7px', fontSize:'10px', background: nodeType===t.key?'rgba(210,74,68,0.18)':'transparent', borderColor: nodeType===t.key?'#d24a44':'#243d52', color: nodeType===t.key?'#e09a9a':'#93a1b0' }}>{t.glyph} {t.name}</button>
                ))}
              </div>
              {!useGeo && <div className="border-2 border-[#243d52]" style={{ background:'#0a1626' }}>
                <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width:'100%', height:'auto', display:'block', cursor:'crosshair' }} onClick={placeNode}>
                  {map === 'capital'
                    ? <g><image href={AURELIA_SAT} x="0" y="0" width={MAP_W} height={MAP_H} preserveAspectRatio="xMidYMid slice" /><rect width={MAP_W} height={MAP_H} fill="#0a1626" opacity="0.30" /></g>
                    : <g><rect width={MAP_W} height={MAP_H} fill="#12181a" /><rect x={MAP_W*0.62} y={0} width={MAP_W*0.38} height={MAP_H} fill="rgba(210,74,68,0.05)" /></g>}
                  {Array.from({length:8}).map((_,i)=><line key={'gx'+i} x1={(i+1)*100} y1={0} x2={(i+1)*100} y2={MAP_H} stroke="#44617b" strokeWidth="0.4" opacity="0.22" />)}
                  {Array.from({length:5}).map((_,i)=><line key={'gy'+i} x1={0} y1={(i+1)*100} x2={MAP_W} y2={(i+1)*100} stroke="#44617b" strokeWidth="0.4" opacity="0.22" />)}
                  <text x={MAP_W-12} y={20} fontSize="11" fill="#e09a9a" textAnchor="end" className="f-typewriter" style={{ paintOrder:'stroke' }}>THREAT AXIS &#8594;</text>
                  <DefendedNodes nodes={nodes} />
                </svg>
              </div>}
              {useGeo && (
                <div>
                  <div className="border-2 border-[#243d52]" style={{ position:'relative', width:'100%', paddingBottom:'64.44%', background:'#0a1626' }}>
                    <GeoTargetEditor geoTargets={geoTargets} setGeoTargets={setGeoTargets} nodeType={nodeType} initGeo={geoBounds} onBounds={setGeoBounds} />
                  </div>
                  <div className="f-mono text-[10px] mt-1" style={{ color:'#5d6b7a' }}>{geoBounds ? ('AO width ' + geoKmWidth(geoBounds).toFixed(1) + ' km  ·  scale ' + (geoKmPerPx(geoBounds)*1000).toFixed(0) + ' m/px  ·  ' + geoTargets.length + ' targets') : 'Move the map to set your area of operations.'}</div>
                </div>
              )}
              {useGeo && geoTargets.length>0 && (
                <div className="space-y-1 mt-2" style={{ maxHeight:'150px', overflowY:'auto' }}>
                  {geoTargets.map(n => (
                    <div key={n.id} className="flex items-center justify-between f-mono text-[10px]" style={{ padding:'3px 7px', background:'#16293c', border:'1px solid #243d52', borderRadius:'3px' }}>
                      <span style={{ color:'#eef2f6' }}>{n.glyph} {n.name} <span style={{ color:'#5d6b7a' }}>&middot; v{n.value} &middot; {n.kind}</span></span>
                      <span className="flex items-center gap-2">
                        <button onClick={()=>bumpGeoHp(n.id,-1)} style={zbtn}>&minus;</button>
                        <span style={{ color:'#5aa0e6', minWidth:'44px', textAlign:'center' }}>HP {n.hp}</span>
                        <button onClick={()=>bumpGeoHp(n.id,1)} style={zbtn}>+</button>
                        <button onClick={()=>removeGeoTarget(n.id)} style={{ color:'#d24a44', background:'none', border:'none', cursor:'pointer', fontSize:'14px' }}>&times;</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!useGeo && nodes.length>0 && (
                <div className="space-y-1 mt-2" style={{ maxHeight:'150px', overflowY:'auto' }}>
                  {nodes.map(n => (
                    <div key={n.id} className="flex items-center justify-between f-mono text-[10px]" style={{ padding:'3px 7px', background:'#16293c', border:'1px solid #243d52', borderRadius:'3px' }}>
                      <span style={{ color:'#eef2f6' }}>{n.glyph} {n.name} <span style={{ color:'#5d6b7a' }}>&middot; v{n.value} &middot; {n.kind}</span></span>
                      <span className="flex items-center gap-2">
                        <button onClick={()=>bumpNodeHp(n.id,-1)} style={zbtn}>&minus;</button>
                        <span style={{ color:'#5aa0e6', minWidth:'44px', textAlign:'center' }}>HP {n.hp}</span>
                        <button onClick={()=>bumpNodeHp(n.id,1)} style={zbtn}>+</button>
                        <button onClick={()=>removeNode(n.id)} style={{ color:'#d24a44', background:'none', border:'none', cursor:'pointer', fontSize:'14px' }}>&times;</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cop-card">
              <div className="cop-card-header" style={{ color:'var(--text-secondary)' }}>LIBRARY</div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <button onClick={saveScenario} className="btn-riso btn-alt" style={{ padding:'6px 12px', fontSize:'12px' }}>SAVE</button>
                <button onClick={exportJSON} className="btn-riso btn-alt" style={{ padding:'6px 12px', fontSize:'12px' }}>EXPORT JSON</button>
                <label className="btn-riso btn-alt" style={{ padding:'6px 12px', fontSize:'12px', cursor:'pointer' }}>IMPORT JSON<input type="file" accept="application/json" onChange={importJSON} style={{ display:'none' }} /></label>
                <button onClick={exportLibrary} className="btn-riso btn-alt" style={{ padding:'6px 12px', fontSize:'12px' }}>EXPORT LIBRARY</button>
                <label className="btn-riso btn-alt" style={{ padding:'6px 12px', fontSize:'12px', cursor:'pointer' }}>IMPORT LIBRARY<input type="file" accept="application/json" onChange={importLibrary} style={{ display:'none' }} /></label>
              </div>
              {saved.length>0 && (
                <div className="space-y-1" style={{ maxHeight:'140px', overflowY:'auto' }}>
                  {saved.map(s=>(
                    <div key={s.when} className="flex items-center justify-between f-mono text-[11px]" style={{ padding:'4px 8px', background:'#16293c', border:'1px solid #243d52', borderRadius:'4px' }}>
                      <span style={{ color:'#eef2f6' }}>{s.name}</span>
                      <span className="flex items-center gap-3">
                        <button onClick={()=>loadConfig(s.config, s.customThreats, s.customAssets)} style={{ color:'#5aa0e6', background:'none', border:'none', cursor:'pointer' }}>LOAD</button>
                        <button onClick={()=>delSaved(s.when)} style={{ color:'#d24a44', background:'none', border:'none', cursor:'pointer' }}>×</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="cls-banner mt-8">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      </div>
    </div>
  );
}
