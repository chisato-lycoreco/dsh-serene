/**
 * 端口边界：这个服务只该被「本机上的这一页」用。
 *
 * `server.listen(port, "127.0.0.1")` 已经挡住了局域网和外网，但挡不住两种东西：
 *   ① **DNS rebinding**——他打开 evil.com，那个域名解析到 127.0.0.1，
 *      浏览器就替它把请求打到 4317 上，`Host` 头写的是 `evil.com:4317`；
 *   ② **跨站副作用**——随便哪个网页都能 `fetch("http://127.0.0.1:4317/api/say", …)`。
 *      响应读不到（没有 CORS 头），但副作用照做：让她说话、清记忆、改设置。
 *      这类请求的 `Origin` 是那个网页，不是本机。
 *
 * 这里只做三件纯判断（不读时钟、不联网、不读文件）：
 *   Host          只能是回环名 + 本进程真正监听的端口（端口被占时会往上挪，不能写死）；
 *   Origin        有就必须是 `http://<回环名>:<那个端口>`（没有 = 非浏览器客户端，放过）；
 *   Content-Type  有请求体时必须是 JSON——简单请求设不了这个头，跨站的表单 CSRF 就打不进来。
 *
 * 为什么不是「加个 token 就完事」：token 得存在哪、怎么发、前端怎么带，都是新的一层；
 * 而这三条的证据（Host / Origin / Content-Type）浏览器一定会带，别的站点伪造不了。
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

/** 拆 `Host` 头：`[::1]:4317` / `127.0.0.1:4317` / `localhost`。拆不出来返回 null。 */
function parseHost(header) {
  const raw = String(header ?? "").trim().toLowerCase();
  if (!raw) return null;
  const ipv6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  const match = ipv6 ?? raw.match(/^([^:/]+)(?::(\d+))?$/);
  if (!match) return null;
  return { hostname: match[1], port: match[2] ?? "" };
}

/** `Origin` 只认 `http://回环:端口`；`null`（file:// 或沙箱 iframe）一律不认。 */
function originAllowed(origin, port) {
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" || !LOOPBACK.has(parsed.hostname)) return false;
  return parsed.port === String(port);
}

/**
 * 这一轮请求能不能进。返回 null 表示放行，否则 `{ status, error }`。
 *
 * @param {object} req `node:http` 的请求对象（只读 `method` / `headers`）
 * @param {number} port 本进程**真正**监听的端口（`server.address().port`）
 */
export function checkPortBoundary(req, port) {
  const headers = req?.headers ?? {};
  // 端口为 0 / 空表示「还没 listen 好」，这时不比对端口，别把正常请求挡在外面。
  const expected = Number(port) > 0 ? String(port) : "";

  const host = parseHost(headers.host);
  if (!host) return { status: 403, error: "不认识的 Host。" };
  if (!LOOPBACK.has(host.hostname)) return { status: 403, error: "只接受本机地址。" };
  if (host.port && expected && host.port !== expected) {
    return { status: 403, error: `端口不对（这里是 ${expected}）。` };
  }

  if (!originAllowed(headers.origin, port)) return { status: 403, error: "不接受跨站来源。" };

  const method = String(req?.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (hasBody && (Number(headers["content-length"] ?? 0) > 0 || headers["transfer-encoding"])) {
    const type = String(headers["content-type"] ?? "").toLowerCase();
    if (!type.includes("application/json")) return { status: 415, error: "只接受 application/json。" };
  }

  return null;
}
