CREATE TYPE "public"."filing_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"previous_state" varchar(50),
	"new_state" varchar(50),
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"category" varchar(50) NOT NULL,
	"status" "filing_status" DEFAULT 'DRAFT',
	"version" integer DEFAULT 1 NOT NULL,
	"assigned_reviewer_id" uuid,
	"rejection_reason" text,
	"external_reference_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"identifier_cr" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tenants_identifier_cr_unique" UNIQUE("identifier_cr")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_filing_id_compliance_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."compliance_filings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_filings" ADD CONSTRAINT "compliance_filings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;