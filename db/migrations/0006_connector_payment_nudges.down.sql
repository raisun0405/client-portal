-- 0006_connector_payment_nudges (down)
-- Removes the record of connector payment reminders. Run only AFTER the code
-- that uses it has been reverted (db/ROLLBACK.md, rule 1).
-- Lost on revert: when each client's Claude last mentioned a pending payment.
-- No payment or client data is touched.

DROP TABLE IF EXISTS connector_payment_nudges;
