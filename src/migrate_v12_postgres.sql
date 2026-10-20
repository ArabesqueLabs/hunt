-- Schema 11 to 12 (PostgreSQL): more kinds of document. See migrate_v12.sql.
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_kind_check;
ALTER TABLE document ADD CONSTRAINT document_kind_check
    CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'screenshot', 'offer',
                    'contract', 'candidate-resource', 'feedback', 'other'));
