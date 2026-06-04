-- CreateEnum
CREATE TYPE "GoalHorizon" AS ENUM ('SHORT_TERM', 'MID_TERM', 'LONG_TERM');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "horizon" "GoalHorizon" NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "target_value" DECIMAL(12,2) NOT NULL,
    "current_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit" VARCHAR(32) NOT NULL DEFAULT '개',
    "start_date" DATE NOT NULL,
    "target_date" DATE,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_goals_user_id_status_horizon" ON "goals"("user_id", "status", "horizon");

-- CreateIndex
CREATE INDEX "idx_goals_user_id_target_date" ON "goals"("user_id", "target_date");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
