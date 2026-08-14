import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    adapter: () =>
      new PrismaPg({
        connectionString: process.env.DATABASE_URL ?? "",
      }),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? "postgresql://contable:contable@localhost:5432/contable_shadow",
  },
});