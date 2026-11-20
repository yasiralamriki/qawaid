CREATE TABLE "registry_jobs" (
	"filing_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"last_error" text,
	"reference_id" varchar(100),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_results" (
	"idempotency_key" varchar(160) PRIMARY KEY NOT NULL,
	"filing_id" uuid NOT NULL,
	"identifier_cr" varchar(20) NOT NULL,
	"reference_id" varchar(100) NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_results_filing_id_unique" UNIQUE("filing_id")
);
--> statement-breakpoint
ALTER TABLE "registry_jobs" ADD CONSTRAINT "registry_jobs_filing_id_compliance_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."compliance_filings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_results" ADD CONSTRAINT "registry_results_filing_id_compliance_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."compliance_filings"("id") ON DELETE cascade ON UPDATE no action;