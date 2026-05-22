import { S3Client } from "@aws-sdk/client-s3";

// E2E object storage endpoint (S3-compatible). Documents are fetched from here.
export const S3_ENDPOINT = "https://in-south1-objectstore.e2enetworks.net";

export const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  endpoint: S3_ENDPOINT,
  // S3-compatible stores (E2E, MinIO, Ceph) require path-style addressing.
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
