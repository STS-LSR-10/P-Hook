-- Early Bird seats, the same for a month and a year: Starter 200, Pro 100, Elite 30 (was Starter
-- 500 yearly / no limit monthly, Pro 100 / 200, Elite 30 / 50). Seats already taken stay taken; past
-- the new number no more are given. Safe to run again.
update early_bird_seats set total = 200 where plan = 'starter';
update early_bird_seats set total = 100 where plan = 'plus';
update early_bird_seats set total = 30 where plan = 'ultimate';
