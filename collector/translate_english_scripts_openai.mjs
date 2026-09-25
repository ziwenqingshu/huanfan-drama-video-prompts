import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAS_ROOT = 'Z:\\幻帧采集';
const WORK_ROOT = path.join(HERE, '.translation-work');
const MODEL = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-5.6-terra';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MAX_CHARS = 5000;
const CONCURRENCY = 2;
const RETRIES = 4;
const PROJECT_IDS = ['1009', '805', '2305', '2307', '1468', '1411'];
const RUN_USAGE = { input: 0, output: 0, total: 0 };

const TRANSLATE_INSTRUCTIONS = `你是专业的中英影视剧本译者。把输入的英文 Markdown 剧本完整翻译成自然、准确、适合短剧对白的简体中文。
严格要求：
1. 每个 block 必须翻译，不能总结、删减、补写、改序。
2. 保留 Markdown、场次标题、动作描述、对白结构、换行、标点、数字和括号；不要输出解释、前后缀或代码围栏。
3. 人物名、地名、机构名等使用术语表；术语表没有且不确定时保留英文原名，不臆造。
4. 只返回要求的 JSON，不要返回其它文字。`;

const PROOFREAD_INSTRUCTIONS = `你是影视剧本中文校对者。逐一对照 source 和 translation，只修正漏译、误译、错序、术语不一致和明显中文语病。
严格要求：
1. 不得总结、删减、补写或改变剧情；没有问题就原样返回 translation。
2. 保留每个 block 的 Markdown、换行、标点、数字、括号和对白结构。
3. 只返回要求的 JSON，不要返回其它文字。`;

const GLOSSARY_INSTRUCTIONS = `从这份英文影视剧本中提取需要全剧统一的专有名词：人物、地名、机构、称谓、关键道具或反复出现的专门词。只收录原文确实出现且值得统一的词，不要收录普通单词；不确定的中文译法保持英文原名。只返回要求的 JSON。`;

const GLOSSARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    terms: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['source', 'target', 'category'],
      },
    },
  },
  required: ['terms'],
};

const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer' },
          translation: { type: 'string' },
        },
        required: ['id', 'translation'],
      },
    },
  },
  required: ['blocks'],
};

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasArg(name) {
  return process.argv.includes(name);
}

async function projectDir(id) {
  const entries = await fs.readdir(NAS_ROOT, { withFileTypes: true });
  const suffix = new RegExp(`\\[${id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\]$`);
  const hit = entries.find((e) => e.isDirectory() && suffix.test(e.name));
  if (!hit) throw new Error(`找不到项目目录: [${id}]`);
  return path.join(NAS_ROOT, hit.name);
}

function splitLong(text, maxChars) {
  const pieces = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n', maxChars);
    if (cut < Math.floor(maxChars * 0.5)) cut = maxChars;
    else cut += 1;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function makeBlocks(source) {
  const tokens = source.split(/(\r?\n\s*\r?\n)/g);
  const segments = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const text = tokens[i] ?? '';
    const paragraphSep = tokens[i + 1] ?? '';
    if (!text) continue;
    const pieces = splitLong(text, MAX_CHARS);
    for (let j = 0; j < pieces.length; j += 1) {
      segments.push({
        id: segments.length,
        text: pieces[j],
        after: j === pieces.length - 1 ? paragraphSep : '',
      });
    }
  }
  if (!segments.length) throw new Error('英文剧本为空');
  return segments;
}

function makeChunks(segments) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const segment of segments) {
    if (current.length && chars + segment.text.length > MAX_CHARS) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += segment.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function schemaBody(schema, name) {
  return { type: 'json_schema', name, strict: true, schema };
}

function extractOutputText(data) {
  const out = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string') out.push(part.text);
    }
  }
  const text = out.join('');
  if (!text) throw new Error('API 返回为空');
  return text;
}

async function callModel(instructions, input, schema, schemaName) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('未设置 OPENAI_API_KEY；请在本机环境变量中设置，不要把密钥发到聊天中');
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          store: false,
          instructions,
          input,
          max_output_tokens: 12000,
          text: { format: schemaBody(schema, schemaName) },
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
      const payload = JSON.parse(body);
      if (payload.status && payload.status !== 'completed') throw new Error(`API 状态: ${payload.status}`);
      if (payload.usage) {
        RUN_USAGE.input += payload.usage.input_tokens || 0;
        RUN_USAGE.output += payload.usage.output_tokens || 0;
        RUN_USAGE.total += payload.usage.total_tokens || 0;
      }
      return JSON.parse(extractOutputText(payload));
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function glossaryText(glossary) {
  return glossary.length ? JSON.stringify(glossary, null, 2) : '（无额外术语表；不确定的专有名词保留英文）';
}

async function buildGlossary(source) {
  const result = await callModel(
    GLOSSARY_INSTRUCTIONS,
    `请提取术语表。\n\n<SOURCE>\n${source}\n</SOURCE>`,
    GLOSSARY_SCHEMA,
    'screenplay_glossary',
  );
  return Array.isArray(result.terms) ? result.terms : [];
}

function validateBlocks(result, expectedIds, sourceById) {
  if (!result || !Array.isArray(result.blocks)) throw new Error('结构化结果缺少 blocks');
  const ids = result.blocks.map((b) => b?.id);
  if (ids.length !== expectedIds.length || ids.some((id, i) => id !== expectedIds[i])) {
    throw new Error(`block ID 不完整或乱序，期望 ${expectedIds.join(',')}，实际 ${ids.join(',')}`);
  }
  for (const block of result.blocks) {
    if (typeof block.translation !== 'string' || !block.translation.trim()) {
      throw new Error(`block ${block.id} 翻译为空`);
    }
    if (sourceById) {
      const source = sourceById.get(block.id);
      const sourceBreaks = (source.match(/\n/g) || []).length;
      const translatedBreaks = (block.translation.match(/\n/g) || []).length;
      if (sourceBreaks !== translatedBreaks) {
        throw new Error(`block ${block.id} 换行数改变（${sourceBreaks}→${translatedBreaks}）`);
      }
    }
  }
}

async function translateChunk(chunk, glossary) {
  const expectedIds = chunk.map((b) => b.id);
  const sourceById = new Map(chunk.map((b) => [b.id, b.text]));
  const input = `术语表：\n${glossaryText(glossary)}\n\n请翻译以下 blocks。必须逐一返回相同 id。\n${JSON.stringify(chunk.map(({ id, text }) => ({ id, source: text })))} `;
  const result = await callModel(TRANSLATE_INSTRUCTIONS, input, BLOCK_SCHEMA, 'translated_blocks');
  validateBlocks(result, expectedIds, sourceById);
  return result.blocks;
}

async function proofreadChunk(chunk, translations, glossary) {
  const expectedIds = chunk.map((b) => b.id);
  const sourceById = new Map(chunk.map((b) => [b.id, b.text]));
  const pairs = chunk.map((b) => ({
    id: b.id,
    source: b.text,
    translation: translations.find((x) => x.id === b.id)?.translation || '',
  }));
  const input = `术语表：\n${glossaryText(glossary)}\n\n请校对以下 source/translation 对。必须逐一返回相同 id。\n${JSON.stringify(pairs)}`;
  const result = await callModel(PROOFREAD_INSTRUCTIONS, input, BLOCK_SCHEMA, 'proofread_blocks');
  validateBlocks(result, expectedIds, sourceById);
  return result.blocks;
}

async function readState(statePath) {
  try { return JSON.parse(await fs.readFile(statePath, 'utf8')); } catch { return null; }
}

async function saveState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state), 'utf8');
}

async function translateProject(id, dryRun) {
  const dir = await projectDir(id);
  const sourcePath = path.join(dir, '_剧本', 'en-US', 'full_script.md');
  const targetPath = path.join(dir, '_剧本', 'zh-CN', 'full_script.md');
  const statePath = path.join(WORK_ROOT, `${id}.json`);
  if (await exists(targetPath)) return { id, status: 'skip-target-exists' };
  const source = await fs.readFile(sourcePath, 'utf8');
  const segments = makeBlocks(source);
  const chunks = makeChunks(segments);
  if (dryRun) return { id, status: 'dry-run', chars: source.length, blocks: segments.length, chunks: chunks.length };

  let state = await readState(statePath);
  if (!state || state.sourceChars !== source.length || state.model !== MODEL) {
    state = { id, sourceChars: source.length, model: MODEL, glossary: null, translations: {}, proofread: {} };
  }
  let stateSave = Promise.resolve();
  const persist = () => {
    stateSave = stateSave.then(() => saveState(statePath, state));
    return stateSave;
  };
  if (!state.glossary) {
    state.glossary = await buildGlossary(source);
    await persist();
  }

  const pending = chunks.map((chunk, index) => ({ chunk, index })).filter(({ chunk }) => !chunk.every((b) => state.translations[b.id]));
  await runLimited(pending, CONCURRENCY, async ({ chunk, index }) => {
    const result = await translateChunk(chunk, state.glossary);
    for (const block of result) state.translations[block.id] = block.translation;
    await persist();
    console.log(`[${id}] 翻译 ${index + 1}/${chunks.length}`);
  });

  const proofPending = chunks.map((chunk, index) => ({ chunk, index })).filter(({ chunk }) => !chunk.every((b) => state.proofread[b.id]));
  await runLimited(proofPending, CONCURRENCY, async ({ chunk, index }) => {
    const initial = chunk.map((b) => ({ id: b.id, translation: state.translations[b.id] }));
    const result = await proofreadChunk(chunk, initial, state.glossary);
    for (const block of result) state.proofread[block.id] = block.translation;
    await persist();
    console.log(`[${id}] 校对 ${index + 1}/${chunks.length}`);
  });

  const output = segments.map((b) => state.proofread[b.id] + b.after).join('');
  if (output.length < Math.max(100, Math.floor(source.length * 0.25))) throw new Error(`[${id}] 输出异常过短`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, output, 'utf8');
  await fs.rename(tmpPath, targetPath);
  await fs.rm(statePath, { force: true });
  return { id, status: 'done', chars: source.length, blocks: segments.length, chunks: chunks.length };
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function runLimited(items, limit, worker) {
  let next = 0;
  async function loop() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, loop));
}

const selected = argValue('--project');
const ids = selected ? [selected] : PROJECT_IDS;
const dryRun = hasArg('--dry-run');
if (!dryRun && !process.env.OPENAI_API_KEY) {
  console.error('未执行：请先在本机设置 OPENAI_API_KEY；脚本不会读取或输出密钥值。');
  process.exit(2);
}

for (const id of ids) {
  try {
    console.log(`[${id}] 开始${dryRun ? '盘点' : '翻译'}`);
    console.log(await translateProject(id, dryRun));
  } catch (error) {
    console.error(`[${id}] 失败：${error.message}`);
    process.exitCode = 1;
  }
}
if (!dryRun) console.log(`[usage] input=${RUN_USAGE.input} output=${RUN_USAGE.output} total=${RUN_USAGE.total}`);
