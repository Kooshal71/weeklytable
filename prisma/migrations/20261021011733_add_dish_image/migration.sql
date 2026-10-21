-- CreateTable
CREATE TABLE "DishImage" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DishImage_pkey" PRIMARY KEY ("id")
);
