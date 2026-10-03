'use client';

import { Code, CheckField, Field } from '@/components/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { KIND_IDS, isGeneric, kindOf, type KindId } from '@/lib/listings/kinds';
import type { Draft } from './scraper-draft';

// The scraper editor's fields that every scraper has (mapping-fields.tsx: a generic one's mapping).

export const ROW = 'grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-3 gap-y-2.5';
const TEXTAREA = 'field-sizing-fixed resize-y font-mono text-[13px] md:text-[13px]';

export type SetDraft = (patch: Partial<Draft>) => void;

/** Type, name, board, link, pages, headers and checks. */
export function ScraperFields({
  draft,
  set,
  keywords,
  onKind,
}: {
  draft: Draft;
  set: SetDraft;
  keywords: string[];
  onKind: (kind: KindId) => void;
}) {
  const generic = isGeneric(draft.kind);
  const usesKeyword = /\{keyword(_slug)?\}/.test(draft.url);
  const paged = /\{(start|page)\}/.test(draft.url);
  return (
    <>
      <div className={ROW}>
        <Field label="Type">
          <NativeSelect
            className="w-full"
            value={draft.kind}
            onChange={(event) => onKind(event.target.value as KindId)}
          >
            {KIND_IDS.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {kindOf(kind).label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            placeholder="LinkedIn – React"
          />
        </Field>
        <Field label="Source id">
          {generic ? (
            <Input
              value={draft.src}
              onChange={(event) => set({ src: event.target.value.toLowerCase() })}
              placeholder="linkedin"
            />
          ) : (
            <Input value={draft.src} readOnly aria-readonly="true" className="text-muted-foreground" />
          )}
        </Field>
      </div>
      <p className="-mt-1.5 mb-0 text-xs text-muted-foreground">
        {generic
          ? 'The source id is saved with each offer and shows as its board (lowercase, e.g. linkedin). Searches on one site share it.'
          : 'Fixed for this board, so its offers keep matching the ones already saved.'}
      </p>

      <Field
        label="Link"
        hint={
          <>
            <Code>{'{keyword}'}</Code> and <Code>{'{keyword_slug}'}</Code> become each keyword from Filters (
            {keywords.join(', ') || 'none set'}): one search per keyword.
            {!usesKeyword && ' Without them the link is fetched as it is.'} <Code>{'{start}'}</Code> (0, 10, 20…) or{' '}
            <Code>{'{page}'}</Code> (1, 2, 3…) fetch several pages.
          </>
        }
      >
        <Textarea
          rows={2}
          className={TEXTAREA}
          value={draft.url}
          onChange={(event) => set({ url: event.target.value })}
          placeholder="https://…"
          spellCheck={false}
        />
      </Field>
      {paged && (
        <Field label="Pages" hint="per keyword, per run">
          <Input
            type="number"
            min={1}
            max={5}
            className="w-24"
            value={draft.pages}
            onChange={(event) => set({ pages: Math.max(1, Math.min(5, Number(event.target.value) || 1)) })}
          />
        </Field>
      )}
      <Field label="Headers" hint="One per line, “Name: value”. A browser User-Agent is sent unless you set one.">
        <Textarea
          rows={2}
          className={TEXTAREA}
          value={draft.headers}
          onChange={(event) => set({ headers: event.target.value })}
          placeholder="X-Api-Version: 1.0"
          spellCheck={false}
        />
      </Field>
      <CheckField>
        <Checkbox checked={draft.checkKeyword} onCheckedChange={(checked) => set({ checkKeyword: checked === true })} />
        The offer must mention a keyword (title or skills)
      </CheckField>
      <CheckField>
        <Checkbox
          checked={draft.checkLocation}
          onCheckedChange={(checked) => set({ checkLocation: checked === true })}
        />
        Only remote or in the cities from Filters
      </CheckField>
      <CheckField>
        <Checkbox checked={draft.enabled} onCheckedChange={(checked) => set({ enabled: checked === true })} />
        On
      </CheckField>
    </>
  );
}
