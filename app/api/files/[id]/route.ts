import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessPatient } from "@/lib/access";
import { audit } from "@/lib/audit";
import { INLINE_MIME } from "@/lib/security";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const a = await db.attachment.findUnique({ where: { id: Number((await params).id) } });
  if (!a || !(await canAccessPatient(u, a.patientId))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const root = path.resolve(process.cwd(), "uploads");
  const full = path.resolve(root, a.path);
  if (!full.startsWith(root + path.sep)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = await readFile(full);
  await audit(u.id, "Attachment", a.id, "download", a.fileName);

  // Тек сурет/PDF браузерде ашылады, қалғаны — жүктеп алынады. Түрі нақты көрсетіледі (sniffing жоқ).
  const inline = INLINE_MIME.has(a.mime);
  return new NextResponse(data, {
    headers: {
      "content-type": inline ? a.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, no-store",
    },
  });
}
