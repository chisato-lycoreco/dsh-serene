/**
 * 天气落盘：`weather.json`。
 *
 * 这里只是「最近一次外面报进来的读数」；它新不新鲜由 core/weather.js 判断
 * （默认 3 小时）。插件自己不联网——谁去查天气是宿主的事。
 */

import { freshWeather, normalizeWeather } from "../../core/weather.js";
import { DocStore } from "./doc-store.js";

const DEFAULTS = { version: 1, weather: null };

export class WeatherStore {
  constructor({ dir }) {
    this.doc = new DocStore({
      dir,
      file: "weather.json",
      defaults: DEFAULTS,
      normalize: (raw) => ({
        version: 1,
        weather: raw?.weather && typeof raw.weather === "object" ? raw.weather : null,
      }),
    });
  }

  /** 最近一次读数（可能已经过期）。 */
  get latest() {
    return this.doc.get().weather;
  }

  /** 还新鲜的读数；过期了当没有。 */
  current(now = Date.now()) {
    return freshWeather(this.latest, now);
  }

  record(raw, now = Date.now()) {
    const weather = normalizeWeather(raw, { now });
    if (!weather) return null;
    this.doc.set({ version: 1, weather });
    return weather;
  }

  reset() {
    return this.doc.reset();
  }
}
