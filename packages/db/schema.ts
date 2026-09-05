import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // ULID
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  plan: text("plan", { enum: ["free", "pro", "studio"] }).default("free").notNull(),
  creditsRemaining: integer("credits_remaining").default(100).notNull(),
  totalGamesCreated: integer("total_games_created").default(0).notNull(),
  totalPlaysReceived: integer("total_plays_received").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (users) => ({
  // Add index on email for lookups
  emailIdx: index("users_email_idx").on(users.email),
}));

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  gameType: text("game_type", { enum: ["2d", "3d"] }).notNull(),
  engine: text("engine", { enum: ["phaser", "threejs", "babylonjs"] }).notNull(),
  status: text("status", { enum: ["idle", "generating", "ready", "failed"] }).default("idle").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  isPublished: integer("is_published", { mode: "boolean" }).default(false).notNull(),
  isPrivate: integer("is_private", { mode: "boolean" }).default(false).notNull(),
  playCount: integer("play_count").default(0).notNull(),
  likeCount: integer("like_count").default(0).notNull(),
  remixCount: integer("remix_count").default(0).notNull(),
  lastGeneratedAt: integer("last_generated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (projects) => ({
  // Add index on userId for project lookups
  userIdIdx: index("projects_user_id_idx").on(projects.userId),
  // Add index on status for filtering by status
  statusIdx: index("projects_status_idx").on(projects.status),
}));

export const projectFiles = sqliteTable("project_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  filePath: text("file_path").notNull(),
  fileContent: text("file_content"),
  fileType: text("file_type").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (projectFiles) => ({
  // Add composite index on projectId + filePath for file lookups
  projectFileIdx: index("project_files_project_path_idx").on(projectFiles.projectId, projectFiles.filePath),
}));

export const generationHistory = sqliteTable("generation_history", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  userId: text("user_id").notNull().references(() => users.id),
  prompt: text("prompt").notNull(),
  modelUsed: text("model_used").notNull(),
  tokensUsed: integer("tokens_used").notNull(),
  promptTokens: integer("prompt_tokens").default(0).notNull(),
  completionTokens: integer("completion_tokens").default(0).notNull(),
  estimatedCost: real("estimated_cost").default(0).notNull(),
  generationTimeMs: integer("generation_time_ms").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (generationHistory) => ({
  // Add index on projectId for history lookups
  projectIdIdx: index("gen_history_project_idx").on(generationHistory.projectId),
  // Add index on userId for user history lookups  
  userIdIdx: index("gen_history_user_idx").on(generationHistory.userId),
}));

export const apiConfigs = sqliteTable("api_configs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  baseUrl: text("base_url"),
  model: text("model"), // Added model field for storing the model preference
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (apiConfigs) => ({
  // Add index on userId for config lookups
  userIdIdx: index("api_configs_user_idx").on(apiConfigs.userId),
}));

export const assetLibrary = sqliteTable("asset_library", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  assetType: text("asset_type", { enum: ["texture", "model", "sound"] }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull(),
  isPublic: integer("is_public", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (assetLibrary) => ({
  // Add index on userId for asset lookups
  userIdIdx: index("asset_library_user_idx").on(assetLibrary.userId),
}));

export const checkpoints = sqliteTable("checkpoints", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  userId: text("user_id").notNull().references(() => users.id),
  label: text("label").notNull(),
  // Full snapshot of the project's files at checkpoint time, as JSON.
  filesJson: text("files_json").notNull(),
  fileCount: integer("file_count").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (checkpoints) => ({
  projectIdx: index("checkpoints_project_idx").on(checkpoints.projectId),
}));

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  type: text("type", { enum: ["credit_purchase", "subscription"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  creditsAdded: integer("credits_added").notNull(),
  stripePaymentId: text("stripe_payment_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (transactions) => ({
  // Add index on userId for transaction lookups
  userIdIdx: index("transactions_user_idx").on(transactions.userId),
}));
