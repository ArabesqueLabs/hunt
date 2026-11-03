-- Schema 11 to 12 (MySQL): more kinds of document. See migrate_v12.sql. The
-- column's CHECK was named by MySQL, as the table's first.
ALTER TABLE document DROP CHECK document_chk_1;
ALTER TABLE document ADD CONSTRAINT document_kind_check
    CHECK (kind IN ('resume', 'cover-letter', 'portfolio', 'reference', 'screenshot', 'offer',
                    'contract', 'candidate-resource', 'feedback', 'other'));
