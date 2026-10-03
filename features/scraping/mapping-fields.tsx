'use client';

import { Field } from '@/components/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { FIELDS, JSON_SOURCES, type FieldId, type JsonSource } from '@/lib/listings/config';
import { ROW, type SetDraft } from './scraper-fields';
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
export function MappingFields({
  draft,
  set,
  setField,
}: {
  draft: Draft;
  set: SetDraft;
  setField: (field: FieldId, value: string) => void;
}) {
  const mapped = draft.kind === 'json' || draft.kind === 'html';
  return (
    <>
      {draft.kind === 'json' && (
        <div className={ROW}>
          <Field label="Where the JSON is">
            <NativeSelect
              className="w-full"
              value={draft.from}
              onChange={(event) => set({ from: event.target.value as JsonSource })}
            >
              {JSON_SOURCES.map((source) => (
                <NativeSelectOption key={source.id} value={source.id}>
                  {source.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {draft.from === 'script' && (
            <Field label="Script id">
              <Input
                value={draft.scriptId}
                onChange={(event) => set({ scriptId: event.target.value })}
                placeholder="serverApp-state"
              />
            </Field>
          )}
        </div>
      )}
      {mapped && (
        <Field
          label={draft.kind === 'json' ? 'Path to the list of offers' : 'One offer (CSS selector)'}
          hint={
            draft.kind === 'json'
              ? 'Keys with dots between them; [] = each item of a list, e.g. results[].job. Test shows the first offer’s JSON to find the paths.'
              : 'Test shows the first one’s HTML, to find the selectors for the fields.'
          }
        >
          <Input
            value={draft.items}
            onChange={(event) => set({ items: event.target.value })}
            placeholder={draft.kind === 'json' ? 'data, or props.pageProps.jobs' : 'li.job-card'}
            spellCheck={false}
          />
        </Field>
      )}
      {mapped && (
        <fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-3 gap-y-2.5 rounded-lg border px-3 py-2.5">
          <legend className="px-1 text-[13px] text-muted-foreground">
            {draft.kind === 'json' ? 'Fields: a path inside one offer' : 'Fields: a CSS selector inside one offer'}
          </legend>
          {FIELDS.map((field) => (
            <Field
              key={field.id}
              label={
                <>
                  {field.label}
                  {'required' in field && ' *'}
                  {'hint' in field && <span className="text-muted-foreground"> · {field.hint}</span>}
                </>
              }
            >
              <Input
                value={draft.fields[field.id] ?? ''}
                onChange={(event) => setField(field.id, event.target.value)}
                placeholder={PLACEHOLDERS[draft.kind as 'json' | 'html'][field.id]}
                spellCheck={false}
              />
            </Field>
          ))}
          <small className="col-span-full text-xs text-muted-foreground">
            {draft.kind === 'json'
              ? 'The link can be a template filled from the offer: https://site.com/job/{slug}. Relative links are fine.'
              : '“h3 a” = its text, “h3 a@href” = an attribute, “@data-id” = the offer element’s own attribute. Relative links are fine.'}
          </small>
        </fieldset>
      )}
    </>
  );
}
