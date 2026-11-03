-- Schema 2 to 3: more about a company, as its website or LinkedIn page
-- describes it.

ALTER TABLE company ADD COLUMN linkedin TEXT;
ALTER TABLE company ADD COLUMN description TEXT;
ALTER TABLE company ADD COLUMN industry TEXT;
ALTER TABLE company ADD COLUMN size TEXT;
ALTER TABLE company ADD COLUMN headquarters TEXT;
ALTER TABLE company ADD COLUMN founded TEXT;
