/**
 * Load a real site (public/sites/<name>/) into siteData.site from disk, for Node tests.
 * Mirrors terrain/siteData.js loadSite() (same decoders, same validation), without fetch.
 * Must run BEFORE terrainGenerator / pathfinder are imported (they read the site at import).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'sites');

export function siteDir(name) { return join(ROOT, name); }

export async function loadRealSite(name) {
  const { site } = await import('../../src/terrain/siteData.js');
  const { decodeGeology } = await import('../../src/terrain/geology.js');
  const { decodeLayers } = await import('../../src/terrain/layers.js');
  const dir = siteDir(name);
  const json = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);
  const meta = json('meta.json');
  const n = meta.grid.n;
  const buf = readFileSync(join(dir, 'grid.bin'));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const heights = new Float32Array(n * n);
  for (let i = 0; i < heights.length; i++) heights[i] = dv.getFloat32(i * 4, true);
  const origin = Math.round(meta.elevation_m.median);
  for (let i = 0; i < heights.length; i++) heights[i] -= origin;
  const geo = json('geology.json'), lay = json('layers.json');
  Object.assign(site, {
    mode: 'dem', name, gridRes: n, cellM: meta.grid.cell_m, sizeM: (n - 1) * meta.grid.cell_m,
    heights, heightOrigin: origin, meta, loadError: null,
    climate: json('climate.json'),
    geology: geo ? decodeGeology(geo, n) : null,
    layers: lay ? decodeLayers(lay, n) : null,
    pov: json('pov.json'), ortho: json('ortho.json'), chemistry: json('chemistry.json'),
    track: json('track.json'), spaceWeather: json('space_weather.json'),
  });
  return site;
}
