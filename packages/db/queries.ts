import { eq, and, desc } from "drizzle-orm";
import { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export class DBQueries {
  constructor(private db: DrizzleD1Database<typeof schema>) {}

  // Users
  async getUser(id: string) {
    return this.db.query.users.findFirst({ where: eq(schema.users.id, id) });
  }

  async getUserByEmail(email: string) {
    return this.db.query.users.findFirst({ where: eq(schema.users.email, email) });
  }

  async updateUserCredits(id: string, credits: number) {
    return this.db.update(schema.users)
      .set({ creditsRemaining: credits, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
  }

  // Projects
  async createProject(project: typeof schema.projects.$inferInsert) {
    return this.db.insert(schema.projects).values(project).returning();
  }

  async getProject(id: string) {
    return this.db.query.projects.findFirst({
      where: eq(schema.projects.id, id),
    });
  }

  async getUserProjects(userId: string) {
    return this.db.query.projects.findMany({
      where: eq(schema.projects.userId, userId),
      orderBy: [desc(schema.projects.updatedAt)],
    });
  }

  async updateProjectStatus(id: string, status: "idle" | "generating" | "ready" | "failed") {
    return this.db.update(schema.projects)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.projects.id, id))
      .returning();
  }

  // Project Files
  async upsertProjectFile(file: typeof schema.projectFiles.$inferInsert) {
    const existing = await this.db.query.projectFiles.findFirst({
      where: and(
        eq(schema.projectFiles.projectId, file.projectId),
        eq(schema.projectFiles.filePath, file.filePath)
      )
    });

    if (existing) {
      return this.db.update(schema.projectFiles)
        .set({ fileContent: file.fileContent, updatedAt: new Date() })
        .where(eq(schema.projectFiles.id, existing.id))
        .returning();
    }

    return this.db.insert(schema.projectFiles).values(file).returning();
  }

  async getProjectFiles(projectId: string) {
    return this.db.query.projectFiles.findMany({
      where: eq(schema.projectFiles.projectId, projectId),
    });
  }
}
