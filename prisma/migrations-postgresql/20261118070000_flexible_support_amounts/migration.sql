ALTER TABLE "support_submissions" ALTER COLUMN "amount" TYPE DECIMAL(12,2) USING "amount"::DECIMAL(12,2);
ALTER TABLE "support_submissions" DROP CONSTRAINT "support_submissions_tier_check";
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_tier_check" CHECK ("tier" BETWEEN 0 AND 3);
ALTER TABLE "support_submissions" ADD CONSTRAINT "support_submissions_amount_positive" CHECK ("amount" > 0);
