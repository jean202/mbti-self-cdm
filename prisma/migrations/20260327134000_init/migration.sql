-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('KAKAO', 'GOOGLE', 'APPLE', 'NAVER');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('AUTH_ONLY', 'MBTI_PENDING', 'CALENDAR_PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MbtiSource" AS ENUM ('SELF_SELECTED', 'FINDER_RESULT', 'MANUAL_CHANGE');

-- CreateEnum
CREATE TYPE "FinderAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('INBOX', 'PLANNED', 'IN_PROGRESS', 'DONE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskSourceType" AS ENUM ('QUICK_CAPTURE', 'IDEA_CONVERSION', 'ROUTINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "TodayFocusStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RoutineCadenceType" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'APPLE', 'OTHER');

-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('ACTIVE', 'SYNCING', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckContext" AS ENUM ('MORNING', 'EVENING', 'ADHOC');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(100),
    "primary_email" VARCHAR(255),
    "locale" VARCHAR(16) NOT NULL DEFAULT 'ko-KR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul',
    "onboarding_status" "OnboardingStatus" NOT NULL DEFAULT 'AUTH_ONLY',
    "notification_prefs_json" JSONB,
    "last_active_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_user_id" VARCHAR(255) NOT NULL,
    "provider_email" VARCHAR(255),
    "provider_display_name" VARCHAR(255),
    "raw_profile_json" JSONB,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mbti_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type_code" CHAR(4) NOT NULL,
    "source" "MbtiSource" NOT NULL,
    "is_user_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confidence_score" DECIMAL(5,4),
    "finder_version" VARCHAR(32),
    "profile_version" VARCHAR(32),
    "last_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mbti_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mbti_finder_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "FinderAttemptStatus" NOT NULL,
    "question_set_version" VARCHAR(32) NOT NULL,
    "predicted_type_code" CHAR(4),
    "confidence_score" DECIMAL(5,4),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "abandoned_at" TIMESTAMPTZ(6),

    CONSTRAINT "mbti_finder_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mbti_finder_answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" VARCHAR(64) NOT NULL,
    "answer_value" SMALLINT NOT NULL,
    "answered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mbti_finder_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'ACTIVE',
    "tags_json" JSONB,
    "converted_task_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "today_focuses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "linked_task_id" UUID,
    "status" "TodayFocusStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "today_focuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'INBOX',
    "source_type" "TaskSourceType" NOT NULL,
    "linked_idea_id" UUID,
    "today_focus_id" UUID,
    "linked_calendar_event_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "local_due_date" DATE,
    "reminder_at" TIMESTAMPTZ(6),
    "energy_estimate" SMALLINT,
    "sort_order" INTEGER,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routines" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "cadence_type" "RoutineCadenceType" NOT NULL,
    "cadence_payload_json" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "provider_account_id" VARCHAR(255) NOT NULL,
    "account_label" VARCHAR(255),
    "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentials_ref" VARCHAR(255),
    "scopes_json" JSONB,
    "sync_cursor_json" JSONB,
    "last_synced_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(64),
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "calendar_name" VARCHAR(255),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "event_status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "provider_updated_at" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "raw_payload_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mood_energy_checks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "context" "CheckContext" NOT NULL,
    "mood_score" SMALLINT NOT NULL,
    "energy_score" SMALLINT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mood_energy_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mindfulness_prompts" (
    "id" UUID NOT NULL,
    "type_code" CHAR(4),
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "stress_signal_key" VARCHAR(64),
    "recovery_mode" VARCHAR(64),
    "duration_minutes" SMALLINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mindfulness_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "today_focus_id" UUID,
    "mood_energy_check_id" UUID,
    "mindfulness_prompt_id" UUID,
    "completed_summary" TEXT,
    "carry_forward_note" TEXT,
    "prompt_answers_json" JSONB,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reflections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_users_onboarding_status" ON "users"("onboarding_status");

-- CreateIndex
CREATE INDEX "idx_auth_identities_user_id" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_user_id_key" ON "auth_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mbti_profiles_user_id_key" ON "mbti_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_mbti_finder_attempts_user_id_started_at" ON "mbti_finder_attempts"("user_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mbti_finder_answers_attempt_id_question_id_key" ON "mbti_finder_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_converted_task_id_key" ON "ideas"("converted_task_id");

-- CreateIndex
CREATE INDEX "idx_ideas_user_id_status_updated_at" ON "ideas"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "today_focuses_user_id_local_date_key" ON "today_focuses"("user_id", "local_date");

-- CreateIndex
CREATE INDEX "idx_tasks_user_id_status_due_at" ON "tasks"("user_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "idx_tasks_user_id_today_focus_id" ON "tasks"("user_id", "today_focus_id");

-- CreateIndex
CREATE INDEX "idx_tasks_user_id_updated_at" ON "tasks"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_calendar_connections_user_id_status" ON "calendar_connections"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_user_id_provider_provider_account_id_key" ON "calendar_connections"("user_id", "provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "idx_calendar_events_user_id_starts_at" ON "calendar_events"("user_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_connection_id_provider_event_id_key" ON "calendar_events"("connection_id", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "mood_energy_checks_user_id_local_date_context_key" ON "mood_energy_checks"("user_id", "local_date", "context");

-- CreateIndex
CREATE UNIQUE INDEX "reflections_user_id_local_date_key" ON "reflections"("user_id", "local_date");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mbti_profiles" ADD CONSTRAINT "mbti_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mbti_finder_attempts" ADD CONSTRAINT "mbti_finder_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mbti_finder_answers" ADD CONSTRAINT "mbti_finder_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "mbti_finder_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_converted_task_id_fkey" FOREIGN KEY ("converted_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "today_focuses" ADD CONSTRAINT "today_focuses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "today_focuses" ADD CONSTRAINT "today_focuses_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linked_idea_id_fkey" FOREIGN KEY ("linked_idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_today_focus_id_fkey" FOREIGN KEY ("today_focus_id") REFERENCES "today_focuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linked_calendar_event_id_fkey" FOREIGN KEY ("linked_calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "calendar_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mood_energy_checks" ADD CONSTRAINT "mood_energy_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_today_focus_id_fkey" FOREIGN KEY ("today_focus_id") REFERENCES "today_focuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_mood_energy_check_id_fkey" FOREIGN KEY ("mood_energy_check_id") REFERENCES "mood_energy_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_mindfulness_prompt_id_fkey" FOREIGN KEY ("mindfulness_prompt_id") REFERENCES "mindfulness_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
