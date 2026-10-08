// Trims raw ATS API responses (recorded as described in README.md here) to the 3 jobs each that show the
// cases the parser handles, and writes them next to this file as ats-<ats>.json.
// Usage: node test/fixtures/trim-ats.cjs <directory with greenhouse.json, lever.json, …>
const fs = require('fs');
const path = require('path');

const RAW = process.argv[2];
if (!RAW) {
  console.error('Usage: node test/fixtures/trim-ats.cjs <directory with the raw responses>');
  process.exit(1);
}
const raw = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const write = (f, value) => {
  const s = JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(path.join(__dirname, f), s);
  console.log(f, s.length);
};
// the first job each test picks, in this order, none twice
const pick = (jobs, ...tests) => {
  const out = [];
  for (const test of tests) {
    const job = jobs.find((one) => !out.includes(one) && test(one));
    if (!job) throw new Error(`no job for ${test}`);
    out.push(job);
  }
  return out;
};
// long texts (descriptions) cut to 200 characters
const short = (value) =>
  typeof value === 'string'
    ? value.length > 200 ? `${value.slice(0, 200)}…` : value
    : Array.isArray(value)
      ? value.map(short)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, short(v)]))
        : value;

// Greenhouse: remote from Poland among other countries, remote from other countries only, an office
{
  const d = raw('greenhouse.json');
  const where = (job) => job.location.name;
  d.jobs = pick(
    d.jobs,
    (job) => /Remote, Poland/.test(where(job)) && where(job).includes(';'),
    (job) => /^Remote, [^;]+$/.test(where(job)) && !/Poland|EMEA|Europe/.test(where(job)),
    (job) => !/remote/i.test(where(job)),
  ).map(short);
  write('ats-greenhouse.json', d);
}
// Lever: remote, hybrid, on site
{
  const d = raw('lever.json');
  write('ats-lever.json', pick(d, (job) => job.workplaceType === 'remote', (job) => job.workplaceType === 'hybrid', (job) => job.workplaceType === 'onsite').map(short));
}
// Ashby: remote in Europe, remote from another country, on site (descriptions dropped)
{
  const d = raw('ashby.json');
  d.jobs = pick(
    d.jobs,
    (job) => job.workplaceType === 'Remote' && /Europe/.test(job.location),
    (job) => job.workplaceType === 'Remote' && !/Europe|Poland/.test(job.location),
    (job) => job.workplaceType === 'OnSite',
  ).map(({ descriptionHtml, descriptionPlain, ...job }) => short(job));
  write('ats-ashbyhq.json', d);
}
// Workable: the account's name and its first 3 jobs
{
  const d = raw('workable.json');
  write('ats-workable.json', short({ ...d, jobs: d.jobs.slice(0, 3) }));
}
// SmartRecruiters: the paging fields and the first 3 postings, without their custom fields
{
  const d = raw('smartrecruiters.json');
  write('ats-smartrecruiters.json', short({ ...d, content: d.content.slice(0, 3).map(({ customField, ...job }) => job) }));
}
