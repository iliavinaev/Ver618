// PartyKit server — authoritative game state with tick loop
// One Durable Object per game room

const TIME_COMPRESSION = 12;
const MAP_W = 900, MAP_H = 580;

const ASSET_COST = {
  patriot: 0, iris_t: 0, nasams: 1500, crotale: 800, camm: 1200,
  gepard: 600, skynex: 700, stinger: 250, piorun: 300,
  int_a: 300, int_b: 300, int_c: 300, ew_a: 400, ew_b: 400,
  mg_a: 100, mg_b: 100, mg_c: 100, mg_d: 100, mg_e: 100, mg_f: 100,
};

const THREAT_COST = {
  iskander: 800, kinzhal: 1200, kh101: 400, kalibr: 400, kh22: 700,
  kab: 300, kab_hvy: 450, geran2: 80, geran1: 60, geran2_jet: 120,
  lancet: 150, lancet_of: 200, fpv: 50, fpv_of: 80,
  orlan10: 60, orlan30: 90, zala: 80, eleron3: 50, supercam: 60,
  forpost: 200, altius: 350, arty: 40, mlrs: 120, mortar: 30, emit_decoy: 50,
};

const TT = {
  iskander:  { code: 'ISKR',     class: 'ballistic', speed: 0.55, dmg: 3, signature: 'large',  classify: 1500 },
  kinzhal:   { code: 'KNZL',     class: 'ballistic', speed: 0.75, dmg: 4, signature: 'large',  classify: 1200 },
  kh101:     { code: 'CR-AIR',   class: 'cruise',    speed: 0.18, dmg: 2, signature: 'medium', classify: 1800 },
  kalibr:    { code: 'CR-SEA',   class: 'cruise',    speed: 0.16, dmg: 2, signature: 'medium', classify: 1800 },
  kh22:      { code: 'CR-HVY',   class: 'cruise',    speed: 0.32, dmg: 3, signature: 'large',  classify: 1500 },
  kab:       { code: 'GLIDE',    class: 'glide',     speed: 0.20, dmg: 2, signature: 'medium', classify: 2000 },
  kab_hvy:   { code: 'GLIDE-HV', class: 'glide',     speed: 0.18, dmg: 3, signature: 'medium', classify: 2000 },
  geran2:    { code: 'OWA-LR',   class: 'owa',       speed: 0.07, dmg: 1, signature: 'small',  classify: 2500 },
  geran1:    { code: 'OWA-SR',   class: 'owa',       speed: 0.07, dmg: 1, signature: 'small',  classify: 2500 },
  geran2_jet:{ code: 'OWA-JET',  class: 'owa',       speed: 0.14, dmg: 1, signature: 'small',  classify: 2200 },
  lancet:    { code: 'IZD-52',   class: 'tactical',  speed: 0.13, dmg: 1, signature: 'small',  classify: 2700, ewVuln: true },
  lancet_of: { code: 'IZD-OF',   class: 'tactical',  speed: 0.12, dmg: 1, signature: 'small',  classify: 2700 },
  fpv:       { code: 'FPV',      class: 'tactical',  speed: 0.12, dmg: 0, signature: 'tiny',   classify: 3000, ewVuln: true },
  fpv_of:    { code: 'FPV-OF',   class: 'tactical',  speed: 0.12, dmg: 0, signature: 'tiny',   classify: 3000 },
  orlan10:   { code: 'ORLAN-10', class: 'recon',     speed: 0.08, dmg: 0, signature: 'small',  classify: 3000, ewVuln: true },
  orlan30:   { code: 'ORLAN-30', class: 'recon',     speed: 0.08, dmg: 0, signature: 'small',  classify: 3000, ewVuln: true },
  zala:      { code: 'ZALA',     class: 'recon',     speed: 0.08, dmg: 0, signature: 'tiny',   classify: 3200, ewVuln: true },
  eleron3:   { code: 'ELRN',     class: 'recon',     speed: 0.08, dmg: 0, signature: 'small',  classify: 3000, ewVuln: true },
  supercam:  { code: 'SCAM',     class: 'recon',     speed: 0.08, dmg: 0, signature: 'small',  classify: 3000, ewVuln: true },
  forpost:   { code: 'FRPST',    class: 'male',      speed: 0.10, dmg: 0, signature: 'medium', classify: 2500 },
  altius:    { code: 'ALTS',     class: 'male',      speed: 0.12, dmg: 0, signature: 'medium', classify: 2500 },
  arty:      { code: 'ARTY',     class: 'unknown',   speed: 0.4,  dmg: 1, signature: 'small',  classify: 1500, indirect: true },
  mlrs:      { code: 'MLRS',     class: 'unknown',   speed: 0.5,  dmg: 1, signature: 'small',  classify: 1500, indirect: true },
  mortar:    { code: 'MORT',     class: 'unknown',   speed: 0.3,  dmg: 1, signature: 'tiny',   classify: 1500, indirect: true },
  emit_decoy:{ code: 'EMIT-DCY', class: 'unknown',   speed: 0.05, dmg: 0, signature: 'medium', classify: 2000 },
};

const CARDS = {
  patriot:  { range: 380, sensorRange: 500, ammoMax: 8,   firingDelay: 4000, attached: true },
  iris_t:   { range: 250, sensorRange: 320, ammoMax: 12,  firingDelay: 2500, attached: true },
  nasams:   { range: 220, sensorRange: 280, ammoMax: 16,  firingDelay: 2000 },
  crotale:  { range: 150, sensorRange: 200, ammoMax: 12,  firingDelay: 1500 },
  camm:     { range: 200, sensorRange: 260, ammoMax: 10,  firingDelay: 1800 },
  gepard:   { range: 80,  sensorRange: 130, ammoMax: 80,  firingDelay: 600  },
  skynex:   { range: 90,  sensorRange: 140, ammoMax: 100, firingDelay: 500  },
  stinger:  { range: 60,  sensorRange: 100, ammoMax: 4,   firingDelay: 4000 },
  piorun:   { range: 65,  sensorRange: 105, ammoMax: 4,   firingDelay: 4000 },
  int_a:    { range: 280, sensorRange: 340, ammoMax: 6,   firingDelay: 5000, isInterceptor: true },
  int_b:    { range: 260, sensorRange: 320, ammoMax: 6,   firingDelay: 5000, isInterceptor: true },
  int_c:    { range: 260, sensorRange: 320, ammoMax: 6,   firingDelay: 5000, isInterceptor: true },
  ew_a:     { range: 95,  sensorRange: 130, ammoMax: 100, firingDelay: 0,    isEW: true },
  ew_b:     { range: 100, sensorRange: 130, ammoMax: 100, firingDelay: 0,    isEW: true },
  mg_a:     { range: 35,  sensorRange: 60,  ammoMax: 200, firingDelay: 1000 },
  mg_b:     { range: 35,  sensorRange: 60,  ammoMax: 200, firingDelay: 1000 },
  mg_c:     { range: 35,  sensorRange: 60,  ammoMax: 200, firingDelay: 1000 },
  mg_d:     { range: 35,  sensorRange: 60,  ammoMax: 200, firingDelay: 1000 },
  mg_e:     { range: 35,  sensorRange: 60,  ammoMax: 200, firingDelay: 1000 },
  mg_f:     { range: 35,  sensorRange: 60,  ammoMax: 200, firingDelay: 1000 },
};

const PK = {
  patriot:    { ballistic: 0.85, cruise: 0.75, glide: 0.70, male: 0.80, owa: 0.50 },
  iris_t:     { cruise: 0.80, glide: 0.75, male: 0.70, owa: 0.65, tactical: 0.55 },
  nasams:     { cruise: 0.75, glide: 0.65, male: 0.60, owa: 0.60, tactical: 0.45 },
  camm:       { cruise: 0.78, glide: 0.70, male: 0.65, owa: 0.60, tactical: 0.45 },
  crotale:    { cruise: 0.55, glide: 0.50, owa: 0.65, tactical: 0.50, male: 0.40 },
  gepard:     { owa: 0.70, tactical: 0.50, recon: 0.55, glide: 0.20 },
  skynex:     { owa: 0.75, tactical: 0.55, recon: 0.60, glide: 0.25 },
  stinger:    { owa: 0.55, tactical: 0.40, recon: 0.50 },
  piorun:     { owa: 0.60, tactical: 0.45, recon: 0.55 },
  interceptor:{ owa: 0.70, recon: 0.85, tactical: 0.45, cruise: 0.40, male: 0.30 },
  ew:         { owa: 0.45, tactical: 0.50, recon: 0.55, glide: 0.15 },
  mg:         { owa: 0.20, tactical: 0.45, recon: 0.40 },
};

const VECTORS = { N: { x: 350, y: -50 }, NE: { x: 950, y: 80 }, E: { x: 950, y: 290 }, SE: { x: 950, y: 500 }, S: { x: 400, y: 630 } };
const NODES_BASE = [
  { id: 'cp',      x: 380, y: 290, name: 'BDE TAC', hp: 4, maxHp: 4, value: 4, glyph: '◧', sym: 'TAC',  kind: 'rear' },
  { id: 'farp',    x: 320, y: 200, name: 'FARP-2',  hp: 3, maxHp: 3, value: 3, glyph: '✚', sym: 'FARP', kind: 'rear' },
  { id: 'ammo',    x: 350, y: 410, name: 'ATP-3',   hp: 3, maxHp: 3, value: 3, glyph: '◬', sym: 'ATP',  kind: 'rear' },
  { id: 'medical', x: 270, y: 350, name: 'R-2',     hp: 2, maxHp: 2, value: 2, glyph: '✚', sym: 'R2',   kind: 'rear' },
  { id: 'fwd_n',   x: 590, y: 160, name: 'STP-N',   hp: 3, maxHp: 3, value: 2, glyph: '▲', sym: 'STP-N', kind: 'forward' },
  { id: 'fwd_c',   x: 610, y: 290, name: 'STP-C',   hp: 3, maxHp: 3, value: 2, glyph: '▲', sym: 'STP-C', kind: 'forward' },
  { id: 'fwd_s',   x: 580, y: 420, name: 'STP-S',   hp: 3, maxHp: 3, value: 2, glyph: '▲', sym: 'STP-S', kind: 'forward' },
];

const RECON_DEPENDENCY = {
  iskander:  { req: ['altius', 'forpost'],  mode: 'strict' },
  kinzhal:   { req: ['altius', 'forpost'],  mode: 'strict' },
  kab:       { req: ['orlan30'],            mode: 'strict' },
  kab_hvy:   { req: ['orlan30'],            mode: 'strict' },
  lancet:    { req: ['zala', 'orlan10'],    mode: 'strict' },
  lancet_of: { req: ['zala'],               mode: 'strict' },
  kh101:     { req: ['altius', 'forpost'],  mode: 'soft' },
  kh22:      { req: ['altius', 'forpost'],  mode: 'soft' },
  kalibr:    { req: ['altius', 'forpost'],  mode: 'soft' },
};

const FRIENDLY_BOUND = { xMin: 30, yMin: 30, xMax: 540, yMax: 555 };

let _id = 1;
const uid = () => _id++;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
function getSector(x, y) {
  if (y < 220) return 'NE';
  if (y > 380) return 'SE';
  return 'E';
}

export default class GameRoom {
  constructor(party) {
    this.party = party;
    this.players = new Map();
    this.phase = 'lobby';
    this.scenario = null;
    this.gameState = null;
    this.tickInterval = null;
    this.lastTickMs = 0;
  }

  async onConnect(conn, ctx) {
    const cid = conn.id;
    const url = new URL(ctx.request.url);
    const callsign = url.searchParams.get('callsign') || `OPR-${cid.slice(0, 4).toUpperCase()}`;
    const isFirstPlayer = this.players.size === 0;
    this.players.set(cid, {
      id: cid, callsign, side: null, ready: false,
      isHost: isFirstPlayer, connected: true,
    });
    conn.send(JSON.stringify({
      type: 'welcome', youAre: cid, isHost: isFirstPlayer,
      state: this.snapshotForSide(null),
    }));
    this.broadcast();
  }

  onMessage(message, conn) {
    let msg;
    try { msg = JSON.parse(message); } catch (e) { return; }
    const player = this.players.get(conn.id);
    if (!player) return;
    switch (msg.type) {
      case 'pick_side':     return this.handlePickSide(player, msg.side);
      case 'set_ready':     return this.handleSetReady(player, msg.ready);
      case 'set_scenario':  return this.handleSetScenario(player, msg.scenario);
      case 'start_match':   return this.handleStartMatch(player);
      case 'place_asset':   return this.handlePlaceAsset(player, msg);
      case 'remove_asset':  return this.handleRemoveAsset(player, msg);
      case 'set_loadout':   return this.handleSetLoadout(player, msg);
      case 'finish_deploy': return this.handleFinishDeploy(player);
      case 'set_mode':      return this.handleSetMode(player, msg);
      case 'set_roe':       return this.handleSetROE(player, msg);
      case 'red_spawn':     return this.handleRedSpawn(player, msg);
      case 'leave_match':   return this.handleLeaveMatch(player);
      case 'ping':          return conn.send(JSON.stringify({ type: 'pong', t: msg.t }));
    }
  }

  onClose(conn) {
    const player = this.players.get(conn.id);
    if (player) {
      player.connected = false;
      setTimeout(() => {
        const p = this.players.get(conn.id);
        if (p && !p.connected) {
          this.players.delete(conn.id);
          if (p.isHost && this.players.size > 0) {
            Array.from(this.players.values())[0].isHost = true;
          }
          this.broadcast();
        }
      }, 30000);
    }
  }

  handlePickSide(player, side) {
    if (this.phase !== 'lobby') return;
    if (![null, 'blue', 'red'].includes(side)) return;
    if (side) {
      for (const p of this.players.values()) {
        if (p.id !== player.id && p.side === side) {
          this.sendError(player.id, `Side ${side.toUpperCase()} taken`);
          return;
        }
      }
    }
    player.side = side; player.ready = false;
    this.broadcast();
  }

  handleSetReady(player, ready) {
    if (!player.side) { this.sendError(player.id, 'Pick a side first'); return; }
    player.ready = !!ready;
    this.broadcast();
  }

  handleSetScenario(player, sc) {
    if (!player.isHost || this.phase !== 'lobby') return;
    this.scenario = {
      id: sc.id || 'iron_wind',
      durationMin: clamp(sc.durationMin || 15, 5, 120),
      intensity: sc.intensity || 'medium',
      blueBudget: sc.blueBudget || 4000,
      redBudget: sc.redBudget || 5000,
    };
    this.broadcast();
  }

  handleStartMatch(player) {
    if (!player.isHost || this.phase !== 'lobby') return;
    let blueReady = 0, redReady = 0;
    for (const p of this.players.values()) {
      if (p.side === 'blue' && p.ready) blueReady++;
      if (p.side === 'red' && p.ready) redReady++;
    }
    if (blueReady < 1 || redReady < 1) {
      this.sendError(player.id, 'Need 1 Blue and 1 Red ready');
      return;
    }
    if (!this.scenario) this.handleSetScenario(player, {});
    this.gameState = this.createInitialGameState();
    this.phase = 'placing';
    this.broadcast();
  }

  handlePlaceAsset(player, msg) {
    if (this.phase !== 'placing' || player.side !== 'blue') return;
    const { cardId, x, y } = msg;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (x < FRIENDLY_BOUND.xMin || x > FRIENDLY_BOUND.xMax ||
        y < FRIENDLY_BOUND.yMin || y > FRIENDLY_BOUND.yMax) return;
    const cost = ASSET_COST[cardId] ?? 100;
    if (this.gameState.blueBudget < cost) {
      this.sendError(player.id, 'Insufficient budget');
      return;
    }
    this.gameState.blueBudget -= cost;
    this.gameState.placedAssets.push({
      id: 'a_' + Math.random().toString(36).slice(2, 8),
      cardId, x, y, facing: 90,
      ownerId: player.id,
      loadout: CARDS[cardId]?.isInterceptor ? 'standard' : null,
    });
    this.broadcast();
  }

  handleRemoveAsset(player, msg) {
    if (this.phase !== 'placing' || player.side !== 'blue') return;
    const idx = this.gameState.placedAssets.findIndex(a => a.id === msg.id);
    if (idx < 0) return;
    const a = this.gameState.placedAssets[idx];
    this.gameState.blueBudget += (ASSET_COST[a.cardId] ?? 100);
    this.gameState.placedAssets.splice(idx, 1);
    this.broadcast();
  }

  handleSetLoadout(player, msg) {
    if (this.phase !== 'placing' || player.side !== 'blue') return;
    const a = this.gameState.placedAssets.find(a => a.id === msg.id);
    if (a && CARDS[a.cardId]?.isInterceptor) {
      a.loadout = msg.loadout;
      this.broadcast();
    }
  }

  handleFinishDeploy(player) {
    if (this.phase !== 'placing' || player.side !== 'blue') return;
    const now = Date.now();
    this.gameState.assets = this.gameState.placedAssets.map(a => {
      const c = CARDS[a.cardId];
      return {
        ...a,
        ammo: c.ammoMax || 6,
        hp: 1, maxHp: 1,
        mode: c.attached ? 'ENGAGE' : 'STANDBY',
        firingCooldown: 0,
        deploying: !c.attached,
        deployingUntil: now + (c.attached ? 0 : 2000),
        engageRules: { ballistic: true, cruise: true, glide: true, owa: true, male: true, tactical: true, recon: true, unknown: true },
        alive: true,
      };
    });
    // Pre-placed CORPS/DIV
    this.gameState.assets.push({
      id: 'pre_pat', cardId: 'patriot', x: 200, y: 290, facing: 90,
      ammo: 8, hp: 1, maxHp: 1, mode: 'ENGAGE', firingCooldown: 0,
      deploying: false, deployingUntil: 0, alive: true,
      engageRules: { ballistic: true, cruise: true, male: true },
    });
    this.gameState.assets.push({
      id: 'pre_iris', cardId: 'iris_t', x: 220, y: 200, facing: 90,
      ammo: 12, hp: 1, maxHp: 1, mode: 'ENGAGE', firingCooldown: 0,
      deploying: false, deployingUntil: 0, alive: true,
      engageRules: { cruise: true, glide: true, male: true, owa: true },
    });
    this.phase = 'running';
    this.gameState.startedAt = now;
    this.lastTickMs = now;
    this.startTickLoop();
    this.broadcast();
  }

  handleSetMode(player, msg) {
    if (this.phase !== 'running' || player.side !== 'blue') return;
    const a = this.gameState.assets.find(a => a.id === msg.assetId);
    if (!a || !a.alive || CARDS[a.cardId]?.attached) return;
    a.mode = msg.mode;
  }

  handleSetROE(player, msg) {
    if (this.phase !== 'running' || player.side !== 'blue') return;
    if (!['HOLD', 'TIGHT', 'FREE'].includes(msg.roe)) return;
    this.gameState.roe = msg.roe;
    this.gameState.log.unshift({ gt: this.gameState.gameTime, msg: `ROE: WPNS ${msg.roe}`, type: 'crit' });
  }

  handleRedSpawn(player, msg) {
    if (this.phase !== 'running' || player.side !== 'red') return;
    const cost = THREAT_COST[msg.threatType] ?? 100;
    if (this.gameState.redBudget < cost) {
      this.sendError(player.id, 'Insufficient budget');
      return;
    }
    if (!TT[msg.threatType]) return;
    this.gameState.redBudget -= cost;
    this.gameState.pendingRedSpawns.push({
      threatType: msg.threatType,
      from: msg.from || 'E',
      scheduledGT: this.gameState.gameTime + 500,
    });
  }

  handleLeaveMatch(player) {
    if (player.isHost && this.phase !== 'lobby') {
      this.stopTickLoop();
      this.phase = 'lobby';
      this.gameState = null;
      this.broadcast();
    }
  }

  startTickLoop() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      try { this.tick(); } catch (e) { console.error('tick error', e); }
    }, 100);
  }

  stopTickLoop() {
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
  }

  tick() {
    const g = this.gameState;
    if (!g || this.phase !== 'running') return;
    const now = Date.now();
    const dt = Math.min(150, now - this.lastTickMs);
    this.lastTickMs = now;
    const gameDt = dt * TIME_COMPRESSION;
    g.gameTime += gameDt;

    g.assets.forEach(a => {
      if (a.deploying && now > a.deployingUntil) {
        a.deploying = false;
        a.mode = 'ENGAGE';
      }
    });

    g.pendingRedSpawns = g.pendingRedSpawns.filter(s => {
      if (g.gameTime >= s.scheduledGT) {
        this.spawnThreat(s);
        return false;
      }
      return true;
    });

    this.updateThreats(dt, gameDt);
    this.updateAssets(dt, gameDt);

    const totalGameMs = (this.scenario.durationMin * 60 * 1000) * TIME_COMPRESSION;
    if (g.gameTime >= totalGameMs) { this.endMatch('time'); return; }
    const rearNodes = g.nodes.filter(n => n.kind !== 'forward');
    if (rearNodes.every(n => n.hp === 0)) { this.endMatch('blue_lost'); return; }

    this.broadcast();
  }

  updateThreats(dt, gameDt) {
    const g = this.gameState;
    g.threats.forEach(th => {
      if (!th.alive) return;
      th.x += th.vx * dt;
      th.y += th.vy * dt;
      if (th.x > MAP_W + 60 || th.x < -60 || th.y > MAP_H + 60 || th.y < -60) {
        th.alive = false;
        return;
      }
      if (!th.classified) {
        const inSensor = g.assets.some(a => a.alive && !a.deploying && Math.hypot(th.x - a.x, th.y - a.y) < (CARDS[a.cardId]?.sensorRange || 0));
        if (inSensor) {
          const tt = TT[th.type];
          const sigMult = { huge: 0.5, large: 0.7, medium: 1.0, small: 1.3, tiny: 1.7 }[tt.signature || 'medium'];
          th.classifyProgress = (th.classifyProgress || 0) + dt;
          if (th.classifyProgress >= tt.classify * sigMult) {
            th.classified = true;
            g.log.unshift({ gt: g.gameTime, msg: `✓ Classified: ${tt.code}`, type: 'ok' });
            if (['orlan30', 'zala', 'altius', 'forpost'].includes(th.type)) {
              const sector = getSector(th.x, th.y);
              g.log.unshift({ gt: g.gameTime, msg: `★ ${tt.code} CLASSIFIED in ${sector} — strike incoming. Engage to break kill chain.`, type: 'crit' });
            }
          }
        }
      }

      const tt = TT[th.type];
      const ttgt = g.nodes.find(n => n.hp > 0 && Math.hypot(th.x - n.x, th.y - n.y) < 14);
      if (ttgt && tt.dmg > 0) {
        th.alive = false;
        if (th.softDegraded && Math.random() < 0.6) {
          g.log.unshift({ gt: g.gameTime, msg: `✓ ${tt.code} MISSED ${ttgt.name} — no recon support`, type: 'ok' });
          g.m.strikesAverted = (g.m.strikesAverted || 0) + 1;
          return;
        }
        ttgt.hp = Math.max(0, ttgt.hp - tt.dmg);
        g.m.leakedReal++;
        g.m.leakDmg += tt.dmg;
        g.log.unshift({ gt: g.gameTime, msg: `✗✗ ${ttgt.name} STRUCK by ${tt.code}`, type: 'crit' });
        if (ttgt.hp === 0) {
          g.log.unshift({ gt: g.gameTime, msg: `!!! ${ttgt.name} LOST`, type: 'crit' });
        }
      }
    });
    g.threats = g.threats.filter(t => t.alive);
  }

  updateAssets(dt, gameDt) {
    const g = this.gameState;
    const roe = g.roe || 'TIGHT';
    g.assets.forEach(a => {
      if (!a.alive || a.deploying || a.mode !== 'ENGAGE') return;
      a.firingCooldown = Math.max(0, (a.firingCooldown || 0) - dt);
      if (a.firingCooldown > 0) return;
      if (a.ammo <= 0) return;
      const c = CARDS[a.cardId]; if (!c) return;

      let best = null, bestPrio = -1;
      g.threats.forEach(th => {
        if (!th.alive) return;
        if (Math.hypot(th.x - a.x, th.y - a.y) > c.range) return;
        if (roe === 'HOLD') return;
        if (!th.classified && roe !== 'FREE') return;
        const tt = TT[th.type];
        if (!a.engageRules?.[tt.class]) return;
        if (c.isEW && !tt.ewVuln) return;
        let prio = 0;
        if (tt.class === 'ballistic') prio = 100;
        else if (tt.class === 'cruise') prio = 80;
        else if (tt.class === 'glide') prio = 70;
        else if (tt.class === 'owa') prio = 60;
        else if (tt.class === 'tactical') prio = 40;
        else if (tt.class === 'recon') prio = 35;
        if (prio > bestPrio) { bestPrio = prio; best = th; }
      });
      if (!best) return;

      const tt = TT[best.type];
      const assetType = this.mapAssetType(a.cardId);
      const baseP = (PK[assetType] || {})[tt.class] ?? 0.3;
      const proxBoost = (1 - dist(best, a) / c.range) * 0.15;
      const finalP = clamp(baseP + proxBoost, 0.05, 0.95);
      const hit = Math.random() < finalP;

      a.firingCooldown = c.firingDelay;
      a.ammo = Math.max(0, a.ammo - 1);

      if (hit) {
        best.alive = false;
        g.m.threatsKilled++;
        g.m.intercepts++;
        if (TT[best.type].class === 'recon' || TT[best.type].class === 'male') {
          g.m.reconKills = (g.m.reconKills || 0) + 1;
          g.m.strikesAverted = (g.m.strikesAverted || 0) + 1;
          // Clear coverage for that recon
          for (const sec of ['NE', 'E', 'SE']) {
            if (g.reconCoverage[sec]?.threatId === best.id) g.reconCoverage[sec] = null;
          }
          g.log.unshift({ gt: g.gameTime, msg: `✓ RECON KILLED: ${tt.code} — designation broken`, type: 'ok' });
        }
        g.log.unshift({ gt: g.gameTime, msg: `✓ ${a.cardId.toUpperCase()} → ${tt.code} HIT (P${(finalP*100).toFixed(0)}%)`, type: 'ok' });
      } else {
        g.m.intercept_misses++;
        g.log.unshift({ gt: g.gameTime, msg: `✗ ${a.cardId.toUpperCase()} → ${tt.code} MISS (P${(finalP*100).toFixed(0)}%)`, type: 'warn' });
      }
    });
  }

  mapAssetType(cardId) {
    if (cardId.startsWith('int_')) return 'interceptor';
    if (cardId.startsWith('ew_')) return 'ew';
    if (cardId.startsWith('mg_')) return 'mg';
    return cardId;
  }

  spawnThreat(sp) {
    const g = this.gameState;
    const tt = TT[sp.type];
    if (!tt) return;
    const dep = RECON_DEPENDENCY[sp.type];
    let softDegraded = false;
    if (dep) {
      const sector = sp.from === 'NE' ? 'NE' : sp.from === 'SE' ? 'SE' : 'E';
      const cov = g.reconCoverage[sector];
      const has = cov && g.gameTime < cov.expiresGT && dep.req.includes(cov.designatorType);
      if (!has) {
        if (dep.mode === 'strict') {
          g.log.unshift({ gt: g.gameTime, msg: `✗ ${tt.code} CANCELLED — no ${dep.req.join('/')} in ${sector}`, type: 'ok' });
          g.m.strikesAverted = (g.m.strikesAverted || 0) + 1;
          return;
        }
        softDegraded = true;
      }
    }
    const origin = VECTORS[sp.from] || VECTORS.E;
    let tx, ty;
    if (tt.indirect) {
      const forwards = g.nodes.filter(n => n.hp > 0 && n.kind === 'forward');
      const t = forwards.length > 0 ? forwards[Math.floor(Math.random() * forwards.length)] : g.nodes[0];
      tx = t.x + (Math.random() - 0.5) * 40; ty = t.y + (Math.random() - 0.5) * 40;
    } else if (sp.type === 'kab') {
      const forwards = g.nodes.filter(n => n.hp > 0 && n.kind === 'forward');
      const t = forwards.length > 0 ? forwards[Math.floor(Math.random() * forwards.length)] : g.nodes[0];
      tx = t.x; ty = t.y;
    } else if (tt.class === 'recon' || tt.class === 'male') {
      tx = 200 + Math.random() * 300;
      ty = 100 + Math.random() * 380;
    } else {
      const t = g.nodes.filter(n => n.hp > 0 && n.kind !== 'forward').sort((a, b) => b.value - a.value)[0] || g.nodes[0];
      tx = t.x; ty = t.y;
    }
    const dx = tx - origin.x, dy = ty - origin.y, len = Math.hypot(dx, dy) || 1;
    const newThreat = {
      id: 't_' + uid(),
      type: sp.type,
      x: origin.x, y: origin.y,
      vx: (dx / len) * tt.speed, vy: (dy / len) * tt.speed,
      classified: false, classifyProgress: 0,
      alive: true,
      targetX: tx, targetY: ty,
      bearing: sp.from || 'E',
      softDegraded,
      spawnGT: g.gameTime,
    };
    g.threats.push(newThreat);
    if (['orlan10', 'orlan30', 'zala', 'forpost', 'altius', 'supercam', 'eleron3'].includes(sp.type)) {
      const sector = getSector(tx, ty);
      g.reconCoverage[sector] = {
        designatorType: sp.type,
        expiresGT: g.gameTime + 30 * 60 * 1000,
        threatId: newThreat.id,
      };
    }
    g.m.threatsSpawned++;
    g.log.unshift({ gt: g.gameTime, msg: `CONTACT ${sp.from} → ${tt.code}${softDegraded ? ' [no recon]' : ''}`, type: 'contact' });
  }

  endMatch(reason) {
    this.phase = 'ended';
    this.gameState.endReason = reason;
    this.stopTickLoop();
    this.broadcast();
  }

  createInitialGameState() {
    return {
      gameTime: 0,
      blueBudget: this.scenario.blueBudget,
      redBudget: this.scenario.redBudget,
      placedAssets: [],
      assets: [],
      threats: [],
      pendingRedSpawns: [],
      nodes: NODES_BASE.map(n => ({ ...n })),
      reconCoverage: { NE: null, E: null, SE: null },
      roe: 'TIGHT',
      log: [{ gt: 0, msg: `Mission start. Hold for ${this.scenario.durationMin} min.`, type: 'wave' }],
      m: { threatsSpawned: 0, threatsKilled: 0, intercepts: 0, intercept_misses: 0,
           leakedReal: 0, leakDmg: 0, reconKills: 0, strikesAverted: 0 },
      endReason: null, startedAt: 0,
    };
  }

  snapshotForSide(side) {
    const players = Array.from(this.players.values()).map(p => ({
      id: p.id, callsign: p.callsign, side: p.side, ready: p.ready,
      isHost: p.isHost, connected: p.connected,
    }));
    const base = { phase: this.phase, scenario: this.scenario, players };
    if (!this.gameState) return base;
    const g = this.gameState;
    let visibleThreats = g.threats;
    let visibleAssets = g.assets;

    if (side === 'red') {
      const redReconAlive = g.threats.filter(t => t.alive &&
        ['orlan10', 'orlan30', 'zala', 'forpost', 'altius', 'supercam', 'eleron3'].includes(t.type));
      visibleAssets = g.assets.filter(a => {
        if (!a.alive) return false;
        if (CARDS[a.cardId]?.attached) return true;
        if (a.mode === 'ENGAGE' && a.firingCooldown > 0) return true;
        for (const r of redReconAlive) {
          if (Math.hypot(a.x - r.x, a.y - r.y) < 100) return true;
        }
        return false;
      });
    } else if (side === 'blue') {
      visibleThreats = g.threats.filter(t => {
        if (!t.alive) return false;
        if (t.classified) return true;
        for (const a of g.assets) {
          if (!a.alive || a.deploying) continue;
          const c = CARDS[a.cardId]; if (!c) continue;
          if (Math.hypot(t.x - a.x, t.y - a.y) < (c.sensorRange || 0)) return true;
        }
        return false;
      }).map(t => {
        if (!t.classified) return { ...t, type: 'unknown', _origType: t.type, code: 'UNK' };
        return t;
      });
    }
    return {
      ...base,
      gameState: {
        gameTime: g.gameTime,
        blueBudget: g.blueBudget,
        redBudget: g.redBudget,
        placedAssets: g.placedAssets,
        assets: visibleAssets,
        threats: visibleThreats,
        nodes: g.nodes,
        reconCoverage: side === 'red' ? g.reconCoverage : null,
        roe: g.roe,
        log: g.log.slice(0, 30),
        m: g.m,
        endReason: g.endReason,
      },
    };
  }

  broadcast() {
    for (const conn of this.party.getConnections()) {
      const player = this.players.get(conn.id);
      const side = player?.side || null;
      const snap = this.snapshotForSide(side);
      try { conn.send(JSON.stringify({ type: 'state_update', state: snap })); } catch (e) {}
    }
  }

  sendError(cid, msgText) {
    for (const conn of this.party.getConnections()) {
      if (conn.id === cid) {
        try { conn.send(JSON.stringify({ type: 'error', msg: msgText })); } catch (e) {}
        return;
      }
    }
  }
}
