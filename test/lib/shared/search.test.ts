import { describe, expect, it } from 'vitest';
import { marksWithin, rank } from '@/lib/shared/search';

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

  it('forgives a typo only when nothing is found as typed', () => {
    const companies = [
      { jobId: 'telemedi', title: 'Full Stack Developer', company: 'Telemedi - digital health' },
      { jobId: 'digis', title: 'React Developer', company: 'Digis' },
    ];
    expect(rank(companies, 'digis')?.ids).toEqual(['digis']);
    expect(rank(companies, 'digit')?.ids).toEqual(['telemedi']);
    expect(rank(companies, 'digiz')?.ids.sort()).toEqual(['digis', 'telemedi']);
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
    expect(found?.marks.get('python')).toEqual({ title: [0, 6], company: [0, 4], note: [] });
    expect(rank(jobs, 'acme react')?.marks.get('react')).toEqual({ title: [27, 32], company: [0, 4], note: [] });
  });

  it('an application’s note is searched too, and marked', () => {
    const apps = [
      { jobId: 'scala', title: 'Fullstack Developer', company: 'Scanye', note: 'Asked about the Scala part' },
      { jobId: 'none', title: 'Frontend Developer', company: null, note: null },
    ];
    const found = rank(apps, 'scala');
    expect(found?.ids).toEqual(['scala']);
    expect(found?.marks.get('scala')).toEqual({ title: [], company: [], note: [16, 21] });
    expect(rank(apps, 'scan')?.marks.get('scala')).toEqual({ title: [], company: [0, 4], note: [] });
  });

  it('nothing to look for: null, the list stays as it is', () => {
    expect(rank(jobs, '%%')).toBeNull();
    expect(rank([], 'java')).toEqual({ ids: [], marks: new Map() });
  });
});

describe('marksWithin', () => {
  it('the marks in a part of the text, from its start, cut at its ends', () => {
    expect(marksWithin([0, 3, 5, 9, 12, 14], 4, 10)).toEqual([1, 5]);
    expect(marksWithin([2, 8], 4, 6)).toEqual([0, 2]);
    expect(marksWithin(undefined, 0, 5)).toEqual([]);
  });
});
