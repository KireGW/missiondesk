-- Cleanup-only migration: normalize known MVP placeholder strings.
-- Keep event_date as TEXT for backward compatibility until Upcoming Signals
-- gets a dedicated event model.
UPDATE processed_items
SET event_date = NULL,
    updated_at = datetime('now')
WHERE event_date IS NOT NULL
  AND (
    trim(event_date) = ''
    OR lower(trim(event_date)) IN ('null', 'undefined', 'nan')
  );
