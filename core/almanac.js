/**
 * core/almanac.js — 她窗外更大的那层现实：年、季、月、日、一天的大段。
 *
 * 钟点回答「今天几点」，这一层回答「今年什么时候」：
 * 十月末不能还说天热，冬至不能还在吃凉面。
 *
 * 和 `core/life.js` 一样是纯函数：给时间戳，给半球，算出说法；
 * 不看系统时区、不联网、不读盘。时间一律按北京时间（UTC+8）算，
 * 和插件里其他地方同一口径。
 *
 * 天气不在这里：这一层只说「现在是仲秋、十月下旬」，
 * 窗外下没下雨由 `core/weather.js` 收下的实况决定，没有就不写。
 */

const BEIJING_OFFSET = 8 * 3_600_000;

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTH_CN = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

/**
 * 四季。`startMonth` 是北半球这个季节第一个月；南半球整体错半年。
 * 季相按季节内的第几个月给说法：初春 / 仲春 / 暮春。不写「春天来了」这种播报腔。
 */
export const SEASONS = Object.freeze({
  spring: { key: "spring", name: "春", full: "春天", startMonth: 3, phases: ["初春", "仲春", "暮春"] },
  summer: { key: "summer", name: "夏", full: "夏天", startMonth: 6, phases: ["初夏", "仲夏", "夏末"] },
  autumn: { key: "autumn", name: "秋", full: "秋天", startMonth: 9, phases: ["初秋", "仲秋", "深秋"] },
  winter: { key: "winter", name: "冬", full: "冬天", startMonth: 12, phases: ["初冬", "隆冬", "残冬"] },
});

const SEASON_ORDER = ["spring", "summer", "autumn", "winter"];

/** 北京时间的年月日与星期；不依赖机器时区。 */
export function beijingDate(ts = 0) {
  const date = new Date(Number(ts) + BEIJING_OFFSET);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

/**
 * 按月算季节。北半球 3–5 春、6–8 夏、9–11 秋、12–2 冬；南半球错半年。
 * @param {number} month 1–12
 * @param {{hemisphere?: "north"|"south", latitude?: number}} [options]
 */
export function seasonOfMonth(month, { hemisphere = "north", latitude } = {}) {
  const value = Number(month);
  if (!Number.isInteger(value) || value < 1 || value > 12) return null;
  const south = Number.isFinite(latitude) ? Number(latitude) < 0 : hemisphere === "south";
  let index = Math.floor(((value + 9) % 12) / 3);
  if (south) index = (index + 2) % 4;
  const meta = SEASONS[SEASON_ORDER[index]];
  let offset = value - meta.startMonth;
  if (offset < 0) offset += 12;
  // 南半球：季节整体错半年，季相也跟着错，不然十月会给出「仲秋」这种半截话。
  if (south) offset = (offset + 6) % 12;
  const phase = meta.phases[offset] ?? meta.phases[1];
  return { ...meta, month: value, phaseIndex: offset, phase };
}

/** 「十月下旬」这种说法。 */
export function monthWord(month, day) {
  const value = Number(month);
  const date = Number(day);
  if (!Number.isInteger(value) || value < 1 || value > 12) return "";
  const part = date <= 10 ? "上旬" : date <= 20 ? "中旬" : "下旬";
  return `${MONTH_CN[value - 1]}${part}`;
}

/** 一天里的大段：凌晨 / 早上 / 上午 / 中午 / 下午 / 傍晚 / 晚上。 */
export function timeBand(hour) {
  const value = ((Number(hour) % 24) + 24) % 24;
  if (value < 5) return "凌晨";
  if (value < 8) return "早上";
  if (value < 11) return "上午";
  if (value < 13) return "中午";
  if (value < 18) return "下午";
  if (value < 21) return "傍晚";
  return "晚上";
}

/**
 * 这一天的说法：年月日、星期、季节、季相、月份位置。
 *
 * @param {number} ts 时间戳
 * @param {{hemisphere?: "north"|"south", latitude?: number}} [options]
 */
export function almanacAt(ts = 0, { hemisphere = "north", latitude } = {}) {
  const date = beijingDate(ts);
  const season = seasonOfMonth(date.month, { hemisphere, latitude });
  const weekdayCn = WEEKDAY_CN[date.weekday];
  const monthText = monthWord(date.month, date.day);
  return {
    ...date,
    weekdayCn,
    season,
    monthText,
    dateText: `${date.year} 年 ${date.month} 月 ${date.day} 日，${weekdayCn}，${season.phase}（${monthText}）`,
  };
}

/**
 * 给 prompt 用的【外面】块。
 *
 * 三行里第一行是日子，第二行是天气（没有就整行不写），第三行说明「这些是真的」。
 * 不写「今天是霜降」「祝你秋日愉快」这类播报——日子和天气是背景，他问起再照实说。
 *
 * @param {ReturnType<typeof almanacAt>} almanac
 * @param {{weather?: object|null}} [options]
 */
export function almanacBlock(almanac, { weather = null } = {}) {
  const lines = ["【外面】", `- 日子：${almanac.dateText}。`];
  const window = weatherLine(weather);
  if (window) lines.push(`- 天气：${window}`);
  lines.push(
    window
      ? "- 这些是真的，不是设定：外面的温度、雨、天光，都顺着它；不用主动报天气，他问起再照实说。"
      : "- 这是真的季节和日子，不是设定：外面的温度、天光、这个月份该有的样子，都顺着它；不用主动报日期，他问起再照实说。",
  );
  return lines.join("\n");
}

/**
 * 天气 → 一句她读得懂的话。没有就返回空串（【外面】里就不出现天气那一行）。
 *
 * 只写拿得到的东西：气温、体感（差 2℃ 以上才写）、今天的高低温、降水概率（30% 以上才写）、
 * 风（20km/h 以上才说）、天亮着还是黑了。不写「适合出门」——那是她的判断，不是天气。
 */
export function weatherLine(weather) {
  if (!weather || !Number.isFinite(weather.temperature)) return "";
  const label = String(weather.label ?? "").trim();
  if (!label) return "";
  const temperature = Math.round(weather.temperature);
  const apparent = Number.isFinite(weather.apparent) ? Math.round(weather.apparent) : null;
  const wet = Boolean(weather.rain || weather.snow || weather.storm);
  const head = wet
    ? `外面在下${label}`
    : label === "晴"
      ? "外面晴着"
      : label === "阴"
        ? "外面阴着"
        : label === "雾"
          ? "外面有雾"
          : `外面${label}`;
  let text = `${head}，${temperature}℃`;
  if (apparent !== null && Math.abs(apparent - temperature) >= 2) text += `（体感 ${apparent}℃）`;
  if (Number.isFinite(weather.high) && Number.isFinite(weather.low)) {
    text += `；今天 ${Math.round(weather.low)}–${Math.round(weather.high)}℃`;
  }
  if (Number.isFinite(weather.precipitationProbability) && weather.precipitationProbability >= 30) {
    text += `，降水概率 ${Math.round(weather.precipitationProbability)}%`;
  }
  if (Number.isFinite(weather.wind) && weather.wind >= 20) text += weather.wind >= 30 ? "，风大" : "，风有点大";
  const day = typeof weather.isDay === "boolean" ? weather.isDay : null;
  if (day !== null) text += day ? "；天还亮着" : "；天已经黑了";
  return `${text}。`;
}
