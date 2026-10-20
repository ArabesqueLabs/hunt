-- Schema 15 to 16 (PostgreSQL): more kinds of document. See migrate_v16.sql.
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_kind_check;
ALTER TABLE document ADD CONSTRAINT document_kind_check
    CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'certificate',
                    'screenshot', 'job-description', 'assignment', 'offer', 'contract',
                    'nda', 'background-check', 'right-to-work', 'candidate-resource',
                    'feedback', 'other'));
