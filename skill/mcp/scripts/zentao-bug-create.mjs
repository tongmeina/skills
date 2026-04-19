#!/usr/bin/env node
/**
 * 在禅道中创建缺陷（REST API v1：POST /products/{id}/bugs）
 *
 * 说明：创建缺陷的 URL 为 POST /products/{id}/bugs（产品 ID 必填）；请求体可带 project 以关联「所属项目」。
 * 仅 --project-name 时：先读项目详情中的产品字段；若无，则调用 GET /projects/{id}/bugs（与 zentao-bugs-summary 一致）从已有缺陷推断 product。
 * 仍无法解析时再使用 --product-id。
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
import { readFileSync, existsSync } from "fs";
import { basename, dirname, join, resolve } from "path";
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

/** 从缺陷对象解析所属产品 ID（与 zentao-bugs-summary 拉取的 bugs 结构一致） */
function pickProductIdFromBug(b) {
  if (!b || typeof b !== "object") return null;
  if (typeof b.product === "number") return b.product;
  if (b.product && typeof b.product === "object" && typeof b.product.id === "number") return b.product.id;
  if (typeof b.productID === "number") return b.productID;
  if (typeof b.productId === "number") return b.productId;
  return null;
}

/**
 * 方案一：与「按项目拉缺陷」同源接口 GET /api.php/v1/projects/{id}/bugs，
 * 从首条（或前列）缺陷上的 product 字段推断创建新缺陷所需的产品 ID。
 */
async function inferProductIdFromProjectBugs(projectId) {
  const data = await api(`/api.php/v1/projects/${projectId}/bugs`, { query: { page: 1, limit: 100 } });
  const list = data.bugs ?? [];
  for (const b of list) {
    const pid = pickProductIdFromBug(b);
    if (pid != null) return pid;
  }
  return null;
}

/**
 * 解析创建缺陷所需的产品 ID，以及可选的「所属项目」（写入请求体 project 字段）。
 * 说明：禅道 API 路径必须是 POST /products/{id}/bugs，故「产品」在接口层不可省略；
 * 「项目」通过 body.project 关联，满足「缺陷挂到项目」的展示与统计。
 */
async function resolveCreateContext(args) {
  const { productId, productName, projectName, projectId: rawProjectId } = args;

  let projectForBody = null;

  if (rawProjectId != null) {
    const pid = Number(rawProjectId);
    if (!Number.isFinite(pid)) throw new Error("--project-id 必须是数字");
    projectForBody = { id: pid, name: `(ID ${pid})` };
  }

  if (productId != null) {
    const id = Number(productId);
    if (!Number.isFinite(id)) throw new Error("--product-id 必须是数字");
    if (projectName && !projectForBody) {
      const proj = await findProject(projectName);
      projectForBody = proj;
    }
    const hint =
      projectForBody && projectForBody.name
        ? `产品 ID ${id}，关联项目「${projectForBody.name}」(ID ${projectForBody.id})`
        : `产品 ID ${id}`;
    return { productId: id, hint, projectForBody };
  }

  if (productName) {
    const p = await findProduct(productName);
    if (projectName && !projectForBody) {
      const proj = await findProject(projectName);
      projectForBody = proj;
    }
    const hint =
      projectForBody && projectForBody.name
        ? `产品「${p.name}」(ID ${p.id})，关联项目「${projectForBody.name}」(ID ${projectForBody.id})`
        : `产品「${p.name}」(ID ${p.id})`;
    return { productId: p.id, hint, projectForBody };
  }

  if (projectName) {
    const proj = await findProject(projectName);
    const detail = await api(`/api.php/v1/projects/${proj.id}`);
    let inferredProductId = pickProductIdFromProjectDetail(detail);
    let productSource = inferredProductId ? "detail" : null;
    if (!inferredProductId) {
      inferredProductId = await inferProductIdFromProjectBugs(proj.id);
      productSource = inferredProductId ? "bugs" : null;
    }
    if (!inferredProductId) {
      console.error(
        `项目「${proj.name}」(ID ${proj.id}) 无法解析产品 ID：\n` +
          `  · 项目详情中无产品字段，且\n` +
          `  · GET /projects/${proj.id}/bugs 无缺陷记录，或缺陷对象上无 product 字段。\n\n` +
          `请先在该项目下至少有一条历史缺陷（与 zentao-bugs-summary 能拉到数据同源），\n` +
          `或使用「--product-id <数字>」手动指定产品。\n`
      );
      process.exit(1);
    }
    const hint =
      productSource === "bugs"
        ? `由项目「${proj.name}」下已有缺陷推断产品 ID ${inferredProductId}（GET /projects/{id}/bugs），并关联该项目`
        : `由项目「${proj.name}」详情解析到产品 ID ${inferredProductId}，并关联该项目`;
    return {
      productId: inferredProductId,
      hint,
      projectForBody: proj,
    };
  }

  if (rawProjectId != null && productId == null && productName == null && !projectName) {
    const pid = Number(rawProjectId);
    if (!Number.isFinite(pid)) throw new Error("--project-id 必须是数字");
    const inferredProductId = await inferProductIdFromProjectBugs(pid);
    if (!inferredProductId) {
      console.error(
        `项目 ID ${pid} 下无法从已有缺陷推断产品 ID（GET /projects/${pid}/bugs 无记录或无 product 字段）。请使用 --product-id。\n`
      );
      process.exit(1);
    }
    return {
      productId: inferredProductId,
      hint: `由项目 ID ${pid} 下已有缺陷推断产品 ID ${inferredProductId}，并关联该项目`,
      projectForBody: { id: pid, name: `(ID ${pid})` },
    };
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
    else if (a === "--project-id" && argv[i + 1]) args.projectId = argv[++i];
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
    else if (a === "--attach" && argv[i + 1]) {
      if (!args.attach) args.attach = [];
      args.attach.push(argv[++i]);
    }
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

/**
 * 将纯文本/Markdown 简述转为禅道富文本可用的 HTML。
 * - 连续空行合并，不再为每行空行生成 `<p> </p>`（避免禅道里出现大块异常空白）。
 * - 以 `1、` `2、` 开头的连续行转为 `<ol><li>…</li></ol>`，保留「有序实际结果 / 预期」的编号。
 */
function stepsToHtml(s) {
  const esc = (t) =>
    String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const raw = String(s)
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trimEnd());
  const lines = [];
  for (const L of raw) {
    if (L === "" && lines.length && lines[lines.length - 1] === "") continue;
    lines.push(L);
  }
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const parts = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "") {
      i++;
      continue;
    }
    if (/^\d+、/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^\d+、/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+、\s*/, ""));
        i++;
      }
      parts.push(`<ol>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`);
      continue;
    }
    parts.push(`<p>${esc(lines[i])}</p>`);
    i++;
  }
  return parts.join("\r\n");
}

/**
 * 禅道 v22+：POST /api.php/v2/files（multipart）。
 * 官方文档请求头为 **token**（小写）；v1 接口常用 **Token**（首字母大写），部分实例只认其一。
 * 若仍失败：可能是版本低于 22、未开放 v2、或需 token 拼在 URL 上。
 */
async function uploadBugAttachments(bugId, paths) {
  if (!paths?.length || !bugId) return;
  if (!token) await login();

  for (const p of paths) {
    const fp = resolve(p);
    if (!existsSync(fp)) {
      console.error(`附件跳过（文件不存在）: ${fp}`);
      continue;
    }
    const buf = readFileSync(fp);
    const blob = new Blob([buf]);
    const fileName = basename(fp);

    const baseUrl = joinUrl(ZENTAO_URL, "/api.php/v2/files");
    const attempts = [
      {
        name: "header token（v2 文档）",
        run: () => {
          const form = new FormData();
          form.append("file", blob, fileName);
          form.append("objectType", "bug");
          form.append("objectID", String(bugId));
          return fetch(baseUrl, {
            method: "POST",
            headers: { token },
            body: form,
          });
        },
      },
      {
        name: "header Token（v1 兼容）",
        run: () => {
          const form = new FormData();
          form.append("file", blob, fileName);
          form.append("objectType", "bug");
          form.append("objectID", String(bugId));
          return fetch(baseUrl, {
            method: "POST",
            headers: { Token: token },
            body: form,
          });
        },
      },
      {
        name: "URL ?token=（部分环境 multipart 需走查询串）",
        run: () => {
          const form = new FormData();
          form.append("file", blob, fileName);
          form.append("objectType", "bug");
          form.append("objectID", String(bugId));
          const u = new URL(baseUrl);
          u.searchParams.set("token", token);
          return fetch(u, { method: "POST", body: form });
        },
      },
    ];

    let lastStatus = 0;
    let lastBody = "";
    let ok = false;
    for (const a of attempts) {
      const res = await a.run();
      const text = await res.text();
      if (res.ok) {
        try {
          const j = JSON.parse(text);
          console.error(`已上传附件: ${fileName}（${a.name}）→ ${j.url || j.id || j.status || "ok"}`);
        } catch {
          console.error(`已上传附件: ${fileName}（${a.name}）`);
        }
        ok = true;
        break;
      }
      lastStatus = res.status;
      lastBody = text;
    }
    if (!ok) {
      console.error(
        `附件上传失败 (${fileName}): HTTP ${lastStatus} ${lastBody.slice(0, 500)}\n` +
          `提示：若 404/501 多为禅道版本未提供 v2/files；401/403 多为 token 与 v2 不兼容，请在禅道界面手动上传附件。`
      );
    }
  }
}

const args = parseArgs(process.argv);

if (args.help || process.argv.length <= 2) {
  console.log(`禅道创建缺陷

  node mcp/scripts/zentao-bug-create.mjs \\
    --project-name "星联应急叫应平台" \\
    --title "【求救群聊】…" \\
    --steps-file ./bug-steps.md

  或：--product-name "关键词" | --product-id <数字>

  --project-name  关键词，匹配项目名（可单独使用：自动解析/推断产品 ID 后创建）
  --project-id    数字，可与 --product-id 同用；单独使用时从该项目下已有缺陷推断产品 ID

  --steps-file   缺陷描述全文（前置条件、步骤、实际、预期等）
  --steps        直接跟一段文字（换行用 \\n）
  --severity     默认 3  |  --pri 默认 3  |  --type 默认 others
  --opened-build 可多次，默认 trunk
  --execution    可选，迭代/执行 ID
  --dry-run      只打印 JSON，不创建
  --list-products [关键词]  列出产品 id 与名称，可选关键词过滤名称
  --attach <路径>  可多次；创建成功后上传到该缺陷（需禅道 v22+，POST /api.php/v2/files）

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

  const { productId, hint, projectForBody } = await resolveCreateContext(args);
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
  if (projectForBody && Number.isFinite(Number(projectForBody.id))) {
    body.project = Number(projectForBody.id);
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ path: `/api.php/v1/products/${productId}/bugs`, body, attach: args.attach || [] }, null, 2));
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
    if (args.attach?.length) {
      await uploadBugAttachments(bugId, args.attach);
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
