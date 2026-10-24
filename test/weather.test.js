import test from "node:test";
import assert from "node:assert/strict";
import {
  CONDITIONS,
  WEATHER_TTL,
  codeOfCondition,
  describeWeatherCode,
  freshWeather,
  isFresh,
  normalizeWeather,
  weatherFlags,
} from "../core/weather.js";

const now = Date.parse("2026-10-24T12:40:00Z");

test("天气码：中文、雨雪雷三个标记", () => {
  assert.equal(describeWeatherCode(61).label, "小雨");
  assert.equal(describeWeatherCode(61).rain, true);
  assert.equal(describeWeatherCode(71).snow, true);
  assert.equal(describeWeatherCode(95).storm, true);
  assert.equal(describeWeatherCode(999), null);
  assert.ok(CONDITIONS.includes("阴"));
  assert.equal(codeOfCondition("中雨"), 63);
  assert.equal(codeOfCondition("下雨"), null);
});

test("收读数：不认识的天气 / 没有气温就整份不要", () => {
  assert.equal(normalizeWeather(null), null);
  assert.equal(normalizeWeather({ condition: "晴" }), null);
  assert.equal(normalizeWeather({ condition: "下钱", temperature: 20 }), null);
  assert.equal(normalizeWeather({ temperature: 20 }), null);
  assert.equal(normalizeWeather({ condition: "晴", temperature: null }), null, "null 不是 0℃");
  assert.equal(normalizeWeather({ condition: "晴", temperature: "" }), null);

  const report = normalizeWeather(
    { condition: "阴", temperature: 20.2, apparent: 19.1, high: 18, low: 21, precipitationProbability: 140, wind: 20.3, isDay: false, city: "上海" },
    { now },
  );
  assert.equal(report.label, "阴");
  assert.equal(report.temperature, 20.2);
  assert.equal(report.high, 21, "高低温反了要摆正");
  assert.equal(report.low, 18);
  assert.equal(report.precipitationProbability, 100, "降水概率封顶 100");
  assert.equal(report.observedAt, now);
  assert.equal(report.city, "上海");
});

test("也可以直接报 WMO 码", () => {
  const report = normalizeWeather({ code: 95, temperature: 27 }, { now });
  assert.equal(report.label, "雷阵雨");
  assert.equal(report.storm, true);
});

test("新鲜度：3 小时内算数，过期当没有", () => {
  const report = normalizeWeather({ condition: "晴", temperature: 20 }, { now });
  assert.equal(isFresh(report, now), true);
  assert.equal(isFresh(report, now + WEATHER_TTL), true);
  assert.equal(isFresh(report, now + WEATHER_TTL + 1), false);
  assert.equal(isFresh(report, now - 1), false, "未来的读数不算数");
  assert.equal(freshWeather(report, now + WEATHER_TTL + 1), null);
  assert.equal(freshWeather(null, now), null);
});

test("生活判断的三个标记：湿 / 冷 / 热", () => {
  const rain = normalizeWeather({ condition: "中雨", temperature: 16 }, { now });
  assert.deepEqual(weatherFlags(rain, now), { wet: true, cold: false, hot: false, known: true });

  const cold = normalizeWeather({ condition: "晴", temperature: 2, apparent: -1 }, { now });
  assert.equal(weatherFlags(cold, now).cold, true);

  const hot = normalizeWeather({ condition: "晴", temperature: 31, apparent: 34 }, { now });
  assert.equal(weatherFlags(hot, now).hot, true);

  assert.deepEqual(weatherFlags(rain, now + WEATHER_TTL + 1), { wet: false, cold: false, hot: false, known: false });
  assert.deepEqual(weatherFlags(null, now), { wet: false, cold: false, hot: false, known: false });
});
