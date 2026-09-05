import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@brainhalf/db/schema";
import { Context, Next } from "hono";

// Extend context type for Hono middleware
declare module "hono" {
  interface ContextVariableMap {
    user: any;
    session: any;
  }
}

export function createAuth(env: Record<string, any>) {
  const db = drizzle(env.DB);
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID || '',
        clientSecret: env.GITHUB_CLIENT_SECRET || '',
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      },
    },
    callbacks: {
      onUserCreate: async ({ user }: { user: any }) => {
        // After sign up: create user record in custom users table
        const baseUsername = user.email
          .split("@")[0]
          .replace(/[^a-zA-Z0-9]/g, "")
          .toLowerCase();
        const username = `${baseUsername}_${Math.random().toString(36).substring(2, 6)}`;

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
      },
    },
  });
}

// Expose auth middleware for Hono
export const authMiddleware = (env: Record<string, any>) => {
  return async (c: Context, next: Next) => {
    const auth = createAuth(env);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (session) {
      c.set("session", session.session);
      c.set("user", session.user);
    } else {
      c.set("session", null);
      c.set("user", null);
    }

    await next();
  };
};
