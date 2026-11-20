-- Backfill verification tracking for pre-integration approvals without changing their review status.
INSERT INTO registry_jobs (filing_id, status, reference_id)
SELECT id, CASE WHEN external_reference_id IS NULL THEN 'PENDING' ELSE 'VERIFIED' END, external_reference_id
FROM compliance_filings WHERE status = 'APPROVED'
ON CONFLICT (filing_id) DO NOTHING;
