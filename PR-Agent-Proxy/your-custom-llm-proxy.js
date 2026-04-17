import http from "http";
import https from "https";

const TARGET = process.env.LLM_PROXY_TARGET || "https://api.openai.com/v1";
const PORT = Number(process.env.LLM_PROXY_PORT || 8081);
const INSECURE_TLS = String(process.env.LLM_PROXY_INSECURE_TLS || "false").toLowerCase() === "true";
const ALLOWED_ORIGINS_RAW =
  process.env.LLM_PROXY_ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5173,http://localhost:8080";

const targetBase = new URL(TARGET.endsWith("/") ? TARGET : `${TARGET}/`);
const allowedOrigins = new Set(
  ALLOWED_ORIGINS_RAW.split(",")
    .map((x) => x.trim())
    .filter(Boolean)
);
const allowAnyOrigin = allowedOrigins.has("*");

const httpsAgent = new https.Agent({ rejectUnauthorized: !INSECURE_TLS });

function getHttpClient(protocol) {
  return protocol === "http:" ? http : https;
}

function buildCorsHeaders(req) {
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Requested-With",
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

function buildTargetUrl(incomingPath) {
  const normalized = incomingPath.startsWith("/") ? incomingPath.slice(1) : incomingPath;
  return new URL(normalized, targetBase);
}

http
  .createServer((clientReq, clientRes) => {
    if (clientReq.method === "OPTIONS") {
      clientRes.writeHead(204, buildCorsHeaders(clientReq));
      clientRes.end();
      return;
    }

    const upstream = buildTargetUrl(clientReq.url || "/");
    const headers = { ...clientReq.headers };
    delete headers.origin;
    delete headers.host;

    const options = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === "http:" ? 80 : 443),
      path: upstream.pathname + upstream.search,
      method: clientReq.method,
      headers,
      agent: upstream.protocol === "https:" ? httpsAgent : undefined
    };

    const client = getHttpClient(upstream.protocol);
    const proxyReq = client.request(options, (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders["access-control-allow-origin"];
      delete responseHeaders["access-control-allow-methods"];
      delete responseHeaders["access-control-allow-headers"];
      delete responseHeaders["access-control-allow-credentials"];

      clientRes.writeHead(proxyRes.statusCode || 500, {
        ...responseHeaders,
        ...buildCorsHeaders(clientReq)
      });
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on("error", (err) => {
      console.error("LLM proxy error:", err.message);
      clientRes.writeHead(502, {
        "Content-Type": "text/plain",
        ...buildCorsHeaders(clientReq)
      });
      clientRes.end(`LLM proxy error: ${err.message}`);
    });

    clientReq.pipe(proxyReq, { end: true });
  })
  .listen(PORT, () => {
    console.log(`Custom LLM proxy listening on http://localhost:${PORT} -> ${TARGET}`);
    console.log(`Allowed origins: ${allowAnyOrigin ? "*" : Array.from(allowedOrigins).join(", ")}`);
    if (INSECURE_TLS) console.log("Warning: LLM_PROXY_INSECURE_TLS=true (self-signed TLS accepted)");
  });
