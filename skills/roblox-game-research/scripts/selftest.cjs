#!/usr/bin/env node
// Offline checks for rbxresearch.cjs helpers. Pass --live to also hit Roblox's endpoints once.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const R = require('./rbxresearch.cjs');

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failed++;
};

// parseTarget
check('place id', R.parseTarget('920587237').placeId === 920587237);
check('games URL', R.parseTarget('https://www.roblox.com/games/920587237/Adopt-Me').placeId === 920587237);
check('localized URL', R.parseTarget('https://www.roblox.com/id/games/123456/X').placeId === 123456);
check('universe prefix', R.parseTarget('u:383310974').universeId === 383310974);
check('garbage rejected', R.parseTarget('adopt me') === null);

// gameMetrics
const now = Date.parse('2026-01-11T00:00:00Z');
const m = R.gameMetrics({
  id: 1, rootPlaceId: 2, name: 'G', creator: { name: 'Studio', type: 'Group' }, genre_l1: 'Simulation', genre_l2: 'Tycoon',
  playing: 1000, visits: 1_000_000, favoritedCount: 5000, maxPlayers: 8,
  created: '2026-01-01T00:00:00Z', updated: '2026-01-10T00:00:00Z', description: 'x',
}, { upVotes: 900, downVotes: 100 }, now);
check('age days', m.ageDays === 10, m.ageDays);
check('visits/day lifetime', m.visitsPerDayLifetime === 100000, m.visitsPerDayLifetime);
check('favorites per 1k visits', m.favPer1kVisits === 5, m.favPer1kVisits);
check('like %', m.likePct === 90, m.likePct);
check('days since update', m.daysSinceUpdate === 1, m.daysSinceUpdate);
check('genre joined', m.genre === 'Simulation / Tycoon');
check('creator group tag', m.creator === 'Studio (group)');

// passSummary / archetypes / buckets
const ps = R.passSummary([
  { name: 'x2 Cash', price: 99, isForSale: true },
  { name: 'VIP', price: 480, isForSale: true },
  { name: '+1 Pet Slot', price: 295, isForSale: true },
  { name: 'Auto Collect', price: 199, isForSale: true },
  { name: 'Old pass', price: 50, isForSale: false },
  { name: 'Mystery', price: 1000, isForSale: true },
]);
check('only for-sale passes counted', ps.count === 5, ps.count);
check('price min/median/max', ps.min === 99 && ps.median === 295 && ps.max === 1000, JSON.stringify(ps));
check('archetypes', ps.archetypes['2x / multiplier'] === 1 && ps.archetypes['VIP / premium perks'] === 1 && ps.archetypes['capacity / slots'] === 1 && ps.archetypes.automation === 1 && ps.archetypes.other === 1, JSON.stringify(ps.archetypes));
check('ladder sorted by price', ps.list.map((p) => p.price).join(',') === '99,199,295,480,1000');
const b = R.priceBuckets([10, 99, 100, 799, 5000]);
check('price buckets', b.find((x) => x.range === '<25').count === 1 && b.find((x) => x.range === '50-99').count === 1 && b.find((x) => x.range === '100-199').count === 1 && b.find((x) => x.range === '400-799').count === 1 && b.find((x) => x.range === '1600+').count === 1);
check('median even count', R.median([1, 2, 3, 4]) === 3 && R.median([]) === null);

// chartSummary
const cs = R.chartSummary([
  { sortId: 'top-trending', games: [{ universeId: 1, name: 'A', genreL1: 'Simulation', playerCount: 10 }, { universeId: 2, name: 'B', genreL1: 'Survival', playerCount: 5 }] },
  { sortId: 'top-earning', games: [{ universeId: 2, name: 'B', genreL1: 'Survival', playerCount: 7 }, { universeId: 3, name: 'C', genreL1: 'Simulation', playerCount: 1 }] },
]);
check('games in several charts', cs.multi.length === 1 && cs.multi[0].universeId === 2 && cs.multi[0].in.join() === 'top-trending#2,top-earning#1' && cs.multi[0].playing === 7, JSON.stringify(cs.multi));
check('genre counts per chart', cs.genres['top-trending'].length === 2);

// snapshotDelta
const prev = { at: '2026-01-01T00:00:00Z', playing: 100, visits: 1000, favorites: 10, updated: 'a' };
const d = R.snapshotDelta(prev, { at: '2026-01-03T00:00:00Z', playing: 150, visits: 5000, favorites: 30, updated: 'b' });
check('delta per day', d.days === 2 && d.visitsPerDay === 2000 && d.favoritesPerDay === 10 && d.playingChangePct === 50 && d.updatedSince === true, JSON.stringify(d));
check('too-soon delta flagged', R.snapshotDelta(prev, { ...prev, at: '2026-01-01T01:00:00Z' }).tooSoon === true);
check('no previous snapshot', R.snapshotDelta(null, prev) === null);

if (process.argv.includes('--live')) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'rbxresearch.cjs'), 'charts', '--sorts', 'top-trending', '--limit', '3', '--json'], { encoding: 'utf8', timeout: 60000 });
    const j = JSON.parse(out);
    check('live: top-trending returns games', j.sorts[0] && j.sorts[0].games.length > 0);
  } catch (e) {
    check('live: charts endpoint reachable', false, e.message.split('\n')[0]);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
