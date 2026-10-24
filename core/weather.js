/**
 * core/weather.js — 窗外那一刻的实况（纯函数）
 *
 * 公开版**不联网**：这一层只负责「把外面报进来的天气收成一份干净的读数」，
 * 以及判断它还新不新鲜。谁去查天气是宿主的事（agent 自己的 web 工具，
 * 或者人在配置里手写）；插件不替窗外下雨。
 *
 * 为什么要有这一层：
 *   - 没有它，她只能凭季节猜天气，十月末照样会说「今天挺热」；
 *   - 有了它，天气也只是一句背景：不播报、不用来改写已经发生的事，
 *     只影响还没发生的那一次选择（比如今天想听什么）。
 *
 * 三条边界沿用私有版的结论：
 *   1. 只写拿得到的；缺字段就不写，不拿默认值糊弄。
 *   2. 不播报日期和天气，他问起再照实说。
 *   3. 过期（默认 3 小时）就当没有——宁可少说，也不替他窗外的雨。
 */

/** 读数多久之后不再进 prompt 和生活判断。 */
export const WEATHER_TTL = 3 * 3_600_000;

/**
 * 天气码 → 中文。码沿用 WMO（Open-Meteo 用的那套），这样宿主抓回来的原始码
 * 不用改就能收；`rain / snow / storm` 是给「要不要出门 / 想听什么」这类判断用的。
 */
export const WEATHER_CODES = Object.freeze({
  0: { label: "晴", rain: false, snow: false, storm: false },
  1: { label: "晴间多云", rain: false, snow: false, storm: false },
  2: { label: "多云", rain: false, snow: false, storm: false },
  3: { label: "阴", rain: false, snow: false, storm: false },
  45: { label: "雾", rain: false, snow: false, storm: false },
  48: { label: "雾凇", rain: false, snow: false, storm: false },
  51: { label: "毛毛雨", rain: true, snow: false, storm: false },
  53: { label: "毛毛雨", rain: true, snow: false, storm: false },
  55: { label: "毛毛雨", rain: true, snow: false, storm: false },
  56: { label: "冻雨", rain: true, snow: false, storm: false },
  57: { label: "冻雨", rain: true, snow: false, storm: false },
  61: { label: "小雨", rain: true, snow: false, storm: false },
  63: { label: "中雨", rain: true, snow: false, storm: false },
  65: { label: "大雨", rain: true, snow: false, storm: false },
  66: { label: "冻雨", rain: true, snow: false, storm: false },
  67: { label: "冻雨", rain: true, snow: false, storm: false },
  71: { label: "小雪", rain: false, snow: true, storm: false },
  73: { label: "中雪", rain: false, snow: true, storm: false },
  75: { label: "大雪", rain: false, snow: true, storm: false },
  77: { label: "米雪", rain: false, snow: true, storm: false },
  80: { label: "阵雨", rain: true, snow: false, storm: false },
  81: { label: "阵雨", rain: true, snow: false, storm: false },
  82: { label: "强阵雨", rain: true, snow: false, storm: false },
  85: { label: "阵雪", rain: false, snow: true, storm: false },
  86: { label: "阵雪", rain: false, snow: true, storm: false },
  95: { label: "雷阵雨", rain: true, snow: false, storm: true },
  96: { label: "雷暴冰雹", rain: true, snow: false, storm: true },
  99: { label: "雷暴冰雹", rain: true, snow: false, storm: true },
});

/** 能报的天气名，去重后的顺序稳定，报错时直接列给人看。 */
export const CONDITIONS = Object.freeze([...new Set(Object.values(WEATHER_CODES).map((item) => item.label))]);

export function describeWeatherCode(code) {
  if (code === null || code === undefined || code === "") return null;
  const value = Number(code);
  if (!Number.isInteger(value)) return null;
  return WEATHER_CODES[value] ?? null;
}

/** 按名字找天气码；认不出来返回 null（不猜）。 */
export function codeOfCondition(condition) {
  const text = String(condition ?? "").trim();
  if (!text) return null;
  for (const [code, info] of Object.entries(WEATHER_CODES)) {
    if (info.label === text) return Number(code);
  }
  return null;
}

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * 把外面报进来的天气收成一份读数。
 *
 * @param {object} raw
 * @param {string} raw.condition 天气名（见 {@link CONDITIONS}）或 WMO 码
 * @param {number} raw.temperature 气温（℃），必须有
 * @param {number} [raw.apparent] 体感
 * @param {number} [raw.high] 今天最高
 * @param {number} [raw.low] 今天最低
 * @param {number} [raw.precipitationProbability] 降水概率 0–100
 * @param {number} [raw.wind] 风速 km/h
 * @param {boolean} [raw.isDay] 天亮着吗
 * @param {string} [raw.city] 城市名，只用于日志，不进 prompt
 * @param {number} [now]
 * @returns {object|null}
 */
export function normalizeWeather(raw, { now = 0 } = {}) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.temperature === null || raw.temperature === undefined || String(raw.temperature).trim() === "") return null;
  const temperature = Number(raw.temperature);
  if (!Number.isFinite(temperature) || temperature < -90 || temperature > 60) return null;

  const byCode = raw.code === null || raw.code === undefined ? null : describeWeatherCode(raw.code);
  const condition = String(raw.condition ?? "").trim();
  const code = byCode ? Number(raw.code) : codeOfCondition(condition);
  const info = byCode ?? (code === null ? null : describeWeatherCode(code));
  if (!info) return null;

  const number = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(min, Math.min(max, parsed));
  };
  let high = number(raw.high, -90, 60);
  let low = number(raw.low, -90, 60);
  if (high !== null && low !== null && high < low) [high, low] = [low, high];
  return {
    version: 1,
    code,
    label: info.label,
    rain: info.rain,
    snow: info.snow,
    storm: info.storm,
    temperature,
    apparent: number(raw.apparent, -90, 60),
    high,
    low,
    precipitationProbability:
      Number.isFinite(Number(raw.precipitationProbability)) ? clampPercent(raw.precipitationProbability) : null,
    wind: number(raw.wind, 0, 400),
    isDay: typeof raw.isDay === "boolean" ? raw.isDay : null,
    city: String(raw.city ?? "").slice(0, 40),
    observedAt: Number(now) || 0,
  };
}

/** 这份读数还新鲜吗？过期就当没有。 */
export function isFresh(weather, now = 0, ttl = WEATHER_TTL) {
  if (!weather || !Number.isFinite(Number(weather.observedAt))) return false;
  const age = Number(now) - Number(weather.observedAt);
  return age >= 0 && age <= ttl;
}

/** 只返回还新鲜的读数；没有就是 null。 */
export function freshWeather(weather, now = 0) {
  return isFresh(weather, now) ? weather : null;
}

/** 给生活判断用的三个标记：湿、冷、热。没有新鲜读数时全 false。 */
export function weatherFlags(weather, now = 0) {
  const current = freshWeather(weather, now);
  if (!current) return { wet: false, cold: false, hot: false, known: false };
  const felt = Number.isFinite(current.apparent) ? current.apparent : current.temperature;
  return {
    wet: Boolean(current.rain || current.snow || current.storm),
    cold: felt <= 5,
    hot: felt >= 30,
    known: true,
  };
}
