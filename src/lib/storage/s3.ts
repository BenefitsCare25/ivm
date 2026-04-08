import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "./index";

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET environment variable is required for S3 storage");

    this.bucket = bucket;
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "ap-southeast-1",
      ...(process.env.S3_ENDPOINT && { endpoint: process.env.S3_ENDPOINT }),
      ...(process.env.S3_ACCESS_KEY_ID && {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        },
      }),
    });
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const stream = response.Body;
    if (!stream) throw new Error(`Empty response for key: ${key}`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async getUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: 3600 });
  }
}
