-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "discordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bggId" INTEGER,
    "minPlayers" INTEGER,
    "maxPlayers" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "playedOn" TIMESTAMP(3) NOT NULL,
    "gameId" TEXT NOT NULL,
    "locationId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionPlayer" (
    "sessionId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,

    CONSTRAINT "SessionPlayer_pkey" PRIMARY KEY ("sessionId","playerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_discordUserId_key" ON "Player"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_name_key" ON "Game"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Session_gameId_idx" ON "Session"("gameId");

-- CreateIndex
CREATE INDEX "Session_playedOn_idx" ON "Session"("playedOn");

-- CreateIndex
CREATE INDEX "SessionPlayer_playerId_idx" ON "SessionPlayer"("playerId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPlayer" ADD CONSTRAINT "SessionPlayer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPlayer" ADD CONSTRAINT "SessionPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
