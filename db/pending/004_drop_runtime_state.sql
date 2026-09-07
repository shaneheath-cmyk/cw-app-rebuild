-- HARD STOP: this file is outside db/migrations so the runner cannot execute it.
-- Applying it requires explicit user authorisation, moving it back, and a verified off-node backup.
drop table cw_runtime_state;
