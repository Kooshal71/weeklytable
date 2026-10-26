-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('web', 'whatsapp');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'web';

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "waId" TEXT NOT NULL,
    "profileName" TEXT,
    "step" TEXT NOT NULL DEFAULT 'idle',
    "draft" JSONB NOT NULL DEFAULT '{}',
    "humanUntil" TIMESTAMP(3),
    "lastWelcomeAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("waId")
);

-- CreateTable
CREATE TABLE "WhatsAppProcessedMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppProcessedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCatalogSync" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ok" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppCatalogSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppProcessedMessage_createdAt_idx" ON "WhatsAppProcessedMessage"("createdAt");

