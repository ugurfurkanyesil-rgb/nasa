/**
 * Planner client — ana iş parçacığı tarafı.
 *
 * DEM modunda rota planlaması Web Worker'da yapılır (arayüz donmaz).
 * Worker kurulamaz veya çökerse senkron planAllRoutes'a geri döner.
 * Prosedürel Ay modu her zaman senkron (eski davranış).
 */

import { IS_DEM, SITE } from '../three/terrainGenerator.js';
import { planAllRoutes, setHomeMaps, planScience as planScienceSync } from './pathfinder.js';
import { getEvaProfile, getObstacleBufferM } from '../config/marswalkProfile.js';

let worker = null;
let readyPromise = null;
// worker kalıcı olarak başarısız → senkron mod. ?planner=sync ile zorlanabilir
// (hata ayıklama / karşılaştırma testi).
let disabled = (() => {
  try { return new URLSearchParams(self.location.search).get('planner') === 'sync'; } catch { return false; }
})();
let seq = 0;
const pending = new Map();

function rejectAll(reason) {
  for (const { reject } of pending.values()) reject(new Error(reason));
  pending.clear();
}

function call(type, payload, transfer) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, profile: getEvaProfile(), bufferM: getObstacleBufferM(), ...payload }, transfer || []);
  });
}

function ensureWorker() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    worker = new Worker(new URL('../workers/planner.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data);
    };
    worker.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.error('[planner] worker error:', e.message || e);
      disabled = true;
      rejectAll(`planner worker failed: ${e.message || 'unknown'}`);
    };
    const siteMsg = {
      mode: SITE.mode, name: SITE.name, gridRes: SITE.gridRes, cellM: SITE.cellM,
      sizeM: SITE.sizeM, heights: SITE.heights, heightOrigin: SITE.heightOrigin, meta: SITE.meta,
      climate: SITE.climate, geology: SITE.geology, layers: SITE.layers, chemistry: SITE.chemistry,
    };
    const r = await call('init', { site: siteMsg });
    // eslint-disable-next-line no-console
    console.info(`[planner] worker ready in ${r.initMs.toFixed(0)} ms`);
  })();
  return readyPromise;
}

/** Arka planda planlama kullanılabilir mi? */
export function plannerUsesWorker() {
  return IS_DEM && !disabled && typeof Worker !== 'undefined';
}

/** Uygulama açılışında worker'ı önceden ısıt (ilk planlamayı hızlandırır). */
export function warmPlanner() {
  if (plannerUsesWorker()) ensureWorker().catch(() => { disabled = true; });
}

/**
 * Rotaları planlar. DEM: worker (async). Prosedürel veya worker yoksa: senkron.
 * @returns {Promise<object>} planAllRoutes ile aynı yapı
 */
export async function planRoutes(waypoints, maps, sunAngleDeg, experienceMap, opts = {}) {
  if (plannerUsesWorker()) {
    try {
      await ensureWorker();
      const plain = waypoints.map(w => (w.dwellS > 0
        ? { x: w.x, z: w.z, dwellS: w.dwellS, label: w.label || null }
        : { x: w.x, z: w.z }));
      const r = await call('plan', { waypoints: plain, sunAngleDeg, opts });
      if (r.homeMaps) setHomeMaps(r.homeMaps);
      return r.routes;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[planner] falling back to main-thread planning:', err.message);
      disabled = true;
    }
  }
  return planAllRoutes(waypoints, maps.sm, maps.cm, maps.hm, sunAngleDeg, experienceMap, opts);
}

/**
 * Bilim EVA'sı (Aşama 6): durak seçimi + sırası. DEM + geology.json gerekir.
 * @returns {Promise<object|null>} pathfinder.planScience çıktısı
 */
export async function planScience(home, maps, opts = {}) {
  if (plannerUsesWorker()) {
    try {
      await ensureWorker();
      const r = await call('science', { home: { x: home.x, z: home.z }, opts });
      return r.result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[planner] science on main thread:', err.message);
      disabled = true;
    }
  }
  return planScienceSync(home, maps.hm, opts);
}
