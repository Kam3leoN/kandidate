/** npm run cron:local — run the daily watch once against the configured database. */
import './env.js';
import { runCron } from '../server/cron.js';

const stats = await runCron('local');
console.log(JSON.stringify(stats, null, 2));
process.exit(0);
