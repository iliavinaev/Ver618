// PartyKit client hook
import { useEffect, useRef, useState, useCallback } from 'react';

// Default points at the deployed PartyKit server so the static production build
// connects without any runtime env. Override with VITE_PARTYKIT_HOST for local dev.
const PARTYKIT_HOST = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PARTYKIT_HOST) || 'skywatch-mp.iliavinaev.partykit.dev';

export function useMultiplayer(roomCode, callsign, enabled) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null);
  const [youAre, setYouAre] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (!enabled || !roomCode) return;
    const wsProtocol = PARTYKIT_HOST.startsWith('localhost') ? 'ws' : 'wss';
    const url = `${wsProtocol}://${PARTYKIT_HOST}/parties/main/${roomCode}?callsign=${encodeURIComponent(callsign || 'OPR')}`;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { setError('Cannot connect to server'); return; }
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); setError(null); reconnectAttemptsRef.current = 0; };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'welcome') {
          setYouAre(msg.youAre); setIsHost(msg.isHost); setState(msg.state);
        } else if (msg.type === 'state_update' || msg.type === 'lobby_update' || msg.type === 'phase_change') {
          setState(msg.state);
        } else if (msg.type === 'error') {
          setError(msg.msg);
          setTimeout(() => setError(null), 3500);
        }
      } catch (e) { console.error('parse error', e); }
    };
    ws.onclose = () => {
      setConnected(false);
      if (reconnectAttemptsRef.current < 5 && enabled) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
        reconnectAttemptsRef.current++;
        setTimeout(() => { if (wsRef.current === ws && enabled) connect(); }, delay);
      } else if (enabled) {
        setError('Disconnected');
      }
    };
    ws.onerror = () => setError('Connection error');
  }, [roomCode, callsign, enabled]);

  useEffect(() => {
    if (enabled && roomCode) connect();
    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
  }, [enabled, roomCode, connect]);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }, []);

  const actions = {
    pickSide: (side) => send({ type: 'pick_side', side }),
    setReady: (ready) => send({ type: 'set_ready', ready }),
    setScenario: (sc) => send({ type: 'set_scenario', scenario: sc }),
    startMatch: () => send({ type: 'start_match' }),
    placeAsset: (cardId, x, y) => send({ type: 'place_asset', cardId, x, y }),
    removeAsset: (id) => send({ type: 'remove_asset', id }),
    setLoadout: (id, loadout) => send({ type: 'set_loadout', id, loadout }),
    finishDeploy: () => send({ type: 'finish_deploy' }),
    setMode: (assetId, mode) => send({ type: 'set_mode', assetId, mode }),
    setROE: (roe) => send({ type: 'set_roe', roe }),
    redSpawn: (threatType, from) => send({ type: 'red_spawn', threatType, from }),
    leaveMatch: () => send({ type: 'leave_match' }),
  };
  return { connected, error, state, youAre, isHost, send, actions };
}

export function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
