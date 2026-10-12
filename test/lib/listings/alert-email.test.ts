import { describe, expect, it } from 'vitest';
import { jobsInAlert } from '@/lib/listings/alert-email';

// The jobs in a LinkedIn job alert email: only their ids, from whatever links the layout has.

const job = (id: string, title: string, card = 0) => {
  const tracking = `trackingId=abc%3D%3D&amp;refId=def&amp;lipi=urn%3Ali&amp;midToken=tok&amp;trk=eml-email_job_alert_digest_01-job_card-${card}-jobcard_body&amp;trkEmail=eml&amp;otpToken=otp`;
  return `
    <tr><td>
      <a href="https://www.linkedin.com/comm/jobs/view/${id}/?${tracking}"><img src="https://media.licdn.com/logo.png" alt="Acme"></a>
      <a href="https://www.linkedin.com/comm/jobs/view/${id}/?${tracking}" style="color:#0a66c2">${title}</a>
      <p>Acme · Warszawa, Mazowieckie, Poland</p>
      <a href="https://www.linkedin.com/comm/company/acme/?trk=eml">Acme</a>
    </td></tr>`;
};

const email = (cards: string) => `<!DOCTYPE html><html><body><table>
  <tr><td><a href="https://www.linkedin.com/comm/feed/?trk=eml-logo">LinkedIn</a></td></tr>
  <tr><td>Your job alert for <b>React developer</b> in Warszawa</td></tr>
  ${cards}
  <tr><td><a href="https://www.linkedin.com/comm/jobs/search?keywords=React&amp;currentJobId=4466208580&amp;trk=eml-see-all">See all jobs</a></td></tr>
  <tr><td>
    <a href="https://www.linkedin.com/comm/jobs/jam?trk=eml-manage">Manage job alerts</a>
    <a href="https://www.linkedin.com/comm/psettings/email-unsubscribe?lipi=x&amp;midToken=y">Unsubscribe</a>
    <a href="https://lnkd.in/abc">Help</a>
  </td></tr>
</table></body></html>`;

describe('jobsInAlert', () => {
  it("each job's id once, in the email's order", () => {
    const html = email(job('4466208580', 'Front End Engineer', 0) + job('4475683203', 'Senior React Developer', 1));
    expect(jobsInAlert(html)).toEqual(['4466208580', '4475683203']);
  });

  it('a job link with its title in the path, and a search that opens on a job', () => {
    const html = email(
      '<a href="https://pl.linkedin.com/jobs/view/front-end-engineer-at-wpp-4466208581?trk=x">Front End Engineer</a>',
    ).replace('currentJobId=4466208580', 'currentJobId=4400000001');
    expect(jobsInAlert(html)).toEqual(['4466208581', '4400000001']);
  });

  it('nothing from other sites, short ids, or links that are no job', () => {
    expect(jobsInAlert(email('').replace(/currentJobId=\d+/, ''))).toEqual([]);
    expect(
      jobsInAlert(
        '<a href="https://example.com/jobs/view/4466208580">elsewhere</a>' +
          '<a href="https://www.linkedin.com/jobs/view/12345">too short</a>' +
          '<a href="not a link">x</a><a>no link</a>',
      ),
    ).toEqual([]);
    expect(jobsInAlert('')).toEqual([]);
  });
});
