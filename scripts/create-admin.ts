/**
 * Бірінші бас менеджерді құру / құпиясөзін қалпына келтіру:
 *   docker compose run --rm -e ADMIN_PASSWORD='...' app npx tsx scripts/create-admin.ts <login> "<Аты-жөні>"
 * ADMIN_PASSWORD берілмесе — кездейсоқ құпиясөз жасалып, экранға бір рет шығады.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { passwordProblem } from "../lib/security";

const db = new PrismaClient();

async function main() {
  const [login, ...nameParts] = process.argv.slice(2);
  if (!login) throw new Error("Қолданылуы: create-admin.ts <login> \"<Аты-жөні>\"");
  const name = nameParts.join(" ") || "Бас менеджер";
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString("base64url");
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Құпиясөз әлсіз: ${problem}`);
  const passwordHash = await bcrypt.hash(password, 12);
  const u = await db.user.upsert({
    where: { login },
    update: { passwordHash, role: "HEAD_MANAGER", active: true, sessionVersion: { increment: 1 } },
    create: { login, name, passwordHash, role: "HEAD_MANAGER" },
  });
  await db.loginAttempt.deleteMany({ where: { key: `l:${login}` } });
  console.log(`✓ Бас менеджер: ${u.login} (${u.name})`);
  if (generated) console.log(`  Құпиясөз (бір рет көрсетіледі, сақтап алыңыз): ${password}`);
}

main()
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
