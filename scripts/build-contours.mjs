// Génère client/assets/contours.svg : de vraies courbes de niveau calculées (marching squares) sur un relief
// artificiel (somme de gaussiennes). Motif décoratif de la page d'accueil ; aucune donnée réelle n'est représentée.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 96;
const H = 60;
const VW = 1200;
const VH = 750;

// Générateur pseudo-aléatoire déterministe : le même fichier est produit à chaque build.
let seed = 20261024;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const hills = Array.from({ length: 9 }, () => ({ x: rnd() * W, y: rnd() * H, r: 7 + rnd() * 14, a: 0.5 + rnd() * 0.9 }));
const field = (x, y) => hills.reduce((s, h) => s + h.a * Math.exp(-(((x - h.x) ** 2 + (y - h.y) ** 2) / (2 * h.r * h.r))), 0);

const grid = Array.from({ length: H + 1 }, (_, j) => Array.from({ length: W + 1 }, (_, i) => field(i, j)));
const max = Math.max(...grid.flat());
const levels = Array.from({ length: 16 }, (_, k) => (0.06 + (k * 0.9) / 16) * max);

const sx = VW / W;
const sy = VH / H;
const lerp = (a, b, v) => (v - a) / (b - a);
const f1 = (n) => Math.round(n * 10) / 10;

function segmentsFor(level) {
  const segs = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const a = grid[j][i];
      const b = grid[j][i + 1];
      const c = grid[j + 1][i + 1];
      const d = grid[j + 1][i];
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = [i + lerp(a, b, level), j];
      const right = [i + 1, j + lerp(b, c, level)];
      const bottom = [i + lerp(d, c, level), j + 1];
      const left = [i, j + lerp(a, d, level)];
      const table = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]], 5: [[top, left], [bottom, right]], 6: [[top, bottom]],
        7: [[top, left]], 8: [[top, left]], 9: [[top, bottom]], 10: [[top, right], [left, bottom]], 11: [[top, right]], 12: [[left, right]],
        13: [[bottom, right]], 14: [[left, bottom]],
      };
      for (const [p, q] of table[code]) segs.push([p, q]);
    }
  }
  return segs;
}

// Chaînage des segments en polylignes (chemins plus compacts et traits continus).
function chain(segs) {
  const key = (p) => `${f1(p[0] * sx)},${f1(p[1] * sy)}`;
  const byEnd = new Map();
  segs.forEach((s, idx) => {
    for (const p of s) {
      const k = key(p);
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(idx);
    }
  });
  const used = new Set();
  const lines = [];
  const next = (p, from) => (byEnd.get(key(p)) ?? []).find((i) => i !== from && !used.has(i));
  for (let s = 0; s < segs.length; s++) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [segs[s][0], segs[s][1]];
    for (let dir = 0; dir < 2; dir++) {
      let cur = s;
      for (;;) {
        const tip = dir === 0 ? line[line.length - 1] : line[0];
        const n = next(tip, cur);
        if (n === undefined) break;
        used.add(n);
        const other = key(segs[n][0]) === key(tip) ? segs[n][1] : segs[n][0];
        if (dir === 0) line.push(other);
        else line.unshift(other);
        cur = n;
      }
    }
    lines.push(line);
  }
  return lines;
}

const groups = levels.map((lv, k) => {
  const d = chain(segmentsFor(lv))
    .map((l) => `M${l.map((p) => `${f1(p[0] * sx)} ${f1(p[1] * sy)}`).join('L')}`)
    .join('');
  const index = k % 4 === 0; // courbe maîtresse : un peu plus marquée, comme sur une carte topographique
  return `<path class="lvl" d="${d}" fill="none" stroke="currentColor" stroke-width="${index ? 1.6 : 0.9}" stroke-linejoin="round" stroke-linecap="round" opacity="${index ? 0.9 : 0.55}"/>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid slice" role="presentation" focusable="false">\n${groups.join('\n')}\n</svg>\n`;
await mkdir(join(root, 'client/assets'), { recursive: true });
await writeFile(join(root, 'client/assets/contours.svg'), svg);
console.log(`Courbes de niveau : ${levels.length} niveaux, ${(svg.length / 1024).toFixed(0)} Ko.`);
