import http from "http";
import https from "https";

const TARGET = process.env.GIT_PROXY_TARGET || "https://gitlab.com";
const PORT = Number(process.env.GIT_PROXY_PORT || 8080);
const INSECURE_TLS = String(process.env.GIT_PROXY_INSECURE_TLS || "false").toLowerCase() === "true";
const ALLOWED_ORIGINS_RAW =
  process.env.GIT_PROXY_ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5173,http://localhost:8080";

const targetUrl = new URL(TARGET);
const allowedOrigins = new Set(
  ALLOWED_ORIGINS_RAW.split(",")
    .map((x) => x.trim())
    .filter(Boolean)
);
const allowAnyOrigin = allowedOrigins.has("*");

const httpsAgent = new https.Agent({ rejectUnauthorized: !INSECURE_TLS });

function buildCorsHeaders(req) {
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,Accept,X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin"
  };

  const origin = req.headers.origin;
  if (allowAnyOrigin) {
    headers["Access-Control-Allow-Origin"] = origin || "*";
  } else if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function getHttpClient(protocol) {
  return protocol === "http:" ? http : https;
}

http
  .createServer((clientReq, clientRes) => {
    if (clientReq.method === "OPTIONS") {
      clientRes.writeHead(204, buildCorsHeaders(clientReq));
      clientRes.end();
      return;
    }

    const upstream = new URL(clientReq.url, targetUrl);
    const requestHeaders = { ...clientReq.headers };
    requestHeaders.host = upstream.host;

    const options = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === "http:" ? 80 : 443),
      path: upstream.pathname + upstream.search,
      method: clientReq.method,
      headers: requestHeaders,
      agent: upstream.protocol === "https:" ? httpsAgent : undefined
    };

    const client = getHttpClient(upstream.protocol);
    const proxyReq = client.request(options, (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders["access-control-allow-origin"];
      delete responseHeaders["access-control-allow-methods"];
      delete responseHeaders["access-control-allow-headers"];
      delete responseHeaders["access-control-allow-credentials"];

      clientRes.writeHead(proxyRes.statusCode ?? 502, {
        ...responseHeaders,
        ...buildCorsHeaders(clientReq)
      });
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on("error", (err) => {
      console.error("Git proxy error:", err.message);
      clientRes.writeHead(502, {
        "Content-Type": "text/plain",
        ...buildCorsHeaders(clientReq)
      });
      clientRes.end(`Git proxy error: ${err.message}`);
    });

    clientReq.pipe(proxyReq, { end: true });
  })
  .listen(PORT, () => {
    console.log(`Git proxy listening on http://localhost:${PORT} -> ${TARGET}`);
    console.log(`Allowed origins: ${allowAnyOrigin ? "*" : Array.from(allowedOrigins).join(", ")}`);
    if (INSECURE_TLS) console.log("Warning: GIT_PROXY_INSECURE_TLS=true (self-signed TLS accepted)");
  });
