-- SIG-Cloud : migration initiale (écrite à la main pour correspondre à prisma/schema.prisma).
-- À valider chez toi : `npx prisma migrate dev` doit n'afficher aucune dérive.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "UploadStatus" AS ENUM ('UPLOADING', 'READY');
CREATE TYPE "SecurityStatus" AS ENUM ('PENDING', 'FORMAT_VERIFIED', 'NOT_DEEP_SCANNED');
CREATE TYPE "PreviewStatus" AS ENUM ('NONE', 'PREVIEWABLE', 'UNSUPPORTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "quotaBytes" BIGINT NOT NULL,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_usedBytes_nonneg" CHECK ("usedBytes" >= 0),
    CONSTRAINT "users_quotaBytes_nonneg" CHECK ("quotaBytes" >= 0)
);

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "trashBatchId" TEXT,
    "trashRoot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "file_assets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "multipartId" TEXT,
    "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'UPLOADING',
    "securityStatus" "SecurityStatus" NOT NULL DEFAULT 'PENDING',
    "previewStatus" "PreviewStatus" NOT NULL DEFAULT 'NONE',
    "previewReason" TEXT,
    "detectedType" TEXT,
    "sha256" TEXT,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geoMeta" JSONB,
    "deletedAt" TIMESTAMP(3),
    "trashBatchId" TEXT,
    "trashRoot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "file_assets_size_nonneg" CHECK ("sizeBytes" >= 0)
);

CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "fileId" TEXT,
    "folderId" TEXT,
    "createdById" TEXT NOT NULL,
    "canDownload" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "share_links_one_target" CHECK (("fileId" IS NOT NULL AND "folderId" IS NULL) OR ("fileId" IS NULL AND "folderId" IS NOT NULL))
);

CREATE TABLE "share_grants" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "granteeId" TEXT NOT NULL,
    "fileId" TEXT,
    "folderId" TEXT,
    "canDownload" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "share_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "share_grants_one_target" CHECK (("fileId" IS NOT NULL AND "folderId" IS NULL) OR ("fileId" IS NULL AND "folderId" IS NOT NULL)),
    CONSTRAINT "share_grants_not_self" CHECK ("ownerId" <> "granteeId")
);

CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");
CREATE INDEX "folders_ownerId_parentId_deletedAt_idx" ON "folders"("ownerId", "parentId", "deletedAt");
CREATE INDEX "folders_parentId_idx" ON "folders"("parentId");
CREATE INDEX "folders_trashBatchId_idx" ON "folders"("trashBatchId");
CREATE UNIQUE INDEX "file_assets_storageKey_key" ON "file_assets"("storageKey");
CREATE INDEX "file_assets_ownerId_folderId_deletedAt_idx" ON "file_assets"("ownerId", "folderId", "deletedAt");
CREATE INDEX "file_assets_ownerId_uploadStatus_createdAt_idx" ON "file_assets"("ownerId", "uploadStatus", "createdAt");
CREATE INDEX "file_assets_folderId_idx" ON "file_assets"("folderId");
CREATE INDEX "file_assets_trashBatchId_idx" ON "file_assets"("trashBatchId");
CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links"("tokenHash");
CREATE INDEX "share_links_fileId_idx" ON "share_links"("fileId");
CREATE INDEX "share_links_folderId_idx" ON "share_links"("folderId");
CREATE INDEX "share_links_createdById_idx" ON "share_links"("createdById");
CREATE UNIQUE INDEX "share_grants_granteeId_fileId_key" ON "share_grants"("granteeId", "fileId");
CREATE UNIQUE INDEX "share_grants_granteeId_folderId_key" ON "share_grants"("granteeId", "folderId");
CREATE INDEX "share_grants_ownerId_idx" ON "share_grants"("ownerId");
CREATE INDEX "share_grants_fileId_idx" ON "share_grants"("fileId");
CREATE INDEX "share_grants_folderId_idx" ON "share_grants"("folderId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");
CREATE INDEX "rate_limits_resetAt_idx" ON "rate_limits"("resetAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folders" ADD CONSTRAINT "folders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folders" ADD CONSTRAINT "folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "file_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "file_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
