import * as Minio from "minio";

/**
 * Almacenamiento de objetos (MinIO) — compartido entre API y worker.
 * Buckets: quarantine, originals, derived, exports.
 */

export const BUCKETS = {
  quarantine: "quarantine",
  originals: "originals",
  derived: "derived",
  exports: "exports",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface StorageConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  region: string;
  accessKey: string;
  secretKey: string;
}

export function loadStorageConfig(): StorageConfig {
  return {
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: parseInt(process.env.MINIO_PORT ?? "9000", 10),
    useSSL: process.env.MINIO_USE_SSL === "true",
    region: process.env.MINIO_REGION ?? "us-east-1",
    accessKey: process.env.MINIO_ACCESS_KEY ?? "contable",
    secretKey: process.env.MINIO_SECRET_KEY ?? "contable-minio",
  };
}

export function loadPublicStorageConfig(internal: StorageConfig = loadStorageConfig()): StorageConfig {
  return {
    endPoint: process.env.MINIO_PUBLIC_ENDPOINT ?? internal.endPoint,
    port: parseInt(process.env.MINIO_PUBLIC_PORT ?? String(internal.port), 10),
    useSSL: process.env.MINIO_PUBLIC_USE_SSL === "true",
    region: internal.region,
    accessKey: internal.accessKey,
    secretKey: internal.secretKey,
  };
}

export class ObjectStorage {
  private client: Minio.Client;
  private presignClient: Minio.Client;
  private config: StorageConfig;

  constructor(config: StorageConfig = loadStorageConfig(), publicConfig: StorageConfig = loadPublicStorageConfig(config)) {
    this.config = config;
    this.client = new Minio.Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      region: config.region,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.presignClient = new Minio.Client({
      endPoint: publicConfig.endPoint,
      port: publicConfig.port,
      useSSL: publicConfig.useSSL,
      region: publicConfig.region,
      accessKey: publicConfig.accessKey,
      secretKey: publicConfig.secretKey,
    });
  }

  async ensureBuckets(): Promise<void> {
    for (const bucket of Object.values(BUCKETS)) {
      const exists = await this.client.bucketExists(bucket);
      if (!exists) await this.client.makeBucket(bucket);
    }
  }

  async put(bucket: BucketName, key: string, data: Buffer, size: number): Promise<void> {
    await this.client.putObject(bucket, key, data, size);
  }

  async getPresignedPutUrl(bucket: BucketName, key: string, _maxSizeBytes: number, ttlSeconds = 900): Promise<string> {
    return this.presignClient.presignedPutObject(bucket, key, ttlSeconds);
  }

  async getPresignedGetUrl(bucket: BucketName, key: string, ttlSeconds = 300): Promise<string> {
    return this.presignClient.presignedGetObject(bucket, key, ttlSeconds);
  }

  async get(bucket: BucketName, key: string): Promise<Buffer> {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async promote(from: BucketName, objectKey: string, to: BucketName): Promise<void> {
    await this.client.copyObject(to, objectKey, `${from}/${objectKey}`);
  }

  async remove(bucket: BucketName, key: string): Promise<void> {
    await this.client.removeObject(bucket, key);
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.bucketExists(BUCKETS.quarantine);
      return true;
    } catch {
      return false;
    }
  }
}
