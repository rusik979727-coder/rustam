import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { safeEqual, verifyMetaSignature, csvSafe, checkUpload, passwordProblem } from "@/lib/security";
import { authSecret } from "@/lib/session";

describe("security helpers", () => {
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
  });

  it("Meta signature", () => {
    const body = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, sig, undefined)).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
  });

  it("CSV injection is neutralized", () => {
    expect(csvSafe('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(csvSafe("+7701+1")).toBe("'+7701+1");
    expect(csvSafe("+77012223344")).toBe("+77012223344");
    expect(csvSafe("@SUM")).toBe("'@SUM");
    expect(csvSafe("Серік")).toBe("Серік");
    expect(csvSafe(null)).toBe("");
  });

  it("upload whitelist + magic bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const pdf = Buffer.from("%PDF-1.7 ...");
    const html = Buffer.from("<script>alert(1)</script>");
    expect(checkUpload("mri.png", png)?.mime).toBe("image/png");
    expect(checkUpload("МРТ қорытынды.PDF", pdf)?.mime).toBe("application/pdf");
    expect(checkUpload("x.html", html)).toBeNull();
    expect(checkUpload("x.svg", html)).toBeNull();
    expect(checkUpload("fake.pdf", html)).toBeNull(); // кеңейтімі pdf, іші HTML
    expect(checkUpload("fake.png", pdf)).toBeNull();
    expect(checkUpload("big.pdf", Buffer.concat([pdf, Buffer.alloc(21 * 1024 * 1024)]))).toBeNull();
  });

  it("password policy", () => {
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem("aaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem("12345678")).not.toBeNull();
    expect(passwordProblem("Beles-2026!")).toBeNull();
  });

  it("AUTH_SECRET required in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const [prevEnv, prevSecret] = [env.NODE_ENV, env.AUTH_SECRET];
    env.NODE_ENV = "production";
    env.AUTH_SECRET = "";
    expect(() => authSecret()).toThrow();
    env.AUTH_SECRET = "change-me-to-a-long-random-string-xxxxx";
    expect(() => authSecret()).toThrow();
    env.AUTH_SECRET = "x".repeat(40);
    expect(authSecret()).toBe("x".repeat(40));
    env.NODE_ENV = prevEnv;
    env.AUTH_SECRET = prevSecret;
  });
});
