import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const resolveConfig = require('tailwindcss/resolveConfig');
const { createContext } = require('tailwindcss/lib/lib/setupContextUtils');
const { generateRules } = require('tailwindcss/lib/lib/generateRules');

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const context = createContext(resolveConfig(require(path.join(root, 'tailwind.config.js'))));
const validityCache = new Map();

const variantPrefix = String.raw`(?:(?:active|focus|focus-visible|disabled|pressed|ios|android|dark):)*`;
const prefixedUtility = new RegExp(
  String.raw`^${variantPrefix}-?(?:bg|text|border|font|shadow|ring|from|via|to|rounded|opacity|tracking|leading|p[trblxy]?|m[trblxy]?|gap|space-[xy]|w|h|min-[wh]|max-[wh]|top|right|bottom|left|inset|z|flex|grow|shrink|basis|order|grid-cols|grid-rows|col|row|items|justify|content|self|place|overflow|aspect|object|divide|duration|ease|delay|scale|rotate|translate|skew|origin|whitespace|line-clamp|decoration|underline-offset|pointer-events)-`,
);
const standaloneUtility = new RegExp(
  String.raw`^${variantPrefix}(?:flex|grid|block|inline|hidden|absolute|relative|fixed|static|grow|shrink|truncate|uppercase|lowercase|capitalize|normal-case|italic|not-italic|underline|no-underline|antialiased|subpixel-antialiased|sr-only|not-sr-only)$`,
);
const utilityCandidate = candidate =>
  prefixedUtility.test(candidate) || standaloneUtility.test(candidate);

const isValidUtility = candidate => {
  if (!validityCache.has(candidate)) {
    validityCache.set(candidate, [...generateRules(new Set([candidate]), context)].length > 0);
  }
  return validityCache.get(candidate);
};

const sourceFiles = [];
const collectSourceFiles = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath);
    } else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
    ) {
      sourceFiles.push(absolutePath);
    }
  }
};

const isStyleContext = (node, filePath) => {
  if (/\.styles\.(?:ts|tsx)$/.test(filePath)) return true;

  let parent = node.parent;
  while (parent) {
    if (ts.isJsxAttribute(parent) && parent.name.getText() === 'className') return true;
    if (ts.isCallExpression(parent) && parent.expression.getText() === 'cn') return true;
    if (ts.isPropertyAssignment(parent) && /class/i.test(parent.name.getText())) return true;
    if (
      ts.isVariableDeclaration(parent) &&
      ts.isIdentifier(parent.name) &&
      /class/i.test(parent.name.text)
    ) {
      return true;
    }
    if (ts.isStatement(parent) || ts.isSourceFile(parent)) break;
    parent = parent.parent;
  }
  return false;
};

const invalidUtilities = new Map();

collectSourceFiles(sourceRoot);

for (const filePath of sourceFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = node => {
    const isStringNode =
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);

    if (isStringNode && isStyleContext(node, filePath)) {
      for (const candidate of node.text.split(/\s+/).filter(Boolean)) {
        if (!utilityCandidate(candidate) || isValidUtility(candidate)) continue;

        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const relativePath = path.relative(root, filePath);
        const locations = invalidUtilities.get(candidate) ?? [];
        locations.push(`${relativePath}:${line + 1}`);
        invalidUtilities.set(candidate, locations);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

if (invalidUtilities.size > 0) {
  console.error('Invalid NativeWind utilities (no generated rule):');
  for (const [candidate, locations] of [...invalidUtilities].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.error(`- ${candidate}: ${[...new Set(locations)].join(', ')}`);
  }
  process.exitCode = 1;
} else {
  console.log(`NativeWind utilities OK (${sourceFiles.length} source files checked).`);
}
