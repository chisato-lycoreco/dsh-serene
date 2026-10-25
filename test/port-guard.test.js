import test from "node:test";
import assert from "node:assert/strict";
import { checkPortBoundary } from "../web/lib/port-guard.mjs";

const PORT = 4317;
const req = (headers, method = "GET") => ({ method, headers });

test("端口边界：本机页面放行", () => {
  assert.equal(checkPortBoundary(req({ host: "127.0.0.1:4317" }), PORT), null);
  assert.equal(checkPortBoundary(req({ host: "localhost:4317" }), PORT), null);
  assert.equal(checkPortBoundary(req({ host: "[::1]:4317" }), PORT), null);
  assert.equal(
    checkPortBoundary(req({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" }), PORT),
    null,
  );
});

test("端口边界：DNS rebinding 的 Host 打不进来", () => {
  assert.equal(checkPortBoundary(req({ host: "evil.com:4317" }), PORT)?.status, 403);
  assert.equal(checkPortBoundary(req({ host: "127.0.0.1" }), PORT), null, "没写端口的 Host 按默认端口算");
  assert.equal(checkPortBoundary(req({ host: "127.0.0.1:9999" }), PORT)?.status, 403);
  assert.equal(checkPortBoundary(req({ host: "" }), PORT)?.status, 403);
});

test("端口边界：跨站 Origin 与 null Origin 都不行", () => {
  assert.equal(
    checkPortBoundary(req({ host: "127.0.0.1:4317", origin: "https://evil.com" }), PORT)?.status,
    403,
  );
  assert.equal(
    checkPortBoundary(req({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:9999" }), PORT)?.status,
    403,
  );
  assert.equal(
    checkPortBoundary(req({ host: "127.0.0.1:4317", origin: "null" }), PORT)?.status,
    403,
  );
});

test("端口边界：有请求体就必须是 JSON", () => {
  const base = { host: "127.0.0.1:4317", "content-length": "12" };
  assert.equal(checkPortBoundary(req(base, "POST"), PORT)?.status, 415);
  assert.equal(checkPortBoundary(req({ ...base, "content-type": "text/plain" }, "POST"), PORT)?.status, 415);
  assert.equal(
    checkPortBoundary(req({ ...base, "content-type": "application/json; charset=utf-8" }, "POST"), PORT),
    null,
  );
  // 表单 POST 是跨站最简单的一种，正好卡在 Content-Type 上。
  assert.equal(
    checkPortBoundary(req({ ...base, "content-type": "application/x-www-form-urlencoded" }, "POST"), PORT)
      ?.status,
    415,
  );
});

test("端口边界：空请求体、GET、非浏览器客户端不受 Content-Type 限制", () => {
  assert.equal(
    checkPortBoundary(req({ host: "127.0.0.1:4317", "content-length": "0" }, "POST"), PORT),
    null,
  );
  assert.equal(
    checkPortBoundary(req({ host: "127.0.0.1:4317", "transfer-encoding": "chunked" }, "POST"), PORT)
      ?.status,
    415,
  );
  assert.equal(checkPortBoundary(req({ host: "127.0.0.1:4317", "content-type": "text/plain" }), PORT), null);
});

test("端口边界：端口未知时不比对端口，别误伤启动中的请求", () => {
  assert.equal(checkPortBoundary(req({ host: "127.0.0.1:5555" }), 0), null);
  assert.equal(checkPortBoundary(req({ host: "127.0.0.1:5555" }), undefined), null);
});
