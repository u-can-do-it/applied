'use client';

import { useSelector } from '@tanstack/react-form';
import { Code } from '@/components/field';
import { withForm } from '@/components/form';
import { NativeSelectOption } from '@/components/ui/native-select';
import { KIND_IDS, isGeneric, kindOf, type KindId } from '@/lib/listings/kinds';
import type { Draft } from './scraper-draft';

// The scraper editor's fields that every scraper has (mapping-fields.tsx: a generic one's mapping).

export const ROW = 'grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-3 gap-y-2.5';
export const TEXTAREA = 'field-sizing-fixed resize-y font-mono text-[13px] md:text-[13px]';

const noKind: (kind: KindId) => void = () => {};

/** Type, name, board, link, pages, headers and checks. Picking a type goes through `onKind` (it may ask first). */
export const ScraperFields = withForm({
  defaultValues: {} as Draft,
  props: { keywords: [] as string[], onKind: noKind },
  render: function ScraperFields({ form, keywords, onKind }) {
    const kind = useSelector(form.store, (state) => state.values.kind);
    const url = useSelector(form.store, (state) => state.values.url);
    const generic = isGeneric(kind);
    const usesKeyword = /\{keyword(_slug)?\}/.test(url);
    const paged = /\{(start|page)\}/.test(url);
    return (
      <>
        <div className={ROW}>
          <form.AppField name="kind">
            {(field) => (
              <field.SelectField label="Type" controlClassName="w-full" onPick={(picked: KindId) => onKind(picked)}>
                {KIND_IDS.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {kindOf(option).label}
                  </NativeSelectOption>
                ))}
              </field.SelectField>
            )}
          </form.AppField>
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" placeholder="LinkedIn – React" />}
          </form.AppField>
          <form.AppField name="src">
            {(field) =>
              generic ? (
                <field.TextField label="Source id" placeholder="linkedin" normalize={(src) => src.toLowerCase()} />
              ) : (
                <field.TextField
                  label="Source id"
                  readOnly
                  aria-readonly="true"
                  controlClassName="text-muted-foreground"
                />
              )
            }
          </form.AppField>
        </div>
        <p className="-mt-1.5 mb-0 text-xs text-muted-foreground">
          {generic
            ? 'The source id is saved with each offer and shows as its board (lowercase, e.g. linkedin). Searches on one site share it.'
            : 'Fixed for this board, so its offers keep matching the ones already saved.'}
        </p>

        <form.AppField name="url">
          {(field) => (
            <field.TextareaField
              label="Link"
              hint={
                <>
                  <Code>{'{keyword}'}</Code> and <Code>{'{keyword_slug}'}</Code> become each keyword from Filters (
                  {keywords.join(', ') || 'none set'}): one search per keyword.
                  {!usesKeyword && ' Without them the link is fetched as it is.'} <Code>{'{start}'}</Code> (0, 10, 20…)
                  or <Code>{'{page}'}</Code> (1, 2, 3…) fetch several pages.
                </>
              }
              rows={2}
              controlClassName={TEXTAREA}
              placeholder="https://…"
              spellCheck={false}
            />
          )}
        </form.AppField>
        {paged && (
          <form.AppField name="pages">
            {(field) => (
              <field.NumberField
                label="Pages"
                hint="per keyword, per run"
                min={1}
                max={5}
                controlClassName="w-24"
                clamp={(pages) => Math.max(1, Math.min(5, pages || 1))}
              />
            )}
          </form.AppField>
        )}
        <form.AppField name="headers">
          {(field) => (
            <field.TextareaField
              label="Headers"
              hint="One per line, “Name: value”. A browser User-Agent is sent unless you set one."
              rows={2}
              controlClassName={TEXTAREA}
              placeholder="X-Api-Version: 1.0"
              spellCheck={false}
            />
          )}
        </form.AppField>
        <form.AppField name="checkKeyword">
          {(field) => <field.CheckboxField label="The offer must mention a keyword (title or skills)" />}
        </form.AppField>
        <form.AppField name="checkLocation">
          {(field) => <field.CheckboxField label="Only remote or in the cities from Filters" />}
        </form.AppField>
        <form.AppField name="enabled">{(field) => <field.CheckboxField label="On" />}</form.AppField>
      </>
    );
  },
});
