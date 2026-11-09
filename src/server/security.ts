import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = scryptSync(password, salt, 64),
    b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
function encryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new Error("ENCRYPTION_KEY muss 64 Hex-Zeichen enthalten.");
  return Buffer.from(key, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((x) => x.toString("base64"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((x) => Buffer.from(x, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
export function validateEndpoint(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Nur HTTP(S)-URLs ohne eingebettete Zugangsdaten sind erlaubt.",
    );
  return url.toString().replace(/\/$/, "");
}
export function redact(value: string) {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]");
}
