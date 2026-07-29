import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import {
  THEATRES, DEFENDED_PRESETS, THREAT_AXES, THREAT_REAL, BATTERY_REAL, OP_PK,
  WEATHER_PRESETS, makeWeather, weatherEffects, windGroundspeed, crosswindPkMul,
  SALVO, salvoPk, C2_POSTURE, radarHorizonKm, effectiveDetectKm,
  kmBetween, destPoint, resolveAxis, bearingTo, monteCarlo,
} from './data/operational';

const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Esri, Maxar, Earthstar Geographics';
const BLUE = '#2f80d6', RED = '#d24a44', AMBER = '#d9a52f', GREEN = '#4f9d77', TEXT = '#dde3ea', MUT = '#93a1b0', PANEL = '#102234';

// battery palette by role
const BAT_COLOR = (id) => id === 'ewnode' ? '#93a1b0' : (id === 'patriot' || id === 'samp_t') ? BLUE : (id === 'iris_t' || id === 'nasams') ? '#56a0e0' : '#7bb8d6';

export default function OperationalScreen({ onBack }) {
  const [theatreKey, setTheatreKey] = useState('ukraine');
  const theatre = THEATRES[theatreKey];
  const [placeMode, setPlaceMode] = useState('patriot'); // battery id to place, or 'erase'
  const [batteries, setBatteries] = useState([]); // {id, type, lat, lng}
  const [defended] = useState(DEFENDED_PRESETS.ukraine);
  const [axes, setAxes] = useState(['shahed_se', 'cruise_blacksea', 'ballistic_ne']);
  const [salvoKey, setSalvoKey] = useState('single');
  const [c2Key, setC2Key] = useState('decentralised');
  const [wxPreset, setWxPreset] = useState('clear');
  const [windDir, setWindDir] = useState(45);
  const [windKmh, setWindKmh] = useState(20);
  const [night, setNight] = useState(true);
  const [waveSize, setWaveSize] = useState(40);
  const [mc, setMc] = useState(null);
  const [running, setRunning] = useState(false);

  const weather = useMemo(() => makeWeather(wxPreset, windDir, windKmh, night), [wxPreset, windDir, windKmh, night]);

  const mapDivRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null), kmppRef = useRef(1);
  const placeRef = useRef(placeMode); placeRef.current = placeMode;
  const batRef = useRef(batteries); batRef.current = batteries;

  // ---- init map once ----
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomSnap: 0, zoomControl: true, worldCopyJump: false });
    L.tileLayer(ESRI_URL, { maxZoom: 19, attribution: ESRI_ATTR }).addTo(map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
    map.fitBounds([[theatre.s, theatre.w], [theatre.n, theatre.e]], { animate: false });
    layerRef.current = L.layerGroup().addTo(map);
    const recalc = () => {
      const c = map.getCenter();
      const p1 = map.latLngToContainerPoint(c);
      const east = map.containerPointToLatLng(L.point(p1.x + 100, p1.y));
      kmppRef.current = kmBetween({ lat: c.lat, lng: c.lng }, { lat: east.lat, lng: east.lng }) / 100;
      draw();
    };
    map.on('click', (e) => {
      const pm = placeRef.current;
      if (pm === 'erase') return;
      setBatteries(prev => [...prev, { uid: 'b' + Date.now() + Math.floor(Math.random() * 999), type: pm, lat: e.latlng.lat, lng: e.latlng.lng }]);
    });
    map.on('moveend zoomend', recalc);
    mapRef.current = map;
    setTimeout(() => { map.invalidateSize(); recalc(); }, 160);
    return () => { try { map.remove(); } catch (e) {} mapRef.current = null; };
    // eslint-disable-next-line
  }, []);

  // refit when theatre changes
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    map.fitBounds([[theatre.s, theatre.w], [theatre.n, theatre.e]], { animate: true });
  }, [theatreKey]);

  // ---- redraw overlays whenever inputs change ----
  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [batteries, defended, axes, theatreKey, wxPreset, windDir, windKmh]);

  function kmToPx(km) {
    const map = mapRef.current; if (!map) return km;
    return km / (kmppRef.current || 1);
  }
  function draw() {
    const map = mapRef.current, lg = layerRef.current; if (!map || !lg) return;
    lg.clearLayers();
    // defended assets
    defended.forEach(d => {
      const col = d.kind === 'energy' ? AMBER : BLUE;
      L.marker([d.lat, d.lng], { icon: L.divIcon({ className: '', iconSize: [10, 10], iconAnchor: [5, 5], html: `<div style="width:8px;height:8px;background:${col};border:1px solid #0a1626;transform:rotate(45deg)"></div>` }) }).addTo(lg);
      L.marker([d.lat, d.lng], { icon: L.divIcon({ className: '', iconSize: [120, 14], iconAnchor: [-6, 7], html: `<div style="font-family:monospace;font-size:9px;color:${TEXT};white-space:nowrap;text-shadow:0 0 3px #000">${d.name}</div>` }) }).addTo(lg);
    });
    // batteries + range rings (km-true)
    batteries.forEach(b => {
      const def = BATTERY_REAL[b.type]; if (!def) return;
      const col = BAT_COLOR(b.type);
      // aero engagement ring
      if (def.aeroRangeKm > 0) L.circle([b.lat, b.lng], { radius: def.aeroRangeKm * 1000, color: col, weight: 1.2, opacity: 0.85, fill: true, fillColor: col, fillOpacity: 0.06 }).addTo(lg);
      // TBM footprint (smaller, dashed) for ABM-capable
      if (def.tbmFootprintKm > 0) L.circle([b.lat, b.lng], { radius: def.tbmFootprintKm * 1000, color: BLUE, weight: 1, opacity: 0.9, dashArray: '4,4', fill: false }).addTo(lg);
      L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: `<div style="width:9px;height:9px;background:${col};border:1.5px solid #0a1626;border-radius:50%"></div>` }) })
        .on('click', () => setBatteries(prev => prev.filter(x => x.uid !== b.uid))).addTo(lg);
      L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', iconSize: [90, 12], iconAnchor: [-7, 6], html: `<div style="font-family:monospace;font-size:8px;color:${col};white-space:nowrap;text-shadow:0 0 3px #000">${def.name}</div>` }) }).addTo(lg);
    });
    // threat axes (arrows toward centre)
    axes.forEach(aid => {
      const ax = THREAT_AXES[aid]; if (!ax) return;
      const { origin, heading } = resolveAxis(ax, theatre);
      const tip = destPoint(origin.lat, origin.lng, heading, 120);
      const fam = ax.family;
      const col = fam === 'ballistic' ? RED : fam === 'cruise' ? '#e0726b' : fam === 'glide' ? '#c2873e' : AMBER;
      L.polyline([[origin.lat, origin.lng], [tip.lat, tip.lng]], { color: col, weight: 2, opacity: 0.8, dashArray: fam === 'ballistic' ? '2,6' : null }).addTo(lg);
      L.marker([origin.lat, origin.lng], { icon: L.divIcon({ className: '', iconSize: [140, 14], iconAnchor: [70, 18], html: `<div style="font-family:monospace;font-size:8px;color:${col};white-space:nowrap;text-align:center;text-shadow:0 0 3px #000">${ax.label}</div>` }) }).addTo(lg);
    });
  }

  // ---- build the wave threat list (with layered engagers by geo coverage) ----
  function buildThreats() {
    const list = [];
    const famThreat = { owa: 'shahed136', cruise: 'kalibr', ballistic: 'iskander', glide: 'umpk' };
    const activeAxes = axes.map(a => THREAT_AXES[a]).filter(Boolean);
    if (!activeAxes.length) return list;
    for (let i = 0; i < waveSize; i++) {
      const ax = activeAxes[i % activeAxes.length];
      const fam = ax.family;
      const tr = THREAT_REAL[famThreat[fam]] || THREAT_REAL.shahed136;
      // aim at a defended asset (weighted to high value)
      const tgt = pickTarget();
      // which batteries can engage: aero ring covers target, or (for ballistic) tbm footprint covers target
      const engagers = batteries.filter(b => {
        const def = BATTERY_REAL[b.type];
        if (!def) return false;
        const dKm = kmBetween({ lat: b.lat, lng: b.lng }, { lat: tgt.lat, lng: tgt.lng });
        if (fam === 'ballistic') return def.tbmFootprintKm > 0 && dKm <= def.tbmFootprintKm;
        return def.aeroRangeKm > 0 && dKm <= def.aeroRangeKm;
      }).map(b => b.type);
      list.push({ family: fam, dmg: tr.dmg, cost: ({ owa: 0.05, cruise: 6.5, ballistic: 3.0, glide: 0.03 })[fam], engagers, target: tgt.id });
    }
    return list;
  }
  function pickTarget() {
    const pool = [];
    defended.forEach(d => { for (let k = 0; k < d.value; k++) pool.push(d); });
    return pool[Math.floor(Math.random() * pool.length)] || defended[0];
  }

  function runMonteCarlo() {
    setRunning(true); setMc(null);
    setTimeout(() => {
      const threats = buildThreats();
      const res = monteCarlo({ batteries, threats, weather, salvoKey, n: 200 });
      setMc(res); setRunning(false);
    }, 30);
  }

  const totalRings = batteries.length;
  const abmCount = batteries.filter(b => (BATTERY_REAL[b.type] || {}).tbmFootprintKm > 0).length;

  return (
    <div className="min-h-screen riso-paper" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="cls-banner">PUBLIC · OPEN-SOURCE · ILLUSTRATIVE</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #243d52' }}>
        <div>
          <span className="f-display" style={{ fontSize: 22, color: BLUE, letterSpacing: '0.04em' }}>OPERATIONAL THEATRE</span>
          <span className="f-mono" style={{ fontSize: 10, color: MUT, marginLeft: 10 }}>COUNTRY-SCALE MODELLING / KM-TRUE / ILLUSTRATIVE</span>
        </div>
        <button onClick={onBack} className="btn-riso btn-alt" style={{ padding: '7px 14px', fontSize: 12 }}>‹ MENU</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ---- left control rail ---- */}
        <div style={{ width: 300, borderRight: '1px solid #243d52', overflowY: 'auto', padding: 12, background: '#0c1c2e' }}>
          <Section title="THEATRE">
            <Select value={theatreKey} onChange={setTheatreKey} options={Object.values(THEATRES).map(t => [t.key, t.label])} />
          </Section>

          <Section title="PLACE BATTERY (click map)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {Object.values(BATTERY_REAL).map(b => (
                <button key={b.id} onClick={() => setPlaceMode(b.id)}
                  className="f-mono" style={{ fontSize: 10, padding: '6px 4px', textAlign: 'left',
                    border: `1px solid ${placeMode === b.id ? BLUE : '#243d52'}`, borderRadius: 3,
                    background: placeMode === b.id ? 'rgba(47,128,214,0.16)' : 'transparent', color: placeMode === b.id ? '#fff' : TEXT, cursor: 'pointer' }}>
                  {b.name}<br /><span style={{ color: MUT }}>{b.aeroRangeKm > 0 ? b.aeroRangeKm + 'km' : 'EW'}{b.tbmFootprintKm > 0 ? ' +ABM' : ''}</span>
                </button>
              ))}
            </div>
            <div className="f-mono" style={{ fontSize: 10, color: MUT, marginTop: 6 }}>Click a battery on the map to remove it. {totalRings} placed, {abmCount} ABM-capable.</div>
          </Section>

          <Section title="THREAT AXES">
            {Object.values(THREAT_AXES).map(ax => (
              <label key={ax.id} className="f-mono" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: TEXT, padding: '2px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={axes.includes(ax.id)} onChange={e => setAxes(p => e.target.checked ? [...p, ax.id] : p.filter(x => x !== ax.id))} />
                {ax.label}
              </label>
            ))}
          </Section>

          <Section title="WEATHER / WIND">
            <Select value={wxPreset} onChange={setWxPreset} options={Object.values(WEATHER_PRESETS).map(w => [w.key, w.label])} />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Field label={`WIND FROM ${windDir}\u00B0`}><input type="range" min="0" max="359" value={windDir} onChange={e => setWindDir(+e.target.value)} style={{ width: '100%' }} /></Field>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <Field label={`WIND ${windKmh} km/h`}><input type="range" min="0" max="80" value={windKmh} onChange={e => setWindKmh(+e.target.value)} style={{ width: '100%' }} /></Field>
            </div>
            <label className="f-mono" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: TEXT, marginTop: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={night} onChange={e => setNight(e.target.checked)} /> Night
            </label>
            <div className="f-mono" style={{ fontSize: 10, color: MUT, marginTop: 6, padding: '4px 6px', border: '1px solid #243d52', borderRadius: 3 }}>
              METAR {weather.metar} / VIS {weather.vis_km}km / CLOUD {weather.cloudBase_m}m
            </div>
          </Section>

          <Section title="DOCTRINE">
            <div className="f-mono" style={{ fontSize: 9, color: MUT, marginBottom: 3 }}>SALVO</div>
            <Select value={salvoKey} onChange={setSalvoKey} options={Object.values(SALVO).map(s => [s.key, s.label])} />
            <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '6px 0 3px' }}>C2 POSTURE</div>
            <Select value={c2Key} onChange={setC2Key} options={Object.values(C2_POSTURE).map(s => [s.key, s.label])} />
          </Section>

          <Section title="WAVE">
            <Field label={`THREATS IN WAVE: ${waveSize}`}><input type="range" min="5" max="120" value={waveSize} onChange={e => setWaveSize(+e.target.value)} style={{ width: '100%' }} /></Field>
            <button onClick={runMonteCarlo} disabled={running || !batteries.length}
              className="f-display" style={{ width: '100%', marginTop: 8, padding: '10px', fontSize: 13, letterSpacing: '0.04em',
                border: `1px solid ${BLUE}`, borderRadius: 3, background: running ? '#1a3550' : 'rgba(47,128,214,0.18)', color: '#fff', cursor: running || !batteries.length ? 'not-allowed' : 'pointer' }}>
              {running ? 'RUNNING\u2026' : 'RUN MONTE-CARLO (200x)'}
            </button>
            {!batteries.length && <div className="f-mono" style={{ fontSize: 9, color: AMBER, marginTop: 4 }}>Place at least one battery.</div>}
          </Section>
        </div>

        {/* ---- map ---- */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div ref={mapDivRef} style={{ position: 'absolute', inset: 0, background: '#0a1626' }} />
          <div className="f-mono" style={{ position: 'absolute', top: 8, left: 8, zIndex: 500, background: 'rgba(10,22,38,0.82)', border: '1px solid #243d52', borderRadius: 3, padding: '4px 8px', fontSize: 9, color: MUT, pointerEvents: 'none' }}>
            Solid ring = aero engagement envelope (km-true). Dashed = ABM footprint vs ballistic.
          </div>
        </div>

        {/* ---- results rail ---- */}
        <div style={{ width: 300, borderLeft: '1px solid #243d52', overflowY: 'auto', padding: 12, background: '#0c1c2e' }}>
          <Section title="RESULTS (MONTE-CARLO)">
            {!mc && <div className="f-mono" style={{ fontSize: 10, color: MUT }}>Configure laydown, weather and doctrine, then run. 200 stochastic trials over the operational Pk model, no rendering.</div>}
            {mc && <MCResults mc={mc} weather={weather} salvoKey={salvoKey} />}
          </Section>
        </div>
      </div>
      <div className="cls-banner">PUBLIC</div>
    </div>
  );
}

function MCResults({ mc, weather, salvoKey }) {
  const lk = mc.leakers, ex = mc.expended;
  const maxBar = Math.max(...mc.leakHist.map(h => h.count), 1);
  return (
    <div>
      <Stat label="Leakers (threats reaching target)" v={`${lk.p50} median`} sub={`P10 ${lk.p10} / P90 ${lk.p90} / worst ${lk.max} of ${mc.totalThreats}`} color={RED} />
      <Stat label="Interceptors expended" v={`${Math.round(ex.mean)} avg`} sub={`P10 ${ex.p10} / P90 ${ex.p90}`} color={BLUE} />
      <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '8px 0 4px' }}>LEAKER DISTRIBUTION</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 70, borderBottom: '1px solid #243d52', borderLeft: '1px solid #243d52', padding: '0 2px' }}>
        {mc.leakHist.map(h => (
          <div key={h.leakers} title={`${h.leakers} leakers: ${h.count} trials`}
            style={{ flex: 1, height: `${(h.count / maxBar) * 100}%`, minHeight: h.count ? 2 : 0, background: h.leakers === 0 ? GREEN : h.leakers <= 3 ? AMBER : RED, opacity: 0.85 }} />
        ))}
      </div>
      <div className="f-mono" style={{ fontSize: 8, color: MUT, display: 'flex', justifyContent: 'space-between', marginTop: 2 }}><span>0</span><span>{mc.totalThreats} leakers</span></div>

      <div className="f-mono" style={{ fontSize: 9, color: MUT, margin: '10px 0 4px' }}>KILLS BY FAMILY</div>
      {Object.entries(mc.killsByFam).map(([f, n]) => (
        <div key={f} className="f-mono" style={{ fontSize: 10, color: TEXT, display: 'flex', justifyContent: 'space-between' }}>
          <span>{f}</span><span style={{ color: MUT }}>{(n / mc.trials).toFixed(1)} / wave</span>
        </div>
      ))}
      <div className="f-mono" style={{ fontSize: 9, color: MUT, marginTop: 10, lineHeight: 1.5, paddingTop: 6, borderTop: '1px solid #243d52' }}>
        Salvo: {(SALVO[salvoKey] || SALVO.single).label}. Weather applied to optical layers (vis {weather.vis_km}km{weather.night ? ', night' : ''}, wind {weather.windKmh}km/h). Illustrative model, not validated OA.
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="f-mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: '#56a0e0', borderBottom: '1px solid #243d52', paddingBottom: 3, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="f-mono"
      style={{ width: '100%', fontSize: 11, padding: '6px 4px', background: '#0a1626', border: '1px solid #243d52', color: TEXT, borderRadius: 3 }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function Field({ label, children }) {
  return <div style={{ flex: 1 }}><div className="f-mono" style={{ fontSize: 9, color: MUT, marginBottom: 2 }}>{label}</div>{children}</div>;
}
function Stat({ label, v, sub, color }) {
  return (
    <div style={{ marginBottom: 8, padding: '6px 8px', border: '1px solid #243d52', borderRadius: 3, background: '#0a1626' }}>
      <div className="f-mono" style={{ fontSize: 9, color: MUT }}>{label}</div>
      <div className="f-display" style={{ fontSize: 18, color }}>{v}</div>
      {sub && <div className="f-mono" style={{ fontSize: 9, color: MUT }}>{sub}</div>}
    </div>
  );
}
