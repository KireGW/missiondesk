ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS event_date TEXT;
