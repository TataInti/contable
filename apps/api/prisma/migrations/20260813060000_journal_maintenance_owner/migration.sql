-- The dedicated migration owner may clean fixtures/perform controlled
-- maintenance. Runtime and worker roles remain unable to mutate posted data.
CREATE OR REPLACE FUNCTION protect_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NOT (OLD.status='POSTED' AND NEW.status='REVERSED'
      AND NEW."reversedByEntryId" IS NOT NULL
      AND NEW."clientId"=OLD."clientId" AND NEW."firmId"=OLD."firmId"
      AND NEW."fiscalYearId"=OLD."fiscalYearId" AND NEW."periodId"=OLD."periodId"
      AND NEW."entryDate"=OLD."entryDate" AND NEW.description=OLD.description
      AND NEW."sequenceNumber"=OLD."sequenceNumber") THEN
      RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_posted_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entry text; target_status "JournalEntryStatus";
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  target_entry := COALESCE(NEW."entryId", OLD."entryId");
  SELECT status INTO target_status FROM journal_entries WHERE id=target_entry;
  IF target_status IN ('POSTED', 'REVERSED')
    AND NOT (TG_OP='INSERT' AND current_setting('app.new_posted_entry_id',true)=target_entry) THEN
    RAISE EXCEPTION 'lines of posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mark_new_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='POSTED' THEN PERFORM set_config('app.new_posted_entry_id',NEW.id,true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_mark_new_posted ON journal_entries;
CREATE TRIGGER journal_entries_mark_new_posted BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION mark_new_posted_journal_entry();
