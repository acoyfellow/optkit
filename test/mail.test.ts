import { describe, expect, it } from "vitest";
import { buildRawMessage, encodeHeaderValue, encodeQuotedPrintable } from "../src/mail";
import { signToken, verifyToken } from "../src/crypto";

describe("quoted-printable", () => {
  it("escapes high bytes and wraps lines", () => {
    const encoded = encodeQuotedPrintable("é".repeat(50));
    expect(encoded).toContain("=C3=A9");
    for (const line of encoded.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  it("keeps ascii readable", () => {
    expect(encodeQuotedPrintable("plain text")).toBe("plain text");
  });
});

describe("headers", () => {
  it("encodes non-ascii subjects", () => {
    expect(encodeHeaderValue("olá")).toContain("=?utf-8?b?");
    expect(encodeHeaderValue("hello")).toBe("hello");
  });
});

describe("raw message", () => {
  it("includes parts and RFC 8058 headers", () => {
    const raw = buildRawMessage({
      from: "newsletter@optkit.com",
      fromName: "optkit",
      to: "a@example.com",
      subject: "Hi",
      html: "<p>Hi {{email}}</p>",
      text: "Hi",
      unsubscribeUrl: "https://optkit.com/api/unsubscribe?token=x",
      messageId: "abc@optkit.com",
      date: new Date("2026-11-07T00:00:00Z"),
    });
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Content-Type: text/plain");
    expect(raw).toContain("Content-Type: text/html");
    expect(raw).toContain("Message-ID: <abc@optkit.com>");
  });
});

describe("tokens", () => {
  it("round-trips and rejects tampering", async () => {
    const token = await signToken("secret", "body");
    expect(await verifyToken("secret", token)).toBe("body");
    expect(await verifyToken("secret", `${token}x`)).toBeNull();
    expect(await verifyToken("other", token)).toBeNull();
  });
});
