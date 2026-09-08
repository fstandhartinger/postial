import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const value = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");
  if (value.length !== 32)
    throw new Error("Channel encryption is not configured");
  return value;
}
export function encryptCredentials(
  credentials: Record<string, string>,
): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decryptCredentials(value: string): Record<string, string> {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"),
  );
}
