-- CreateEnum
CREATE TYPE "VideoSuggestionState" AS ENUM ('LOW_MOOD', 'UNRESPONSIVE', 'OVERAROUSED');

-- CreateEnum
CREATE TYPE "VideoSuggestionAction" AS ENUM ('OPENED', 'DISMISSED');

-- CreateTable
CREATE TABLE "video_suggestion_feedbacks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type_code" CHAR(4),
    "state" "VideoSuggestionState" NOT NULL,
    "action" "VideoSuggestionAction" NOT NULL,
    "video_id" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_suggestion_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_video_suggestion_feedbacks_user_id_state_created_at" ON "video_suggestion_feedbacks"("user_id", "state", "created_at");

-- AddForeignKey
ALTER TABLE "video_suggestion_feedbacks" ADD CONSTRAINT "video_suggestion_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
