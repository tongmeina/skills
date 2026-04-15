import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const ZENTAO_URL = process.env.ZENTAO_URL;
const ZENTAO_ACCOUNT = process.env.ZENTAO_ACCOUNT;
const ZENTAO_PASSWORD = process.env.ZENTAO_PASSWORD;

if (!ZENTAO_URL) throw new Error("Missing env: ZENTAO_URL");
if (!ZENTAO_ACCOUNT) throw new Error("Missing env: ZENTAO_ACCOUNT");
if (!ZENTAO_PASSWORD) throw new Error("Missing env: ZENTAO_PASSWORD");

function joinUrl(base, path) {
  const b = base.replace(/\/$/, "");
  const p = path.replace(/^\//, "");
  return `${b}/${p}`;
}

let cachedToken = null;

async function login() {
  const url = joinUrl(ZENTAO_URL, "/api.php/v1/tokens");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: ZENTAO_ACCOUNT, password: ZENTAO_PASSWORD }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ZenTao login failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text);
  cachedToken = json.token;
  if (!cachedToken) {
    throw new Error(`ZenTao login response missing token: ${text}`);
  }
  return cachedToken;
}

async function getToken() {
  if (cachedToken) return cachedToken;
  return login();
}

async function zentaoApi(path, { method = "GET", query, body } = {}) {
  const token = await getToken();
  const urlObj = new URL(joinUrl(ZENTAO_URL, path));

  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) urlObj.searchParams.set(k, String(v));
    }
  }

  let res = await fetch(urlObj.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      "Token": token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Token 过期时自动重新登录并重试一次
  if (res.status === 401) {
    cachedToken = null;
    const newToken = await login();
    res = await fetch(urlObj.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        "Token": newToken,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`ZenTao API ${res.status}: ${text}`);
  }
  return json;
}

const server = new McpServer({ name: "mcp-zentao", version: "0.1.0" });

// 1) 获取项目列表（验证最常用、也最不容易受权限影响）
server.tool(
  "zentao.projects",
  "获取项目列表（分页）",
  async ({ page = 1, limit = 50 } = {}) => {
    const data = await zentaoApi("/api.php/v1/projects", { query: { page, limit } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// 2) 通用请求：你可以临时调用任何 endpoint
server.tool(
  "zentao.request",
  "通用请求（调试任意 REST API）",
  async ({ path, method = "GET", query, body } = {}) => {
    if (!path) throw new Error("path is required, e.g. /api.php/v1/bugs");
    const data = await zentaoApi(path, { method, query, body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);