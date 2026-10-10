-- Better Auth 1.7.0 through 1.7.2 required account.issuer, while 1.7.3 and
-- later identify credentials by providerId and accountId. Preserve existing
-- issuer values while allowing new credential rows to omit the legacy value.
ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "account_issuer_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "account_issuer_accountId_uidx";
