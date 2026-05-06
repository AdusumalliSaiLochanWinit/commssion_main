import { initDb } from './src/db/database.js';

async function run() {
  console.log('Starting DB initialization...');
  await initDb();
  console.log('Done!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
