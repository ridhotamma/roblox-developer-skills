#!/usr/bin/env node
// Market data for Roblox game research, from Roblox's public web endpoints. Node 18+, no packages.
//
//   node rbxresearch.cjs charts [--sorts top-trending,up-and-coming,...] [--device all] [--country all]
//                               [--genre "Simulation"] [--limit 25] [--json] [--out file.md]
//   node rbxresearch.cjs games <placeId | roblox.com/games/... URL | u:<universeId>>... [--passes]
//                               [--snapshot dir] [--json] [--out file.md]
//
// charts: Roblox's Charts sorts (what's viral, what earns, what retains), plus which games appear
//         in several sorts and which genres dominate each one.
// games:  stats per game (players now, visits, favorites, likes, age, last update, genre) and
//         with --passes the game pass catalogue with prices, aggregated across games.
//         --snapshot saves the stats and, on later runs, reports change since the last snapshot
//         (real recent visits/day and player growth).
//
// The explore-api (charts) is undocumented and used by the Roblox website; it may change.
// Requests are sequential with a short delay. No login or personal data is used.
'use strict';

const fs = require('fs');
const path = require('path');

const UA = 'roblox-game-research-skill/1.0';
const SESSION = '00000000-0000-0000-0000-000000000000';
const DELAY_MS = 350;

const CHART_SORTS = {
  'top-trending': 'viral: largest relative growth in daily users over the past week',
  'up-and-coming': 'viral: published in the last 28 days, sorted by user growth',
  'top-earning': 'success: Robux spent in the last 7 days',
  'top-playing-now': 'success: concurrent players right now',
  'top-revisited': 'success: share of users who come back after a week (retention)',
  'top-rated': 'quality: high number and share of positive ratings (5k+ daily users)',
  'fun-with-friends': 'social: share of time spent playing in groups (5k+ daily users)',
  'top-paid-access': 'paid-access games sorted by daily revenue',
};
const DEFAULT_SORTS = ['top-trending', 'up-and-coming', 'top-earning', 'top-revisited', 'top-playing-now'];

// Pass name keywords -> archetype (for the monetization summary).
const PASS_ARCHETYPES = [
  ['2x / multiplier', /\b(\d+(\.\d+)?x|x\d+|double|triple|multiplier)\b/i],
  ['VIP / premium perks', /\b(vip|premium|mvp|elite|royal|pro)\b/i],
  ['luck / odds boost', /\b(luck|lucky|odds|chance)\b/i],
  ['capacity / slots', /\b(slots?|storage|inventory|backpack|equip|capacity|space|pen)\b/i],
  ['automation', /\b(auto|afk|idle|offline)\b/i],
  ['speed / movement', /\b(speed|fast|faster|run|walk|fly|jump|teleport)\b/i],
  ['skip / instant', /\b(skip|instant|unlock all)\b/i],
  ['cosmetic / expression', /\b(trail|aura|skin|title|tag|emote|effect|color|name ?tag|chat)\b/i],
  ['tools / weapons / items', /\b(sword|gun|tool|weapon|rod|pet|car|vehicle|boat|gear|item)\b/i],
  ['admin / fun commands', /\b(admin|commands?|troll|boombox|radio|music)\b/i],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429 && attempt < tries) {
      await sleep(1500 * attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} from ${url.split('?')[0]}: ${text.slice(0, 120)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response from ${url.split('?')[0]}`);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Pure helpers (tested offline by selftest.cjs)

function parseTarget(token) {
  const t = String(token).trim();
  let m = t.match(/^u(?:niverse)?:(\d+)$/i);
  if (m) return { universeId: Number(m[1]) };
  m = t.match(/roblox\.com\/(?:[a-z-]+\/)?games\/(\d+)/i) || t.match(/^(\d+)$/);
  if (m) return { placeId: Number(m[1]) };
  return null;
}

const DAY = 86400000;
const MIN_SNAPSHOT_DAYS = 0.25; // 6 hours

function gameMetrics(game, votes, now = Date.now()) {
  const created = Date.parse(game.created);
  const updated = Date.parse(game.updated);
  const ageDays = Math.max(1, (now - created) / DAY);
  const up = votes ? votes.upVotes : null;
  const down = votes ? votes.downVotes : null;
  return {
    universeId: game.id,
    placeId: game.rootPlaceId,
    name: game.name,
    creator: game.creator ? `${game.creator.name}${game.creator.type === 'Group' ? ' (group)' : ''}` : '',
    genre: [game.genre_l1, game.genre_l2].filter(Boolean).join(' / ') || game.genre || '',
    playing: game.playing,
    visits: game.visits,
    favorites: game.favoritedCount,
    maxPlayers: game.maxPlayers,
    ageDays: Math.round(ageDays),
    daysSinceUpdate: Math.round(((now - updated) / DAY) * 10) / 10,
    visitsPerDayLifetime: Math.round(game.visits / ageDays),
    favPer1kVisits: game.visits ? Math.round((game.favoritedCount / game.visits) * 10000) / 10 : null,
    likePct: up !== null && up + down > 0 ? Math.round((up / (up + down)) * 1000) / 10 : null,
    votes: up !== null ? up + down : null,
    description: game.description || '',
    url: `https://www.roblox.com/games/${game.rootPlaceId}`,
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function passSummary(passes) {
  const priced = passes.filter((p) => p.isForSale && typeof p.price === 'number');
  const prices = priced.map((p) => p.price);
  const archetypes = {};
  for (const p of priced) {
    const label = `${p.name || ''} ${p.displayDescription || ''}`;
    const hit = PASS_ARCHETYPES.find(([, re]) => re.test(label));
    const key = hit ? hit[0] : 'other';
    archetypes[key] = (archetypes[key] || 0) + 1;
  }
  return {
    count: priced.length,
    min: prices.length ? Math.min(...prices) : null,
    median: median(prices),
    max: prices.length ? Math.max(...prices) : null,
    archetypes,
    list: priced.map((p) => ({ name: p.name, price: p.price })).sort((a, b) => a.price - b.price),
  };
}

function priceBuckets(prices) {
  const edges = [25, 50, 100, 200, 400, 800, 1600, Infinity];
  const labels = ['<25', '25-49', '50-99', '100-199', '200-399', '400-799', '800-1599', '1600+'];
  const counts = labels.map(() => 0);
  for (const p of prices) counts[edges.findIndex((e) => p < e)]++;
  return labels.map((l, i) => ({ range: l, count: counts[i] }));
}

function chartSummary(sorts) {
  // sorts: [{ sortId, games: [{ universeId, name, playerCount, genreL1, ... }] }]
  const seen = new Map();
  for (const s of sorts) {
    s.games.forEach((g, i) => {
      const e = seen.get(g.universeId) || { universeId: g.universeId, placeId: g.rootPlaceId, name: g.name, genre: g.genreL1 || '', playing: g.playerCount, in: [] };
      e.in.push(`${s.sortId}#${i + 1}`);
      e.playing = Math.max(e.playing || 0, g.playerCount || 0);
      seen.set(g.universeId, e);
    });
  }
  const multi = [...seen.values()].filter((e) => e.in.length > 1).sort((a, b) => b.in.length - a.in.length || b.playing - a.playing);
  const genres = {};
  for (const s of sorts) {
    const counts = {};
    for (const g of s.games) {
      const k = g.genreL1 || 'Unknown';
      counts[k] = (counts[k] || 0) + 1;
    }
    genres[s.sortId] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }
  return { multi, genres };
}

function snapshotDelta(prev, cur) {
  if (!prev) return null;
  const days = (Date.parse(cur.at) - Date.parse(prev.at)) / DAY;
  if (!(days > 0)) return null;
  // Visits arrive in daily waves (time zones, school hours): shorter windows mislead.
  if (days < MIN_SNAPSHOT_DAYS) return { tooSoon: true, days: Math.round(days * 24 * 10) / 10 / 24 };
  return {
    days: Math.round(days * 100) / 100,
    visitsPerDay: Math.round((cur.visits - prev.visits) / days),
    favoritesPerDay: Math.round((cur.favorites - prev.favorites) / days),
    playingChangePct: prev.playing ? Math.round(((cur.playing - prev.playing) / prev.playing) * 1000) / 10 : null,
    updatedSince: cur.updated !== prev.updated,
  };
}

const fmt = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};
const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------
// Network

async function fetchChart(sortId, { device, country }) {
  const q = new URLSearchParams({ sessionId: SESSION, sortId, device, country });
  const d = await getJson(`https://apis.roblox.com/explore-api/v1/get-sort-content?${q}`);
  if (!d || !Array.isArray(d.games)) throw new Error(`chart "${sortId}" returned no games (unknown sort id?)`);
  return { sortId, name: d.sortDisplayName || sortId, info: (d.topicLayoutData && d.topicLayoutData.infoText) || CHART_SORTS[sortId] || '', games: d.games };
}

async function resolveUniverse(target) {
  if (target.universeId) return target.universeId;
  const d = await getJson(`https://apis.roblox.com/universes/v1/places/${target.placeId}/universe`);
  if (!d.universeId) throw new Error(`no universe for place ${target.placeId}`);
  await sleep(DELAY_MS);
  return d.universeId;
}

async function fetchGames(universeIds) {
  const out = [];
  for (let i = 0; i < universeIds.length; i += 50) {
    const ids = universeIds.slice(i, i + 50).join(',');
    const [games, votes] = [await getJson(`https://games.roblox.com/v1/games?universeIds=${ids}`), await getJson(`https://games.roblox.com/v1/games/votes?universeIds=${ids}`)];
    const vmap = new Map((votes.data || []).map((v) => [v.id, v]));
    for (const g of games.data || []) out.push(gameMetrics(g, vmap.get(g.id)));
    await sleep(DELAY_MS);
  }
  return out;
}

async function fetchPasses(universeId) {
  const passes = [];
  let token = '';
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ passView: 'Full', pageSize: '100' });
    if (token) q.set('pageToken', token);
    const d = await getJson(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?${q}`);
    passes.push(...(d.gamePasses || []));
    token = d.nextPageToken;
    await sleep(DELAY_MS);
    if (!token) break;
  }
  return passes;
}

// ---------------------------------------------------------------------------------------
// Commands

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && !['json', 'passes'].includes(key)) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else flags._.push(a);
  }
  return flags;
}

async function cmdCharts(flags) {
  const sortIds = flags.sorts ? String(flags.sorts).split(',').map((s) => s.trim()) : DEFAULT_SORTS;
  const limit = Number(flags.limit || 25);
  const opts = { device: flags.device || 'all', country: flags.country || 'all' };
  const sorts = [];
  for (const id of sortIds) {
    try {
      const s = await fetchChart(id, opts);
      if (flags.genre) s.games = s.games.filter((g) => (g.genreL1 || '').toLowerCase() === String(flags.genre).toLowerCase());
      sorts.push(s);
    } catch (e) {
      console.error(`warning: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  const summary = chartSummary(sorts);
  if (flags.json) return JSON.stringify({ at: new Date().toISOString(), filters: opts, sorts, summary }, null, 2);

  const lines = [`# Roblox charts — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, `Filters: device=${opts.device}, country=${opts.country}${flags.genre ? `, genre=${flags.genre}` : ''}`, ''];
  for (const s of sorts) {
    lines.push(`## ${s.name} (\`${s.sortId}\`)`, `_${s.info}_`, '', '| # | Game | Genre | Playing | Like % | Ids |', '|---|---|---|---|---|---|');
    s.games.slice(0, limit).forEach((g, i) => {
      const up = g.totalUpVotes || 0;
      const down = g.totalDownVotes || 0;
      const like = up + down ? `${((up / (up + down)) * 100).toFixed(0)}%` : '-';
      lines.push(`| ${i + 1} | ${cell(g.name)}${g.isSponsored ? ' (sponsored)' : ''} | ${cell(g.genreL1 || '')} | ${fmt(g.playerCount)} | ${like} | u:${g.universeId} / place ${g.rootPlaceId} |`);
    });
    lines.push('', `Genres: ${summary.genres[s.sortId].map(([k, n]) => `${k} ${n}`).join(', ')}`, '');
  }
  lines.push('## In several charts', '_Viral (trending, up-and-coming) and successful (earning, revisited, playing) at once are the strongest study candidates._', '');
  if (!summary.multi.length) lines.push('None.');
  else {
    lines.push('| Game | Genre | Playing | Charts (rank) |', '|---|---|---|---|');
    for (const e of summary.multi.slice(0, 40)) lines.push(`| ${cell(e.name)} (u:${e.universeId}) | ${cell(e.genre)} | ${fmt(e.playing)} | ${e.in.join(', ')} |`);
  }
  return lines.join('\n');
}

async function cmdGames(flags) {
  const targets = flags._.map(parseTarget);
  const bad = flags._.filter((t, i) => !targets[i]);
  if (bad.length) throw new Error(`can't read: ${bad.join(', ')} (use a place id, a roblox.com/games URL, or u:<universeId>)`);
  if (!targets.length) throw new Error('give at least one game');

  const universeIds = [];
  for (const t of targets) universeIds.push(await resolveUniverse(t));
  const games = await fetchGames([...new Set(universeIds)]);

  if (flags.passes) {
    for (const g of games) {
      try {
        g.passes = passSummary(await fetchPasses(g.universeId));
      } catch (e) {
        g.passes = { error: e.message };
      }
    }
  }

  const at = new Date().toISOString();
  if (flags.snapshot) {
    const dir = path.resolve(String(flags.snapshot));
    fs.mkdirSync(dir, { recursive: true });
    for (const g of games) {
      const file = path.join(dir, `${g.universeId}.json`);
      const history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
      const cur = { at, playing: g.playing, visits: g.visits, favorites: g.favorites, updated: new Date(Date.now() - g.daysSinceUpdate * DAY).toISOString().slice(0, 13) };
      g.change = snapshotDelta(history[history.length - 1], cur);
      g.snapshots = history.length + 1;
      history.push(cur);
      fs.writeFileSync(file, JSON.stringify(history, null, 1));
    }
  }

  const allPrices = games.flatMap((g) => (g.passes && g.passes.list ? g.passes.list.map((p) => p.price) : []));
  const allArch = {};
  for (const g of games) for (const [k, n] of Object.entries((g.passes && g.passes.archetypes) || {})) allArch[k] = (allArch[k] || 0) + n;

  if (flags.json) return JSON.stringify({ at, games, passPrices: flags.passes ? { median: median(allPrices), buckets: priceBuckets(allPrices), archetypes: allArch } : undefined }, null, 2);

  const lines = [`# Game stats — ${at.slice(0, 16).replace('T', ' ')} UTC`, ''];
  lines.push('| Game | Genre | Playing | Visits | Visits/day (lifetime) | Fav per 1k visits | Like % | Age (days) | Updated (days ago) | Max players |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const g of games) lines.push(`| [${cell(g.name)}](${g.url}) | ${cell(g.genre)} | ${fmt(g.playing)} | ${fmt(g.visits)} | ${fmt(g.visitsPerDayLifetime)} | ${g.favPer1kVisits ?? '-'} | ${g.likePct ?? '-'} | ${g.ageDays} | ${g.daysSinceUpdate} | ${g.maxPlayers} |`);
  lines.push('');
  for (const g of games) {
    lines.push(`## ${g.name}`, `${g.creator} · ${g.genre} · u:${g.universeId} · ${g.url}`);
    if (g.change && g.change.tooSoon) lines.push(`Last snapshot was only ${Math.round(g.change.days * 24 * 10) / 10} h ago: run again after 6+ hours (ideally 24 h, same time of day) to measure growth.`);
    else if (g.change) lines.push(`Since last snapshot (${g.change.days} days ago): ${fmt(g.change.visitsPerDay)} visits/day, ${fmt(g.change.favoritesPerDay)} favorites/day, players ${g.change.playingChangePct ?? '-'}%${g.change.updatedSince ? ', game was updated' : ''}`);
    else if (flags.snapshot) lines.push('First snapshot saved; run again later (same time of day) to measure recent growth.');
    const desc = g.description.split('\n').filter((l) => l.trim()).slice(0, 8).map((l) => `> ${l.trim()}`);
    if (desc.length) lines.push('', ...desc);
    if (g.passes) {
      if (g.passes.error) lines.push('', `Game passes: unavailable (${g.passes.error})`);
      else {
        lines.push('', `Game passes for sale: ${g.passes.count} · price min ${g.passes.min ?? '-'} / median ${g.passes.median ?? '-'} / max ${g.passes.max ?? '-'} R$`);
        lines.push(`Types: ${Object.entries(g.passes.archetypes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}`);
        if (g.passes.list.length) lines.push(`Ladder: ${g.passes.list.map((p) => `${cell(p.name)} ${p.price}`).join(' · ')}`);
      }
    }
    lines.push('');
  }
  if (flags.passes && allPrices.length) {
    lines.push('## Game pass prices across these games', `${allPrices.length} passes, median ${median(allPrices)} R$`, '', '| Price (R$) | Passes |', '|---|---|');
    for (const b of priceBuckets(allPrices)) lines.push(`| ${b.range} | ${b.count} |`);
    lines.push('', `Most common types: ${Object.entries(allArch).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  return lines.join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (!cmd || cmd === '-h' || cmd === '--help' || !['charts', 'games', 'sorts'].includes(cmd)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === 'sorts') {
    for (const [id, what] of Object.entries(CHART_SORTS)) console.log(`${id.padEnd(18)} ${what}`);
    return;
  }
  const text = cmd === 'charts' ? await cmdCharts(flags) : await cmdGames(flags);
  if (flags.out) {
    fs.writeFileSync(String(flags.out), text);
    console.log(`wrote ${flags.out}`);
  } else console.log(text);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`rbxresearch: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { parseTarget, gameMetrics, passSummary, priceBuckets, chartSummary, snapshotDelta, median };
