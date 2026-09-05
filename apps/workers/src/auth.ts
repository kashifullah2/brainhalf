import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@brainhalf/db/schema";
import type { Env } from "./env";

export const getAuth = (env: Env) => {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is not set. Add it to wrangler.toml [vars] or as a secret.");
  }

  const db = drizzle(env.DB);
  const baseURL = env.BETTER_AUTH_URL || "http://localhost:8787";

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://localhost:8787",
      "http://127.0.0.1:8787",
      "https://brainhalf.com",
      "https://www.brainhalf.com",
      "https://studio.brainhalf.com",
      "https://api.brainhalf.com",
    ],
    emailAndPassword: {
      enabled: true,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const baseUsername = user.email
              .split("@")[0]
              .replace(/[^a-zA-Z0-9]/g, "")
              .toLowerCase();
            const username = `${baseUsername}_${Math.random().toString(36).substring(2, 6)}`;

            try {
              await db.insert(schema.users).values({
                id: user.id,
                email: user.email,
                username,
                displayName: user.name || baseUsername,
                avatarUrl: user.image || null,
                plan: "free",
                creditsRemaining: 100,
                totalGamesCreated: 0,
                totalPlaysReceived: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            } catch (err) {
              console.error("Failed to create app user record:", err);
            }
          },
        },
      },
    },
  });
};
