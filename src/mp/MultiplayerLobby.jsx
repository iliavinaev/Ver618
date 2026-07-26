// Lobby — DELTA dark COP styled
import React, { useState, useEffect } from 'react';
import { useMultiplayer, generateRoomCode } from './useMultiplayer';

export function MultiplayerLobby({ onMatchStart, onBack }) {
  const [callsign, setCallsign] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [stage, setStage] = useState('entry');

  const mp = useMultiplayer(roomCode, callsign, enabled);

  useEffect(() => {
    if (mp.state?.phase === 'placing' || mp.state?.phase === 'running') {
      onMatchStart && onMatchStart(mp);
    }
  }, [mp.state?.phase]);

  if (stage === 'entry') {
    return (
      <div className="min-h-screen riso-paper p-6 flex items-center justify-center">
        <div className="max-w-md w-full">
          <div className="cls-banner mb-6">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
          <div className="text-center mb-6">
            <div className="f-typewriter text-[10px] tracking-[0.4em] mb-2" style={{ color: 'var(--text-secondary)' }}>
              JATEC · MULTIPLAYER
            </div>
            <div className="f-display text-4xl" style={{ color: 'var(--mil-friend)', letterSpacing: '0.1em' }}>
              SKYWATCH NET
            </div>
          </div>

          <div className="cop-card">
            <div className="cop-card-header">OPERATOR CALLSIGN</div>
            <input
              value={callsign}
              onChange={e => setCallsign(e.target.value.toUpperCase().slice(0, 12))}
              placeholder="OPR-ALPHA"
              className="w-full f-mono text-sm"
              style={{ letterSpacing: '0.1em' }}
            />
          </div>

          <div className="cop-card">
            <div className="cop-card-header" style={{ color: 'var(--mil-friend)' }}>CREATE ROOM</div>
            <p className="f-mono text-[10px] mb-3" style={{ color: 'var(--text-secondary)' }}>
              Generate 4-digit room code, share with opponent.
            </p>
            <button
              onClick={() => {
                if (!callsign) { alert('Enter callsign first'); return; }
                setRoomCode(generateRoomCode());
                setEnabled(true);
                setStage('lobby');
              }}
              className="btn-riso w-full"
            >
              CREATE ROOM >
            </button>
          </div>

          <div className="cop-card">
            <div className="cop-card-header" style={{ color: 'var(--mil-unknown)' }}>JOIN EXISTING</div>
            <input
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0000"
              className="w-full f-mono text-2xl text-center mb-3"
              style={{ letterSpacing: '0.5em', padding: '10px' }}
            />
            <button
              onClick={() => {
                if (!callsign || roomCode.length !== 4) { alert('Need callsign + 4-digit code'); return; }
                setEnabled(true);
                setStage('lobby');
              }}
              className="btn-riso w-full"
              style={{ borderColor: 'var(--mil-unknown)', color: 'var(--mil-unknown)', background: 'var(--mil-unknown-bg)' }}
            >
              JOIN ROOM >
            </button>
          </div>

          <button onClick={onBack} className="btn-riso btn-alt w-full">‹ BACK</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen riso-paper p-6">
      <div className="cls-banner">PUBLIC // OPEN-SOURCE // ILLUSTRATIVE</div>
      <div className="max-w-3xl mx-auto pt-6">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="f-typewriter text-[10px] tracking-widest" style={{ color: 'var(--text-secondary)' }}>ROOM CODE</div>
            <div className="f-display text-5xl" style={{ letterSpacing: '0.25em', color: 'var(--mil-friend)' }}>
              {roomCode}
            </div>
          </div>
          <div className="text-right">
            <div className="f-typewriter text-[10px] tracking-widest" style={{ color: 'var(--text-secondary)' }}>STATUS</div>
            <div className="f-display text-xl"
              style={{ color: mp.connected ? 'var(--mil-neutral)' : 'var(--mil-hostile)' }}>
              {mp.connected ? '● LINKED' : '○ CONNECTING...'}
            </div>
          </div>
        </div>
        {mp.error && (
          <div className="alert-card crit mb-3">
            <span>⚠</span> {mp.error}
          </div>
        )}

        <div className="double-rule mb-4" />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <SidePanel
            side="blue" label="BLUE · DEFENDER" color="var(--mil-friend)"
            players={(mp.state?.players || []).filter(p => p.side === 'blue')}
            myCid={mp.youAre}
            canPick={mp.state?.phase === 'lobby'}
            onPick={() => mp.actions.pickSide('blue')}
            onReady={() => mp.actions.setReady(!mp.state?.players?.find(p => p.id === mp.youAre)?.ready)}
            myPlayer={mp.state?.players?.find(p => p.id === mp.youAre)}
          />
          <SidePanel
            side="red" label="RED · ATTACKER" color="var(--mil-hostile)"
            players={(mp.state?.players || []).filter(p => p.side === 'red')}
            myCid={mp.youAre}
            canPick={mp.state?.phase === 'lobby'}
            onPick={() => mp.actions.pickSide('red')}
            onReady={() => mp.actions.setReady(!mp.state?.players?.find(p => p.id === mp.youAre)?.ready)}
            myPlayer={mp.state?.players?.find(p => p.id === mp.youAre)}
          />
        </div>

        {mp.isHost && mp.state?.phase === 'lobby' && (
          <ScenarioBuilder scenario={mp.state?.scenario} onSet={(sc) => mp.actions.setScenario(sc)} />
        )}
        {!mp.isHost && (
          <div className="cop-card">
            <div className="cop-card-header">SCENARIO (host-controlled)</div>
            {mp.state?.scenario ? (
              <div className="f-mono text-[11px]" style={{ color: 'var(--text-primary)' }}>
                {mp.state.scenario.id?.toUpperCase()} · {mp.state.scenario.durationMin}min ·
                <span style={{ color: 'var(--mil-friend)' }}> Blue {mp.state.scenario.blueBudget}pts</span> ·
                <span style={{ color: 'var(--mil-hostile)' }}> Red {mp.state.scenario.redBudget}pts</span>
              </div>
            ) : <div className="f-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>not set</div>}
          </div>
        )}

        {(mp.state?.players || []).some(p => !p.side) && (
          <div className="cop-card">
            <div className="cop-card-header">SPECTATORS</div>
            <div className="f-mono text-[11px]">
              {(mp.state?.players || []).filter(p => !p.side).map(p => p.callsign).join(', ')}
            </div>
          </div>
        )}

        {mp.isHost && mp.state?.phase === 'lobby' && (
          <div className="flex gap-2">
            <button
              onClick={() => mp.actions.startMatch()}
              className="btn-riso flex-1"
              style={canStart(mp.state) ? {
                background: 'var(--mil-neutral)', borderColor: 'var(--mil-neutral)', color: 'var(--text-inverted)'
              } : undefined}>
              START MATCH >
            </button>
            <button onClick={onBack} className="btn-riso btn-alt">LEAVE</button>
          </div>
        )}
        {!mp.isHost && (
          <button onClick={onBack} className="btn-riso btn-alt w-full">LEAVE ROOM</button>
        )}
      </div>
      <div className="cls-banner mt-8">UNCLASSIFIED</div>
    </div>
  );
}

function canStart(state) {
  if (!state) return false;
  let blueReady = 0, redReady = 0;
  for (const p of state.players || []) {
    if (p.side === 'blue' && p.ready) blueReady++;
    if (p.side === 'red' && p.ready) redReady++;
  }
  return blueReady >= 1 && redReady >= 1;
}

function SidePanel({ side, label, color, players, myCid, canPick, onPick, onReady, myPlayer }) {
  const myInThisSide = myPlayer?.side === side;
  return (
    <div className="cop-card" style={{ borderColor: color, borderWidth: '2px' }}>
      <div className="cop-card-header" style={{ color }}>{label}</div>
      <div className="space-y-1 mb-3 min-h-[60px]">
        {players.length === 0 && <div className="f-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>— empty —</div>}
        {players.map(p => (
          <div key={p.id} className="flex items-center justify-between f-mono text-[11px]">
            <span>
              {p.callsign}
              {p.isHost && <span style={{ color: 'var(--mil-unknown)' }}></span>}
              {p.id === myCid && <span style={{ color: 'var(--text-secondary)' }}> (you)</span>}
              {!p.connected && <span style={{ color: 'var(--mil-hostile)' }}> [DC]</span>}
            </span>
            <span style={{ color: p.ready ? 'var(--mil-neutral)' : 'var(--text-tertiary)' }}>
              {p.ready ? '✓ READY' : '○ wait'}
            </span>
          </div>
        ))}
      </div>
      {canPick && !myInThisSide && (
        <button onClick={onPick} className="btn-riso w-full"
          style={{ background: color + '20', borderColor: color, color: color, padding: '6px', fontSize: '11px' }}>
          TAKE {side.toUpperCase()}
        </button>
      )}
      {myInThisSide && (
        <button onClick={onReady} className="btn-riso w-full"
          style={{
            background: myPlayer?.ready ? 'var(--mil-neutral)' : 'transparent',
            color: myPlayer?.ready ? 'var(--text-inverted)' : color,
            borderColor: myPlayer?.ready ? 'var(--mil-neutral)' : color,
            padding: '6px', fontSize: '11px',
          }}>
          {myPlayer?.ready ? '✓ READY (click to unready)' : 'CLICK WHEN READY'}
        </button>
      )}
    </div>
  );
}

function ScenarioBuilder({ scenario, onSet }) {
  const sc = scenario || { id: 'iron_wind', durationMin: 15, intensity: 'medium', blueBudget: 4000, redBudget: 5000 };
  const setField = (key, value) => onSet({ ...sc, [key]: value });
  return (
    <div className="cop-card">
      <div className="cop-card-header" style={{ color: 'var(--mil-unknown)' }}>SCENARIO BUILDER (HOST)</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>DURATION (real min)</label>
          <select value={sc.durationMin} onChange={e => {
            const d = parseInt(e.target.value);
            const m = { light: 0.6, medium: 1.0, heavy: 1.5, extreme: 2.0 }[sc.intensity] || 1.0;
            const newRed = Math.round(d * 60 * m * 0.8);
            const newBlue = Math.round(newRed * 0.85);
            onSet({ ...sc, durationMin: d, redBudget: newRed, blueBudget: newBlue });
          }} className="w-full">
            <option value="10">10 min (quick demo)</option>
            <option value="15">15 min (standard demo)</option>
            <option value="30">30 min (training)</option>
            <option value="45">45 min (extended)</option>
            <option value="60">60 min (full exercise)</option>
            <option value="90">90 min (deep)</option>
          </select>
        </div>
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>INTENSITY</label>
          <select value={sc.intensity} onChange={e => {
            const v = e.target.value;
            const m = { light: 0.6, medium: 1.0, heavy: 1.5, extreme: 2.0 }[v];
            const newRed = Math.round(sc.durationMin * 60 * m * 0.8);
            const newBlue = Math.round(newRed * 0.85);
            onSet({ ...sc, intensity: v, redBudget: newRed, blueBudget: newBlue });
          }} className="w-full">
            <option value="light">LIGHT</option>
            <option value="medium">MEDIUM</option>
            <option value="heavy">HEAVY</option>
            <option value="extreme">EXTREME</option>
          </select>
        </div>
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--mil-friend)' }}>BLUE BUDGET</label>
          <input type="number" value={sc.blueBudget}
            onChange={e => setField('blueBudget', parseInt(e.target.value) || 0)} className="w-full" />
        </div>
        <div>
          <label className="block mb-1 f-mono text-[10px]" style={{ color: 'var(--mil-hostile)' }}>RED BUDGET</label>
          <input type="number" value={sc.redBudget}
            onChange={e => setField('redBudget', parseInt(e.target.value) || 0)} className="w-full" />
        </div>
      </div>
    </div>
  );
}
