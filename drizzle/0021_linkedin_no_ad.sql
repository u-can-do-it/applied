-- LinkedIn's ads saved as "no ad text" (offer_details 'empty') were its login wall or an HTTP 429, not ads
-- without text: every posting has one. Since this version a LinkedIn read without the ad is an error, never
-- saved, and a job whose ads are all 'empty' is never judged (the AI judges a job only from its ad), so these
-- rows go: the next read of those ads tries again. The version before this one, between this migration and
-- its deploy, only reads them again too. Runs any number of times.
delete from public.offer_details where src = 'linkedin' and status = 'empty';
