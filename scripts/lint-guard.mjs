#!/usr/bin/env node
/**
 * 原创性与安全门禁扫描脚本
 * 检查项（对应详细设计 §4.4）：
 * 1. 绝对禁用词扫描（src/、index.html、tests/e2e/、docs/04-submission.md）
 * 2. D5 别名白名单扫描（仅允许 parser.js 白名单行与对应单测）
 * 3. 凭证与 .env 泄露扫描
 * 4. reference/ 隔离检查（.gitignore + git ls-files）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

// 使用 Unicode 转义，避免扫描脚本自身携带敏感字面量
const FORBIDDEN_WORDS = [
  '\u5c0f\u7ea2\u4e66', // 小红书
  '\u7b14\u8bb0',       // 笔记
  '\u5c01\u9762',       // 封面
];
const D5_WORD = '\u70b9\u8d5e'; // 点赞

const SECRET_PATTERNS = [
  { name: 'OpenAI/DeepSeek-style key', regex: /\bsk-[A-Za-z0-9]{16,}\b/g },
  { name: 'Bearer token', regex: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g },
  { name: 'Private key header', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

/** @param {string} dir @returns {string[]} */
function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'coverage') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else if (/\.(js|mjs|cjs|html|css|md|json|yml|yaml|txt)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** @type {string[]} */
const violations = [];

// 1 & 2. 扫描禁用词与 D5 词
const wordScanTargets = [
  ...walkFiles(path.join(ROOT, 'src')),
  ...walkFiles(path.join(ROOT, 'tests', 'e2e')),
  ...(fs.existsSync(path.join(ROOT, 'index.html')) ? [path.join(ROOT, 'index.html')] : []),
  ...(fs.existsSync(path.join(ROOT, 'docs', '04-submission.md')) ? [path.join(ROOT, 'docs', '04-submission.md')] : []),
];

for (const filePath of wordScanTargets) {
  const rel = path.relative(ROOT, filePath).replaceAll('\\', '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    for (const word of FORBIDDEN_WORDS) {
      if (line.includes(word)) {
        violations.push(`[禁用词] ${rel}:${lineNo} 包含绝对禁用词 "${word}"`);
      }
    }
    if (line.includes(D5_WORD)) {
      const isAllowedParserLine = rel === 'src/core/parser.js' && line.includes('D5-WHITELIST');
      const isAllowedE2ELine = rel.startsWith('tests/e2e/') && line.includes('D5-WHITELIST');
      if (!isAllowedParserLine && !isAllowedE2ELine) {
        violations.push(`[D5禁词] ${rel}:${lineNo} 未经白名单标注出现了 "${D5_WORD}"`);
      }
    }
  });
}

// 3. 凭证与 .env 扫描
const rootEntries = fs.readdirSync(ROOT);
for (const name of rootEntries) {
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
    violations.push(`[凭证文件] 仓库根目录存在禁止提交的文件: ${name}`);
  }
}

const secretScanTargets = [
  ...walkFiles(path.join(ROOT, 'src')),
  ...walkFiles(path.join(ROOT, 'tests')),
  ...walkFiles(path.join(ROOT, 'scripts')),
  ...walkFiles(path.join(ROOT, '.github')),
  ...(fs.existsSync(path.join(ROOT, 'index.html')) ? [path.join(ROOT, 'index.html')] : []),
  ...(fs.existsSync(path.join(ROOT, 'docs', '04-submission.md')) ? [path.join(ROOT, 'docs', '04-submission.md')] : []),
];

for (const filePath of secretScanTargets) {
  const rel = path.relative(ROOT, filePath).replaceAll('\\', '/');
  // 跳过大型纯数字回归固件
  if (rel.endsWith('.json.gz') || rel.includes('differential-350k')) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.includes('SECRET-SCAN-IGNORE')) return;
    for (const { name, regex } of SECRET_PATTERNS) {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        violations.push(`[凭证泄露] ${rel}:${idx + 1} 命中 ${name}`);
      }
    }
  });
}

// 4. reference/ 隔离检查
const gitignorePath = path.join(ROOT, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  violations.push('[隔离检查] 缺少 .gitignore 文件');
} else {
  const gi = fs.readFileSync(gitignorePath, 'utf8');
  if (!/^\s*reference\/?\s*$/m.test(gi)) {
    violations.push('[隔离检查] .gitignore 必须包含 reference/');
  }
}

if (fs.existsSync(path.join(ROOT, '.git'))) {
  try {
    const tracked = execFileSync('git', ['ls-files', 'reference'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (tracked) {
      violations.push(`[隔离检查] reference/ 中存在已跟踪文件:\n${tracked}`);
    }
  } catch (err) {
    violations.push(`[隔离检查] 执行 git ls-files 失败: ${String(err)}`);
  }
}

if (violations.length > 0) {
  console.error('❌ 原创性与安全门禁扫描未通过：');
  for (const v of violations) {
    console.error('  -', v);
  }
  process.exit(1);
}

console.log(`✅ 原创性与安全门禁扫描通过（已扫描 ${wordScanTargets.length} 个文案/源码文件、${secretScanTargets.length} 个凭证目标文件）。`);
