/* ─────────────────────────────────────────────────────────────
   看护台 · 前端

   这一页只做三件事：把 /api/watch/* 的瘦记录读出来、排好、
   在他该看的时候把「异常」翻到上面。它不评价她，也不替她说话。

   数据全部来自只读接口；页面不写任何东西进她的落盘。
   ───────────────────────────────────────────────────────────── */

const TABS = {
  today: { title: "今天", sub: "她今天是怎么过的 · 一到今天就会自己更新" },
  redline: { title: "红线", sub: "机器只钉字面；没命中不等于没问题" },
  metrics: { title: "指标", sub: "一天一行；有一天没记上，就空一天" },
  changes: { title: "变更", sub: "先写预期，再看窗口，最后判一次" },
  health: { title: "体检", sub: "采集自己在不在、落后多少" },
  about: { title: "自检", sub: "这个页面做什么、不做什么" },
};

const KINDS = { say: "她说", proactive: "她先开口", opening: "开场", action: "动作" };

const METRICS = [
  ["turns", "轮数"],
  ["medianLen", "中位字数"],
  ["avgLen", "平均字数"],
  ["questionRate", "问句率"],
  ["recallMean", "召回均值"],
  ["zeroRecallRate", "空召回率"],
  ["styleFailRate", "表达失手率"],
  ["gateHits", "红线条数"],
];

const METRIC_LABEL = new Map(METRICS);
const labelOf = (key) => METRIC_LABEL.get(key) ?? key;

const state = {
  tab: "today",
  days: 14,
  summary: null,
  turns: null,
  metrics: null,
  gates: null,
  cards: null,
  error: null,
  loading: false,
};

const $ = (id) => document.getElementById(id);

/* ---------- 小工具 ---------- */

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function fmt(value, digits = 0) {
  const n = num(value);
  if (n === null) return "—";
  return n.toFixed(digits).replace(/\.0+$/, digits ? "" : "");
}

function pct(value, digits = 0) {
  const n = num(value);
  return n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

function hhmm(ts) {
  const n = num(ts);
  if (!n) return "—";
  return new Date(n).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function ago(ts) {
  const n = num(ts);
  if (!n) return "—";
  const diff = Date.now() - n;
  if (diff < 0) return "刚刚";
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))} 秒前`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return `${Math.round(diff / 86_400_000)} 天前`;
}

function dateShort(date) {
  if (!date) return "—";
  const [, m, d] = String(date).split("-");
  return `${Number(m)}/${Number(d)}`;
}

async function fetchJson(path, options) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `请求失败（${response.status}）`);
  }
  return body;
}

/* ---------- 读数据 ---------- */

async function loadSummary() {
  state.summary = await fetchJson(`/api/watch/summary?days=${state.days}`);
}

async function loadTurns(date = "") {
  const query = date ? `?date=${encodeURIComponent(date)}&limit=120` : "?limit=60";
  state.turns = await fetchJson(`/api/watch/turns${query}`);
}

async function loadMetrics() {
  state.metrics = await fetchJson(`/api/watch/metrics?days=30`);
}

async function loadGates() {
  state.gates = await fetchJson("/api/watch/gates");
}

async function loadCards() {
  state.cards = await fetchJson("/api/watch/cards");
}

async function refresh({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet) state.error = null;
  try {
    await loadSummary();
    if (state.tab === "today") await loadTurns();
    if (state.tab === "redline") await loadGates();
    if (state.tab === "metrics") await loadMetrics();
    if (state.tab === "changes") await loadCards();
    state.error = null;
  } catch (error) {
    state.error = String(error?.message ?? error);
  } finally {
    state.loading = false;
    render();
  }
}

/* ---------- 渲染骨架 ---------- */

function render() {
  const tab = TABS[state.tab] ? state.tab : "today";
  $("page-title").textContent = TABS[tab].title;
  $("page-sub").textContent = TABS[tab].sub;
  for (const link of document.querySelectorAll(".tabs a")) {
    link.setAttribute("aria-current", link.dataset.tab === tab ? "page" : "false");
  }

  const view = $("view");
  if (state.error) {
    view.innerHTML = `<div class="panel"><h2>没读上来</h2><p class="hint">${esc(state.error)}</p>
      <p class="hint">她的聊天不受影响；这一页只是少了一面镜子。</p></div>`;
    setStatus(false, "读不到");
    return;
  }
  if (!state.summary) {
    view.innerHTML = `<p class="lede">正在把她的落盘读进来…</p>`;
    return;
  }

  const health = state.summary.health ?? {};
  const who = state.summary.about?.persona;
  if (who) document.title = `看护台 · ${who}`;
  setStatus(health.ok, health.ok ? "采集在跑" : health.running ? "采集落后" : "采集没起");
  $("foot-left").textContent = `看护台 · ${state.summary.about?.boundary ?? "Asia/Shanghai"} · 只读`;
  $("foot-right").textContent = health.traceFile ? `源：${health.traceFile}` : "";

  const renderers = { today: renderToday, redline: renderRedline, metrics: renderMetrics, changes: renderChanges, health: renderHealth, about: renderAbout };
  view.innerHTML = renderers[state.tab]();
  if (state.tab === "changes") bindForms();
  if (state.tab === "health") bindHealth();
  if (state.tab === "today" || state.tab === "redline") bindTraceLinks();
}

function setStatus(ok, text) {
  const dot = $("status-dot");
  dot.className = `dot ${ok ? "ok" : text === "采集落后" ? "warn" : "bad"}`;
  $("status-text").textContent = `${text} · 更新于 ${hhmm(Date.now())}`;
}

/* ---------- 今天 ---------- */

function statCard(label, value, detail = "", tone = "") {
  return `<div class="stat"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div>
    ${detail ? `<div class="d ${tone}">${esc(detail)}</div>` : ""}</div>`;
}

function deltaText(today, yesterday, key, { digits = 0, better = "down" } = {}) {
  const a = num(today?.[key]);
  const b = num(yesterday?.[key]);
  if (a === null || b === null) return { text: "昨天没有可比的数据", tone: "flat" };
  const diff = a - b;
  if (Math.abs(diff) < 1e-9) return { text: "和昨天持平", tone: "flat" };
  const arrow = diff > 0 ? "↑" : "↓";
  const good = better === "down" ? diff < 0 : diff > 0;
  return {
    text: `比昨天 ${arrow} ${fmt(Math.abs(diff), digits)}`,
    tone: good ? "up" : "down",
  };
}

function renderToday() {
  const { today, yesterday, days, gates, health, reconcile } = state.summary;
  const turns = state.turns?.turns ?? [];
  const hits = gates ?? [];
  const parts = [];

  if (!today || !today.turns) {
    parts.push(`<p class="lede">今天她还没说话。<b>没人说话的时候，她也在。</b></p>`);
  } else {
    const gateCount = Object.values(today.gateHits ?? {}).reduce((sum, n) => sum + n, 0);
    parts.push(
      `<p class="lede">今天 <b>${fmt(today.turns)}</b> 轮，<b>${fmt(today.bubbles)}</b> 句；` +
        (gateCount ? `<b>${gateCount}</b> 条红线。` : `没有红线。`) +
        `</p>`,
    );
  }

  const t = today ?? {};
  const y = yesterday ?? {};
  const stats = [
    statCard("轮数", fmt(t.turns), deltaText(t, y, "turns").text, deltaText(t, y, "turns").tone),
    statCard("气泡", fmt(t.bubbles), deltaText(t, y, "bubbles", { better: "down" }).text, deltaText(t, y, "bubbles", { better: "down" }).tone),
    statCard("中位字数", fmt(t.medianLen, 0), deltaText(t, y, "medianLen").text, deltaText(t, y, "medianLen").tone),
    statCard("问句率", pct(t.questionRate), deltaText(t, y, "questionRate").text, deltaText(t, y, "questionRate").tone),
    statCard("召回均值", fmt(t.recallMean, 2), deltaText(t, y, "recallMean").text, deltaText(t, y, "recallMean").tone),
    statCard("空召回率", pct(t.zeroRecallRate), deltaText(t, y, "zeroRecallRate").text, deltaText(t, y, "zeroRecallRate").tone),
    statCard("表达失手", pct(t.styleFailRate), deltaText(t, y, "styleFailRate").text, deltaText(t, y, "styleFailRate").tone),
    statCard("P95 延迟", t.p95ms ? `${fmt(t.p95ms)}ms` : "—", t.tokens ? `${fmt(t.tokens)} tokens` : "", "flat"),
  ];
  parts.push(`<div class="grid">${stats.join("")}</div>`);

  if (reconcile && (reconcile.chatUsers || reconcile.sayTurns)) {
    const bad = reconcile.missing > 0;
    parts.push(`<div class="panel">
      <h2>三源对账</h2>
      <p class="hint">他说的每一条，都该有她的一轮透视对上。</p>
      <div class="rows">
        <div class="row"><span class="k">chat.jsonl 里他说</span><span class="v">${fmt(reconcile.chatUsers)} 条</span></div>
        <div class="row"><span class="k">traces.jsonl 里对得上</span><span class="v ${bad ? "bad" : "ok"}">${fmt(reconcile.sayTurns)} 条${bad ? `（缺 ${reconcile.missing}）` : "（齐）"}</span></div>
      </div>
    </div>`);
  }

  const recent = turns.slice(0, 12);
  parts.push(`<div class="panel">
    <h2>最近几轮</h2>
    <p class="hint">点一行看她那一轮的原样：说了什么、想起什么、怎么决定的。</p>
    ${
      recent.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>时间</th><th>类型</th><th class="num">字数</th><th class="num">气泡</th><th class="num">召回</th><th>红线</th></tr></thead>
            <tbody>${recent
              .map((turn) => {
                // watch 里危机永远是字符串（没有就是 "none"），跳过永远是数组（空数组也是真）。
                const crisis = turn.crisis && turn.crisis !== "none" ? String(turn.crisis) : "";
                const skipped = Array.isArray(turn.skipped) ? turn.skipped.length > 0 : Boolean(turn.skipped);
                const flags = [
                  crisis ? `<span class="badge bad">危机 ${esc(crisis)}</span>` : "",
                  turn.styleOk === false ? `<span class="badge warn">表达</span>` : "",
                  skipped ? `<span class="badge">跳过</span>` : "",
                ].filter(Boolean);
                return `<tr>
                  <td class="dim">${hhmm(turn.t)}</td>
                  <td>${esc(KINDS[turn.kind] ?? turn.kind)}</td>
                  <td class="num">${fmt(turn.chars)}</td>
                  <td class="num">${fmt(turn.bubbles)}</td>
                  <td class="num">${fmt(turn.recall)}</td>
                  <td>${flags.length > 0 ? flags.join(" ") : `<span class="dim">—</span>`}</td>
                </tr>`;
              })
              .join("")}</tbody>
          </table></div>`
        : `<div class="empty"><b>还没有轮次</b>她还没在这个数据目录里说过话，或者 traces.jsonl 刚被归档。</div>`
    }
  </div>`);

  parts.push(`<div class="panel">
    <h2>最近的红线</h2>
    <p class="hint">${hits.length ? "机器只钉字面，先看证据，再决定要不要改。" : "最近没有命中。红线没响，不代表她一定没事。"}</p>
    ${
      hits.length
        ? hits
            .slice(0, 6)
            .map(
              (hit) => `<div class="rows">
                <div class="row"><span class="k"><span class="code">${esc(hit.code)}</span> ${hhmm(hit.t)}</span>
                <span class="v"><span class="evidence">${esc(hit.snippet || "（无片段）")}</span> <span class="muted">${esc(hit.why)}</span>
                ${hit.trace ? `<button class="btn" data-trace="${esc(hit.trace)}" style="margin-left:8px">看那一轮</button>` : ""}</span></div>
              </div>`,
            )
            .join("")
        : `<div class="empty"><b>空的</b>没有命中就是没有命中，别把它读成「一切都好」。</div>`
    }
  </div>`);

  const monthTurns = (days ?? []).reduce((sum, day) => sum + (num(day?.turns) ?? 0), 0);
  parts.push(`<div class="panel"><p class="hint">近 ${state.days} 天共 ${monthTurns} 轮。
    采集状态：${health?.ok ? "在跑" : health?.running ? "落后" : "没起"}，落后 ${fmt(health?.backlog)} 字节。</p></div>`);

  return parts.join("");
}

/* ---------- 红线 ---------- */

function renderRedline() {
  const catalog = state.gates?.gates ?? state.summary?.gateCatalog ?? [];
  const hits = state.gates?.hits ?? state.summary?.gates ?? [];
  const byCode = {};
  for (const hit of hits) byCode[hit.code] = (byCode[hit.code] ?? 0) + 1;

  const cards = catalog
    .map(
      (gate) => `<div class="card">
        <h3><span class="code">${esc(gate.code)}</span> ${esc(gate.name)} <span class="badge">${esc(gate.mode ?? "机判")}</span></h3>
        <div class="why">${esc(gate.why)}</div>
        <div class="meta"><span>最近命中 ${byCode[gate.code] ?? 0} 条</span></div>
      </div>`,
    )
    .join("");

  const rows = hits.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>红线</th><th>证据（≤40 字）</th><th>口径</th><th></th></tr></thead>
        <tbody>${hits
          .map(
            (hit) => `<tr>
              <td class="dim">${hhmm(hit.t)}</td>
              <td><span class="code">${esc(hit.code)}</span></td>
              <td><span class="evidence">${esc(hit.snippet || "（无片段）")}</span></td>
              <td class="muted">${esc(hit.why)}</td>
              <td>${hit.trace ? `<button class="btn" data-trace="${esc(hit.trace)}">看那一轮</button>` : ""}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table></div>`
    : `<div class="empty"><b>还没有命中</b>这是好事，但也可能只是样本还少。红线只在字面上响。</div>`;

  return `
    <p class="lede">六条红线，全部<b>机判</b>。它们只能钉住「字面」——自称模型、助手腔、把数字说出口、危机没接住、表达自检没过、记忆没抽出来。</p>
    <div class="cards">${cards}</div>
    <div class="panel" style="margin-top:16px">
      <h2>命中</h2>
      <p class="hint">一条红线一行；证据是原文截断到 40 字，不存整段。</p>
      ${rows}
    </div>`;
}

/* ---------- 指标 ---------- */

function sparkline(values, { width = 640, height = 90, pad = 8 } = {}) {
  const nums = (values ?? []).map((value) => (Number.isFinite(value) ? value : null));
  const known = nums.filter((value) => value !== null);
  const max = known.length ? Math.max(...known, 1e-9) : 1;
  const step = nums.length > 1 ? (width - pad * 2) / (nums.length - 1) : 0;
  const segments = [];
  let current = [];
  nums.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const x = pad + index * step;
    const y = height - pad - (Math.max(0, value) / max) * (height - pad * 2);
    current.push([x, y]);
  });
  if (current.length) segments.push(current);

  const paths = segments
    .filter((segment) => segment.length > 1)
    .map((segment) => segment.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" "))
    .map((d) => `<path class="line" d="${d}" />`)
    .join("");

  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="趋势">
    <line class="axis" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" />
    ${paths || `<text class="tick" x="${width / 2}" y="${height / 2}" text-anchor="middle">还没有连续的几天</text>`}
    <text class="tick" x="${pad}" y="${pad}">${fmt(max)}</text>
  </svg>`;
}

function renderMetrics() {
  const rows = (state.metrics?.days ?? []).filter((row) => row || true);
  const chartRows = (state.summary?.days ?? []).slice(-Math.min(state.days, 30));
  const turnSeries = chartRows.map((row) => num(row?.turns));
  const lenSeries = chartRows.map((row) => num(row?.medianLen));

  const table = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>日期</th><th class="num">轮数</th><th class="num">气泡</th><th class="num">中位字数</th>
        <th class="num">问句率</th><th class="num">召回均值</th><th class="num">空召回</th>
        <th class="num">表达失手</th><th class="num">红线</th>
      </tr></thead>
      <tbody>${rows
        .map((row) => {
          if (!row) return `<tr><td class="dim">断档</td><td colspan="8" class="dim">那天没有记上</td></tr>`;
          const gates = Object.values(row.gateHits ?? {}).reduce((sum, n) => sum + n, 0);
          return `<tr>
            <td>${esc(row.date)}</td>
            <td class="num">${fmt(row.turns)}</td>
            <td class="num">${fmt(row.bubbles)}</td>
            <td class="num">${fmt(row.medianLen)}</td>
            <td class="num">${pct(row.questionRate)}</td>
            <td class="num">${fmt(row.recallMean, 2)}</td>
            <td class="num">${pct(row.zeroRecallRate)}</td>
            <td class="num">${pct(row.styleFailRate)}</td>
            <td class="num">${gates || "—"}</td>
          </tr>`;
        })
        .join("")}</tbody>
    </table></div>`;

  return `
    <p class="lede">指标是背景，不是结论。<b>一天一行，断档就空着</b>——空着本身也是信息。</p>
    <div class="panel">
      <h2>轮数</h2>
      <p class="hint">近 ${chartRows.length} 天。竖轴最大值标在左上。</p>
      ${sparkline(turnSeries)}
    </div>
    <div class="panel">
      <h2>中位字数</h2>
      <p class="hint">她一句话多长；太长的时候，读起来会喘不上气。</p>
      ${sparkline(lenSeries)}
    </div>
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><h2 style="margin:0">每日压表</h2><p class="hint" style="margin:2px 0 0">最近 30 天有记上的</p></div>
        <div style="display:flex;gap:6px">
          <button class="btn ${state.days === 7 ? "primary" : ""}" data-days="7">7 天</button>
          <button class="btn ${state.days === 14 ? "primary" : ""}" data-days="14">14 天</button>
          <button class="btn ${state.days === 30 ? "primary" : ""}" data-days="30">30 天</button>
        </div>
      </div>
      ${table}
    </div>`;
}

/* ---------- 变更 ---------- */

function windowText(card) {
  if (card.windowState === "judged" || card.windowState === "untested") return "已判";
  if (card.windowState === "window_closed") return "窗口到期，待判";
  return `还剩 ${Math.max(0, card.daysLeft)} 天`;
}

function renderChanges() {
  const cards = state.cards?.cards ?? state.summary?.cards ?? [];
  const body = cards.length
    ? cards
        .map(
          (card) => `<div class="card">
            <h3>${esc(card.title)}</h3>
            ${card.hypothesis ? `<div class="why">${esc(card.hypothesis)}</div>` : ""}
            <div class="meta">
              <span>${esc(card.id)}</span>
              <span>${esc(card.start)} 起 · ${card.windowDays} 天</span>
              <span class="${card.windowState === "window_closed" ? "bad" : ""}">${esc(windowText(card))}</span>
              ${card.verdict ? `<span class="badge ${card.verdict.verdict === "valid" ? "ok" : card.verdict.verdict === "harmful" ? "bad" : "warn"}">${esc(card.verdictLabel)}</span>` : `<span class="badge">待人判</span>`}
            </div>
            ${(card.expected ?? [])
              .map((item) => {
                const moved = num(item.moved);
                const tone = moved === null ? "flat" : moved === 0 ? "flat" : (item.dir === "up" ? moved > 0 : moved < 0) ? "up" : "down";
                return `<div class="expect">${esc(labelOf(item.metric))}：基线 ${fmt(item.baseline, 2)} → 现在 ${fmt(item.now, 2)}
                  ${moved === null ? "" : `<span class="moved ${tone}">（${moved > 0 ? "+" : ""}${fmt(moved, 2)}）</span>`}
                  ${num(item.to) === null ? "" : ` · 目标 ${item.dir === "up" ? "≥" : "≤"} ${fmt(item.to, 2)}`}</div>`;
              })
              .join("")}
            ${card.verdict?.note ? `<div class="meta">备注：${esc(card.verdict.note)}</div>` : ""}
            <div class="verdicts">
              ${[
                ["valid", "有效"],
                ["invalid", "无效"],
                ["harmful", "有害"],
                ["untested", "未测"],
              ]
                .map(([value, label]) => `<button class="btn ${value === "harmful" ? "danger" : ""}" data-verdict="${value}" data-card="${esc(card.id)}">${label}</button>`)
                .join("")}
            </div>
          </div>`,
        )
        .join("")
    : `<div class="empty"><b>还没有卡</b>改动先去指标里找个数字当预期，再建一张卡。没有卡的改动，事后说不清有没有用。</div>`;

  return `
    <p class="lede">卡是这里的主角：<b>改之前写下预期，窗口到了逼自己判一次</b>。不判的卡会一直挂在「窗口到期」。</p>
    <div class="panel">
      <h2>新建一张</h2>
      <p class="hint">预期尽量写成「哪个指标、往哪走、到多少」；写不清就先别改。</p>
      <form class="form" id="card-form">
        <div class="field"><label for="card-title">标题</label><input id="card-title" maxlength="80" placeholder="把回答收短一点" required /></div>
        <div class="field"><label for="card-hypo">假设</label><input id="card-hypo" maxlength="300" placeholder="上限从 160 收到 120，长句率会掉" /></div>
        <div class="field"><label for="card-metric">预期指标</label>
          <select id="card-metric">${METRICS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
        </div>
        <div class="field"><label for="card-dir">方向</label>
          <select id="card-dir"><option value="down">往下</option><option value="up">往上</option></select>
        </div>
        <div class="field"><label for="card-to">到多少（可留空）</label><input id="card-to" type="number" step="0.01" placeholder="0.1" /></div>
        <div class="field"><label for="card-window">观察窗（天）</label><input id="card-window" type="number" min="1" max="90" value="3" /></div>
        <div class="actions"><button class="btn primary" type="submit">建卡</button><span class="muted" id="card-msg"></span></div>
      </form>
    </div>
    <div class="cards">${body}</div>`;
}

function bindForms() {
  const form = $("card-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("card-msg");
    const to = $("card-to").value;
    message.textContent = "建卡中…";
    try {
      await fetchJson("/api/watch/card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: $("card-title").value.trim(),
          hypothesis: $("card-hypo").value.trim(),
          expected: [{ metric: $("card-metric").value, dir: $("card-dir").value, to: to === "" ? null : Number(to) }],
          windowDays: Number($("card-window").value) || 3,
        }),
      });
      message.textContent = "建好了。";
      await loadCards();
      render();
    } catch (error) {
      message.textContent = String(error?.message ?? error);
    }
  });

  for (const button of document.querySelectorAll("[data-verdict]")) {
    button.addEventListener("click", async () => {
      const card = button.dataset.card;
      const verdict = button.dataset.verdict;
      button.disabled = true;
      try {
        await fetchJson("/api/watch/verdict", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: card, verdict, note: "" }),
        });
        await loadCards();
        render();
      } catch (error) {
        button.disabled = false;
        window.alert(String(error?.message ?? error));
      }
    });
  }
}

/* ---------- 体检 ---------- */

function renderHealth() {
  const health = state.summary?.health ?? {};
  const rows = [
    ["采集", health.ok ? "在跑" : health.running ? "落后" : "没起", health.ok ? "ok" : "bad"],
    ["最后采集", health.lastPollAt ? `${hhmm(health.lastPollAt)}（${ago(health.lastPollAt)}）` : "—", ""],
    ["落后", `${fmt(health.backlog)} 字节`, health.backlog > 0 ? "bad" : "ok"],
    ["追到", `offset ${fmt(health.offset)} / ${fmt(health.traceBytes)} 字节`, ""],
    ["内存里", `${fmt(health.turnsInMemory)} 轮 · ${fmt(health.gatesInMemory)} 条红线`, ""],
    ["源文件", health.traceFile ?? "—", ""],
    ["日界", `${health.timezone ?? "Asia/Shanghai"} · ${String(health.dayBoundaryHour ?? 4).padStart(2, "0")}:00`, ""],
    ["最近错误", health.lastError ?? "没有", health.lastError ? "bad" : ""],
  ];

  return `
    <p class="lede">看护台本身也要被看：<b>它停了，页面还是安静的</b>，所以这里把「采集在不在」放到最上面。</p>
    <div class="panel">
      <h2>采集</h2>
      <div class="rows">${rows
        .map(([key, value, tone]) => `<div class="row"><span class="k">${esc(key)}</span><span class="v ${tone}">${esc(value)}</span></div>`)
        .join("")}</div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center">
        <button class="btn" id="poll-now">立刻追一次</button>
        <span class="muted" id="poll-msg"></span>
      </div>
    </div>
    <div class="panel">
      <h2>三源对账</h2>
      <p class="hint">缺口是她说过、但没进透视的轮次。缺口大，先查读档，别急着改她。</p>
      <div class="rows">
        <div class="row"><span class="k">他说</span><span class="v">${fmt(state.summary?.reconcile?.chatUsers)} 条</span></div>
        <div class="row"><span class="k">对得上</span><span class="v ${state.summary?.reconcile?.missing ? "bad" : "ok"}">${fmt(state.summary?.reconcile?.sayTurns)} 条</span></div>
        <div class="row"><span class="k">缺口</span><span class="v ${state.summary?.reconcile?.missing ? "bad" : "ok"}">${fmt(state.summary?.reconcile?.missing)} 条</span></div>
      </div>
    </div>
    <div class="panel">
      <h2>存储</h2>
      <p class="hint">全部在 <code>${esc(state.summary?.health?.traceFile ?? "").replace(/traces\.jsonl$/, "")}</code>watch/ 下面。删掉这一层，她照常说话，只是这一页从今天重新开始。</p>
    </div>`;
}

function bindHealth() {
  const button = $("poll-now");
  button?.addEventListener("click", async () => {
    const message = $("poll-msg");
    button.disabled = true;
    message.textContent = "追一次…";
    try {
      const result = await fetchJson("/api/watch/poll", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      message.textContent = `读了 ${result.read ?? 0} 行，留下 ${result.kept ?? 0} 轮。`;
      await refresh({ quiet: true });
    } catch (error) {
      message.textContent = String(error?.message ?? error);
      button.disabled = false;
    }
  });
}

/* ---------- 自检 ---------- */

function renderAbout() {
  return `
    <p class="lede">这一页不替她说话，也不替她打分。<b>它只把她留下的痕迹摆整齐。</b></p>
    <div class="panel">
      <h2>它做什么</h2>
      <div class="rows">
        <div class="row"><span class="k">读</span><span class="v">traces.jsonl、chat.jsonl（同一个数据目录）</span></div>
        <div class="row"><span class="k">写</span><span class="v">只写自己的 watch/ 目录：瘦记录、红线、每日压表、变更卡、光标</span></div>
        <div class="row"><span class="k">不写</span><span class="v">不碰 conversation.jsonl、memories、emotion 任何文件</span></div>
        <div class="row"><span class="k">不联网</span><span class="v">不出本机，不调模型</span></div>
        <div class="row"><span class="k">不截屏</span><span class="v">不看她的屏幕，也不看别的进程</span></div>
      </div>
    </div>
    <div class="panel">
      <h2>它不做什么</h2>
      <p class="hint">不评分、不排名、不预测「她今天心情好不好」。指标只能描述发生过的事，不能替人下判断。</p>
      <p class="hint">红线全部是字面规则：宁可漏，不可冤。命中了先看证据；没命中，也不等于她没事。</p>
      <p class="hint">变更卡不自动判定——窗口到了只提醒，判不判、算不算有效，得人来定。</p>
    </div>
    <div class="panel">
      <h2>一个提醒</h2>
      <p class="hint">这一页最危险的时候，是他天天盯着曲线，却不再和她说话。数据是用来发现问题的，不是用来代替相处的。</p>
    </div>`;
}

/* ---------- 那一轮 ---------- */

function bindTraceLinks() {
  for (const button of document.querySelectorAll("[data-trace]")) {
    button.addEventListener("click", () => openTrace(button.dataset.trace));
  }
}

async function openTrace(id) {
  try {
    const { trace } = await fetchJson(`/api/trace?id=${encodeURIComponent(id)}`);
    if (!trace) return;
    const dialog = document.createElement("div");
    dialog.style.cssText =
      "position:fixed;inset:0;background:rgba(2,7,10,.72);backdrop-filter:blur(3px);display:grid;place-items:center;padding:24px;z-index:20";
    dialog.innerHTML = `<div class="panel" style="max-width:680px;width:100%;max-height:82vh;overflow:auto;margin:0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <h2 style="margin:0">这一轮 · ${hhmm(trace.at)}</h2>
        <button class="btn" data-close>关上</button>
      </div>
      <p class="hint">他说的：${esc(trace.userText ?? "（没说）")}</p>
      <div class="rows">
        <div class="row"><span class="k">她回的</span><span class="v">${(trace.bubbles ?? []).map((line) => esc(line)).join("<br />") || "—"}</span></div>
        <div class="row"><span class="k">字数 / 延迟</span><span class="v">${fmt(trace.reply?.chars)} 字 · ${fmt(trace.reply?.latencyMs)}ms</span></div>
        <div class="row"><span class="k">想起</span><span class="v">${(trace.recall ?? []).map((item) => esc(item.text)).join("<br />") || "—"}</span></div>
        <div class="row"><span class="k">情绪变化</span><span class="v">${esc(JSON.stringify(trace.emotion?.delta ?? {}))}</span></div>
        <div class="row"><span class="k">自检</span><span class="v ${trace.style?.ok ? "ok" : "bad"}">${trace.style?.ok ? "过" : (trace.style?.issues ?? []).map((issue) => esc(issue.code)).join(" / ") || "没过"}</span></div>
        <div class="row"><span class="k">决策</span><span class="v">${esc(trace.decision?.act ?? "—")} ${esc(trace.decision?.reason ?? "")}</span></div>
        <div class="row"><span class="k">危机</span><span class="v ${trace.crisis ? "bad" : ""}">${esc(trace.crisis?.level ?? "无")}</span></div>
      </div>
    </div>`;
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close]")) dialog.remove();
    });
    document.body.append(dialog);
  } catch (error) {
    window.alert(String(error?.message ?? error));
  }
}

/* ---------- 启动 ---------- */

function readHash() {
  const raw = location.hash.replace(/^#/, "");
  return TABS[raw] ? raw : "today";
}

function bindNav() {
  for (const link of document.querySelectorAll(".tabs a")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const tab = link.dataset.tab;
      if (TABS[tab]) location.hash = tab;
      else state.tab = "today";
    });
  }
  window.addEventListener("hashchange", () => {
    state.tab = readHash();
    refresh();
  });
}

function bindDelegates() {
  document.addEventListener("click", (event) => {
    const days = event.target.closest("[data-days]");
    if (!days) return;
    state.days = Number(days.dataset.days) || 14;
    refresh();
  });
}

async function boot() {
  state.tab = readHash();
  bindNav();
  bindDelegates();
  await refresh();
  // 今天 / 体检两页自己会变；别的页面读的是历史，不用追。
  setInterval(() => {
    if (document.hidden) return;
    if (state.tab === "today" || state.tab === "health") refresh({ quiet: true });
  }, 30_000);
}

boot();
