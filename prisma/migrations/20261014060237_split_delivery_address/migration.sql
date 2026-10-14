/*
  Warnings:

  - You are about to drop the column `deliveryAddress` on the `Order` table. All the data in the column will be lost.
  - Added the required column `addressLine1` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `city` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `postcode` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "deliveryAddress",
ADD COLUMN     "addressLine1" TEXT NOT NULL,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "postcode" TEXT NOT NULL;
