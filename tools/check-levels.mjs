// Validates every level map: row widths, borders, reachability of objectives,
// pickups and exits (keycard doors open only once a keycard is reachable).
// Usage: node tools/check-levels.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../js/levels.js', import.meta.url), 'utf8');
const ctx = {};
vm.runInNewContext(src + '\nthis.LEVELS = LEVELS;', ctx);

const SOLID = new Set('#XxTALBOC=DZI'.split(''));
const ENT = new Set('P^v<>gHocraK'.split(''));
let failures = 0;
const fail = (lvl, msg) => { failures++; console.log(`  FAIL [${lvl}] ${msg}`); };

for (const L of ctx.LEVELS) {
  const rows = L.map;
  const h = rows.length, w = rows[0].length;
  console.log(`${L.id}: ${w}x${h}`);
  rows.forEach((r, y) => { if (r.length !== w) fail(L.id, `row ${y} has length ${r.length} (expected ${w})`); });
  const at = (x, y) => (y < 0 || y >= h || x < 0 || x >= rows[y].length) ? '#' : rows[y][x];
  for (let x = 0; x < w; x++) { if (at(x, 0) !== '#' || at(x, h - 1) !== '#') fail(L.id, `border gap at column ${x}`); }
  for (let y = 0; y < h; y++) { if (at(0, y) !== '#' || at(w - 1, y) !== '#') fail(L.id, `border gap at row ${y}`); }

  let start = null; const need = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c === 'P') start = [x, y];
    if ('raKE'.includes(c)) need.push([c, x, y, false]);
    if ('ZI'.includes(c)) need.push([c, x, y, true]);
    if (c === 'c') {
      const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => at(x + dx, y + dy) === '#').length;
      if (!walls) fail(L.id, `camera at ${x},${y} is not touching a wall`);
    }
  }
  if (!start) { fail(L.id, 'no player start'); continue; }

  const flood = (openDoors) => {
    const seen = new Set([start.join()]); const q = [start];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny, c = at(nx, ny);
        if (seen.has(k)) continue;
        if (SOLID.has(c) && !(openDoors && c === 'D')) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return seen;
  };
  const noDoors = flood(false);
  const hasDoor = rows.some((r) => r.includes('D'));
  const cardReachable = need.some(([c, x, y]) => c === 'K' && noDoors.has(x + ',' + y));
  if (hasDoor && !cardReachable) fail(L.id, 'keycard is not reachable without opening a door');
  const reach = cardReachable ? flood(true) : noDoors;
  const reachable = (x, y, adj) => adj
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has((x + dx) + ',' + (y + dy)))
    : reach.has(x + ',' + y);
  for (const [c, x, y, adj] of need) if (!reachable(x, y, adj)) fail(L.id, `'${c}' at ${x},${y} unreachable`);
  if (!need.some(([c]) => c === 'E')) fail(L.id, 'no exit');
  // entities standing on reachable ground
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (ENT.has(c) && c !== 'c' && !reach.has(x + ',' + y)) console.log(`  note [${L.id}] '${c}' at ${x},${y} is in a sealed area`);
  }
  if (L.requires === 'cores' && !rows.some((r) => r.includes('Z'))) fail(L.id, 'requires cores but has none');
  if (L.requires === 'intel' && !rows.some((r) => r.includes('I'))) fail(L.id, 'requires intel but has none');
}
console.log(failures ? `\n${failures} problem(s)` : '\nAll levels OK');
process.exit(failures ? 1 : 0);
