// The adaptive-music logic, ported line for line from the Luau kit (MusicTimeline.luau and
// MusicDirector.luau) so the browser lab behaves exactly like the game. tests/run-luau.cjs
// replays the same scenarios through both and fails on any difference.
(function (M) {
  'use strict';

  // ---------------------------------------------------------------- MusicTimeline
  const Timeline = {
    BeatLength: (cue) => 60 / cue.Bpm,
    BarLength: (cue) => (60 / cue.Bpm) * cue.BeatsPerBar,
    LoopLength: (cue) => (60 / cue.Bpm) * cue.BeatsPerBar * cue.Bars,
    SyncLength(cue, sync) {
      if (sync === 'Beat') return Timeline.BeatLength(cue);
      if (sync === 'Bar') return Timeline.BarLength(cue);
      if (sync === 'Phrase') return Timeline.BarLength(cue) * Math.min(cue.PhraseBars || 4, cue.Bars);
      if (sync === 'Loop') return Timeline.LoopLength(cue);
      return 0;
    },
    // First grid point at or after `earliest`, on the grid that started at `startTime`.
    NextBoundary(cue, startTime, earliest, sync) {
      const unit = Timeline.SyncLength(cue, sync);
      if (unit <= 0) return earliest;
      const k = Math.ceil((earliest - startTime) / unit - 1e-6);
      return startTime + Math.max(k, 0) * unit;
    },
    // -> { loopTime, bar (1-based), beat (1-based) }
    Position(cue, startTime, now) {
      const loop = Timeline.LoopLength(cue);
      const t = (((now - startTime) % loop) + loop) % loop;
      const beats = t / Timeline.BeatLength(cue);
      return { loopTime: t, bar: Math.floor(beats / cue.BeatsPerBar) + 1, beat: Math.floor(beats % cue.BeatsPerBar) + 1 };
    },
    // Stem gain for an intensity: 0 below Min, 1 above Full, smoothstep between.
    LayerGain(minI, fullI, intensity) {
      if (fullI <= minI) return intensity >= minI ? 1 : 0;
      const x = Math.min(Math.max((intensity - minI) / (fullI - minI), 0), 1);
      return x * x * (3 - 2 * x);
    },
    // Where to start the new cue: "Start" = its first bar; "Match" = the same bar position as the
    // old cue (cues that share tempo and meter, like a calm and a combat version of one theme).
    EntryOffset(newCue, oldCue, oldStart, at, entry) {
      if (entry === 'Match' && oldCue && oldCue.Bpm === newCue.Bpm && oldCue.BeatsPerBar === newCue.BeatsPerBar) {
        const loop = Timeline.LoopLength(newCue);
        return (((at - oldStart) % loop) + loop) % loop;
      }
      return 0;
    },
  };

  // ---------------------------------------------------------------- MusicDirector
  // Game code reports *sources* ("enemy 12 sees me: combat 0.6", "wanted level: chase 0.8");
  // the director turns them into one state + one smoothed intensity, with hysteresis so the
  // music doesn't flip-flop: escalation is immediate, de-escalation waits for the state's Hold
  // and MinDwell, intensity rises at Attack/s and falls at Release/s after IntensityHold.
  function Director(config) {
    this.config = config;
    this.states = config.States;
    this.base = config.BaseState;
    if (!this.states[this.base]) throw new Error(`BaseState '${this.base}' is not in States`);
    this.sources = {};
    this.time = 0;
    this.state = this.base;
    this.intensity = this.states[this.base].Intensity || 0;
    this.stateSince = 0;
    this.lastSupport = 0;
    this.peakTime = 0;
  }
  Director.prototype.SetSource = function (id, state, intensity, ttl) {
    if (!this.states[state]) throw new Error(`unknown music state '${state}'`);
    this.sources[id] = { State: state, Intensity: Math.min(Math.max(intensity || 0, 0), 1), Expires: ttl === undefined || ttl === null ? null : this.time + ttl };
  };
  Director.prototype.ClearSource = function (id) { delete this.sources[id]; };
  Director.prototype.SetBase = function (state) {
    if (!this.states[state]) throw new Error(`unknown music state '${state}'`);
    if (this.state === this.base) this.lastSupport = -Infinity;
    this.base = state;
  };
  Director.prototype.Update = function (dt) {
    this.time += dt;
    const now = this.time, states = this.states, cfg = this.config;
    let best = this.base, bestPriority = states[this.base].Priority, bestIntensity = -1;
    const support = {};
    for (const id of Object.keys(this.sources)) {
      const s = this.sources[id];
      if (s.Expires !== null && s.Expires <= now) { delete this.sources[id]; continue; }
      support[s.State] = Math.max(support[s.State] === undefined ? 0 : support[s.State], s.Intensity);
    }
    for (const name of Object.keys(support)) {
      const p = states[name].Priority, i = support[name];
      if (p > bestPriority || (p === bestPriority && name !== best && (i > bestIntensity || (i === bestIntensity && name < best)))) {
        best = name; bestPriority = p; bestIntensity = i;
      }
    }
    if (support[this.state] !== undefined || this.state === this.base) this.lastSupport = now;

    let changed = false;
    if (best !== this.state) {
      const current = states[this.state];
      const up = bestPriority > current.Priority;
      const hold = current.Hold === undefined ? (cfg.StateHold || 0) : current.Hold;
      const held = now - this.lastSupport >= hold - 1e-9;
      const dwelt = now - this.stateSince >= (current.MinDwell || 0) - 1e-9;
      if (up || (held && dwelt)) {
        this.state = best;
        this.stateSince = now;
        this.lastSupport = now;
        changed = true;
      }
    }

    const def = states[this.state];
    const target = Math.max(def.Intensity || 0, support[this.state] === undefined ? 0 : support[this.state]);
    if (changed) {
      this.intensity = target;
      this.peakTime = now;
    } else if (target >= this.intensity) {
      this.intensity = Math.min(target, this.intensity + (cfg.Attack === undefined ? 1 : cfg.Attack) * dt);
      this.peakTime = now;
    } else if (now - this.peakTime >= (cfg.IntensityHold || 0) - 1e-9) {
      this.intensity = Math.max(target, this.intensity - (cfg.Release === undefined ? 0.25 : cfg.Release) * dt);
    }
    return { state: this.state, intensity: this.intensity, changed };
  };

  Object.assign(M, { Timeline, Director });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
