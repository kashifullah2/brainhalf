export interface Env {
  DB: D1Database;
}

export const createAllTables = async (db: D1Database) => {
  const queries = [
    // Core Application Tables
    `CREATE TABLE IF NOT EXISTS "users" (
      "id" text PRIMARY KEY NOT NULL,
      "email" text NOT NULL UNIQUE,
      "username" text NOT NULL UNIQUE,
      "display_name" text,
      "avatar_url" text,
      "bio" text,
      "plan" text DEFAULT 'free' NOT NULL,
      "credits_remaining" integer DEFAULT 100 NOT NULL,
      "total_games_created" integer DEFAULT 0 NOT NULL,
      "total_plays_received" integer DEFAULT 0 NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "projects" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES "users"("id"),
      "title" text NOT NULL,
      "description" text,
      "game_type" text NOT NULL,
      "engine" text NOT NULL,
      "status" text DEFAULT 'idle' NOT NULL,
      "thumbnail_url" text,
      "is_published" integer DEFAULT 0 NOT NULL,
      "is_private" integer DEFAULT 0 NOT NULL,
      "play_count" integer DEFAULT 0 NOT NULL,
      "like_count" integer DEFAULT 0 NOT NULL,
      "remix_count" integer DEFAULT 0 NOT NULL,
      "last_generated_at" integer,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "project_files" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL REFERENCES "projects"("id"),
      "file_path" text NOT NULL,
      "file_content" text,
      "file_type" text NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "generation_history" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL REFERENCES "projects"("id"),
      "user_id" text NOT NULL REFERENCES "users"("id"),
      "prompt" text NOT NULL,
      "model_used" text NOT NULL,
      "tokens_used" integer NOT NULL,
      "prompt_tokens" integer DEFAULT 0 NOT NULL,
      "completion_tokens" integer DEFAULT 0 NOT NULL,
      "estimated_cost" real DEFAULT 0 NOT NULL,
      "generation_time_ms" integer NOT NULL,
      "status" text NOT NULL,
      "error_message" text,
      "created_at" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "api_configs" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES "users"("id"),
      "name" text NOT NULL,
      "provider" text NOT NULL,
      "base_url" text,
      "model" text,
      "api_key_encrypted" text NOT NULL,
      "is_default" integer DEFAULT 0 NOT NULL,
      "created_at" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "asset_library" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES "users"("id"),
      "name" text NOT NULL,
      "asset_type" text NOT NULL,
      "file_url" text NOT NULL,
      "file_size" integer NOT NULL,
      "is_public" integer DEFAULT 0 NOT NULL,
      "created_at" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "checkpoints" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL REFERENCES "projects"("id"),
      "user_id" text NOT NULL REFERENCES "users"("id"),
      "label" text NOT NULL,
      "files_json" text NOT NULL,
      "file_count" integer DEFAULT 0 NOT NULL,
      "created_at" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "transactions" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL REFERENCES "users"("id"),
      "type" text NOT NULL,
      "amount_cents" integer NOT NULL,
      "credits_added" integer NOT NULL,
      "stripe_payment_id" text,
      "created_at" integer NOT NULL
    );`,

    // Better Auth Required Tables
    `CREATE TABLE IF NOT EXISTS "user" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "email" text NOT NULL UNIQUE,
      "emailVerified" integer NOT NULL,
      "image" text,
      "createdAt" integer NOT NULL,
      "updatedAt" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "session" (
      "id" text PRIMARY KEY NOT NULL,
      "expiresAt" integer NOT NULL,
      "token" text NOT NULL UNIQUE,
      "createdAt" integer NOT NULL,
      "updatedAt" integer NOT NULL,
      "ipAddress" text,
      "userAgent" text,
      "userId" text NOT NULL REFERENCES "user"("id")
    );`,
    `CREATE TABLE IF NOT EXISTS "account" (
      "id" text PRIMARY KEY NOT NULL,
      "accountId" text NOT NULL,
      "providerId" text NOT NULL,
      "userId" text NOT NULL REFERENCES "user"("id"),
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" integer,
      "refreshTokenExpiresAt" integer,
      "scope" text,
      "password" text,
      "createdAt" integer NOT NULL,
      "updatedAt" integer NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "verification" (
      "id" text PRIMARY KEY NOT NULL,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expiresAt" integer NOT NULL,
      "createdAt" integer NOT NULL,
      "updatedAt" integer NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");`,
    `CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "projects_status_idx" ON "projects" ("status");`,
    `CREATE INDEX IF NOT EXISTS "project_files_project_path_idx" ON "project_files" ("project_id", "file_path");`,
    `CREATE INDEX IF NOT EXISTS "gen_history_project_idx" ON "generation_history" ("project_id");`,
    `CREATE INDEX IF NOT EXISTS "gen_history_user_idx" ON "generation_history" ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "api_configs_user_idx" ON "api_configs" ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "asset_library_user_idx" ON "asset_library" ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "transactions_user_idx" ON "transactions" ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "checkpoints_project_idx" ON "checkpoints" ("project_id");`,
  ];

  for (const query of queries) {
    await db.prepare(query).run();
  }

  // Additive column migrations for databases created before these columns
  // existed. SQLite lacks "ADD COLUMN IF NOT EXISTS", so we ignore the
  // "duplicate column" error that occurs when the column is already present.
  const addColumns = [
    `ALTER TABLE "generation_history" ADD COLUMN "prompt_tokens" integer DEFAULT 0 NOT NULL;`,
    `ALTER TABLE "generation_history" ADD COLUMN "completion_tokens" integer DEFAULT 0 NOT NULL;`,
    `ALTER TABLE "generation_history" ADD COLUMN "estimated_cost" real DEFAULT 0 NOT NULL;`,
  ];
  for (const query of addColumns) {
    try {
      await db.prepare(query).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  }
};

/** Returns true if core app tables exist */
export async function isDatabaseReady(db: D1Database): Promise<boolean> {
  try {
    await db.prepare(`SELECT 1 FROM "projects" LIMIT 1`).run();
    return true;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/migrate" && request.method === "POST") {
      try {
        await createAllTables(env.DB);
        return new Response("Migration completed successfully. All tables are ready.", { status: 200 });
      } catch (error: any) {
        return new Response(`Migration failed: ${error.message}`, { status: 500 });
      }
    }
    
    return new Response("Not found. Send POST to /migrate to run migrations.", { status: 404 });
  }
};
