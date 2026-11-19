// Scenarios replayed through both the kit's Luau (Replay.luau) and the lab's JS port
// (scripts/engine/adaptive.js). Every output line must match exactly.
'use strict';

const CONFIG = {
  BaseState: 'explore',
  Attack: 1.5, Release: 0.15, IntensityHold: 3, StateHold: 6,
  States: {
    silence: { Priority: 0 },
    explore: { Priority: 1, Cue: 'exploration', Intensity: 0.2 },
    tension: { Priority: 2, Cue: 'heist_stealth', Intensity: 0.3, Hold: 6 },
    combat: { Priority: 3, Cue: 'action_combat', Intensity: 0.45, Hold: 8, MinDwell: 12 },
    chase: { Priority: 3, Cue: 'car_chase', Intensity: 0.3, Hold: 10 },
    boss: { Priority: 4, Cue: 'epic_boss', Intensity: 0.55, Hold: 5 },
  },
};

const SCENARIOS = [
  { name: 'combat', config: CONFIG, dt: 0.1, steps: 320, actions: [
    { t: 1, op: 'set', id: 'enemy1', state: 'combat', intensity: 0.6 },
    { t: 3, op: 'set', id: 'gunfire', state: 'combat', intensity: 0.95, ttl: 1.5 },
    { t: 6, op: 'clear', id: 'enemy1' },
  ] },
  { name: 'escalate', config: CONFIG, dt: 0.1, steps: 400, actions: [
    { t: 0.5, op: 'set', id: 'guard', state: 'tension', intensity: 0.4 },
    { t: 4, op: 'set', id: 'alarm', state: 'combat', intensity: 0.7 },
    { t: 8, op: 'set', id: 'boss', state: 'boss', intensity: 0.8 },
    { t: 15, op: 'clear', id: 'boss' },
    { t: 16, op: 'clear', id: 'alarm' },
    { t: 30, op: 'clear', id: 'guard' },
    { t: 36, op: 'base', state: 'silence' },
  ] },
  { name: 'tie', config: CONFIG, dt: 0.05, steps: 400, actions: [
    { t: 1, op: 'set', id: 'cops', state: 'chase', intensity: 0.5 },
    { t: 2, op: 'set', id: 'gang', state: 'combat', intensity: 0.4 },
    { t: 4, op: 'set', id: 'gang', state: 'combat', intensity: 0.8 },
    { t: 6, op: 'clear', id: 'cops' },
    { t: 9, op: 'clear', id: 'gang' },
  ] },
  { name: 'blip', config: CONFIG, dt: 1 / 60, steps: 1500, actions: [
    { t: 1, op: 'set', id: 'peek', state: 'combat', intensity: 0.5, ttl: 0.5 },
    { t: 2, op: 'set', id: 'emitter:tension', state: 'tension', intensity: 0.35 },
    { t: 2.5, op: 'set', id: 'emitter:tension', state: 'tension', intensity: 0.7 },
    { t: 3, op: 'clear', id: 'emitter:tension' },
  ] },
];

const C140 = { Bpm: 140, BeatsPerBar: 4, Bars: 8 };
const C92 = { Bpm: 92, BeatsPerBar: 4, Bars: 8, PhraseBars: 2 };
const C84W = { Bpm: 84, BeatsPerBar: 3, Bars: 8 };
const TIMELINE_CASES = [];
let i = 0;
for (const cue of [C140, C92, C84W]) {
  for (const sync of ['Immediate', 'Beat', 'Bar', 'Phrase', 'Loop']) {
    for (const now of [10, 10.4, 12.3456, 37.9, 100.01, 9.5]) {
      TIMELINE_CASES.push({ name: `c${i++}`, cue, start: 10, now, sync, min: 0.2 + (i % 5) * 0.1, full: 0.35 + (i % 5) * 0.12, intensity: (i % 11) / 10, entry: i % 2 ? 'Match' : 'Start', old: i % 3 ? cue : C92 });
    }
  }
}
TIMELINE_CASES.push({ name: 'bed', cue: C140, start: 0, now: 1, sync: 'Bar', min: 0, full: 0, intensity: 0, entry: 'Start' });
TIMELINE_CASES.push({ name: 'flat', cue: C140, start: 0, now: 1, sync: 'Bar', min: 0.5, full: 0.5, intensity: 0.49, entry: 'Start' });

module.exports = { CONFIG, SCENARIOS, TIMELINE_CASES };
