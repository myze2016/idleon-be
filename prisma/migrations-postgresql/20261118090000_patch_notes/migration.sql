ALTER TABLE "balance_revisions" ADD COLUMN "patchVersion" INTEGER, ADD COLUMN "patchChanges" JSONB;
CREATE UNIQUE INDEX "balance_revisions_patchVersion_key" ON "balance_revisions"("patchVersion");
