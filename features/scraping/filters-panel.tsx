'use client';

import { startTransition, type SubmitEvent } from 'react';
import { CheckField, Code, Field } from '@/components/field';
import { ActionError, useAction } from '@/components/use-action';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { normalizeList, type ScrapeSettings } from '@/lib/listings/settings';
import { saveFiltersAction } from './actions';
import { BUTTONS, PANEL, PANEL_TITLE } from './panel-styles';
import { useServerForm } from './use-server-form';

const join = (xs: string[]) => xs.join(', ');
const LISTS = ['keywords', 'cities', 'ignore', 'mute'] as const;

export function FiltersPanel({ settings }: { settings: ScrapeSettings }) {
  const { form, setForm, dirty } = useServerForm({
    keywords: join(settings.keywords),
    cities: join(settings.cities),
    remoteOk: settings.remoteOk,
    ignore: join(settings.ignore),
    mute: join(settings.mute),
  });
  const save = useAction();
  const edit = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    // shown the way it's saved ("React,Vue " -> "React, Vue"), so it matches the refreshed page
    const normalized = { ...form };
    for (const field of LISTS) normalized[field] = join(normalizeList(form[field]));
    save.run(async () => {
      const answer = await saveFiltersAction(normalized);
      if (answer.ok) startTransition(() => setForm(normalized));
      return answer;
    });
  };
  const text = (field: (typeof LISTS)[number]) => ({
    value: form[field],
    onChange: (event: { target: { value: string } }) => edit({ [field]: event.target.value }),
  });
  return (
    <Card className={PANEL} role="region" aria-labelledby="filters-h">
      <CardHeader className="px-4">
        <h2 id="filters-h" className={PANEL_TITLE}>
          Filters
        </h2>
      </CardHeader>
      <CardContent className="px-4">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label="Keywords"
            hint={
              <>
                Searched on every board (<Code>{'{keyword}'}</Code> in a scraper’s link) and, where a scraper checks it,
                required in the offer’s title or skills. A keyword starts a word: “react” matches ReactJS, not Preact.
              </>
            }
          >
            <Input {...text('keywords')} placeholder="React, Next.js" />
          </Field>
          <Field
            label="Cities"
            hint="Part of a name is enough: “warszaw” matches Warszawa and Warszawie. Empty = anywhere. Offers that don’t say where pass."
          >
            <Input {...text('cities')} placeholder="warszaw, warsaw" />
          </Field>
          <CheckField>
            <Checkbox checked={form.remoteOk} onCheckedChange={(checked) => edit({ remoteOk: checked === true })} />
            Remote offers are fine wherever they are
          </CheckField>
          <Field label="Skip titles with" hint="Not saved at all.">
            <Input {...text('ignore')} placeholder="PHP, Angular" />
          </Field>
          <Field
            label="Save, but don’t send to Telegram"
            hint="Whole words: “java” doesn’t hit JavaScript, “.net” also hits ASP.NET."
          >
            <Input {...text('mute')} />
          </Field>
          <div className={BUTTONS}>
            <Button type="submit" disabled={save.busy || !dirty} aria-busy={save.busy || undefined}>
              {save.busy ? 'Saving…' : 'Save filters'}
            </Button>
          </div>
          <ActionError error={save.error} className="mt-0" />
        </form>
      </CardContent>
    </Card>
  );
}
