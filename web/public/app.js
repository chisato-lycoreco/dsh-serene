/**
 * web/public/app.js — 纯净版前端。
 *
 * 没有群聊、没有联系人、没有贴纸和账单。只有一条对话、
 * 一扇「她此刻怎么样」的侧窗，和一扇「这一轮她怎么想」的透视。
 * 所有状态都来自 /api/state，页面自己不编造任何东西。
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ACTIONS = [
  { id: "poke", label: "戳一戳", icon: "i-poke" },
  { id: "pat", label: "摸摸头", icon: "i-hand" },
  { id: "water", label: "递杯水", icon: "i-cup" },
  { id: "praise", label: "夸她一句", icon: "i-star" },
];

const KIND_LABEL = {
  fact: "事实",
  preference: "偏好",
  moment: "时刻",
  promise: "约定",
  insight: "察觉",
  self: "她自己",
};

const DIMENSION_LABEL = {
  rhythm: "作息",
  taste: "口味",
  matters: "在意",
  talk: "说话",
  mood: "情绪",
  weather: "天气",
};

const TRACE_KIND = {
  say: "一次对话",
  opening: "第一次见面",
  proactive: "她先开口",
};

const app = {
  data: null,
  config: null,
  lastTrace: null,
  pendingUser: "",
  typing: false,
  busy: false,
  emotionLayer: "primary",
  chatError: "",
  toastTimer: null,
  pollTimer: null,
  tickTimer: null,
  lastRenderedCount: 0,
};

/* ───────────────────────────── 启动 ───────────────────────────── */

init();

async function init() {
  bindStaticEvents();
  renderActions();

  try {
    const payload = await api("/api/state");
    applyState(payload);
    hideBoot();
    if (!app.config.hasKey && !app.config.demo) {
      showSetup();
    } else {
      await maybeOpening();
    }
  } catch (error) {
    $("#boot-text").textContent = error.message || "她没醒过来";
    $("#boot-text").insertAdjacentHTML("afterend", '<p class="tiny">刷新页面再试一次；如果一直这样，看看启动窗口里的报错。</p>');
  }

  renderAll();
  startTimers();
}

function bindStaticEvents() {
  $("#send").addEventListener("click", send);
  $("#input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  $("#input").addEventListener("input", autoGrow);

  $$(".rail-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "chat") {
        $("#panel").classList.remove("is-open");
        $("#input").focus();
      } else if (view === "memory") openMemory();
      else if (view === "trace") openTrace();
      else if (view === "settings") openSettings();
      else if (view === "help") openHelp();
    });
  });

  $("#btn-trace").addEventListener("click", openTrace);
  $("#btn-panel").addEventListener("click", () => $("#panel").classList.toggle("is-open"));
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (event) => {
    if (event.target.id === "modal") closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!$("#modal").hidden) closeModal();
      else if (!$("#setup").hidden) {
        // 第一次设置不靠 Esc 关掉：没有 key 她不会说话。
      }
    }
  });

  $("#setup-save").addEventListener("click", saveSetup);
  $("#setup-key").addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveSetup();
  });
  $("#setup-help").addEventListener("click", openHelp);

  $("#messages").addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry-opening]");
    if (retry) {
      app.chatError = "";
      maybeOpening(true);
    }
  });

  $("#panel-content").addEventListener("click", (event) => {
    const seg = event.target.closest("[data-layer]");
    if (seg) {
      app.emotionLayer = seg.dataset.layer;
      renderPanel();
      return;
    }
    const more = event.target.closest("[data-more]");
    if (more?.dataset.more === "memory") openMemory();
    if (more?.dataset.more === "trace") openTrace();
  });

  $("#action-row").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-action]");
    if (chip) act(chip.dataset.action);
  });

  const chat = $("#chat");
  chat.addEventListener("scroll", () => {
    $("#jump").classList.toggle("is-visible", !nearBottom());
  }, { passive: true });

  const jump = document.createElement("button");
  jump.className = "jump";
  jump.id = "jump";
  jump.title = "回到下面";
  jump.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/></svg>';
  jump.addEventListener("click", () => scrollBottom("smooth"));
  $(".main").appendChild(jump);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
}

function startTimers() {
  clearInterval(app.pollTimer);
  clearInterval(app.tickTimer);
  app.pollTimer = setInterval(refresh, 75_000);
  app.tickTimer = setInterval(tick, 50_000);
  updateClock();
  setInterval(updateClock, 30_000);
}

/* ───────────────────────────── 状态 ───────────────────────────── */

function applyState(payload) {
  if (!payload || !payload.persona) return;
  app.data = payload;
  if (payload.config) app.config = payload.config;
  if (payload.lastTraceId && !app.lastTrace) app.lastTrace = { id: payload.lastTraceId };
}

async function refresh() {
  if (document.visibilityState !== "visible" || app.busy) return;
  try {
    const before = app.data?.chat?.messages?.length ?? 0;
    const payload = await api("/api/state");
    applyState(payload);
    renderHeader();
    renderPanel();
    if ((payload.chat?.messages?.length ?? 0) !== before) renderMessages();
  } catch {
    // 轮询失败不打扰用户。
  }
}

async function maybeOpening(force = false) {
  if (!app.data) return;
  const { opening, chat } = app.data;
  if (!opening?.pending) return;
  if (!force && chat?.messages?.length) return;
  app.typing = true;
  renderMessages();
  try {
    const result = await api("/api/opening", { method: "POST", body: {} });
    if (result.state) applyState(result.state);
    if (result.trace) app.lastTrace = result.trace;
    app.typing = false;
    app.chatError = "";
    renderAll();
  } catch (error) {
    app.typing = false;
    app.chatError = error.message || "她没能开口。";
    renderAll();
  }
}

/* ───────────────────────────── 对话 ───────────────────────────── */

async function send() {
  const input = $("#input");
  const text = input.value.trim();
  if (!text || app.busy) return;
  if (!app.config?.hasKey && !app.config?.demo) {
    showSetup();
    return;
  }

  app.busy = true;
  app.pendingUser = text;
  app.typing = true;
  app.chatError = "";
  input.value = "";
  autoGrow();
  renderMessages(true);

  try {
    const result = await api("/api/say", { method: "POST", body: { text } });
    app.pendingUser = "";
    app.typing = false;
    if (result.state) applyState(result.state);
    app.lastTrace = result.trace ?? app.lastTrace;
    renderAll();
    scrollBottom("smooth");
  } catch (error) {
    app.pendingUser = "";
    app.typing = false;
    input.value = text;
    autoGrow();
    renderMessages();
    toast(error.message || "这句话没发出去。", true);
    if (error.code === "NEED_KEY") showSetup();
  } finally {
    app.busy = false;
    updateSendState();
    input.focus();
  }
}

async function act(id) {
  if (app.busy) return;
  app.busy = true;
  app.typing = true;
  app.chatError = "";
  renderMessages(true);
  try {
    const result = await api("/api/action", { method: "POST", body: { id } });
    app.typing = false;
    if (result.state) applyState(result.state);
    app.lastTrace = result.trace ?? app.lastTrace;
    renderAll();
    scrollBottom("smooth");
  } catch (error) {
    app.typing = false;
    renderMessages();
    toast(error.message || "这个动作没做成。", true);
    if (error.code === "NEED_KEY") showSetup();
  } finally {
    app.busy = false;
    updateSendState();
  }
}

async function tick() {
  if (app.busy || app.typing || document.visibilityState !== "visible") return;
  if (!app.config?.hasKey && !app.config?.demo) return;
  const before = app.data?.chat?.messages?.length ?? 0;
  try {
    const result = await api("/api/tick", { method: "POST", body: {} });
    if (!result.act) return;
    if (result.state) applyState(result.state);
    app.lastTrace = result.trace ?? app.lastTrace;
    renderAll();
    if ((app.data?.chat?.messages?.length ?? 0) > before) scrollBottom("smooth");
  } catch {
    // 主动开口失败就算了，她可以等下一次。
  }
}

/* ───────────────────────────── 渲染：框架 ───────────────────────────── */

function renderAll() {
  renderHeader();
  renderMessages();
  renderPanel();
  renderActions();
  renderKeyHint();
  updateSendState();
}

function renderHeader() {
  if (!app.data) return;
  const { persona, life, clock } = app.data;
  $("#her-name").textContent = persona.name;
  const status = life.asleep ? `睡着了 · ${life.place}` : `${life.place} · ${life.activity}`;
  $("#her-status").textContent = status;
  $("#status-dot").classList.toggle("is-asleep", Boolean(life.asleep));
  $("#clock").textContent = clock?.time ?? "";
  $("#demo-flag").hidden = !app.config?.demo;
  document.title = `${persona.name} · 网页版`;

  const rail = $$(".rail-btn[data-view]").find((button) => button.dataset.view === "chat");
  rail?.classList.add("is-active");
}

function renderKeyHint() {
  const hint = $("#key-hint");
  if (!hint) return;
  if (app.config?.demo) {
    hint.textContent = "演示模式：台词固定，不联网";
    return;
  }
  if (app.config?.hasKey) {
    hint.textContent = "";
    return;
  }
  hint.textContent = "还没有 key";
}

function updateSendState() {
  $("#send").disabled = app.busy || !$("#input").value.trim();
}

function autoGrow() {
  const input = $("#input");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 148)}px`;
  updateSendState();
}

/* ───────────────────────────── 渲染：消息 ───────────────────────────── */

function renderMessages(forceBottom = false) {
  const host = $("#messages");
  if (!app.data) return;
  const wasBottom = nearBottom();
  const messages = app.data.chat?.messages ?? [];
  const nodes = [];
  let lastAt = 0;

  if (!messages.length && !app.pendingUser && !app.typing) {
    host.innerHTML = `
      <div class="chat-empty">
        <svg class="orb"><use href="#i-orb"></use></svg>
        <p>${app.chatError ? "她刚才没能开口。" : "她还没开口。你可以先说一句。"}</p>
        ${app.chatError ? `<div class="chat-error">${esc(app.chatError)} <button data-retry-opening>再试一次</button></div>` : ""}
      </div>`;
    app.lastRenderedCount = 0;
    return;
  }

  let openingMarked = false;
  for (const message of messages) {
    if (message.role === "note") {
      nodes.push(noteNode(message));
      lastAt = message.at;
      continue;
    }
    const gap = message.at - lastAt;
    if (!lastAt || gap > 20 * 60_000) {
      nodes.push(separatorNode(message.at, !lastAt));
      lastAt = message.at;
    }
    if (message.kind === "opening" && !openingMarked) {
      nodes.push(noteNode({ text: "第一次见面", kind: "opening" }));
      openingMarked = true;
    }
    nodes.push(messageNode(message));
  }

  if (app.pendingUser) {
    nodes.push(
      messageNode({
        role: "user",
        text: app.pendingUser,
        at: Date.now(),
        pending: true,
      }),
    );
  }
  if (app.typing) {
    nodes.push(typingNode());
  }
  if (app.chatError) {
    nodes.push(
      el("div", { class: "chat-error" }, `${app.chatError} `, retryButton()),
    );
  }

  host.innerHTML = "";
  for (const node of nodes) host.appendChild(node);

  if (forceBottom || wasBottom) scrollBottom(forceBottom ? "auto" : "smooth");
  app.lastRenderedCount = messages.length;
}

function messageNode(message) {
  const isHer = message.role === "her";
  const wrap = el("div", {
    class: `msg ${isHer ? "her" : "user"}${message.pending ? " is-pending" : ""}`,
  });
  if (isHer) {
    const avatar = el("div", { class: "msg-avatar" });
    avatar.innerHTML = '<svg class="orb"><use href="#i-orb"></use></svg>';
    wrap.appendChild(avatar);
  }
  const bubbleWrap = el("div", { class: "bubble-wrap" });
  const bubble = el("div", { class: "bubble" });
  bubble.textContent = message.text;
  bubbleWrap.appendChild(bubble);
  const time = el("span", { class: "msg-time" }, message.pending ? "发送中" : clockOf(message.at));
  bubbleWrap.appendChild(time);
  wrap.appendChild(bubbleWrap);
  return wrap;
}

function noteNode(message) {
  const node = el("div", { class: "note" });
  node.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-spark"></use></svg>';
  node.appendChild(document.createTextNode(message.text));
  return node;
}

function typingNode() {
  const node = el("div", { class: "typing" });
  const avatar = el("div", { class: "msg-avatar" });
  avatar.innerHTML = '<svg class="orb"><use href="#i-orb"></use></svg>';
  const bubble = el("div", { class: "bubble" });
  bubble.innerHTML = "<i></i><i></i><i></i>";
  node.append(avatar, bubble);
  return node;
}

function separatorNode(at, first = false) {
  if (first) {
    const node = el("div", { class: "day-sep" });
    node.textContent = dayLabel(at);
    return node;
  }
  return el("div", { class: "day-sep" }, dayLabel(at));
}

function retryButton() {
  const button = el("button", { type: "button" }, "再试一次");
  button.addEventListener("click", () => {
    app.chatError = "";
    maybeOpening(true);
  });
  return button;
}

/* ───────────────────────────── 渲染：右侧 ───────────────────────────── */

function renderPanel() {
  const host = $("#panel-content");
  if (!app.data) return;
  const { persona, life, clock, almanac, emotion, memory, beliefs, profile, proactive } = app.data;
  const layers = emotion.layerDimensions ?? {};
  const bars = pickBars(emotion, app.emotionLayer);
  const recent = memory.recent?.slice(0, 3) ?? [];

  host.innerHTML = `
    <section class="card identity" data-card="identity">
      <div class="portrait"><svg class="orb"><use href="#i-orb"></use></svg></div>
      <h2>${esc(persona.name)}</h2>
      <p class="role">${esc(persona.role || "")}</p>
      <p class="status"><span class="status-dot ${life.asleep ? "is-asleep" : ""}"></span>${life.asleep ? "睡着" : "醒着"} · ${esc(life.place)}</p>
    </section>

    <section class="card" data-card="now">
      <div class="card-head"><h3>此刻</h3><span class="dim mono">${esc(clock?.time ?? "")}</span></div>
      <p class="now-phrase">${esc(clock?.phrase ?? "")}。${life.asleep ? "她睡着了。" : `在${esc(life.place)}。${esc(String(life.activity ?? "").replace(/^在/, ""))}。`}</p>
      <div class="meta-row"><span>${esc(almanac?.season?.phase ?? "秋")} · ${esc(almanac?.monthText ?? "")}</span><span>能量 ${Math.round((life.energy ?? 0) * 100)}%</span></div>
      <div class="energy"><i style="width:${Math.round((life.energy ?? 0) * 100)}%"></i></div>
    </section>

    <section class="card" data-card="emotion">
      <div class="card-head">
        <h3>她的情绪</h3>
        <div class="seg" role="group" aria-label="看哪一层">
          ${["primary", "background", "social"].map((layer) => `<button data-layer="${layer}" class="${app.emotionLayer === layer ? "is-on" : ""}">${layerName(layer)}</button>`).join("")}
        </div>
      </div>
      <p class="emotion-label">${esc(emotion.label)}</p>
      <p class="emotion-sub">${esc(emotion.backgroundLabel)} · ${esc(emotion.socialLabel)}${emotion.divergent ? " · 此刻和底色不在一个温度上" : ""}</p>
      <div class="bars">
        ${bars.map((bar) => `
          <div class="bar">
            <span>${esc(bar.label)}</span>
            <span class="track"><i style="width:${Math.round(bar.value)}%"></i></span>
            <span class="val">${Math.round(bar.value)}</span>
          </div>`).join("")}
      </div>
    </section>

    <section class="card" data-card="memory">
      <div class="card-head"><h3>她记得</h3><button class="more" data-more="memory">全部 ${memory.count}</button></div>
      ${recent.length ? `<ul class="mem-list">${recent.map(memoryItem).join("")}</ul>` : '<p class="quiet-note">还什么都没记住。聊几句，她会自己挑重要的留下。</p>'}
    </section>

    <section class="card" data-card="profile">
      <div class="card-head"><h3>她注意到</h3></div>
      ${profile?.observations?.length ? `<ul class="obs-list">${profile.observations.slice(0, 3).map((item) => `<li><span class="dim">${esc(DIMENSION_LABEL[item.dimension] ?? "")}</span> ${esc(item.value)}</li>`).join("")}</ul>` : '<p class="quiet-note">还在看。她不急着给人下结论。</p>'}
    </section>

    <section class="card" data-card="beliefs">
      <div class="card-head"><h3>她相信</h3></div>
      ${beliefs?.length ? `<ul class="belief-list">${beliefs.slice(0, 3).map((item) => `<li class="${item.learned ? "is-learned" : ""}">${esc(item.topic)}</li>`).join("")}</ul>` : '<p class="quiet-note">她还没有形成什么看法。</p>'}
    </section>

    <section class="card" data-card="proactive">
      <div class="card-head"><h3>今天</h3><span class="dim mono">${proactive?.remaining ?? 0}/${proactive?.policy?.perDay ?? 0}</span></div>
      <p class="quiet-note">${proactiveText(proactive)}</p>
      <p class="tiny">${esc(proactive?.decision?.line ?? "")}</p>
    </section>
  `;
}

function memoryItem(item) {
  return `<li class="mem-item"><i class="kind" data-kind="${esc(item.kind)}"></i><div><p>${esc(item.text)}</p><time>${relTime(item.createdAt)}</time></div></li>`;
}

function pickBars(emotion, layer) {
  if (layer === "background" || layer === "social") return emotion.layerDimensions?.[layer] ?? [];
  if (layer === "primary") return emotion.layerDimensions?.primary ?? [];
  return emotion.dimensions ?? [];
}

function layerName(layer) {
  return layer === "primary" ? "此刻" : layer === "background" ? "底色" : "关系";
}

function proactiveText(proactive) {
  if (!proactive) return "";
  if (proactive.policy?.perDay === 0) return "主动开口是关着的。她不会先找你，但你说的话她都在听。";
  if (proactive.remaining <= 0) return "今天的额度用完了。她不会再先开口，但你说话她一定在。";
  return `她今天还可以主动找你 <b>${proactive.remaining}</b> 次。不是定时消息，是到那一刻真的想说。`;
}

/* ───────────────────────────── 动作条 ───────────────────────────── */

function renderActions() {
  const host = $("#action-row");
  host.innerHTML = ACTIONS.map(
    (action) => `<button class="action-chip" data-action="${action.id}" ${app.busy ? "disabled" : ""}><svg viewBox="0 0 24 24"><use href="#${action.icon}"></use></svg>${action.label}</button>`,
  ).join("");
}

/* ───────────────────────────── 记忆 ───────────────────────────── */

async function openMemory() {
  openModal({ eyebrow: "她记得的", title: "记忆", body: '<p class="empty">正在翻开……</p>' });
  try {
    const result = await api("/api/memories");
    $("#modal-body").innerHTML = renderMemory(result);
  } catch (error) {
    $("#modal-body").innerHTML = `<p class="empty">${esc(error.message)}</p>`;
  }
}

function renderMemory(result) {
  const { stats, items, forgotten } = result;
  const rows = items.length
    ? items
        .map(
          (item) => `<div class="memory-row">
            <span class="memory-kind" data-kind="${esc(item.kind)}">${KIND_LABEL[item.kind] ?? "事实"}</span>
            <span class="memory-text">${esc(item.text)}</span>
            <span class="memory-meta">${relTime(item.createdAt)}</span>
          </div>`,
        )
        .join("")
    : '<p class="empty">她还没有记住什么。<br />聊几句，她会自己挑重要的留下。</p>';

  const forgottenLine = forgotten?.length
    ? `<p class="tiny">她已经忘了 ${forgotten.length} 条。记忆会随时间和容量自己退场，这里只留记录，不留原文。</p>`
    : "";

  return `
    <div class="stats">
      <div class="stat"><b>${stats.size}</b><span>条记忆</span></div>
      <div class="stat"><b>${stats.capacity}</b><span>容量上限</span></div>
      <div class="stat"><b>${Math.round((stats.averageRetention ?? 0) * 100)}%</b><span>平均清晰度</span></div>
    </div>
    <p class="tiny">记忆不是聊天记录。她只留下以后可能用得上的事，条数满了会先忘不重要的。</p>
    <div class="section-label">全部</div>
    <div class="memory-full">${rows}</div>
    ${forgottenLine}
    <p class="tiny">这些字只在这台电脑上。网页版不会把记忆发到任何地方，除了说话时作为上下文交给 DeepSeek。</p>
  `;
}

/* ───────────────────────────── 透视 ───────────────────────────── */

async function openTrace() {
  openModal({ eyebrow: "这一轮", title: "透视", wide: true, body: '<p class="empty">正在回看……</p>' });
  try {
    const id = app.lastTrace?.id || app.data?.lastTraceId || "latest";
    const result = await api(`/api/trace?id=${encodeURIComponent(id)}`);
    app.lastTrace = result.trace;
    $("#modal-body").innerHTML = renderTrace(result.trace);
  } catch (error) {
    $("#modal-body").innerHTML = `<p class="empty">${esc(error.message)}<br />先和她说一句话，这里就有东西可看了。</p>`;
  }
}

function renderTrace(trace) {
  const after = trace.emotion?.after;
  const before = trace.emotion?.before;
  const delta = trace.emotion?.delta ?? {};
  const dims = after?.dimensions ?? [];
  const kind = TRACE_KIND[trace.kind] ?? (trace.kind?.startsWith("action:") ? "一个动作" : trace.kind);
  const recall = trace.recall ?? [];
  const sections = trace.prompt?.sections ?? [];
  const maxChars = Math.max(1, ...sections.map((section) => section.chars));
  const wrote = trace.wrote;
  const wroteCount = (wrote?.memories?.length ?? 0) + (wrote?.profile?.length ?? 0) + (wrote?.beliefs?.length ?? 0);
  const moved = dims.some((dim) => Math.abs(Number(delta[dim.key] ?? 0)) > 0.05);

  return `
    <div class="trace-hero">
      <p><span class="dim">${esc(kind)}</span> · ${esc(trace.reply?.text ?? "")}</p>
      <span class="stamp">${clockOf(trace.at)}<br />${trace.reply?.latencyMs ?? 0}ms</span>
    </div>

    <div class="trace-grid">
      <div class="trace-block">
        <h4>情绪怎么动的</h4>
        <div class="delta-row"><span>${esc(before?.label ?? "—")}</span><span class="dim">→</span><b>${esc(after?.label ?? "—")}</b></div>
        ${
          moved
            ? dims
                .map((dim) => {
                  const value = Number(delta[dim.key] ?? 0);
                  const cls = value > 0.05 ? "up" : value < -0.05 ? "down" : "zero";
                  return `<div class="delta-row"><span>${esc(dim.label)}</span><b class="${cls}">${value > 0 ? "+" : ""}${value.toFixed(1)}</b></div>`;
                })
                .join("")
            : '<p class="tiny">这一轮情绪几乎没有动。平静也是一种信息。</p>'
        }
      </div>

      <div class="trace-block">
        <h4>想起的记忆</h4>
        ${
          recall.length
            ? recall
                .map((item) => {
                  const score = Number(item.score ?? 0);
                  const width = Math.min(100, Math.round(score * 100));
                  return `<div class="recall-item"><div class="recall-head"><p>${esc(item.text)}</p><span class="recall-score">相关 ${score.toFixed(2)}</span></div><div class="scorebar"><i style="width:${width}%"></i></div></div>`;
                })
                .join("")
            : '<p class="tiny">这一轮没有想起什么。没有硬塞两条无关的，是对的。</p>'
        }
      </div>

      <div class="trace-block">
        <h4>这一轮写下的</h4>
        ${
          wroteCount
            ? [
                ...(wrote.memories ?? []).map((item) => `<div class="delta-row"><span>记住</span><b class="up">${esc(item.text)}</b></div>`),
                ...(wrote.profile ?? []).map((item) => `<div class="delta-row"><span>注意到</span><b>${esc(item.value)}</b></div>`),
                ...(wrote.beliefs ?? []).map((item) => `<div class="delta-row"><span>看法</span><b>${esc(item.topic)}</b></div>`),
              ].join("")
            : '<p class="tiny">没有需要记下的。普通的一句话，不必都变成档案。</p>'
        }
      </div>

      <div class="trace-block">
        <h4>表达自检</h4>
        ${
          trace.style?.ok
            ? '<p class="style-ok">干净：没有列点、没有自称助手、没有把话递回去。</p>'
            : (trace.style?.issues ?? []).map((issue) => `<p class="style-issue"><code>${esc(issue.code)}</code> ${esc(issue.message)}</p>`).join("") || '<p class="tiny">没有记录。</p>'
        }
      </div>

      <div class="trace-block">
        <h4>她这一轮看到的</h4>
        <div class="prompt-bars">
          ${sections
            .map(
              (section) => `<div class="prompt-bar"><span>${esc(section.name)}</span><span class="track"><i style="width:${Math.round((section.chars / maxChars) * 100)}%"></i></span><em>${section.chars}</em></div>`,
            )
            .join("")}
        </div>
        <p class="tiny">共 ${trace.prompt?.chars ?? 0} 字。这里只显示每块多大，不显示原文。</p>
      </div>

      <div class="trace-block">
        <h4>这一轮的账</h4>
        <div class="kv"><span>事件</span><span>${esc(classifiedLabel(trace))}</span></div>
        <div class="kv"><span>模型</span><span>${esc(trace.reply?.model ?? "—")}</span></div>
        <div class="kv"><span>tokens</span><span>${trace.reply?.usage?.total_tokens ?? "—"}</span></div>
        <div class="kv"><span>用时</span><span>${trace.reply?.latencyMs ?? 0}ms</span></div>
        <div class="kv"><span>记忆抽取</span><span>${trace.extractionError ? "失败（不影响说话）" : wrote ? "完成" : "跳过"}</span></div>
      </div>
    </div>

    <p class="tiny">透视只显示这一轮用到了什么，不显示 system prompt 原文；所有内容都只在这台电脑上。</p>
  `;
}

function classifiedLabel(trace) {
  if (!trace.classified) return "对话";
  if (trace.classified.label) return trace.classified.label;
  return trace.classified.kind ?? "对话";
}

/* ───────────────────────────── 设置 / 帮助 ───────────────────────────── */

async function openSettings() {
  if (!app.data) return;
  let personas = [];
  try {
    const result = await api("/api/personas");
    personas = result.personas ?? [];
  } catch {
    personas = [];
  }
  const config = app.config ?? {};
  const remember = config.remember !== false;
  const sourceText = {
    env: "来自环境变量 DEEPSEEK_API_KEY",
    config: "存在这台电脑的设置里",
    dsh: "从 ~/.dsh/.credentials.yaml 读到的",
    dotenv: "从 .env 读到的",
  }[config.keySource] ?? "还没有";

  openModal({
    eyebrow: "只在这台电脑上",
    title: "设置",
    body: `
      <div class="setting">
        <div class="setting-text"><b>DeepSeek API key</b><span>${esc(sourceText)}${config.keyHint ? ` · 尾巴 ${esc(config.keyHint)}` : ""}</span></div>
        <input type="password" id="set-key" placeholder="${config.hasKey ? "已保存，留空就不改" : "sk-..."}" autocomplete="off" spellcheck="false" />
      </div>
      <div class="setting">
        <div class="setting-text"><b>模型</b><span>默认 deepseek-chat；换模型只影响说话方式，不影响她的记忆。</span></div>
        <input type="text" id="set-model" value="${esc(config.model ?? "deepseek-chat")}" spellcheck="false" />
      </div>
      <div class="setting">
        <div class="setting-text"><b>人格</b><span>换一个人格，会换一个数据桶：记忆和疤不会串。</span></div>
        <select id="set-persona">
          ${personas.map((persona) => `<option value="${esc(persona.id)}" ${persona.id === config.persona ? "selected" : ""}>${esc(persona.name)}${persona.role ? ` · ${esc(persona.role.slice(0, 18))}` : ""}</option>`).join("") || `<option value="${esc(config.persona)}">${esc(config.personaName ?? config.persona)}</option>`}
        </select>
      </div>
      <div class="setting">
        <div class="setting-text"><b>让她自己记</b><span>每轮对话后多一次很小的调用，只挑值得留的。关掉就只聊天、不记新事。</span></div>
        <button class="switch ${remember ? "is-on" : ""}" id="set-remember" role="switch" aria-checked="${remember}"></button>
      </div>
      <div class="setting">
        <div class="setting-text"><b>每天主动找你几次</b><span>0 = 她永远不先开口。默认 3 次，且两次之间至少隔一小时。</span></div>
        <input type="range" class="range" id="set-proactive" min="0" max="6" step="1" value="${Number(config.proactivePerDay ?? 3)}" />
      </div>
      <div class="setting">
        <div class="setting-text"><b>数据在哪里</b><span class="data-path">${esc(config.dataDir ?? "")}</span></div>
      </div>
      <div class="setting">
        <div class="setting-text"><b>清理</b><span>不会真的删除：先归档到同目录的 archive/，你反悔了还能找回来。</span></div>
        <div class="btn-row">
          <button class="ghost" data-reset="chat">清空聊天</button>
          <button class="danger" data-reset="memory">让她忘掉一切</button>
        </div>
      </div>
      <div class="btn-row" style="margin-top:22px">
        <button class="primary" id="set-save">保存设置</button>
        <button class="ghost" id="set-help">怎么用</button>
      </div>
      ${config.demo ? '<p class="tiny warm">现在是演示模式，台词是固定的。填了 key 也要用 start-web.cmd 重新启动，才会真的调用模型。</p>' : ""}
      <p class="tiny">网页版是仓库里唯一会自己调模型的部分。插件本体仍然不调模型、不联网。key 不会出现在日志里。</p>
    `,
  });

  const rememberButton = $("#set-remember");
  rememberButton.addEventListener("click", () => {
    rememberButton.classList.toggle("is-on");
    rememberButton.setAttribute("aria-checked", String(rememberButton.classList.contains("is-on")));
  });
  $("#set-help").addEventListener("click", openHelp);
  $$("[data-reset]").forEach((button) => {
    button.addEventListener("click", () => reset(button.dataset.reset));
  });
  $("#set-save").addEventListener("click", saveSettings);
}

async function saveSettings() {
  const button = $("#set-save");
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const payload = {
      apiKey: $("#set-key").value.trim() || undefined,
      model: $("#set-model").value.trim(),
      persona: $("#set-persona").value,
      remember: $("#set-remember").classList.contains("is-on"),
      proactivePerDay: Number($("#set-proactive").value),
    };
    const result = await api("/api/setup", { method: "POST", body: payload });
    if (result.state) applyState(result.state);
    closeModal();
    renderAll();
    toast(result.warning || "设置已保存。", Boolean(result.warning));
    if (!app.config?.hasKey && !app.config?.demo) showSetup();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
    button.textContent = "保存设置";
  }
}

async function reset(scope) {
  const text =
    scope === "chat"
      ? "清空聊天记录？她还会记得你，只是这段对话会收进 archive/。"
      : "让她忘掉一切？记忆、情绪、看法、开场都会归档，她会重新认识你。";
  if (!window.confirm(text)) return;
  try {
    const result = await api("/api/reset", { method: "POST", body: { scope } });
    closeModal();
    applyState(result.state);
    app.lastTrace = null;
    app.chatError = "";
    renderAll();
    toast(scope === "chat" ? "聊天记录已归档。" : "她已经重新开始了。");
    if (app.data?.opening?.pending) await maybeOpening();
  } catch (error) {
    toast(error.message, true);
  }
}

function openHelp() {
  openModal({
    eyebrow: "给第一次用的人",
    title: "怎么用",
    body: `
      <div class="section-label">说话</div>
      <p class="quiet-note">在下面输入，Enter 发送，Shift + Enter 换行。她可能回得慢，也可能只回几个字——那不是卡住了。</p>
      <div class="section-label">四个动作</div>
      <p class="quiet-note">输入框上方：「戳一戳」「摸摸头」「递杯水」「夸她一句」。她不会每次都热烈回应，看她的状态。</p>
      <div class="section-label">透视是什么</div>
      <p class="quiet-note">点右上角「透视」，能看到这一轮：她想起了哪条记忆、情绪动了多少、说了多少字、自检有没有问题。它不显示 prompt 原文，也不是监控。</p>
      <div class="section-label">记忆和主动</div>
      <p class="quiet-note">她会自己挑重要的事记住；说得越多，她越像认识你。安静的时候她可能先开口，每天最多几次，深夜不会。</p>
      <div class="section-label">没有 key 怎么办</div>
      <p class="quiet-note">在 DeepSeek 开放平台建一个，粘进设置。也可以先看演示：关掉这个窗口，双击 <code>start-web-demo.cmd</code>（Mac 上跑 <code>./start-web-demo.sh</code>）。</p>
      <div class="section-label">数据</div>
      <p class="quiet-note">所有聊天、记忆、情绪都在本机的 <code>~/.dsh/plugins/dsh-serene/</code>。想备份就复制这个文件夹；想重来就在设置里清理。</p>
      <p class="tiny">她不是一个服务。她是一个住在这台机器里的存在，刚好愿意和你说话。</p>
    `,
  });
}

/* ───────────────────────────── 首次设置 ───────────────────────────── */

function showSetup() {
  $("#setup").hidden = false;
  setTimeout(() => $("#setup-key")?.focus(), 180);
}

async function saveSetup() {
  const button = $("#setup-save");
  const key = $("#setup-key").value.trim();
  if (!key) {
    $("#setup-note").textContent = "先把 key 粘进来。";
    $("#setup-note").style.color = "var(--warm)";
    return;
  }
  button.disabled = true;
  button.textContent = "正在验证…";
  try {
    const result = await api("/api/setup", { method: "POST", body: { apiKey: key } });
    if (result.state) applyState(result.state);
    $("#setup").hidden = true;
    button.disabled = false;
    button.textContent = "保存，开始";
    renderAll();
    toast(result.warning || "钥匙收好了。");
    if (app.data?.opening?.pending) await maybeOpening();
  } catch (error) {
    button.disabled = false;
    button.textContent = "保存，开始";
    $("#setup-note").textContent = error.message;
    $("#setup-note").style.color = "var(--danger)";
  }
}

/* ───────────────────────────── 弹层 ───────────────────────────── */

function openModal({ eyebrow = "", title = "", body = "", wide = false }) {
  $("#modal-eyebrow").textContent = eyebrow;
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-card").classList.toggle("wide", Boolean(wide));
  $("#modal").hidden = false;
  $("#modal-body").scrollTop = 0;
}

function closeModal() {
  $("#modal").hidden = true;
  $("#modal-body").innerHTML = "";
}

/* ───────────────────────────── 小工具 ───────────────────────────── */

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error || `请求失败（${response.status}）`);
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nearBottom() {
  const chat = $("#chat");
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
}

function scrollBottom(behavior = "auto") {
  const chat = $("#chat");
  requestAnimationFrame(() => {
    chat.scrollTo({ top: chat.scrollHeight, behavior });
    $("#jump")?.classList.remove("is-visible");
  });
}

function hideBoot() {
  const boot = $("#boot");
  boot.classList.add("is-done");
  setTimeout(() => boot.remove(), 700);
}

function updateClock() {
  if (!app.data) return;
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function clockOf(at) {
  return new Date(Number(at) || Date.now()).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dayLabel(at) {
  const date = new Date(Number(at) || Date.now());
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return `今天 ${clockOf(at)}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clockOf(at)}`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clockOf(at)}`;
}

function relTime(at) {
  const value = Number(at) || 0;
  if (!value) return "";
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)} 天前`;
  const date = new Date(value);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function toast(message, bad = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("is-bad", bad);
  node.classList.add("is-on");
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => node.classList.remove("is-on"), 4200);
}
