import fs from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./index";

const BASE_DIR = path.resolve(process.env.STORAGE_LOCAL_PATH ?? "./uploads");

/** Reject keys that could escape BASE_DIR via path traversal. */
function validateKey(key: string): void {
  if (
    !key ||
    key.includes("..") ||
    key.startsWith("/") ||
    key.startsWith("\\") ||
    /[<>:"|?*\x00-\x1f]/.test(key)
  ) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  private async ensureDir(filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    validateKey(key);
    const filePath = path.join(BASE_DIR, key);
    await this.ensureDir(filePath);
    await fs.writeFile(filePath, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    validateKey(key);
    const filePath = path.join(BASE_DIR, key);
    return fs.readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    validateKey(key);
    const filePath = path.join(BASE_DIR, key);
    await fs.unlink(filePath).catch(() => {});
  }

  async getUrl(key: string): Promise<string> {
    return `/api/files/${encodeURIComponent(key)}`;
  }
}
