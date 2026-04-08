export interface StorageAdapter {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): Promise<string>;
}

let cachedAdapter: StorageAdapter | undefined;

export function getStorageAdapter(): StorageAdapter {
  if (cachedAdapter) return cachedAdapter;

  const provider = process.env.STORAGE_PROVIDER ?? "local";
  switch (provider) {
    case "local": {
      const { LocalStorageAdapter } = require("./local");
      cachedAdapter = new LocalStorageAdapter();
      break;
    }
    case "s3": {
      const { S3StorageAdapter } = require("./s3");
      cachedAdapter = new S3StorageAdapter();
      break;
    }
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
  return cachedAdapter!;
}
