#!/usr/bin/env node
/**
 * 在禅道中创建缺陷（REST API v1：POST /products/{id}/bugs）
 *
 * 说明：禅道「项目」与「产品」不同；列表缺陷常用项目维度，创建缺陷 API 使用产品 ID。
 * 本脚本支持用 --product-name / --project-name 自动解析产品（项目详情中可能含 product 字段）。
 *
 * 用法：
 *   node zentao-bug-create.mjs --product-name "应急" --title "xxx" --steps-file ./bug-body.txt
 *   node zentao-bug-create.mjs --project-name "星联应急叫应平台" --title "xxx" --steps-file ./steps.md
 *   node zentao-bug-create.mjs --product-id 12 --title "xxx" --steps "纯文本步骤…"
 *
 * 可选：--severity 3 --pri 3 --type others --opened-build trunk（可多次）
 * 可选：--execution <执行/迭代ID>  --dry-run 只打印请求体不提交
 *
 * 配置：同 zentao-bugs-summary.mjs（mcp.json 中 zentao.env 或环境变量）
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 读取配置（与 zentao-bugs-summary.mjs 一致）────────────────
const MCP_JSON_CANDIDATES = [
  join(__dirname, "..", "..", ".cursor", "mcp.json"),
  join(process.env.USERPROFILE || process.env.HOME || "", ".cursor", "mcp.json"),
];

let ZENTAO_URL, ZENTAO_ACCOUNT, ZENTAO_PASSWORD;
for (const p of MCP_JSON_CANDIDATES) {
  try {
    const cfg = JSON.parse(readFileSync(resolve(p), "utf8"));
    const env = cfg.mcpServers?.zentao?.env;
    if (env?.ZENTAO_URL) {
      ZENTAO_URL = env.ZENTAO_URL;
      ZENTAO_ACCOUNT = env.ZENTAO_ACCOUNT;
      ZENTAO_PASSWORD = env.ZENTAO_PASSWORD;
      break;
    }
  } catch { /* */ }
}
if (!ZENTAO_URL) {
  ZENTAO_URL = process.env.ZENTAO_URL;
  ZENTAO_ACCOUNT = process.env.ZENTAO_ACCOUNT;
  ZENTAO_PASSWORD = process.env.ZENTAO_PASSWORD;
}
if (!ZENTAO_URL || !ZENTAO_ACCOUNT || !ZENTAO_PASSWORD) {
  console.error("缺少禅道配置。请配置 mcp.json 的 zentao.env 或环境变量 ZENTAO_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD。");
  process.exit(1);
}

function joinUrl(base, path) {
  return base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
}

let token = null;

async function login() {
  const res = await fetch(joinUrl(ZENTAO_URL, "/api.php/v1/tokens"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: ZENTAO_ACCOUNT, password: ZENTAO_PASSWORD }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`登录失败 (${res.status}): ${text.slice(0, 400)}`);
  token = JSON.parse(text).token;
  if (!token) throw new Error("登录响应中无 token");
}

async function api(path, { method = "GET", query, body } = {}) {
  if (!token) await login();
  const u = new URL(joinUrl(ZENTAO_URL, path));
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) u.searchParams.set(k, String(v));
    }
  }
  const opts = {
    method,
    headers: { Token: token, "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  };
  let res = await fetch(u, opts);
  if (res.status === 401) {
    token = null;
    await login();
    opts.headers.Token = token;
    res = await fetch(u, opts);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${method} ${path} (${res.status}): ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

async function findProject(nameKey) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await api("/api.php/v1/projects", { query: { page, limit: 100 } });
    const list = data.projects ?? [];
    if (!list.length) break;
    all.push(...list);
    if (list.length < 100) break;
    page++;
    if (page > 50) break;
  }
  const hits = all.filter((p) => String(p.name || "").includes(nameKey));
  if (!hits.length) {
    console.error(`未找到名称包含「${nameKey}」的项目。`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`匹配到多个项目，使用第一个：`);
    hits.forEach((p) => console.error(`  ${p.id}  ${p.name}`));
  }
  return hits[0];
}

async function findProduct(nameKey) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await api("/api.php/v1/products", { query: { page, limit: 100 } });
    const list = data.products ?? [];
    if (!list.length) break;
    all.push(...list);
    if (list.length < 100) break;
    page++;
    if (page > 50) break;
  }
  const hits = all.filter((p) => String(p.name || "").includes(nameKey));
  if (!hits.length) {
    console.error(`未找到名称包含「${nameKey}」的产品。可用 --list-products 查看列表。`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`匹配到多个产品，使用第一个：`);
    hits.forEach((p) => console.error(`  ${p.id}  ${p.name}`));
  }
  return hits[0];
}

/** 从项目详情推断关联产品 ID（不同禅道版本字段可能不同） */
function pickProductIdFromProjectDetail(d) {
  if (!d || typeof d !== "object") return null;
  if (typeof d.product === "number") return d.product;
  if (d.product && typeof d.product.id === "number") return d.product.id;
  if (Array.isArray(d.products) && d.products.length) {
    const x = d.products[0];
    if (typeof x === "number") return x;
    if (x && typeof x.id === "number") return x.id;
  }
  if (d.linkedProducts && Array.isArray(d.linkedProducts) && d.linkedProducts.length) {
    const x = d.linkedProducts[0];
    if (typeof x === "number") return x;
    if (x && typeof x.id === "number") return x.id;
  }
  return null;
}

async function resolveProductId({ productId, productName, projectName }) {
  if (productId != null) {
    const id = Number(productId);
    if (!Number.isFinite(id)) throw new Error("--product-id 必须是数字");
    return { productId: id, hint: `产品 ID ${id}` };
  }
  if (productName) {
    const p = await findProduct(productName);
    return { productId: p.id, hint: `产品「${p.name}」(ID ${p.id})` };
  }
  if (projectName) {
    const proj = await findProject(projectName);
    const detail = await api(`/api.php/v1/projects/${proj.id}`);
    const pid = pickProductIdFromProjectDetail(detail);
    if (!pid) {
      console.error(
        `项目「${proj.name}」(ID ${proj.id}) 的详情中未能解析出产品 ID。\n请改用 --product-name <关键词> 或 --product-id <数字>（在禅道界面「产品」页可看到产品 ID）。`
      );
      process.exit(1);
    }
    return { productId: pid, hint: `由项目「${proj.name}」解析到产品 ID ${pid}` };
  }
  throw new Error("请指定 --product-id、--product-name 或 --project-name 之一");
}

function parseArgs(argv) {
  const args = { openedBuild: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--product-id" && argv[i + 1]) args.productId = argv[++i];
    else if (a === "--product-name" && argv[i + 1]) args.productName = argv[++i];
    else if (a === "--project-name" && argv[i + 1]) args.projectName = argv[++i];
    else if (a === "--title" && argv[i + 1]) args.title = argv[++i];
    else if (a === "--steps" && argv[i + 1]) args.steps = argv[++i];
    else if (a === "--steps-file" && argv[i + 1]) args.stepsFile = argv[++i];
    else if (a === "--severity" && argv[i + 1]) args.severity = Number(argv[++i]);
    else if (a === "--pri" && argv[i + 1]) args.pri = Number(argv[++i]);
    else if (a === "--type" && argv[i + 1]) args.type = argv[++i];
    else if (a === "--execution" && argv[i + 1]) args.execution = Number(argv[++i]);
    else if (a === "--opened-build" && argv[i + 1]) args.openedBuild.push(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--list-products") {
      args.listProducts = true;
      if (argv[i + 1] && !String(argv[i + 1]).startsWith("--")) args.listProductsKeyword = argv[++i];
    }
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function stepsToHtml(s) {
  const esc = (t) =>
    String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const lines = String(s).split(/\r?\n/);
  return lines.map((line) => `<p>${esc(line) || " "}</p>`).join("\r\n");
}

const args = parseArgs(process.argv);

if (args.help || process.argv.length <= 2) {
  console.log(`禅道创建缺陷

  node mcp/scripts/zentao-bug-create.mjs \\
    --project-name "星联应急叫应平台" \\
    --title "【求救群聊】…" \\
    --steps-file ./bug-steps.md

  或：--product-name "关键词" | --product-id <数字>

  --steps-file   缺陷描述全文（前置条件、步骤、实际、预期等）
  --steps        直接跟一段文字（换行用 \\n）
  --severity     默认 3  |  --pri 默认 3  |  --type 默认 others
  --opened-build 可多次，默认 trunk
  --execution    可选，迭代/执行 ID
  --dry-run      只打印 JSON，不创建
  --list-products [关键词]  列出产品 id 与名称，可选关键词过滤名称

禅道 API：POST /api.php/v1/products/{产品ID}/bugs
`);
  process.exit(args.help ? 0 : 1);
}

async function main() {
  if (args.listProducts) {
    await login();
    const kw = args.listProductsKeyword || "";
    let page = 1;
    const rows = [];
    for (;;) {
      const data = await api("/api.php/v1/products", { query: { page, limit: 100 } });
      const list = data.products ?? [];
      for (const p of list) {
        if (!kw || String(p.name).includes(kw)) rows.push({ id: p.id, name: p.name });
      }
      if (!list.length || list.length < 100) break;
      page++;
      if (page > 20) break;
    }
    console.log("id\tname");
    for (const r of rows) console.log(`${r.id}\t${r.name}`);
    console.error(`共 ${rows.length} 条`);
    return;
  }

  if (!args.title) {
    console.error("请指定 --title");
    process.exit(1);
  }

  let steps = args.steps;
  if (args.stepsFile) {
    steps = readFileSync(resolve(args.stepsFile), "utf8");
  }
  if (steps == null || String(steps).trim() === "") {
    console.error("请通过 --steps 或 --steps-file 提供缺陷描述（重现步骤等）");
    process.exit(1);
  }

  const severity = Number.isFinite(args.severity) ? args.severity : 3;
  const pri = Number.isFinite(args.pri) ? args.pri : 3;
  const type = args.type || "others";
  const openedBuild = args.openedBuild.length ? args.openedBuild : ["trunk"];

  await login();

  const { productId, hint } = await resolveProductId(args);
  console.error(hint);

  const body = {
    title: args.title,
    severity,
    pri,
    type,
    steps: stepsToHtml(steps.trim()),
    openedBuild,
  };
  if (Number.isFinite(args.execution)) body.execution = args.execution;

  if (args.dryRun) {
    console.log(JSON.stringify({ path: `/api.php/v1/products/${productId}/bugs`, body }, null, 2));
    return;
  }

  const created = await api(`/api.php/v1/products/${productId}/bugs`, {
    method: "POST",
    body,
  });

  const bugId = created.id ?? created.bug?.id;
  console.log(JSON.stringify(created, null, 2));
  if (bugId) {
    const base = ZENTAO_URL.replace(/\/$/, "");
    console.error(`已创建缺陷 ID: ${bugId}（请在禅道界面核对产品与项目归属）`);
    console.error(`可尝试访问: ${base}/bug-view-${bugId}.html（路径因禅道路由配置可能略有不同）`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
