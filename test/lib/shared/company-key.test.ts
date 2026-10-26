import { expect, it } from 'vitest';
import { companyKeyOf } from '@/lib/shared/company-key';

it("takes the company part of a job's id, '' when it has none", () => {
  expect(companyKeyOf('upvanta|seniorfrontenddeveloper')).toBe('upvanta');
  expect(companyKeyOf('|reactdeveloper')).toBe('');
});
