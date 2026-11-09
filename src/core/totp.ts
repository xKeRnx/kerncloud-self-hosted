import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buffer: Uint8Array) {
  let bits = 0,
    value = 0,
    output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function decode(value: string) {
  let bits = 0,
    number = 0;
  const bytes: number[] = [];
  for (const char of value.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    number = (number << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((number >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function newTotpSecret() {
  return base32(randomBytes(20));
}
export function totpCode(secret: string, time = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const digest = createHmac("sha1", decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(number).padStart(digits, "0");
}
export function matchingTotpStep(
  secret: string,
  code: string,
  lastStep = -1,
  time = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(time / 30000);
  for (const delta of [0, -1, 1]) {
    const step = current + delta;
    if (
      step > lastStep &&
      step >= 0 &&
      timingSafeEqual(
        Buffer.from(totpCode(secret, step * 30000)),
        Buffer.from(code),
      )
    )
      return step;
  }
  return null;
}
