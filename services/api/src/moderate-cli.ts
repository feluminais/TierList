import { createDb } from "./db";
import { moderate } from "./moderation";
import { createRepository } from "./repository";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { db, close } = createDb(url);
const result = await moderate(process.argv.slice(2), createRepository(db));
await close();

for (const line of result.lines) (result.ok ? console.log : console.error)(line);
process.exit(result.ok ? 0 : 1);
