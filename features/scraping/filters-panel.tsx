'use client';

import { Code } from '@/components/field';
import {
  answered,
  checkOnSubmit,
  FormError,
  formSchema,
  lazySchema,
  useAppForm,
  useFollowServer,
} from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { normalizeList, type ScrapeSettings } from '@/lib/listings/settings';
import { saveFiltersAction } from './actions';
import { loadSettingsSchemas } from './settings-schemas';
import { BUTTONS, PANEL, PANEL_TITLE } from './panel-styles';

const join = (xs: string[]) => xs.join(', ');

export function FiltersPanel({ settings }: { settings: ScrapeSettings }) {
  const server = {
    keywords: join(settings.keywords),
    cities: join(settings.cities),
    remoteOk: settings.remoteOk,
    ignore: join(settings.ignore),
    mute: join(settings.mute),
  };
  const form = useAppForm({
    defaultValues: server,
    validationLogic: checkOnSubmit,
    validators: {
      onDynamicAsync: lazySchema(() => loadSettingsSchemas().then((schemas) => formSchema(schemas.filtersSchema))),
    },
    onSubmit: async ({ value, formApi }) => {
      const answer = await answered(formApi, saveFiltersAction(value), { success: (saved) => saved });
      // shown the way it's saved ("React,Vue " -> "React, Vue"), so it matches the refreshed page
      const normalize = (list: string) => join(normalizeList(list));
      if (answer.ok)
        formApi.reset(
          {
            ...value,
            keywords: normalize(value.keywords),
            cities: normalize(value.cities),
            ignore: normalize(value.ignore),
            mute: normalize(value.mute),
          },
          { keepDefaultValues: true },
        );
    },
  });
  // what you type stays; a refreshed page brings its values while the form still shows the old ones
  useFollowServer(form, server);
  return (
    <Card className={PANEL} role="region" aria-labelledby="filters-h">
      <CardHeader className="px-4">
        <h2 id="filters-h" className={PANEL_TITLE}>
          Filters
        </h2>
      </CardHeader>
      <CardContent className="px-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          noValidate
          onFocus={() => void loadSettingsSchemas()}
          className="flex flex-col gap-3"
        >
          <form.AppField name="keywords">
            {(field) => (
              <field.TagsField
                label="Keywords"
                hint={
                  <>
                    <Code>React, Node</Code>: two searches, offers with React or Node. <Code>React CSS</Code>: one
                    search, offers with React and CSS.
                  </>
                }
                placeholder="React, Node"
              />
            )}
          </form.AppField>
          <form.AppField name="cities">
            {(field) => (
              <field.TagsField
                label="Cities"
                hint="Part of a name is enough: “warszaw” matches Warszawa and Warszawie. Empty = anywhere. Offers that don’t say where pass."
                placeholder="warszaw, warsaw"
              />
            )}
          </form.AppField>
          <form.AppField name="remoteOk">
            {(field) => <field.CheckboxField label="Remote offers are fine wherever they are" />}
          </form.AppField>
          <form.AppField name="ignore">
            {(field) => (
              <field.TagsField label="Skip titles with" hint="Not saved at all." placeholder="PHP, Angular" />
            )}
          </form.AppField>
          <form.AppField name="mute">
            {(field) => (
              <field.TagsField
                label="Save, but don’t notify"
                hint="Whole words: “java” doesn’t hit JavaScript, “.net” also hits ASP.NET."
              />
            )}
          </form.AppField>
          <div className={BUTTONS}>
            <form.Subscribe selector={(state) => [state.isSubmitting, state.isDefaultValue] as const}>
              {([saving, unchanged]) => (
                <Button type="submit" disabled={saving || unchanged} aria-busy={saving || undefined}>
                  {saving ? 'Saving…' : 'Save filters'}
                </Button>
              )}
            </form.Subscribe>
          </div>
          <FormError form={form} className="mt-0" />
        </form>
      </CardContent>
    </Card>
  );
}
