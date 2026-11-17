-- The ad you paste in an offer's window (or have read from a link there) is marked yours, so marking the job
-- applied keeps it: the application's ad was fetched from the board again, and a board that always answers
-- (Eldorado, with what its search lists about the job, not the ad) replaced the text you pasted. Until now
-- nothing told your text from the window's own fetch. Eldorado's are told by their text: its reader only ever
-- writes the "What Eldorado lists about it" lines, so a complete one that isn't those is yours. The other
-- boards' can't be told, and stay as they are (a board that gives no ad already left yours in place).
-- Written by `npm run db:generate` and made idempotent by hand (`if not exists`; a second run marks the same
-- rows). Safe for the previous code: it never names the column, and its inserts get the default.
ALTER TABLE "offer_details" ADD COLUMN IF NOT EXISTS "yours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
update public.offer_details
   set yours = true
 where src = 'eldorado'
   and complete
   and status = 'ok'
   and description not like 'What Eldorado lists about it%';
