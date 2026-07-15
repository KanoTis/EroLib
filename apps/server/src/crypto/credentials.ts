import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export interface EncryptedBlob {
  /** base64: iv + tag + ciphertext */
  v: 1;
  data: string;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptJson(secret: string, value: unknown): EncryptedBlob {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, encrypted]);
  return { v: 1, data: packed.toString("base64") };
}

export function decryptJson<T>(secret: string, blob: EncryptedBlob): T {
  if (blob.v !== 1 || typeof blob.data !== "string") {
    throw new Error("Unsupported encrypted blob format");
  }
  const key = deriveKey(secret);
  const packed = Buffer.from(blob.data, "base64");
  if (packed.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Encrypted blob too short");
  }
  const iv = packed.subarray(0, IV_LEN);
  const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = packed.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed: unknown = JSON.parse(plain.toString("utf8"));
  return parsed as T;
}

export function encryptString(secret: string, value: string): string {
  return JSON.stringify(encryptJson(secret, value));
}

export function decryptString(secret: string, encoded: string): string {
  const raw: unknown = JSON.parse(encoded);
  if (!raw || typeof raw !== "object" || !("v" in raw) || !("data" in raw)) {
    throw new Error("Invalid encrypted string payload");
  }
  const blob = raw as EncryptedBlob;
  return decryptJson<string>(secret, blob);
}
