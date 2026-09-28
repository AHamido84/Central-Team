/**
 * Fails when Arabic and English message files differ in keys or ICU placeholders.
 * (Missing keys used in code are caught at compile time by the typed next-intl config.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(__dirname, '../messages');

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

/** Top-level ICU arguments only ({name}, {count, plural, …}); nested plural branches are ignored. */
function placeholders(message: string): string {
  const found = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*([a-zA-Z0-9_]+)/.exec(message.slice(i));
        if (m) found.add(m[1]!);
      }
      depth++;
    } else if (message[i] === '}') depth--;
  }
  return [...found].sort().join(',');
}

let problems = 0;
const namespaces = readdirSync(path.join(dir, 'ar')).filter((f) => f.endsWith('.json'));
for (const file of namespaces) {
  const ar = flatten(JSON.parse(readFileSync(path.join(dir, 'ar', file), 'utf8')));
  let en: Record<string, string> = {};
  try {
    en = flatten(JSON.parse(readFileSync(path.join(dir, 'en', file), 'utf8')));
  } catch {
    console.error(`✗ en/${file} is missing`);
    problems++;
    continue;
  }
  for (const key of new Set([...Object.keys(ar), ...Object.keys(en)])) {
    let problem: string | null = null;
    if (!(key in ar)) problem = 'missing in ar';
    else if (!(key in en)) problem = 'missing in en';
    else if (placeholders(ar[key]!) !== placeholders(en[key]!)) problem = 'placeholders differ';
    else if (!ar[key]!.trim() || !en[key]!.trim()) problem = 'is empty';
    if (problem) {
      console.error(`✗ ${file}: "${key}" ${problem}`);
      problems++;
    }
  }
}
if (problems) {
  console.error(`\n${problems} i18n problem(s).`);
  process.exit(1);
}
console.info(`✓ ${namespaces.length} namespaces, ar/en in sync.`);
