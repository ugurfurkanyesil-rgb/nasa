/**
 * Space weather for an EVA date — ONE lookup shared by the radiation card and the mission status,
 * so both always show the same thing. Bundled snapshot first; for a past date it does not cover,
 * a live DONKI query. Returns { wx, state }:
 *   state 'bundled' | 'live'   wx covers the date (events may be empty = no catalogued event)
 *         'loading'            live query running
 *         'failed'             live query failed (offline / rate-limited) — unknown, NOT clear
 *         'future'             date is in the future: DONKI is a catalogue, it has no forecast
 */
import { useEffect, useState } from 'react';
import { spaceWeatherAt, fetchSpaceWeatherLive } from '../utils/radiation';
import { SITE } from '../three/terrainGenerator';

export function useSpaceWeather(startMs) {
  const [live, setLive] = useState({ key: null, data: undefined });
  const valid = Number.isFinite(startMs);
  const bundled = spaceWeatherAt(SITE.spaceWeather, valid ? startMs : NaN);
  const future = valid && startMs > Date.now();
  const needLive = valid && bundled.advisory === 'no-data' && !future;
  const dayKey = valid ? Math.floor(startMs / 86400e3) : null;
  useEffect(() => {
    if (!needLive) return;
    let on = true;
    setLive({ key: dayKey, data: undefined });
    fetchSpaceWeatherLive(startMs).then(r => { if (on) setLive({ key: dayKey, data: r }); });
    return () => { on = false; };
  }, [needLive, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!valid) return { wx: null, state: 'failed' };
  if (!needLive) return { wx: bundled, state: future && bundled.advisory === 'no-data' ? 'future' : 'bundled' };
  if (live.key !== dayKey || live.data === undefined) return { wx: bundled, state: 'loading' };
  if (live.data === null) return { wx: bundled, state: 'failed' };
  return { wx: spaceWeatherAt(live.data, startMs), state: 'live' };
}
