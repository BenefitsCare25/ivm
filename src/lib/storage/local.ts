import fs from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./index";

const BASE_DIR = process.env.STORAGE_LOCAL_PATH ?? "./uploads";

export class LocalStorageAdapter implements StorageAdapter {
  private async ensureDir(filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(BASE_DIR, key);
    await this.ensureDir(filePath);
    await fs.writeFile(filePath, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const filePath = path.join(BASE_DIR, key);
    return fs.readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(BASE_DIR, key);
    await fs.unlink(filePath).catch(() => {});
  }

  async getUrl(key: string): Promise<string> {
    return `/api/files/${encodeURIComponent(key)}`;
  }
}
