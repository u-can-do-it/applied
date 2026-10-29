import { describe, expect, it } from 'vitest';
import { marksWithin, rank, snippetOf } from '@/lib/shared/search';

// newest first, as lib/db/repos/offer-search.ts searchable() lists them
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
    expect(found?.marks.get('python')).toEqual({ title: [0, 6], company: [0, 4], note: [], more: [] });
    expect(rank(jobs, 'acme react')?.marks.get('react')).toEqual({
      title: [27, 32],
      company: [0, 4],
      note: [],
      more: [],
    });
  });

  it('an application’s note is searched too, and marked', () => {
    const apps = [
      { jobId: 'scala', title: 'Fullstack Developer', company: 'Scanye', note: 'Asked about the Scala part' },
      { jobId: 'none', title: 'Frontend Developer', company: null, note: null },
    ];
    const found = rank(apps, 'scala');
    expect(found?.ids).toEqual(['scala']);
    expect(found?.marks.get('scala')).toEqual({ title: [], company: [], note: [16, 21], more: [] });
    expect(rank(apps, 'scan')?.marks.get('scala')).toEqual({ title: [], company: [0, 4], note: [], more: [] });
  });

  it('searching everything, the rest too: the ad, what the board says besides', () => {
    const ads = [
      { jobId: 'k8s', title: 'Backend Developer', company: 'Acme', more: 'Salary 25000 PLN\nWe run Kubernetes on AWS' },
      {
        jobId: 'noted',
        title: 'Backend Developer',
        company: null,
        note: 'Kubernetes mentioned on the call',
        more: null,
      },
      { jobId: 'plain', title: 'Kubernetes Engineer', company: 'Beta', more: '' },
    ];
    expect(rank(ads, 'kubernets')?.ids).toEqual(['plain', 'noted', 'k8s']); // the title's first
    expect(rank(ads, 'kubernetes aws')?.marks.get('k8s')).toEqual({
      title: [],
      company: [],
      note: [],
      more: [24, 34, 38, 41],
    });
    expect(rank(ads, 'kubernetes')?.marks.get('noted')).toEqual({ title: [], company: [], note: [0, 10], more: [] });
    expect(rank(ads, 'backend 25000')?.ids).toEqual(['k8s']);
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

describe('snippetOf', () => {
  const ad = 'We are a small team.\nOur stack:\n• TypeScript and React\n• Kubernetes on AWS, Terraform';
  const job = { jobId: 'a', title: 'Developer', company: 'Acme', more: ad };
  const marked = (snippet: ReturnType<typeof snippetOf>) =>
    snippet && snippet.marks.length ? snippet.text.slice(snippet.marks[0], snippet.marks[1]) : undefined;

  it('the rest from a word a little before the first mark, on one line, its marks moved with it', () => {
    const marks = rank([job], 'terraform')?.marks.get('a');
    const snippet = snippetOf(job, marks);
    expect(snippet).toMatchObject({ of: 'more', text: '…Kubernetes on AWS, Terraform' });
    expect(marked(snippet)).toBe('Terraform');
  });

  it('the start as it is, and "…" where a long text is cut', () => {
    const long = { ...job, more: 'Kubernetes ' + 'x'.repeat(400) };
    const snippet = snippetOf(long, rank([long], 'kubernetes')?.marks.get('a'));
    expect(snippet?.text.startsWith('Kubernetes x')).toBe(true);
    expect(snippet?.text.endsWith('x…')).toBe(true);
    expect(snippet?.marks).toEqual([0, 10]);
  });

  it('the note first; none when only the title or the company matched', () => {
    const noted = { ...job, note: 'Ask about React Native' };
    const snippet = snippetOf(noted, rank([noted], 'react')?.marks.get('a'));
    expect(snippet).toMatchObject({ of: 'note', text: 'Ask about React Native' });
    expect(marked(snippet)).toBe('React');
    expect(snippetOf(job, rank([job], 'acme developer')?.marks.get('a'))).toBeUndefined();
    expect(snippetOf(job, undefined)).toBeUndefined();
  });

  it('the rest, when the list shows the note itself (left out of the job)', () => {
    const both = { ...job, note: 'React, they said' };
    const marks = rank([both], 'react')?.marks.get('a');
    expect(marks?.note).toEqual([0, 5]);
    expect(snippetOf({ ...both, note: null }, marks)).toBeUndefined(); // only the note matched
    const anywhere = rank([{ ...both, note: 'Remote' }], 'react')?.marks.get('a');
    expect(snippetOf({ ...both, note: null }, anywhere)?.of).toBe('more');
  });
});
