// MultiplayerGameView – handles deploy phase + run phase for both sides
import React, { useState, useEffect, useMemo } from 'react';

// === SHARED CONSTANTS (match server) ===
const MAP_W = 900, MAP_H = 580;
const FRIENDLY_BOUND = { xMin: 30, yMin: 30, xMax: 540, yMax: 555 };

const CARDS = {
  patriot:  { tag: 'PAC-3', name: 'PATRIOT PAC-3',     range: 380, sensorRange: 500, ammoMax: 8,   color: '#2c5f8d', attached: true,  isAttached: true },
  iris_t:   { tag: 'IRIS',  name: 'IRIS-T SLM',        range: 250, sensorRange: 320, ammoMax: 12,  color: '#2c5f8d', attached: true,  isAttached: true },
  nasams:   { tag: 'NSMS',  name: 'NASAMS',            range: 220, sensorRange: 280, ammoMax: 16,  color: '#2c5f8d' },
  crotale:  { tag: 'CRTL',  name: 'CROTALE NG',        range: 150, sensorRange: 200, ammoMax: 12,  color: '#2c5f8d' },
  camm:     { tag: 'CAMM',  name: 'CAMM-ER',           range: 200, sensorRange: 260, ammoMax: 10,  color: '#2c5f8d' },
  gepard:   { tag: 'GPRD',  name: 'GEPARD 1A2',        range: 80,  sensorRange: 130, ammoMax: 80,  color: '#2c5f8d' },
  skynex:   { tag: 'SKYN',  name: 'SKYNEX',            range: 90,  sensorRange: 140, ammoMax: 100, color: '#2c5f8d' },
  stinger:  { tag: 'STNG',  name: 'STINGER MANPADS',   range: 60,  sensorRange: 100, ammoMax: 4,   color: '#2c5f8d' },
  piorun:   { tag: 'PIOR',  name: 'PIORUN MANPADS',    range: 65,  sensorRange: 105, ammoMax: 4,   color: '#2c5f8d' },
  int_a:    { tag: 'INT-A', name: 'FPV INT SQD ALPHA', range: 280, sensorRange: 340, ammoMax: 6,   color: '#b8902c', isInterceptor: true },
  int_b:    { tag: 'INT-B', name: 'FPV INT SQD BRAVO', range: 260, sensorRange: 320, ammoMax: 6,   color: '#b8902c', isInterceptor: true },
  int_c:    { tag: 'INT-C', name: 'FPV INT SQD CHARLIE',range: 260,sensorRange: 320, ammoMax: 6,   color: '#b8902c', isInterceptor: true },
  ew_a:     { tag: 'EW1',   name: 'EW SUITE',          range: 95,  sensorRange: 130, ammoMax: 100, color: '#5c534a', isEW: true },
  ew_b:     { tag: 'EW2',   name: 'EW GROUND',         range: 100, sensorRange: 130, ammoMax: 100, color: '#5c534a', isEW: true },
  mg_a:     { tag: 'MG-A',  name: 'C-UAS TEAM ALPHA',  range: 35,  sensorRange: 60,  ammoMax: 200, color: '#2c5f8d' },
  mg_b:     { tag: 'MG-B',  name: 'C-UAS TEAM BRAVO',  range: 35,  sensorRange: 60,  ammoMax: 200, color: '#2c5f8d' },
  mg_c:     { tag: 'MG-C',  name: 'C-UAS TEAM CHARLIE',range: 35,  sensorRange: 60,  ammoMax: 200, color: '#2c5f8d' },
  mg_d:     { tag: 'MG-D',  name: 'C-UAS TEAM DELTA',  range: 35,  sensorRange: 60,  ammoMax: 200, color: '#2c5f8d' },
  mg_e:     { tag: 'MG-E',  name: 'C-UAS TEAM ECHO',   range: 35,  sensorRange: 60,  ammoMax: 200, color: '#2c5f8d' },
  mg_f:     { tag: 'MG-F',  name: 'C-UAS TEAM FOX',    range: 35,  sensorRange: 60,  ammoMax: 200, color: '#2c5f8d' },
};

const ASSET_COST = {
  patriot: 0, iris_t: 0, nasams: 1500, crotale: 800, camm: 1200,
  gepard: 600, skynex: 700, stinger: 250, piorun: 300,
  int_a: 300, int_b: 300, int_c: 300, ew_a: 400, ew_b: 400,
  mg_a: 100, mg_b: 100, mg_c: 100, mg_d: 100, mg_e: 100, mg_f: 100,
};

const TT = {
  iskander:  { code: 'ISKR',     class: 'ballistic', name: 'Iskander-M', color: '#a83232' },
  kinzhal:   { code: 'KNZL',     class: 'ballistic', name: 'Kh-47M Kinzhal', color: '#a83232' },
  kh101:     { code: 'CR-AIR',   class: 'cruise',    name: 'Kh-101', color: '#e67e22' },
  kalibr:    { code: 'CR-SEA',   class: 'cruise',    name: 'Kalibr-3M14', color: '#e67e22' },
  kh22:      { code: 'CR-HVY',   class: 'cruise',    name: 'Kh-22 (heavy)', color: '#a83232' },
  kab:       { code: 'GLIDE',    class: 'glide',     name: 'KAB UMPK', color: '#e67e22' },
  kab_hvy:   { code: 'GLIDE-HV', class: 'glide',     name: 'KAB-1500 UMPK-PD', color: '#a83232' },
  geran2:    { code: 'OWA-LR',   class: 'owa',       name: 'Shahed-136 Geran-2', color: '#b8902c' },
  geran1:    { code: 'OWA-SR',   class: 'owa',       name: 'Geran-1', color: '#b8902c' },
  geran2_jet:{ code: 'OWA-JET',  class: 'owa',       name: 'Geran-2 Jet', color: '#b8902c' },
  lancet:    { code: 'IZD-52',   class: 'tactical',  name: 'Lancet-3', color: '#b8902c' },
  lancet_of: { code: 'IZD-OF',   class: 'tactical',  name: 'Lancet-OF (fiber)', color: '#b8902c' },
  fpv:       { code: 'FPV',      class: 'tactical',  name: 'FPV (radio)', color: '#b8902c' },
  fpv_of:    { code: 'FPV-OF',   class: 'tactical',  name: 'FPV-OF (fiber)', color: '#b8902c' },
  orlan10:   { code: 'ORLAN-10', class: 'recon',     name: 'Orlan-10', color: '#b8902c' },
  orlan30:   { code: 'ORLAN-30', class: 'recon',     name: 'Orlan-30 (designator)', color: '#b8902c' },
  zala:      { code: 'ZALA',     class: 'recon',     name: 'ZALA (designator)', color: '#b8902c' },
  eleron3:   { code: 'ELRN',     class: 'recon',     name: 'Eleron-3', color: '#b8902c' },
  supercam:  { code: 'SCAM',     class: 'recon',     name: 'SuperCam', color: '#b8902c' },
  forpost:   { code: 'FRPST',    class: 'male',      name: 'Forpost-RU', color: '#e67e22' },
  altius:    { code: 'ALTS',     class: 'male',      name: 'Altius-RU (HALE)', color: '#e67e22' },
  arty:      { code: 'ARTY',     class: 'unknown',   name: '152mm Arty', color: '#a83232' },
  mlrs:      { code: 'MLRS',     class: 'unknown',   name: 'MLRS', color: '#a83232' },
  mortar:    { code: 'MORT',     class: 'unknown',   name: '120mm Mortar', color: '#a83232' },
  emit_decoy:{ code: 'EMIT-DCY', class: 'unknown',   name: 'Emission Decoy', color: '#b8902c' },
  unknown:   { code: 'UNK',      class: 'unknown',   name: 'Unidentified', color: '#b8902c' },
};

const THREAT_COST = {
  iskander: 800, kinzhal: 1200, kh101: 400, kalibr: 400, kh22: 700,
  kab: 300, kab_hvy: 450, geran2: 80, geran1: 60, geran2_jet: 120,
  lancet: 150, lancet_of: 200, fpv: 50, fpv_of: 80,
  orlan10: 60, orlan30: 90, zala: 80, eleron3: 50, supercam: 60,
  forpost: 200, altius: 350, arty: 40, mlrs: 120, mortar: 30, emit_decoy: 50,
};

// Red catalog grouped
const RED_CATALOG = [
  { group: 'BALLISTIC', items: ['iskander', 'kinzhal'] },
  { group: 'CRUISE',    items: ['kh101', 'kalibr', 'kh22'] },
  { group: 'GLIDE',     items: ['kab', 'kab_hvy'] },
  { group: 'OWA',       items: ['geran2', 'geran1', 'geran2_jet'] },
  { group: 'TACTICAL',  items: ['lancet', 'lancet_of', 'fpv', 'fpv_of'] },
  { group: 'RECON',     items: ['orlan10', 'orlan30', 'zala', 'eleron3', 'supercam'] },
  { group: 'MALE',      items: ['forpost', 'altius'] },
  { group: 'INDIRECT',  items: ['arty', 'mlrs', 'mortar'] },
  { group: 'DECOY',     items: ['emit_decoy'] },
];

const fmtGT = (gt) => {
  const totalH = gt / (3600 * 1000);
  const h = Math.floor(totalH);
  const m = Math.floor((totalH - h) * 60);
  return `H+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export function MultiplayerGameView({ mp, onLeave }) {
  const state = mp.state;
  const myPlayer = state?.players?.find(p => p.id === mp.youAre);
  const side = myPlayer?.side;

  if (!state || !state.gameState) {
    return (
      <div className="min-h-screen riso-paper p-6 flex items-center justify-center">
        <div className="cop-card">Loading game state...</div>
      </div>
    );
  }
  if (state.phase === 'ended') {
    return <EndScreen state={state} onLeave={onLeave} />;
  }

  return (
    <div className="min-h-screen riso-paper p-3">
      <div className="cls-banner mb-2">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <MPHeader state={state} side={side} onLeave={onLeave} />
      {state.phase === 'placing' && side === 'blue' && (
        <BlueDeployView mp={mp} state={state} />
      )}
      {state.phase === 'placing' && side === 'red' && (
        <RedWaitingView state={state} />
      )}
      {state.phase === 'running' && side === 'blue' && (
        <BlueRunView mp={mp} state={state} />
      )}
      {state.phase === 'running' && side === 'red' && (
        <RedRunView mp={mp} state={state} />
      )}
      {!side && (
        <div className="cop-card">You are spectating. State: {state.phase}</div>
      )}
    </div>
  );
}

function MPHeader({ state, side, onLeave }) {
  const g = state.gameState;
  const sideColor = side === 'blue' ? 'var(--mil-friend)' : side === 'red' ? 'var(--mil-hostile)' : 'var(--text-secondary)';
  return (
    <div className="cop-card flex items-center gap-4">
      <div>
        <div className="f-typewriter text-[9px]" style={{ color: 'var(--text-secondary)' }}>YOU ARE</div>
        <div className="f-display text-base" style={{ color: sideColor, letterSpacing: '0.08em' }}>
          {side === 'blue' ? 'BLUE · DEFENDER' : side === 'red' ? 'RED · ATTACKER' : 'OBSERVER'}
        </div>
      </div>
      <div>
        <div className="f-typewriter text-[9px]" style={{ color: 'var(--text-secondary)' }}>PHASE</div>
        <div className="f-display text-sm" style={{ color: 'var(--mil-unknown)' }}>{state.phase.toUpperCase()}</div>
      </div>
      <div>
        <div className="f-typewriter text-[9px]" style={{ color: 'var(--text-secondary)' }}>MISSION TIME</div>
        <div className="f-mono text-sm" style={{ color: 'var(--text-primary)' }}>{fmtGT(g.gameTime)}</div>
      </div>
      <div>
        <div className="f-typewriter text-[9px]" style={{ color: 'var(--text-secondary)' }}>BUDGET</div>
        <div className="f-mono text-sm">
          {side === 'blue' && <span style={{ color: 'var(--mil-friend)' }}>{g.blueBudget} pts</span>}
          {side === 'red' && <span style={{ color: 'var(--mil-hostile)' }}>{g.redBudget} pts</span>}
          {!side && <span style={{ color: 'var(--text-secondary)' }}>–</span>}
        </div>
      </div>
      {state.phase === 'running' && side === 'blue' && (
        <div>
          <div className="f-typewriter text-[9px]" style={{ color: 'var(--text-secondary)' }}>ROE</div>
          <div className="f-display text-sm" style={{
            color: g.roe === 'HOLD' ? 'var(--mil-neutral)' : g.roe === 'FREE' ? 'var(--mil-hostile)' : 'var(--mil-unknown)'
          }}>WPNS {g.roe}</div>
        </div>
      )}
      <div className="flex-1" />
      <button onClick={onLeave} className="btn-riso btn-alt" style={{ padding: '6px 12px', fontSize: '11px' }}>LEAVE</button>
    </div>
  );
}

// === BLUE DEPLOY VIEW ===
function BlueDeployView({ mp, state }) {
  const g = state.gameState;
  const [selectedCard, setSelectedCard] = useState(null);

  const inventory = [
    { card: 'nasams', count: 1 },
    { card: 'crotale', count: 1 },
    { card: 'camm', count: 1 },
    { card: 'gepard', count: 2 },
    { card: 'skynex', count: 1 },
    { card: 'stinger', count: 2 },
    { card: 'piorun', count: 2 },
    { card: 'int_a', count: 1 },
    { card: 'int_b', count: 1 },
    { card: 'int_c', count: 1 },
    { card: 'ew_a', count: 1 },
    { card: 'ew_b', count: 1 },
    { card: 'mg_a', count: 1 },
    { card: 'mg_b', count: 1 },
    { card: 'mg_c', count: 1 },
    { card: 'mg_d', count: 1 },
    { card: 'mg_e', count: 1 },
    { card: 'mg_f', count: 1 },
  ];

  const placedCount = (id) => g.placedAssets.filter(p => p.cardId === id).length;

  const onMapClick = (e) => {
    if (!selectedCard) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const c = pt.matrixTransform(svg.getScreenCTM().inverse());
    if (c.x < FRIENDLY_BOUND.xMin || c.x > FRIENDLY_BOUND.xMax ||
        c.y < FRIENDLY_BOUND.yMin || c.y > FRIENDLY_BOUND.yMax) return;
    mp.actions.placeAsset(selectedCard, c.x, c.y);
  };

  return (
    <div className="grid grid-cols-[1fr_320px] gap-3 mt-2">
      <div className="cop-card" style={{ padding: 0 }}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full"
          style={{ background: 'var(--bg-base)', cursor: selectedCard ? 'crosshair' : 'default' }}
          onClick={onMapClick}>
          <MapBase />
          <FriendlyBound />
          <NodeLayer nodes={g.nodes} />
          {g.placedAssets.map(p => <AssetMarker key={p.id} asset={p} placement
            onClick={() => mp.actions.removeAsset(p.id)} />)}
        </svg>
      </div>
      <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '70vh' }}>
        <div className="cop-card">
          <div className="cop-card-header">DEPLOY · BLUE</div>
          <div className="f-mono text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
            Click card &gt; click on map. Click placed asset to remove.
          </div>
          <div className="space-y-1">
            {inventory.map(inv => {
              const card = CARDS[inv.card];
              const remaining = inv.count - placedCount(inv.card);
              const cost = ASSET_COST[inv.card];
              const isSelected = selectedCard === inv.card;
              const exhausted = remaining <= 0;
              const canAfford = cost <= g.blueBudget;
              return (
                <div key={inv.card}
                  onClick={() => { if (!exhausted && canAfford) setSelectedCard(isSelected ? null : inv.card); }}
                  className="p-2 cursor-pointer"
                  style={{
                    border: '1px solid ' + (isSelected ? card.color : 'var(--border-default)'),
                    background: isSelected ? card.color + '20' : 'var(--bg-panel-2)',
                    opacity: (exhausted || !canAfford) ? 0.4 : 1,
                  }}>
                  <div className="flex items-center gap-2">
                    <span className="f-display text-xs" style={{ color: card.color }}>{card.tag}</span>
                    <span className="flex-1 f-mono text-[10px]">{card.name}</span>
                    <span className="f-mono text-[10px]">{remaining}/{inv.count}</span>
                  </div>
                  <div className="f-mono text-[9px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {cost}pts · RNG {card.range} · AMMO {card.ammoMax}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <button onClick={() => mp.actions.finishDeploy()} className="btn-riso w-full"
          style={{
            background: 'var(--mil-neutral)',
            borderColor: 'var(--mil-neutral)',
            color: 'var(--text-inverted)',
          }}>
          DEPLOYMENT COMPLETE &gt; BEGIN MISSION
        </button>
      </div>
    </div>
  );
}

function RedWaitingView({ state }) {
  return (
    <div className="cop-card mt-2 p-8 text-center">
      <div className="f-display text-2xl mb-2" style={{ color: 'var(--mil-hostile)' }}>RED · STANDBY</div>
      <div className="f-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
        Blue commander is deploying defensive assets. Mission begins when Blue completes deployment.
      </div>
      <div className="f-mono text-xs mt-4" style={{ color: 'var(--text-tertiary)' }}>
        Blue placed: {state.gameState.placedAssets?.length || 0} assets · {state.gameState.blueBudget} pts remaining
      </div>
    </div>
  );
}

// === BLUE RUN VIEW ===
function BlueRunView({ mp, state }) {
  const g = state.gameState;
  return (
    <div className="grid grid-cols-[1fr_320px] gap-3 mt-2">
      <div className="cop-card" style={{ padding: 0, position: 'relative' }}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full" style={{ background: 'var(--bg-base)' }}>
          <MapBase />
          <NodeLayer nodes={g.nodes} />
          {(g.assets || []).map(a => <AssetMarker key={a.id} asset={a} />)}
          {(g.threats || []).map(t => <ThreatMarker key={t.id} threat={t} />)}
        </svg>
        {/* ROE controls */}
        <div className="absolute bottom-3 right-3 flex gap-1">
          {['HOLD', 'TIGHT', 'FREE'].map(r => {
            const colors = { HOLD: 'var(--mil-neutral)', TIGHT: 'var(--mil-unknown)', FREE: 'var(--mil-hostile)' };
            const active = g.roe === r;
            return (
              <button key={r} onClick={() => mp.actions.setROE(r)}
                className="f-display text-[10px] px-2 py-1"
                style={{
                  background: active ? colors[r] : 'var(--bg-panel)',
                  color: active ? 'var(--text-inverted)' : colors[r],
                  border: '1px solid ' + colors[r],
                  letterSpacing: '0.1em',
                }}>WPNS {r}</button>
            );
          })}
        </div>
      </div>
      <BlueRunSidebar mp={mp} g={g} />
    </div>
  );
}

function BlueRunSidebar({ mp, g }) {
  return (
    <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '70vh' }}>
      <div className="cop-card">
        <div className="cop-card-header">METRICS</div>
        <div className="grid grid-cols-2 gap-1 f-mono text-[10px]">
          <div>Threats: <strong>{g.m.threatsSpawned || 0}</strong></div>
          <div>Killed: <strong style={{ color: 'var(--mil-neutral)' }}>{g.m.threatsKilled || 0}</strong></div>
          <div>Leaked: <strong style={{ color: 'var(--mil-hostile)' }}>{g.m.leakedReal || 0}</strong></div>
          <div>Recon kills: <strong>{g.m.reconKills || 0}</strong></div>
          <div>Strikes averted: <strong style={{ color: 'var(--mil-neutral)' }}>{g.m.strikesAverted || 0}</strong></div>
          <div>Node HP lost: <strong style={{ color: 'var(--mil-hostile)' }}>{g.m.leakDmg || 0}</strong></div>
        </div>
      </div>
      <div className="cop-card">
        <div className="cop-card-header">ACTIVE ASSETS</div>
        <div className="space-y-1 max-h-[150px] overflow-y-auto">
          {(g.assets || []).filter(a => a.alive).map(a => {
            const c = CARDS[a.cardId]; if (!c) return null;
            return (
              <div key={a.id} className="flex items-center justify-between f-mono text-[10px] py-1"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: c.color }}>{c.tag}</span>
                <span style={{ color: a.deploying ? 'var(--mil-unknown)' : 'var(--text-secondary)' }}>
                  {a.deploying ? 'DEPLOYING' : a.mode}
                </span>
                <span>AMMO {a.ammo}/{c.ammoMax}</span>
                {!c.attached && (
                  <button onClick={() => mp.actions.setMode(a.id, a.mode === 'ENGAGE' ? 'STANDBY' : 'ENGAGE')}
                    className="f-mono text-[9px] px-1 py-0.5"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                    {a.mode === 'ENGAGE' ? '◯' : '▶'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <EventLog g={g} />
    </div>
  );
}

// === RED RUN VIEW ===
function RedRunView({ mp, state }) {
  const g = state.gameState;
  const [selectedThreat, setSelectedThreat] = useState('orlan30');
  const [selectedFrom, setSelectedFrom] = useState('E');

  const handleSpawn = () => {
    if (THREAT_COST[selectedThreat] > g.redBudget) return;
    mp.actions.redSpawn(selectedThreat, selectedFrom);
  };

  return (
    <div className="grid grid-cols-[1fr_360px] gap-3 mt-2">
      <div className="cop-card" style={{ padding: 0 }}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full" style={{ background: 'var(--bg-base)' }}>
          <MapBase />
          <NodeLayer nodes={g.nodes} />
          {(g.assets || []).map(a => <AssetMarker key={a.id} asset={a} hostileView />)}
          {(g.threats || []).map(t => <ThreatMarker key={t.id} threat={t} fromRed />)}
          {/* Recon coverage zones for Red */}
          {g.reconCoverage && Object.entries(g.reconCoverage).map(([sec, cov]) => {
            if (!cov) return null;
            const sectorY = sec === 'NE' ? 100 : sec === 'SE' ? 460 : 290;
            return (
              <g key={sec}>
                <rect x={550} y={sectorY - 90} width={350} height={180}
                  fill="rgba(74,122,60,0.05)" stroke="var(--mil-neutral)"
                  strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
                <text x={720} y={sectorY} fontSize="11" fill="var(--mil-neutral)"
                  textAnchor="middle" className="f-mono">
                  {sec} · {cov.designatorType.toUpperCase()} ACTIVE
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '70vh' }}>
        <div className="cop-card" style={{ borderColor: 'var(--mil-hostile)' }}>
          <div className="cop-card-header" style={{ color: 'var(--mil-hostile)' }}>RED COMMANDER · SPAWN</div>
          <div className="f-mono text-[10px] mb-2" style={{ color: 'var(--text-secondary)' }}>
            Spend budget to launch threats. Precision strikes need recon designation.
          </div>
          <div>
            <label className="f-mono text-[10px] block mb-1" style={{ color: 'var(--text-secondary)' }}>BEARING</label>
            <div className="flex gap-1">
              {['NE', 'E', 'SE'].map(b => (
                <button key={b} onClick={() => setSelectedFrom(b)}
                  className="flex-1 f-display text-[10px] py-1"
                  style={{
                    background: selectedFrom === b ? 'var(--mil-hostile)' : 'var(--bg-panel-2)',
                    color: selectedFrom === b ? 'var(--text-inverted)' : 'var(--text-primary)',
                    border: '1px solid var(--mil-hostile)',
                  }}>{b}</button>
              ))}
            </div>
          </div>
          <div className="mt-2">
            <label className="f-mono text-[10px] block mb-1" style={{ color: 'var(--text-secondary)' }}>THREAT TYPE</label>
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {RED_CATALOG.map(grp => (
                <div key={grp.group}>
                  <div className="f-mono text-[9px] mt-2 mb-1 tracking-widest"
                    style={{ color: 'var(--text-tertiary)' }}>{grp.group}</div>
                  {grp.items.map(t => {
                    const tt = TT[t];
                    const cost = THREAT_COST[t];
                    const canAfford = cost <= g.redBudget;
                    const isSel = selectedThreat === t;
                    return (
                      <div key={t}
                        onClick={() => canAfford && setSelectedThreat(t)}
                        className="p-1.5 cursor-pointer flex items-center justify-between"
                        style={{
                          background: isSel ? 'var(--mil-hostile-bg)' : 'transparent',
                          border: '1px solid ' + (isSel ? 'var(--mil-hostile)' : 'transparent'),
                          opacity: canAfford ? 1 : 0.4,
                        }}>
                        <div className="flex items-center gap-2">
                          <span className="f-display text-[10px]" style={{ color: tt.color }}>{tt.code}</span>
                          <span className="f-mono text-[9px]" style={{ color: 'var(--text-primary)' }}>{tt.name}</span>
                        </div>
                        <span className="f-mono text-[10px]">{cost}pts</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <button onClick={handleSpawn}
            className="btn-riso w-full mt-2"
            style={{
              background: 'var(--mil-hostile)', borderColor: 'var(--mil-hostile)',
              color: 'var(--text-inverted)',
            }}>
            ▶ LAUNCH {TT[selectedThreat]?.code} from {selectedFrom} ({THREAT_COST[selectedThreat]}pts)
          </button>
        </div>
        <EventLog g={g} />
      </div>
    </div>
  );
}

// === SHARED MAP COMPONENTS ===
function MapBase() {
  return (
    <g>
      <defs>
        <linearGradient id="cop-bg-mp" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e6dfcb" />
          <stop offset="100%" stopColor="#ddd4be" />
        </linearGradient>
        <pattern id="grid-mp" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#cfc3a8" strokeWidth="0.5" opacity="0.6" />
        </pattern>
      </defs>
      <rect width={MAP_W} height={MAP_H} fill="url(#cop-bg-mp)" />
      <rect width={MAP_W} height={MAP_H} fill="url(#grid-mp)" />
      {/* FLOT line */}
      <line x1={700} y1={30} x2={700} y2={550} stroke="#a83232" strokeWidth="2" strokeDasharray="6,4" opacity="0.7" />
      <text x={MAP_W - 130} y={45} fontSize="10" fill="#a83232" className="f-typewriter">FLOT</text>
      <text x={780} y={100} fontSize="13" fill="#a83232" className="f-display">RED FORCE</text>
    </g>
  );
}

function FriendlyBound() {
  return (
    <g>
      <rect x={FRIENDLY_BOUND.xMin} y={FRIENDLY_BOUND.yMin}
        width={FRIENDLY_BOUND.xMax - FRIENDLY_BOUND.xMin}
        height={FRIENDLY_BOUND.yMax - FRIENDLY_BOUND.yMin}
        fill="rgba(44,95,141,0.04)" stroke="#2c5f8d" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
      <text x={FRIENDLY_BOUND.xMin + 6} y={FRIENDLY_BOUND.yMin + 14}
        fill="#2c5f8d" className="f-typewriter" fontSize="10" opacity="0.7">BLUE AOR · DEPLOYMENT</text>
    </g>
  );
}

function NodeLayer({ nodes }) {
  return (
    <g>
      {(nodes || []).map(n => {
        const dead = n.hp === 0;
        const isForward = n.kind === 'forward';
        const stroke = isForward ? '#a6651a' : '#2c5f8d';
        const fill = isForward ? 'rgba(166,101,26,0.15)' : 'rgba(44,95,141,0.12)';
        return (
          <g key={n.id} opacity={dead ? 0.3 : 1}>
            {isForward ? (
              <polygon points={`${n.x},${n.y - 12} ${n.x + 14},${n.y + 8} ${n.x - 14},${n.y + 8}`}
                fill={fill} stroke={stroke} strokeWidth="1.5" />
            ) : (
              <rect x={n.x - 16} y={n.y - 11} width="32" height="22"
                fill={fill} stroke={stroke} strokeWidth="1.5" />
            )}
            <text x={n.x} y={n.y + (isForward ? 4 : -1)} fill={stroke}
              fontSize="8" textAnchor="middle" className="f-typewriter">{n.sym}</text>
            <text x={n.x} y={n.y + 26} fill="#2a2620" fontSize="9"
              textAnchor="middle" className="f-cond" fontWeight="700">{n.name}</text>
            {n.maxHp && (
              <g transform={`translate(${n.x - n.maxHp * 4}, ${n.y - (isForward ? 22 : 18)})`}>
                {Array.from({ length: n.maxHp }).map((_, i) => (
                  <rect key={i} x={i * 8} y="0" width="6" height="3"
                    fill={i < n.hp ? stroke : 'transparent'} stroke={stroke} strokeWidth="0.5" />
                ))}
              </g>
            )}
            {dead && <line x1={n.x - 18} y1={n.y - 14} x2={n.x + 18} y2={n.y + 14}
              stroke="#a83232" strokeWidth="2" />}
          </g>
        );
      })}
    </g>
  );
}

function AssetMarker({ asset, placement, onClick, hostileView }) {
  const c = CARDS[asset.cardId];
  if (!c) return null;
  const color = hostileView ? '#2c5f8d' : c.color; // Red sees Blue assets in NATO blue too (just outlines)
  return (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {!hostileView && (
        <circle cx={asset.x} cy={asset.y} r={c.range} fill="rgba(44,95,141,0.04)"
          stroke={color} strokeWidth="0.4" strokeDasharray="2,3" opacity="0.4" />
      )}
      <rect x={asset.x - 12} y={asset.y - 8} width="24" height="16"
        fill={hostileView ? 'transparent' : color + '30'}
        stroke={color} strokeWidth="1.5" />
      <text x={asset.x} y={asset.y + 3} fontSize="8" fill={color}
        textAnchor="middle" className="f-typewriter">{c.tag}</text>
      {!hostileView && asset.alive === false && (
        <line x1={asset.x - 14} y1={asset.y - 10} x2={asset.x + 14} y2={asset.y + 10}
          stroke="#a83232" strokeWidth="2" />
      )}
      {placement && (
        <text x={asset.x} y={asset.y + 22} fontSize="8" fill="#a83232"
          textAnchor="middle" className="f-typewriter">click to remove</text>
      )}
    </g>
  );
}

function ThreatMarker({ threat, fromRed }) {
  const tt = TT[threat.type] || TT.unknown;
  const isUnknown = threat.type === 'unknown' || !threat.classified;
  const color = fromRed ? '#a83232' : (isUnknown ? '#b8902c' : tt.color);
  return (
    <g>
      <polygon
        points={`${threat.x},${threat.y - 6} ${threat.x + 5},${threat.y} ${threat.x},${threat.y + 6} ${threat.x - 5},${threat.y}`}
        fill={color + '40'} stroke={color} strokeWidth="1.2" />
      <text x={threat.x + 8} y={threat.y + 3} fontSize="8" fill={color}
        className="f-typewriter">{isUnknown ? 'UNK' : tt.code}</text>
    </g>
  );
}

function EventLog({ g }) {
  return (
    <div className="cop-card">
      <div className="cop-card-header">EVENT LOG</div>
      <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
        {(g.log || []).slice(0, 30).map((l, i) => {
          const colors = { wave: 'var(--mil-friend)', contact: 'var(--mil-unknown)',
            ok: 'var(--mil-neutral)', warn: 'var(--mil-unknown)', crit: 'var(--mil-hostile)', info: 'var(--text-secondary)' };
          return (
            <div key={i} className="f-mono text-[9px] leading-tight"
              style={{ color: colors[l.type] || 'var(--text-primary)' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>{fmtGT(l.gt)}</span> · {l.msg}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EndScreen({ state, onLeave }) {
  const g = state.gameState;
  return (
    <div className="min-h-screen riso-paper p-6 flex items-center justify-center">
      <div className="max-w-2xl w-full">
        <div className="cls-banner mb-6">UNCLASSIFIED // POST-MISSION</div>
        <div className="cop-card">
          <div className="f-display text-3xl mb-2"
            style={{ color: g.endReason === 'time' ? 'var(--mil-friend)' : 'var(--mil-hostile)' }}>
            {g.endReason === 'time' ? 'TIME EXPIRED' : 'BLUE NODES LOST'}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 f-mono text-[11px]">
            <div>Spawned: <strong>{g.m.threatsSpawned}</strong></div>
            <div>Killed: <strong style={{ color: 'var(--mil-neutral)' }}>{g.m.threatsKilled}</strong></div>
            <div>Leaked: <strong style={{ color: 'var(--mil-hostile)' }}>{g.m.leakedReal}</strong></div>
            <div>Recon kills: <strong>{g.m.reconKills}</strong></div>
            <div>Strikes averted: <strong>{g.m.strikesAverted}</strong></div>
            <div>Node HP lost: <strong>{g.m.leakDmg}</strong></div>
          </div>
        </div>
        <button onClick={onLeave} className="btn-riso w-full mt-4">‹ BACK TO MENU</button>
      </div>
    </div>
  );
}
