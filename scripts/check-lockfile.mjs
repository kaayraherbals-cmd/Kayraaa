// Offline consistency check: does package-lock.json describe the same root dependencies as package.json?
// No network, no dependencies. It reads both files and compares them. It does NOT verify integrity hashes or that
// the registry can serve the packages (only `npm ci` can do that). Exit code 0 = consistent, 1 = mismatch.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const rootEntry = lock.packages?.[''];
const problems = [];

if (!rootEntry) problems.push('package-lock.json has no root ("") entry.');
else {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const want = pkg[field] || {};
    const have = rootEntry[field] || {};
    for (const [name, range] of Object.entries(want)) {
      if (!(name in have)) problems.push(`${field}: "${name}" (${range}) is in package.json but missing from the lockfile root.`);
      else if (have[name] !== range) problems.push(`${field}: "${name}" is "${range}" in package.json but "${have[name]}" in the lockfile root.`);
      if (!lock.packages[`node_modules/${name}`]) problems.push(`${field}: "${name}" has no node_modules/${name} entry in the lockfile (no resolved version or integrity).`);
    }
    for (const name of Object.keys(have)) {
      if (!(name in want)) problems.push(`${field}: "${name}" is in the lockfile root but not in package.json.`);
    }
  }
}

if (problems.length) {
  console.error(`package-lock.json is NOT consistent with package.json (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nFix: on a machine with registry access run `npm install --package-lock-only`, review the diff, commit it, then `npm ci`.');
  process.exit(1);
}
console.log('package-lock.json root dependencies match package.json.');
