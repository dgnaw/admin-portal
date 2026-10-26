import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db';

async function main() {
  const dir = join(__dirname, '..', 'sql');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(dir, file), 'utf8'));
    console.log('applied', file);
  }
  await pool.end();
}

main();
