declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BACKUP_SERVICE_TOKEN?: string;
    AUTH_PROVIDER?: string;
  }
}
