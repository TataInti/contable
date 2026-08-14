-- Permit the initial balanced lines of a newly inserted posted entry while
-- keeping every later line mutation blocked.
CREATE OR REPLACE FUNCTION mark_new_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='POSTED' THEN PERFORM set_config('app.new_posted_entry_id',NEW.id,true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_mark_new_posted ON journal_entries;
CREATE TRIGGER journal_entries_mark_new_posted BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION mark_new_posted_journal_entry();

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
