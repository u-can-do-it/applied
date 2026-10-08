import { describe, expect, it } from 'vitest';
import { rank } from '@/lib/shared/search';

// newest first, as lib/db/repos/offers.ts searchable() lists them
const jobs = [
  { jobId: 'java', title: 'Java Developer', company: 'Acme' },
  { jobId: 'advocate', title: 'Developer Advocate', company: 'Devtools' },
  { jobId: 'python', title: 'Python Engineer', company: 'Łódź Soft' },
  { jobId: 'dotnet', title: 'C# .NET Developer', company: null },
  { jobId: 'react', title: 'Senior Frontend Developer (React)', company: 'Acme' },
];
const ids = (query: string) => rank(jobs, query)?.ids;

describe('rank', () => {
  it('finds every word, in the title or the company, in any order', () => {
    expect(ids('acme java')).toEqual(['java']);
    expect(ids('react senior')).toEqual(['react']);
    expect(ids('java react')).toEqual([]);
  });

  it('forgives one typo in a longer word, and ignores accents and case', () => {
    expect(ids('pyhton')).toEqual(['python']);
    expect(ids('LODZ')).toEqual(['python']);
    expect(ids('devloper')?.sort()).toEqual(['advocate', 'dotnet', 'java', 'react']);
    expect(ids('ptyhno')).toEqual([]); // two
  });

  it('ranks a whole word at the start first, then the newest', () => {
    expect(ids('dev')).toEqual(['advocate', 'java', 'dotnet', 'react']);
    expect(ids('developer')).toEqual(['advocate', 'java', 'dotnet', 'react']);
  });

  it('takes "phrases" as they are, and leaves out -words', () => {
    expect(ids('"senior frontend"')).toEqual(['react']);
    expect(ids('"frontend senior"')).toEqual([]);
    expect(ids('developer -java -"c#"')?.sort()).toEqual(['advocate', 'react']);
  });

  it('keeps the punctuation of C#, .NET and the like', () => {
    expect(ids('c#')).toEqual(['dotnet']);
    expect(ids('.NET')).toEqual(['dotnet']);
    expect(ids('c++')).toEqual([]);
  });

  it('says where it matched, in the title and the company', () => {
    const found = rank(jobs, 'pyhton lodz');
    expect(found?.marks.get('python')).toEqual({ title: [0, 6], company: [0, 4] });
    expect(rank(jobs, 'acme react')?.marks.get('react')).toEqual({ title: [27, 32], company: [0, 4] });
  });

  it('nothing to look for: null, the list stays as it is', () => {
    expect(rank(jobs, '%%')).toBeNull();
    expect(rank([], 'java')).toEqual({ ids: [], marks: new Map() });
  });
});
