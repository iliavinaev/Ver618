// Pure functions a plan needs, kept in one place.
//
// A plan carries two callables: how good a system is against a threat class,
// and what a threat costs. Both are derivable from data alone, which matters
// because a plan has to survive being posted to a worker, and functions do not
// survive structured cloning. The worker rebuilds them from the same source as
// the UI, so the two can never drift apart.

import { OP_PK } from './operational';

const THREAT_COST_M = { geran2: 0.1, geran1: 0.05, geran2_jet: 0.25, decoy: 0.01, emit_decoy: 0.02, kh101: 13, kalibr: 6.5, kh22: 1.0, iskander: 3.0, kinzhal: 10, kab: 0.03, kub_bla: 0.12, lancet: 0.035, molniya: 0.005, orlan10: 0.1, orlan30: 0.15, orion: 5, forpost: 6, altius: 12, sirius: 6 };
const FAM_COST_M = { ballistic: 3.0, cruise: 6.5, glide: 0.03, owa: 0.1, male: 5, tactical: 0.03, recon: 0.08, indirect: 0.005, unknown: 0.1 };

export function costForType(type, family) {
  if (THREAT_COST_M[type] != null) return THREAT_COST_M[type];
  return FAM_COST_M[family] != null ? FAM_COST_M[family] : 0.1;
}

// A library system has no hand-written Pk table, so one is derived from its
// category and reach: that derivation lives here rather than in the component.
export function makePkProfile(defs) {
  return function pkProfile(type) {
    if (OP_PK[type]) return OP_PK[type];
    const d = (defs && defs[type]) || {};
    if (d.isEW) return { ballistic: 0, cruise: 0, owa: 0, glide: 0 };
    if (d.cat === 'GUN_LASER') return OP_PK.gepard;
    if (d.cat === 'MANPADS') return { ballistic: 0, cruise: 0.10, owa: 0.50, glide: 0.15 };
    if (d.cat === 'INTERCEPTOR') return { ballistic: 0, cruise: 0.05, owa: 0.60, glide: 0.10 };
    if ((d.aeroRangeKm || 0) >= 100) return d.tbmFootprintKm > 0 ? OP_PK.patriot : { ballistic: 0.05, cruise: 0.70, owa: 0.50, glide: 0.50 };
    if ((d.aeroRangeKm || 0) >= 25) return OP_PK.iris_t;
    return OP_PK.nasams;
  };
}

// Strip a plan down to what can cross a worker boundary, then put it back
// together on the other side.
export function serialisePlan(plan) {
  const { pkProfile, costForType: _c, ...rest } = plan;
  return rest;
}
export function rehydratePlan(raw) {
  return { ...raw, pkProfile: makePkProfile(raw.defs), costForType };
}
