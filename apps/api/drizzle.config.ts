import { defineConfig } from "drizzle-kit";

const url =
  process.env.DATABASE_URL ?? "mysql://root:root@127.0.0.1:3306/apoteku";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  verbose: true,
  strict: false,
});
