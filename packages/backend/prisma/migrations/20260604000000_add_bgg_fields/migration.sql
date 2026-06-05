-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "bggName" TEXT,
ADD COLUMN     "bggThumbnail" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "yearPublished" INTEGER;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "bggUsername" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Game_bggId_key" ON "Game"("bggId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_bggUsername_key" ON "Player"("bggUsername");

