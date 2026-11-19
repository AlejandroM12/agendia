import http from "node:http";
import { appendFileSync, existsSync } from "node:fs";
const log = (line) => appendFileSync(".mp-sandbox/webhooks.log", `${new Date().toISOString()} ${line}\n`);
http.createServer((req, res) => {
  const isWebhook = req.url.startsWith("/api/webhooks");
  if (isWebhook && existsSync(".mp-sandbox/drop-webhooks")) {
    log(`DROP ${req.method} ${req.url.split("?")[0]}`);
    res.writeHead(503, { "content-type": "application/json" });
    res.end('{"dropped":true}');
    return;
  }
  const up = http.request({ host: "127.0.0.1", port: 3120, path: req.url, method: req.method, headers: req.headers }, (r) => {
    if (isWebhook) log(`${req.method} ${req.url.split("?")[0]}?${new URL(req.url, "http://x").searchParams.toString().slice(0, 80)} sig=${req.headers["x-signature"] ? "sí" : "no"} ua=${String(req.headers["user-agent"] ?? "").slice(0, 30)} -> ${r.statusCode}`);
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(3121);
