export interface StorageAdapter {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): Promise<string>;
}

export function getStorageAdapter(): StorageAdapter {
  const provider = process.env.STORAGE_PROVIDER ?? "local";
  switch (provider) {
    case "local": {
      const { LocalStorageAdapter } = require("./local");
      return new LocalStorageAdapter();
    }
    case "s3": {
      const { S3StorageAdapter } = require("./s3");
      return new S3StorageAdapter();
    }
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}
