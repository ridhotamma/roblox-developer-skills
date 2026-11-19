// Drum grooves and rhythm cells. One string per voice, one character per step:
//   X = accent (1.0)   x = normal (0.72)   - = ghost (0.4)   . = rest
// `steps` is steps per bar: 16 = 4/4 in sixteenths, 12 = 4/4 in triplet eighths (12/8 feel)
// or 3/4 in sixteenths. Voices map to the drum instruments in instruments.js.
(function (M) {
  'use strict';

  const DRUMS = {
    // Electronic / pop
    four_floor: { steps: 16, kick: 'X...X...X...X...', clap: '....X.......X...', hat: '..x...x...x...x.', openhat: '..............x.' },
    synthwave: { steps: 16, kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
    backbeat: { steps: 16, kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
    halftime: { steps: 16, kick: 'X.........x.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' },
    trap: { steps: 16, kick: 'X......x..X.....', snare: '........X.......', hat: 'x.x.x.x.xxx.x.xx', openhat: '..............x.' },
    breakbeat: { steps: 16, kick: 'X.........X.....', snare: '....X..-....X..-', hat: 'x.x.x.x.x.x.x.x.' },
    lofi: { steps: 16, kick: 'X......x..X.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x-', rim: '.......-.......-' },
    chiptune: { steps: 16, kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx' },
    disco: { steps: 16, kick: 'X...X...X...X...', clap: '....X.......X...', hat: 'x.X.x.X.x.X.x.X.', openhat: '..x...x...x...x.' },
    // Cinematic / action
    action: { steps: 16, kick: 'X..x..X...X..x..', snare: '....X.......X..x', tom: '..........x.x.x.', hat: 'XxxxXxxxXxxxXxxx' },
    action_light: { steps: 16, hat: 'X-x-X-x-X-x-X-x-', shaker: 'x-x-x-x-x-x-x-x-' },
    taiko: { steps: 16, taiko: 'X..X..X.X...X.X.', tom: '......x.......x.', rim: 'x.x.x.x.x.x.x.x.' },
    epic: { steps: 16, kick: 'X.......X.......', taiko: 'X..x..X...X.x...', snare: '........X.......' },
    march: { steps: 16, snare: 'X.xxX.x.X.xxX.x.', kick: 'X.......X.......' },
    chase: { steps: 16, kick: 'X.xX..x.X.xX..x.', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx', tom: '...........x.xx.' },
    dnb: { steps: 16, kick: 'X.........X.....', snare: '....X.......X...', hat: 'x.xxx.xxx.xxx.xx' },
    // Tension / horror
    clock: { steps: 16, tick: 'x...x...x...x...' },
    tick8: { steps: 16, tick: 'x.x.x.x.x.x.x.x.', rim: '....-.......-...' },
    heartbeat: { steps: 16, kick: 'X..x............' },
    heartbeat_fast: { steps: 16, kick: 'X..x....X..x....' },
    horror_pulse: { steps: 16, kick: 'X...............', tom: '........x.......' },
    stalk: { steps: 16, kick: 'X.....x...X.....', tick: '..x...x...x...x.', tom: '...............x' },
    pound: { steps: 16, kick: 'X...X...X...X...', taiko: 'X.......X.......', tom: '..x...x...x...x.' },
    // Guitar-band grooves
    punk: { steps: 16, kick: 'X.....X.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
    skate: { steps: 16, kick: 'X...X...X...X...', snare: '..X...X...X...X.', hat: 'x.x.x.x.x.x.x.x.' },
    rock: { steps: 16, kick: 'X.....x.X.x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
    funk: { steps: 16, kick: 'X.........X..x..', snare: '....X..-.-..X..-', hat: 'x-x-x-x-x-x-x-xX', openhat: '.......x........' },
    folk: { steps: 16, kick: 'X.......X.......', rim: '....x.......x...', shaker: 'x-x-x-x-x-x-x-x-' },
    train: { steps: 16, kick: 'X.......X.......', snare: '-x-X-x-x-x-X-x-x' },
    // Dark and dusty: trip-hop (slow, heavy, behind the beat) and industrial (metal on metal)
    triphop: { steps: 16, kick: 'X......x..X.....', snare: '....X.......X..-', hat: 'x.x-x.x.x.x-x.x.' },
    industrial: { steps: 16, kick: 'X..x..X...X..x..', metal: '..x...x.x.....x.', tom: '............x.x.' },
    rust: { steps: 16, metal: '......x.........', tom: '..............-.' },
    // Grooves with a triplet feel (12 steps per 4/4 bar)
    shuffle: { steps: 12, kick: 'X.....X..x..', snare: '...X.....X..', hat: 'X.xX.xX.xX.x' },
    gallop: { steps: 12, kick: 'X..X..X..X..', rim: 'x.xx.xx.xx.x', shaker: 'x.xx.xx.xx.x' },
    // 3/4
    waltz: { steps: 12, kick: 'X...........', hat: '....x...x...', rim: '....-...-...' },
    // Light percussion beds
    hats16: { steps: 16, hat: 'X-x-X-x-X-x-X-x-' },
    hats8: { steps: 16, hat: 'x.x.x.x.x.x.x.x.' },
    shaker16: { steps: 16, shaker: 'x-x-x-x-x-x-x-x-' },
    ride: { steps: 16, ride: 'x.x.x.x.x.x.x.x.' },
  };

  // Rhythm strings for bass, stabs and other pitched patterns (same symbols).
  const RHYTHMS = {
    ostinato16: 'X-x-x-X-x-x-X-x-',
    chug16: 'XxxxXxxxXxxxXxxx',
    gallop16: 'X.xxX.xxX.xxX.xx',
    eighths: 'x.x.x.x.x.x.x.x.',
    offbeat: '..x...x...x...x.',
    quarters: 'X...x...X...x...',
    syncopated: 'X..x..x...x..x..',
    tresillo: 'X..x..x.X..x..x.',
    pushes: 'X.......X..x.x..',
    stab2: 'X.......X.......',
    stab_end: 'X..........x.X..',
    trap808: 'X......x..X.....',
    halftime: 'X.........x.....',
    heartbeat: 'X..x............',
    once: 'X...............',
    twice: 'X.......x.......',
    triplet12: 'X..x..x..x..',
    funk16: 'X..x-.x.X.-x.xX-',
  };

  // Melody rhythm cells per beat (in 16th steps; negative = rest).
  const CELLS = {
    sparse: [[16], [8, 8], [12, 4], [8, -8], [-4, 12], [4, 12]],
    medium: [[4], [2, 2], [3, 1], [2, 2], [4], [-2, 2], [1, 1, 2]],
    dense: [[2, 2], [1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [3, 1], [2, 2], [-1, 1, 2]],
    // cells that span a whole bar of 16 (used for hooks and fanfares)
    bar: [[3, 3, 2, 8], [4, 4, 8], [2, 2, 4, 8], [6, 2, 8], [3, 3, 4, 2, 2], [4, 2, 2, 4, 4]],
    // one-bar hook rhythms: each has a syncopation or a pickup, the thing that makes a hook stick
    hook: [[3, 3, 2, 4, 4], [2, 2, 3, 3, 2, 4], [-2, 2, 4, 2, 2, 4], [4, 3, 3, 2, 2, 2], [3, 1, 2, 2, 4, 4], [2, 4, 2, 4, 4], [-4, 2, 2, 3, 3, 2], [3, 3, 4, 2, 4]],
  };

  // Arpeggio figures: offsets along the chord's tones (0 = the tone nearest the previous chord's,
  // so each chord comes in on the inversion closest to the last one). Cycled per step within a bar.
  const ARPS = {
    alberti: [0, 2, 1, 2],                 // low-high-middle-high (classical left hand)
    broken: [0, 2, 1, 3, 2, 4, 3, 1],      // broken thirds: climbs by skipping
    groups3: [0, 1, 2, 0, 1, 2, 3, 2],     // 3+3+2 accents against the beat
    pedal: [0, 3, 0, 2, 0, 4, 0, 3],       // a low pedal tone under a moving top
    cascade: [4, 3, 2, 1, 3, 2, 1, 0],     // falling, with a lift halfway
    wave: [0, 1, 2, 3, 4, 3, 2, 1],        // up and down over five tones (with the 9th: a wide, open sweep)
    spread: [0, 2, 4, 5, 3, 1],            // six-note figure: drifts across the bar line
  };

  function velocityOf(ch) {
    return ch === 'X' ? 1 : ch === 'x' ? 0.72 : ch === '-' ? 0.4 : 0;
  }

  Object.assign(M, { DRUMS, RHYTHMS, CELLS, ARPS, velocityOf });
})(typeof MusicEngine !== 'undefined' ? MusicEngine : (globalThis.MusicEngine = globalThis.MusicEngine || {}));
