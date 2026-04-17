#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) args.input = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.input) {
  console.error("请指定 --input <json文件路径>");
  process.exit(1);
}

const input = resolve(args.input);
const raw = JSON.parse(readFileSync(input, "utf8"));
// 禅道部分流程会将 confirmed 视为待处理激活态，这里一并纳入。
const ACTIVE_LIKE_STATUS = new Set(["active", "confirmed"]);
const bugs = (raw.bugs || []).filter((b) => ACTIVE_LIKE_STATUS.has(b.status));
const meta = { ...(raw.meta || {}), filter: "status in (active, confirmed)" };

const outputDir = dirname(input);
const base = basename(input, extname(input));
const activeJson = join(outputDir, `${base}-active.json`);
const activeMd = join(outputDir, `${base}-active.md`);

writeFileSync(
  activeJson,
  JSON.stringify({ meta, total: bugs.length, bugs }, null, 2),
  "utf8"
);

const priMap = { 1: "一级", 2: "二级", 3: "三级", 4: "四级" };
const priCount = {};
for (const b of bugs) {
  const p = Number(b.pri);
  priCount[p] = (priCount[p] || 0) + 1;
}

const lines = [];
lines.push(`# ${meta.projectName || "项目"} — 仅激活缺陷汇总`);
lines.push("");
lines.push(`> 生成时间：${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
lines.push("");
lines.push("## 总览统计");
lines.push("");
lines.push(`- **缺陷总数**：${bugs.length} 个`);
const priParts = [1, 2, 3, 4]
  .filter((p) => priCount[p])
  .map((p) => `**${priMap[p]}**：${priCount[p]} 个`);
lines.push(`- **按优先级**：${priParts.join("；") || "无"}`);
lines.push("");
lines.push("## 缺陷列表（仅激活）");
lines.push("");
lines.push("| ID | 创建者 | 优先级 | 标题 |");
lines.push("| --- | --- | --- | --- |");

for (const b of bugs) {
  const p = priMap[Number(b.pri)] || `优先级${b.pri}`;
  const who = String(b.openedByName || b.openedBy || "—").replace(/\|/g, "\\|");
  const title = String(b.title || "—")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|");
  lines.push(`| ${b.id ?? "—"} | ${who} | ${p} | ${title} |`);
}

writeFileSync(activeMd, lines.join("\n"), "utf8");

console.log(`ACTIVE_TOTAL=${bugs.length}`);
console.log(`JSON=${activeJson}`);
console.log(`MD=${activeMd}`);
