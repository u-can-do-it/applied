// Shared by the server and client components.

/**
 * The company part of a job's id ("company|title", public.jw_dup_key: lower case, no legal form or
 * punctuation), as offers_unique.company_key has it; '' for a job without a company.
 */
export const companyKeyOf = (jobId: string) => jobId.split('|', 1)[0];
