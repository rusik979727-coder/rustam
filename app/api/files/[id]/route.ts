import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const a = await db.attachment.findUnique({ where: { id: Number((await params).id) } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = await readFile(path.join(process.cwd(), "uploads", a.path));
  return new NextResponse(data, {
    headers: { "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}` },
  });
}
