import type { StorageAdapter } from "./index";

export class S3StorageAdapter implements StorageAdapter {
  async upload(_key: string, _data: Buffer, _contentType: string): Promise<string> {
    throw new Error("S3 adapter not implemented. Configure in Phase 2+.");
  }

  async download(_key: string): Promise<Buffer> {
    throw new Error("S3 adapter not implemented.");
  }

  async delete(_key: string): Promise<void> {
    throw new Error("S3 adapter not implemented.");
  }

  async getUrl(_key: string): Promise<string> {
    throw new Error("S3 adapter not implemented.");
  }
}
