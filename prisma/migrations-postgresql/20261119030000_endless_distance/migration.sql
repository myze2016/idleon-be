-- Wave scores and distance scores belong to separate seasons.
UPDATE endless_runs SET status = 'expired', pending = NULL, ready_at = NULL WHERE status = 'active';
INSERT INTO endless_settings (id, version, config, updated_at)
VALUES (1, 2, '{"enabled":true,"enemyPool":["slime","boar","plant"],"statMultiplier":1.1}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET version = endless_settings.version + 1, updated_at = CURRENT_TIMESTAMP;
COMMENT ON COLUMN endless_runs.wave IS 'Internal continuous-combat checkpoint number; not a gameplay wave';
COMMENT ON COLUMN endless_runs.best_wave IS 'Verified distance travelled in meters for distance seasons';
COMMENT ON COLUMN endless_scores.best_wave IS 'Best verified distance in meters for distance seasons';
