import test from "node:test";
import assert from "node:assert/strict";
import { almanacAt, almanacBlock, monthWord, seasonOfMonth, timeBand, weatherLine } from "../core/almanac.js";

const at = (iso) => Date.parse(iso);

test("季节按月份切，季相按季内第几个月", () => {
  assert.equal(seasonOfMonth(3).phase, "初春");
  assert.equal(seasonOfMonth(4).phase, "仲春");
  assert.equal(seasonOfMonth(5).phase, "暮春");
  assert.equal(seasonOfMonth(10).phase, "仲秋");
  assert.equal(seasonOfMonth(12).phase, "初冬");
  assert.equal(seasonOfMonth(2).phase, "残冬");
  assert.equal(seasonOfMonth(13), null);
  assert.equal(seasonOfMonth("十月"), null);
});

test("南半球错半年，季相也跟着错", () => {
  assert.equal(seasonOfMonth(10, { hemisphere: "south" }).phase, "仲春");
  assert.equal(seasonOfMonth(1, { hemisphere: "south" }).phase, "仲夏");
  assert.equal(seasonOfMonth(7, { hemisphere: "south" }).phase, "隆冬");
  assert.equal(seasonOfMonth(10, { latitude: -31.2 }).phase, "仲春");
});

test("日子的说法按北京时间算，跨日也对", () => {
  const a = almanacAt(at("2026-10-24T12:40:00Z"));
  assert.equal(a.year, 2026);
  assert.equal(a.month, 10);
  assert.equal(a.day, 24);
  assert.equal(a.weekdayCn, "周六");
  assert.equal(a.dateText, "2026 年 10 月 24 日，周六，仲秋（十月下旬）");

  const next = almanacAt(at("2026-10-24T16:30:00Z"));
  assert.equal(next.day, 25);
  assert.equal(next.weekdayCn, "周日");
});

test("月份位置：上旬 / 中旬 / 下旬", () => {
  assert.equal(monthWord(3, 5), "三月上旬");
  assert.equal(monthWord(10, 15), "十月中旬");
  assert.equal(monthWord(10, 24), "十月下旬");
  assert.equal(monthWord(0, 3), "");
});

test("天气句：只在有把握的阈值上说", () => {
  assert.equal(weatherLine(null), "");
  assert.equal(weatherLine({ temperature: 20 }), "", "没有天气名就不写");

  const line = weatherLine({
    temperature: 20.2,
    label: "阴",
    high: 21,
    low: 18,
    precipitationProbability: 100,
    wind: 20.3,
    isDay: false,
  });
  assert.match(line, /外面阴着，20℃/);
  assert.match(line, /今天 18–21℃/);
  assert.match(line, /降水概率 100%/);
  assert.match(line, /风有点大/);
  assert.match(line, /天已经黑了/);

  assert.match(weatherLine({ temperature: 26, label: "晴", apparent: 28, isDay: true }), /外面晴着，26℃（体感 28℃）/);
  assert.doesNotMatch(weatherLine({ temperature: 26, label: "晴", apparent: 27 }), /体感/);
  assert.match(weatherLine({ temperature: 3, label: "小雪", snow: true }), /外面在下小雪，3℃/);
  assert.doesNotMatch(weatherLine({ temperature: 10, label: "多云", precipitationProbability: 20 }), /降水概率/);
});

test("【外面】：没有天气只写日子，有天气多一行", () => {
  const almanac = almanacAt(at("2026-10-24T12:40:00Z"));
  const bare = almanacBlock(almanac);
  assert.match(bare, /【外面】/);
  assert.match(bare, /日子：2026 年 10 月 24 日，周六，仲秋（十月下旬）/);
  assert.doesNotMatch(bare, /天气：/);
  assert.match(bare, /不用主动报日期/);

  const withWeather = almanacBlock(almanac, {
    weather: { temperature: 20, label: "小雨", rain: true, isDay: false },
  });
  assert.match(withWeather, /天气：外面在下小雨，20℃/);
  assert.match(withWeather, /不用主动报天气/);
});

test("一天的大段", () => {
  assert.equal(timeBand(0), "凌晨");
  assert.equal(timeBand(7), "早上");
  assert.equal(timeBand(9), "上午");
  assert.equal(timeBand(12), "中午");
  assert.equal(timeBand(16), "下午");
  assert.equal(timeBand(19), "傍晚");
  assert.equal(timeBand(23), "晚上");
});
