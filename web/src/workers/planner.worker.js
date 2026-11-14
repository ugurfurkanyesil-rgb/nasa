/**
 * Planner Web Worker — DEM rota planlamasını ana iş parçacığının dışında yapar.
 *
 * Protokol (her mesajda `id`, yanıt aynı `id` ile döner):
 *   { type: 'init', site }                       → { ok: true, initMs }
 *   { type: 'plan', waypoints, sunAngleDeg, opts } → { routes, homeMaps, planMs }
 *   { type: 'science', home, opts }               → { result, planMs }  (Aşama 6)
 *   hata durumunda                               → { error }
 *
 * Arazi modülleri sabitlerini import anında site verisinden okur, bu yüzden
 * site önce doldurulur, modüller sonra DİNAMİK import edilir (main.jsx ile aynı kural).
 */

let P = null;      // pathfinder modülü
let CFG = null;    // config/marswalkProfile (EVA limit profile)
let maps = null;   // { hm, sm, cm }

async function init(siteMsg) {
  const t0 = performance.now();
  const { site } = await import('../terrain/siteData.js');
  Object.assign(site, siteMsg);
  const T = await import('../three/terrainGenerator.js');
  P = await import('../utils/pathfinder.js');
  CFG = await import('../config/marswalkProfile.js');
  const hm = T.buildHeightMap();
  maps = { hm, sm: T.buildSlopeMap(hm), cm: T.buildCraterMask() };
  P.getWallMap(); // duvar haritasını önceden kur
  return performance.now() - t0;
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') {
      const initMs = await init(e.data.site);
      self.postMessage({ id, ok: true, initMs });
      return;
    }
    if (CFG && e.data.profile) CFG.setEvaProfile(e.data.profile);
    if (CFG && e.data.bufferM != null) CFG.setObstacleBufferM(e.data.bufferM);
    if (type === 'plan') {
      if (!P) throw new Error('planner worker not initialised');
      const t0 = performance.now();
      const { waypoints, sunAngleDeg, opts } = e.data;
      const routes = P.planAllRoutes(waypoints, maps.sm, maps.cm, maps.hm, sunAngleDeg, null, opts || {});
      const hmaps = P.peekHomeMaps();
      // Ev haritalarının kopyası (worker kendi önbelleğini korur); ana iş parçacığına aktarılır
      const homeMaps = hmaps && {
        homeIdx: hmaps.homeIdx, profile: hmaps.profile, bufferM: hmaps.bufferM ?? 0,
        fromHome: hmaps.fromHome.slice(),
        toHome: hmaps.toHome.slice(),
      };
      const transfer = homeMaps ? [homeMaps.fromHome.buffer, homeMaps.toHome.buffer] : [];
      self.postMessage({ id, routes, homeMaps, planMs: performance.now() - t0 }, transfer);
      return;
    }
    if (type === 'science') {
      if (!P) throw new Error('planner worker not initialised');
      const t0 = performance.now();
      const result = P.planScience(e.data.home, maps.hm, e.data.opts || {});
      self.postMessage({ id, result, planMs: performance.now() - t0 });
      return;
    }
    throw new Error(`unknown message type: ${type}`);
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
