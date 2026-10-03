'use client';

import { useSelector } from '@tanstack/react-form';
import { withForm } from '@/components/form';
import { NativeSelectOption } from '@/components/ui/native-select';
import { FIELDS, JSON_SOURCES, type FieldId } from '@/lib/listings/config';
import { ROW } from './scraper-fields';
import type { Draft } from './scraper-draft';

// Where a generic scraper (JSON / HTML) finds its offers, and each offer's fields.

const PLACEHOLDERS: Record<'json' | 'html', Partial<Record<FieldId, string>>> = {
  json: {
    title: 'title',
    url: 'url, or https://site.com/job/{slug}',
    id: 'id',
    company: 'company.name',
    date: 'publishedAt',
    location: 'locations[].city',
    remote: 'remote',
    skills: 'skills[].name',
    seniority: 'level',
  },
  html: {
    title: 'h3 a',
    url: 'h3 a@href',
    id: '@data-id',
    company: '.company',
    date: 'time@datetime',
    location: '.location',
    remote: '.tags',
    skills: '.skills li',
    seniority: '.level',
  },
};

/** A JSON or HTML scraper: where its offers are, and each field inside one. */
export const MappingFields = withForm({
  defaultValues: {} as Draft,
  render: function MappingFields({ form }) {
    const kind = useSelector(form.store, (state) => state.values.kind);
    const from = useSelector(form.store, (state) => state.values.from);
    if (kind !== 'json' && kind !== 'html') return null;
    return (
      <>
        {kind === 'json' && (
          <div className={ROW}>
            <form.AppField name="from">
              {(field) => (
                <field.SelectField label="Where the JSON is" controlClassName="w-full">
                  {JSON_SOURCES.map((source) => (
                    <NativeSelectOption key={source.id} value={source.id}>
                      {source.label}
                    </NativeSelectOption>
                  ))}
                </field.SelectField>
              )}
            </form.AppField>
            {from === 'script' && (
              <form.AppField name="scriptId">
                {(field) => <field.TextField label="Script id" placeholder="serverApp-state" />}
              </form.AppField>
            )}
          </div>
        )}
        <form.AppField name="items">
          {(field) => (
            <field.TextField
              label={kind === 'json' ? 'Path to the list of offers' : 'One offer (CSS selector)'}
              hint={
                kind === 'json'
                  ? 'Keys with dots between them; [] = each item of a list, e.g. results[].job. Test shows the first offer’s JSON to find the paths.'
                  : 'Test shows the first one’s HTML, to find the selectors for the fields.'
              }
              placeholder={kind === 'json' ? 'data, or props.pageProps.jobs' : 'li.job-card'}
              spellCheck={false}
            />
          )}
        </form.AppField>
        <fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-3 gap-y-2.5 rounded-lg border px-3 py-2.5">
          <legend className="px-1 text-[13px] text-muted-foreground">
            {kind === 'json' ? 'Fields: a path inside one offer' : 'Fields: a CSS selector inside one offer'}
          </legend>
          {FIELDS.map((mapped) => (
            <form.AppField key={mapped.id} name={`fields.${mapped.id}`}>
              {(field) => (
                <field.TextField
                  label={
                    <>
                      {mapped.label}
                      {'required' in mapped && ' *'}
                      {'hint' in mapped && <span className="text-muted-foreground"> · {mapped.hint}</span>}
                    </>
                  }
                  placeholder={PLACEHOLDERS[kind][mapped.id]}
                  spellCheck={false}
                />
              )}
            </form.AppField>
          ))}
          <small className="col-span-full text-xs text-muted-foreground">
            {kind === 'json'
              ? 'The link can be a template filled from the offer: https://site.com/job/{slug}. Relative links are fine.'
              : '“h3 a” = its text, “h3 a@href” = an attribute, “@data-id” = the offer element’s own attribute. Relative links are fine.'}
          </small>
        </fieldset>
      </>
    );
  },
});
