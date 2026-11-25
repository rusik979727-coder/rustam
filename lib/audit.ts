import { db } from "./db";

export async function audit(userId: number | null, entity: string, entityId: number | null, action: string, details?: unknown) {
  await db.auditLog.create({
    data: {
      userId,
      entity,
      entityId,
      action,
      details: details === undefined ? null : typeof details === "string" ? details : JSON.stringify(details),
    },
  });
}
