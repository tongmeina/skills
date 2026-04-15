#!/usr/bin/env node
/**
 * 从缺陷截图（聊天/文档/禅道导出等）提取结构化信息，便于录入禅道或归档。
 *
 * 依赖：任意 OpenAI 兼容的多模态 Chat Completions 接口（需可访问网络）。
 *
 * 用法：
 *   node defect-image-extract.mjs --image ./bug.png
 *   node defect-image-extract.mjs --image ./bug.png --out ./extracted.json
 *   node defect-image-extract.mjs --image ./bug.png --md
 *
 * 环境变量（与多数 OpenAI 兼容网关一致）：
 *   OPENAI_API_KEY      必填（除非网关不要求）
 *   OPENAI_BASE_URL     可选，默认 https://api.openai.com/v1
 *   OPENAI_VISION_MODEL 可选，默认 gpt-4o-mini
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXTRACTION_SYSTEM = `你是测试领域的文档结构化助手。用户会提供一张或多张与软件缺陷相关的截图（可能含：Bug 标题、前置条件、复现步骤、实际/预期结果、缺陷分析表、优化建议、严重等级等）。
你必须只输出一个合法的 JSON 对象，不要 Markdown 代码围栏，不要前后解释文字。
JSON 必须符合下列 TypeScript 语义（字段缺失用 null 或空数组，不要编造截图中不存在的内容；不确定时在 notes 中说明）：

{
  "documentType": "bug_report" | "defect_analysis" | "mixed" | "unknown",
  "bugReport": {
    "title": string | null,
    "prerequisites": string[],
    "reproductionSteps": string[],
    "actualResults": string[],
    "expectedResults": string[]
  } | null,
  "analysisReport": {
    "analysisTable": { "defectDimension": string, "problemDescription": string, "optimizationSolution": string }[],
    "optimizationSuggestions": string[],
    "severity": { "level": string | null, "summary": string | null }
  } | null,
  "confidence": "high" | "medium" | "low",
  "notes": string
}

规则：
- 列表项保持截图中的顺序；原文为中文则保留中文。
- 若同一张图同时有「缺陷描述」与「缺陷分析」两类版式，documentType 用 mixed，两部分都填。
- 表格三列分别映射到 analysisTable 的三个字段。
- 严重等级如 P0/P1/P2 或「严重等级」后的文字写入 severity.level 与 severity.summary。`;

function parseArgs(argv) {
  const args = { images: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--image" && argv[i + 1]) args.images.push(argv[++i]);
    else if (a === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (a === "--md") args.md = true;
    else if (a === "--model" && argv[i + 1]) args.model = argv[++i];
    else if (a === "--base-url" && argv[i + 1]) args.baseUrl = argv[++i];
  }
  return args;
}

function mimeForPath(p) {
  const lower = p.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

function stripJsonFence(text) {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m;
  const m = t.match(fence);
  if (m) t = m[1].trim();
  return t;
}

function renderMarkdown(data) {
  const lines = [];
  lines.push(`# 缺陷提取结果`);
  lines.push("");
  lines.push(`- **文档类型**：${data.documentType ?? "unknown"}`);
  lines.push(`- **置信度**：${data.confidence ?? "-"}`);
  if (data.notes) {
    lines.push(`- **备注**：${data.notes}`);
  }
  lines.push("");

  const br = data.bugReport;
  if (br && (br.title || (br.prerequisites?.length ?? 0) > 0)) {
    lines.push(`## Bug 标题`);
    lines.push("");
    lines.push(br.title || "（未识别）");
    lines.push("");
    lines.push(`## 缺陷描述`);
    lines.push("");
    if (br.prerequisites?.length) {
      lines.push(`**前置条件**`);
      br.prerequisites.forEach((x) => lines.push(`- ${x}`));
      lines.push("");
    }
    if (br.reproductionSteps?.length) {
      lines.push(`**复现步骤**`);
      br.reproductionSteps.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
      lines.push("");
    }
    if (br.actualResults?.length) {
      lines.push(`**实际结果**`);
      br.actualResults.forEach((x) => lines.push(`- ${x}`));
      lines.push("");
    }
    if (br.expectedResults?.length) {
      lines.push(`**预期结果**`);
      br.expectedResults.forEach((x) => lines.push(`- ${x}`));
      lines.push("");
    }
  }

  const ar = data.analysisReport;
  if (
    ar &&
    ((ar.analysisTable?.length ?? 0) > 0 ||
      (ar.optimizationSuggestions?.length ?? 0) > 0 ||
      ar.severity)
  ) {
    lines.push(`## 缺陷分析`);
    lines.push("");
    if (ar.analysisTable?.length) {
      lines.push(`| 缺陷维度 | 问题描述 | 优化方案 |`);
      lines.push(`| --- | --- | --- |`);
      for (const row of ar.analysisTable) {
        const a = (row.defectDimension || "").replace(/\|/g, "\\|");
        const b = (row.problemDescription || "").replace(/\|/g, "\\|");
        const c = (row.optimizationSolution || "").replace(/\|/g, "\\|");
        lines.push(`| ${a} | ${b} | ${c} |`);
      }
      lines.push("");
    }
    if (ar.optimizationSuggestions?.length) {
      lines.push(`## 优化建议`);
      lines.push("");
      ar.optimizationSuggestions.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
      lines.push("");
    }
    if (ar.severity && (ar.severity.level || ar.severity.summary)) {
      lines.push(`## 严重等级`);
      lines.push("");
      if (ar.severity.level) lines.push(`**等级**：${ar.severity.level}`);
      if (ar.severity.summary) lines.push(`${ar.severity.summary}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

async function callVision({ baseUrl, apiKey, model, imagePaths }) {
  const content = [{ type: "text", text: "请根据截图提取结构化缺陷信息。" }];
  for (const p of imagePaths) {
    const abs = resolve(p);
    const buf = readFileSync(abs);
    const b64 = buf.toString("base64");
    const mime = mimeForPath(abs);
    if (mime === "application/octet-stream") {
      throw new Error(`不支持的图片格式：${basename(abs)}（请使用 png/jpg/webp/gif）`);
    }
    content.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}` },
    });
  }

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM },
      { role: "user", content },
    ],
  };

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`视觉接口错误 HTTP ${res.status}: ${rawText.slice(0, 800)}`);
  }

  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`接口返回非 JSON：${rawText.slice(0, 400)}`);
  }

  const msg = json.choices?.[0]?.message?.content;
  if (!msg || typeof msg !== "string") {
    throw new Error(`无法解析模型输出：${JSON.stringify(json).slice(0, 500)}`);
  }

  const cleaned = stripJsonFence(msg);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`模型 JSON 无效：${e.message}\n---\n${cleaned.slice(0, 1200)}`);
  }
}

const args = parseArgs(process.argv);

if (args.help || process.argv.length <= 2) {
  console.log(`缺陷截图结构化提取

用法:
  node mcp/scripts/defect-image-extract.mjs --image <路径> [--image <路径2>] [--out <json路径>] [--md]

选项:
  --image    图片路径，可重复传入多张（会一次发给模型）
  --out      输出 JSON 路径；默认 mcp/output/defect-extract-<时间戳>.json
  --md       同时写出同名 .md（当指定 --out 时与 json 同目录同基名）
  --model    覆盖环境变量 OPENAI_VISION_MODEL
  --base-url 覆盖环境变量 OPENAI_BASE_URL

环境:
  OPENAI_API_KEY       多数网关必填
  OPENAI_BASE_URL      默认 https://api.openai.com/v1
  OPENAI_VISION_MODEL  默认 gpt-4o-mini
`);
  process.exit(args.help ? 0 : 1);
}

if (!args.images.length) {
  console.error("请至少指定一张图片：--image <路径>");
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY || "";
const baseUrl = args.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const model = args.model || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

if (!apiKey && !process.env.OPENAI_API_KEY_OPTIONAL) {
  console.error(
    "缺少 OPENAI_API_KEY。若使用本地网关且无需密钥，可设置 OPENAI_API_KEY=dummy 或 OPENAI_API_KEY_OPTIONAL=1。"
  );
  process.exit(1);
}

const defaultOutDir = resolve(__dirname, "..", "output");
const stamp = `${Date.now()}`;
const defaultJson = resolve(defaultOutDir, `defect-extract-${stamp}.json`);

const outJson = args.out ? resolve(args.out) : defaultJson;

mkdirSync(dirname(outJson), { recursive: true });

try {
  const data = await callVision({
    baseUrl,
    apiKey: apiKey || undefined,
    model,
    imagePaths: args.images.map((p) => resolve(p)),
  });

  writeFileSync(outJson, JSON.stringify(data, null, 2), "utf8");
  console.log(`已写入 JSON：${outJson}`);

  if (args.md) {
    const mdPath = outJson.replace(/\.json$/i, "") + ".md";
    writeFileSync(mdPath, renderMarkdown(data), "utf8");
    console.log(`已写入 Markdown：${mdPath}`);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
