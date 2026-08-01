import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { db, close } = createDb(url);
await migrate(db, { migrationsFolder: "./drizzle" });
await close();
console.log("migrations applied");
