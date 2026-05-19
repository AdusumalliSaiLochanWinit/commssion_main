// Assigns plausible Arabic/Saudi names to NFPC-imported employees.
// Source DB has no person names, only emp_uid. Names are picked deterministically
// by user-id hash so re-running gives the same name for the same user.

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  for (const f of [path.join(__dirname,'..','..','.env.production'), path.join(__dirname,'..','.env')]) {
    if (existsSync(f)) {
      const m = readFileSync(f, 'utf8').match(/DATABASE_URL=\"?([^\"\n]+)/);
      if (m) { DB_URL = m[1]; break; }
    }
  }
}
if (!DB_URL) throw new Error('DATABASE_URL not found');

const FIRST = [
  'Mohammed','Ahmed','Khalid','Abdullah','Faisal','Omar','Yousef','Saad','Salem','Sultan',
  'Bandar','Majed','Turki','Naif','Saleh','Hamad','Ibrahim','Fahad','Nasser','Hassan',
  'Hussein','Hamza','Ali','Saud','Mansour','Jamal','Tariq','Rashid','Mubarak','Waleed',
  'Yasir','Ziyad','Tareq','Marwan','Adel','Ammar','Anas','Bader','Dhari','Eyad',
  'Fawaz','Ghazi','Hadi','Ihsan','Jaber','Kamal','Mazin','Nawaf','Othman','Rakan',
];
const LAST = [
  'Al-Rashidi','Al-Mansouri','Al-Qahtani','Al-Otaibi','Al-Harbi','Al-Ghamdi','Al-Shahrani',
  'Al-Zahrani','Al-Dossari','Al-Subaie','Al-Anazi','Al-Mutairi','Al-Sahli','Al-Juhani',
  'Al-Saud','Al-Sheikh','Al-Maliki','Al-Asiri','Al-Qarni','Al-Ahmari','Al-Yami','Al-Faraj',
  'Al-Tamimi','Al-Hashemi','Al-Khalifa','Al-Najjar','Al-Saadi','Al-Hilali','Al-Hammad',
  'Al-Bahrani','Al-Aqeel','Al-Suwailem','Al-Hijazi','Al-Najjar','Al-Mazrouei','Al-Nuaimi',
];

function hashIndex(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickName(empId) {
  const h = hashIndex(empId);
  return FIRST[h % FIRST.length] + ' ' + LAST[Math.floor(h / FIRST.length) % LAST.length];
}

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false, max: 3 });
  const c = await pool.connect();
  try {
    const emps = (await c.query(`SELECT id, external_id FROM employees WHERE id LIKE 'nfpc-%' ORDER BY id`)).rows;
    console.log(`Assigning names to ${emps.length} NFPC employees...`);

    const BATCH = 100;
    let updated = 0;
    for (let i = 0; i < emps.length; i += BATCH) {
      const slice = emps.slice(i, i + BATCH);
      // Build a single UPDATE ... FROM (VALUES ...) AS v(id, name)
      const values = [];
      const params = [];
      for (const e of slice) {
        const name = pickName(e.id);
        values.push(`($${params.length+1}, $${params.length+2})`);
        params.push(e.id, name);
      }
      await c.query(
        `UPDATE employees AS t SET name = v.name
         FROM (VALUES ${values.join(',')}) AS v(id, name)
         WHERE t.id = v.id`,
        params
      );
      updated += slice.length;
      if (updated % 200 === 0) console.log(`  ... ${updated}/${emps.length}`);
    }
    console.log(`✓ Updated ${updated} employee names`);

    // Show sample
    const s = await c.query(`SELECT id, name, external_id FROM employees WHERE id LIKE 'nfpc-%' ORDER BY id LIMIT 8`);
    console.log('\nSample updated employees:');
    console.table(s.rows);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
