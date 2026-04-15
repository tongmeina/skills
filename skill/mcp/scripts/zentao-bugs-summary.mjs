#!/usr/bin/env node
/**
 * 禅道项目缺陷汇总：拉取 → 分组 → 输出 JSON + Markdown
 *
 * 用法：
 *   node zentao-bugs-summary.mjs --project-id 1216
 *   node zentao-bugs-summary.mjs --project-name "星联应急叫应平台"
 *   node zentao-bugs-summary.mjs --project-name "星联" --creator "童美娜"
 *
 * 可选参数：
 *   --project-id <id>       直接指定项目 ID
 *   --project-name <关键词>  按名称模糊匹配项目
 *   --creator <姓名>         只保留指定创建者的缺陷（中文姓名，可多次指定）
 *   --out-dir <目录>         输出目录，默认 mcp/output
 *   --no-closed              排除已关闭的缺陷
 *
 * 配置：读取 mcp.json 中 zentao 的 ZENTAO_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 项目名称 + bugs + 年月日（YYYYMMDD），去掉 Windows 非法文件名字符 */
function buildExportBaseName(projectName) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const safe = String(projectName || "项目")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${safe}-bugs-${ymd}`;
}

// ── 参数解析 ────────────────────────────────────────
function parseArgs(argv) {
  const args = { creators: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-id" && argv[i + 1]) args.projectId = Number(argv[++i]);
    else if (a === "--project-name" && argv[i + 1]) args.projectName = argv[++i];
    else if (a === "--creator" && argv[i + 1]) args.creators.push(argv[++i]);
    else if (a === "--out-dir" && argv[i + 1]) args.outDir = argv[++i];
    else if (a === "--no-closed") args.noClosed = true;
    else if (a === "--mcp-json" && argv[i + 1]) args.mcpJson = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);

// ── 读取配置 ────────────────────────────────────────
const MCP_JSON_CANDIDATES = [
  args.mcpJson,
  join(__dirname, "..", "..", ".cursor", "mcp.json"),
  join(process.env.USERPROFILE || process.env.HOME || "", ".cursor", "mcp.json"),
].filter(Boolean);

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
  } catch { /* try next */ }
}
if (!ZENTAO_URL) {
  ZENTAO_URL = process.env.ZENTAO_URL;
  ZENTAO_ACCOUNT = process.env.ZENTAO_ACCOUNT;
  ZENTAO_PASSWORD = process.env.ZENTAO_PASSWORD;
}
if (!ZENTAO_URL || !ZENTAO_ACCOUNT || !ZENTAO_PASSWORD) {
  console.error("缺少禅道配置。请确保 mcp.json 或环境变量中有 ZENTAO_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD。");
  process.exit(1);
}

// ── HTTP 工具 ───────────────────────────────────────
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
  if (!res.ok) throw new Error(`登录失败 (${res.status}): ${text}`);
  token = JSON.parse(text).token;
  if (!token) throw new Error("登录响应中无 token");
}

async function api(path, query = {}) {
  if (!token) await login();
  const u = new URL(joinUrl(ZENTAO_URL, path));
  for (const [k, v] of Object.entries(query)) {
    if (v != null) u.searchParams.set(k, String(v));
  }
  let res = await fetch(u, { headers: { Token: token, "Content-Type": "application/json" } });
  if (res.status === 401) {
    token = null;
    await login();
    res = await fetch(u, { headers: { Token: token, "Content-Type": "application/json" } });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${path} (${res.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// ── 业务逻辑 ───────────────────────────────────────
async function findProject(nameKey) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await api("/api.php/v1/projects", { page, limit: 100 });
    const list = data.projects ?? [];
    if (!list.length) break;
    all.push(...list);
    if (list.length < 100) break;
    page++;
    if (page > 50) break;
  }
  const hits = all.filter((p) => String(p.name || "").includes(nameKey));
  if (!hits.length) {
    console.error(`未找到名称包含「${nameKey}」的项目。可用项目：`);
    all.slice(0, 20).forEach((p) => console.error(`  ${p.id}  ${p.name}`));
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`匹配到多个项目，使用第一个：`);
    hits.forEach((p) => console.error(`  ${p.id}  ${p.name}`));
  }
  return hits[0];
}

async function fetchAllBugs(projectId) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await api(`/api.php/v1/projects/${projectId}/bugs`, { page, limit: 100 });
    const list = data.bugs ?? [];
    const total = data.total ?? list.length;
    all.push(...list);
    if (all.length >= total || list.length < 100) break;
    page++;
    if (page > 200) break;
  }
  return all;
}

async function resolveUserNames(accounts) {
  const map = {};
  try {
    const data = await api("/api.php/v1/users", { page: 1, limit: 500 });
    for (const u of data.users ?? []) {
      if (u.account && u.realname) map[u.account] = u.realname;
    }
  } catch { /* 降级：账号即显示名 */ }
  for (const acc of accounts) {
    if (!map[acc]) map[acc] = acc;
  }
  return map;
}

// ── 中文映射 ───────────────────────────────────────
const STATUS_CN = { active: "激活", resolved: "已解决", closed: "已关闭", postponed: "已延期" };
const STATUS_ORDER = ["active", "resolved", "postponed", "closed"];
function priCn(n) { return { 1: "一级", 2: "二级", 3: "三级", 4: "四级" }[n] || `优先级${n}`; }
function statusCn(s) { return STATUS_CN[s] || s; }
function escape(s) { return s == null ? "—" : String(s).replace(/\r?\n/g, " ").replace(/\|/g, "\\|"); }
function priRank(p) { const n = Number(p); return Number.isFinite(n) ? n : 99; }

// ── 生成 Markdown ──────────────────────────────────
function generateMd(bugs, meta, nameMap) {
  const L = [];
  L.push(`# ${meta.projectName} — 缺陷汇总`);
  L.push("", `> 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")}`, "");

  // 总览
  const priCounts = {};
  for (const b of bugs) { const p = Number(b.pri); priCounts[p] = (priCounts[p] || 0) + 1; }
  L.push("## 总览统计", "");
  L.push(`- **缺陷总数**：${bugs.length} 个`);
  const priParts = [1, 2, 3, 4].filter((p) => priCounts[p]).map((p) => `**${priCn(p)}**：${priCounts[p]} 个`);
  L.push(`- **按优先级**：${priParts.join("；")}`, "");

  // 按创建者分组
  const byCreator = {};
  for (const b of bugs) {
    const acc = b.openedBy || "未知";
    (byCreator[acc] ??= []).push(b);
  }
  const creators = Object.keys(byCreator).sort((a, b) =>
    (nameMap[a] || a).localeCompare(nameMap[b] || b, "zh-CN")
  );

  L.push("## 按创建者 · 状态 · 优先级", "");

  for (const acc of creators) {
    const list = byCreator[acc];
    const cn = nameMap[acc] || acc;
    L.push(`### 创建者：${cn}`);
    const cPri = {};
    for (const b of list) { const p = Number(b.pri); cPri[p] = (cPri[p] || 0) + 1; }
    const cp = [1, 2, 3, 4].filter((p) => cPri[p]).map((p) => `**${priCn(p)}**：${cPri[p]} 个`);
    L.push(`- **缺陷数**：${list.length} 个（${cp.join("；")}）`, "");

    const bySt = {};
    for (const b of list) (bySt[b.status] ??= []).push(b);

    const stKeys = Object.keys(bySt).sort((a, b) => {
      const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    for (const st of stKeys) {
      L.push(`#### 状态：${statusCn(st)}`, "");
      const byPri = {};
      for (const b of bySt[st]) { const p = Number(b.pri); (byPri[p] ??= []).push(b); }
      const priKeys = Object.keys(byPri).map(Number).sort((a, b) => a - b);

      for (const pk of priKeys) {
        L.push(`##### ${priCn(pk)}`, "");
        L.push("| 创建者 | 状态 | 优先级 | 标题 |");
        L.push("| --- | --- | --- | --- |");
        for (const b of byPri[pk]) {
          L.push(`| ${cn} | ${statusCn(b.status)} | ${priCn(pk)} | ${escape(b.title)} |`);
        }
        L.push("");
      }
    }
    L.push("---", "");
  }
  return L.join("\n");
}

// ── 主流程 ─────────────────────────────────────────
async function main() {
  if (!args.projectId && !args.projectName) {
    console.error("请指定 --project-id <id> 或 --project-name <关键词>");
    process.exit(1);
  }

  await login();

  let projectId = args.projectId;
  let projectName = "";
  if (!projectId) {
    const proj = await findProject(args.projectName);
    projectId = proj.id;
    projectName = proj.name;
    console.error(`匹配项目：${projectName} (ID ${projectId})`);
  } else {
    try {
      const proj = await api(`/api.php/v1/projects/${projectId}`);
      projectName = proj.name || `项目${projectId}`;
    } catch {
      projectName = `项目${projectId}`;
    }
  }

  let bugs = await fetchAllBugs(projectId);
  console.error(`拉取缺陷：${bugs.length} 条`);

  // 获取账号 → 中文名映射
  const accounts = [...new Set(bugs.map((b) => b.openedBy).filter(Boolean))];
  const nameMap = await resolveUserNames(accounts);

  // 按创建者筛选
  if (args.creators.length) {
    const accSet = new Set();
    for (const [acc, name] of Object.entries(nameMap)) {
      if (args.creators.some((c) => name.includes(c) || acc.includes(c))) accSet.add(acc);
    }
    bugs = bugs.filter((b) => accSet.has(b.openedBy));
    console.error(`筛选创建者 [${args.creators.join(", ")}] 后：${bugs.length} 条`);
  }

  if (args.noClosed) {
    bugs = bugs.filter((b) => b.status !== "closed");
    console.error(`排除已关闭后：${bugs.length} 条`);
  }

  const meta = { projectId, projectName };

  // 输出目录
  const outDir = resolve(args.outDir || join(__dirname, "..", "output"));
  mkdirSync(outDir, { recursive: true });

  // 写 JSON
  const slim = (b) => ({
    id: b.id, title: b.title, status: b.status, pri: b.pri,
    severity: b.severity, openedBy: b.openedBy,
    openedByName: nameMap[b.openedBy] || b.openedBy,
    openedDate: b.openedDate, assignedTo: b.assignedTo, type: b.type,
  });
  const exportBase = buildExportBaseName(projectName);
  const jsonFile = join(outDir, `${exportBase}.json`);
  writeFileSync(jsonFile, JSON.stringify({ meta, total: bugs.length, bugs: bugs.map(slim) }, null, 2), "utf8");

  // 写 Markdown
  const md = generateMd(bugs, meta, nameMap);
  const mdFile = join(outDir, `${exportBase}.md`);
  writeFileSync(mdFile, md, "utf8");

  console.log(`项目: ${projectName} (ID ${projectId})`);
  console.log(`缺陷: ${bugs.length} 条`);
  console.log(`JSON: ${jsonFile}`);
  console.log(`MD:   ${mdFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
