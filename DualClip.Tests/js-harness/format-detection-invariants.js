// Frontend Format Detection & Syntax Invariants Harness
// Tests getFormatTag() against real edge cases: JSON, PowerShell, Shebangs,
// Python # comments, Markdown fences, English prose false positives, and 250KB payloads.
//
// Run:  node DualClip.Tests/js-harness/format-detection-invariants.js
// Exit: 0 = all tests pass, 1 = regression detected

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const filtersSearchPath = path.join(REPO, 'ui', 'js', 'list', 'filters-search.js');
const source = fs.readFileSync(filtersSearchPath, 'utf8');

const match = source.match(/function getFormatTag\(text\) \{[\s\S]*?\n\}/);
if (!match) {
  console.error('FAIL: Could not locate function getFormatTag() in ui/js/list/filters-search.js');
  process.exit(1);
}

// Evaluate function in current scope
eval(match[0]);

let passed = 0;
let failed = 0;

function assertTag(description, input, expectedTag, maxDurationMs) {
  const start = performance.now();
  const actualTag = getFormatTag(input);
  const elapsed = performance.now() - start;
  const elapsedStr = elapsed.toFixed(3);

  if (actualTag !== expectedTag) {
    failed++;
    console.error(`  FAIL: ${description}`);
    console.error(`        Expected: ${expectedTag}`);
    console.error(`        Actual:   ${actualTag}`);
    return;
  }

  if (typeof maxDurationMs === 'number' && elapsed > maxDurationMs) {
    failed++;
    console.error(`  FAIL PERF: ${description}`);
    console.error(`        Budget:   ${maxDurationMs} ms`);
    console.error(`        Actual:   ${elapsedStr} ms`);
    return;
  }

  passed++;
  console.log(`  PASS: ${description} -> ${actualTag} (${elapsedStr} ms)`);
}

console.log('=== Running Frontend Format Detection Invariant Tests ===\n');

// 1. English Prose vs Code (Regression drill for hyphenated words)
assertTag(
  'Hyphenated English prose (set-up, start-date, get-together)',
  'We need a set-up for the new start-date and a get-together.',
  'TEXT'
);

assertTag(
  'Normal email / chat message',
  'Hey team, please review the document before noon tomorrow.',
  'TEXT'
);

// 2. PowerShell Cmdlets & Variables
assertTag(
  'PowerShell PascalCase cmdlet with parameters',
  'Get-ChildItem -Path C:\\Users -Recurse | Where-Object { $_.Length -gt 1MB }',
  'CODE'
);

assertTag(
  'PowerShell $PSScriptRoot variable',
  '$scriptPath = "$PSScriptRoot/config.json"',
  'CODE'
);

assertTag(
  'PowerShell param( block',
  'param(\n  [string]$Path,\n  [int]$Count = 10\n)',
  'CODE'
);

// 3. Shell / Shebangs
assertTag(
  'Bash shebang with loop',
  '#!/bin/bash\nfor f in *.txt; do\n  echo "$f"\ndone',
  'CODE'
);

assertTag(
  'Python env shebang',
  '#!/usr/bin/env python3\nimport sys\nprint(sys.version)',
  'CODE'
);

// 4. Python & Languages with # comments
assertTag(
  'Python function with # comment',
  '# Calculate total cost\ndef calculate_total(items):\n    return sum(item.price for item in items)',
  'CODE'
);

// 5. Markdown Fenced Code vs Code
assertTag(
  'Markdown containing fenced code block',
  '# Project Setup\n\nRun the following command:\n\n```bash\nnpm install\n```\n\nThen start the server.',
  'MD'
);

assertTag(
  'Plain Markdown heading and bullet points',
  '# Meeting Notes\n- Review roadmap\n- QA checklist\n- Release candidate 1.0',
  'MD'
);

// 6. JSON (Small & Massive payload)
assertTag(
  'Standard small JSON payload',
  '{\n  "name": "DualClip",\n  "version": "1.0.0",\n  "active": true\n}',
  'JSON'
);

// Generate 250 KB JSON to verify full-document parse without falling back to TEXT
const bigObj = {
  project: 'DualClip',
  items: Array.from({ length: 4500 }, (_, i) => ({
    id: i,
    label: `Item record index ${i}`,
    tags: ['clipboard', 'windows', 'tool']
  }))
};
const bigJsonStr = JSON.stringify(bigObj, null, 2);

assertTag(
  `Large JSON document (${(bigJsonStr.length / 1024).toFixed(0)} KB)`,
  bigJsonStr,
  'JSON',
  60 // 60 ms budget for ~650 KB parse
);

// 7. URLs & File Paths
assertTag(
  'Standard HTTPS URL',
  'https://github.com/dualclip/dualclip',
  'URL'
);

assertTag(
  'Windows absolute file path',
  'C:\\Users\\Maaz\\Documents\\DualClip\\ui\\index.html',
  'FILE'
);

// 8. SQL Queries
assertTag(
  'SQL SELECT query',
  'SELECT id, title, text_content FROM clips WHERE track = "text" ORDER BY created_at DESC LIMIT 50;',
  'CODE'
);

console.log(`\n=== Invariant Test Summary ===`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All frontend format detection invariants hold!\n');
  process.exit(0);
}
