-- Add optional date-only thought review scheduling. Existing rows remain unscheduled.
ALTER TABLE "ideas" ADD COLUMN "review_on" DATE;

CREATE INDEX "idx_ideas_user_updated_id" ON "ideas"("user_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "idx_ideas_user_status_review_on" ON "ideas"("user_id", "status", "review_on");
