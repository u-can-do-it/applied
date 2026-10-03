'use client';

import { withForm } from '@/components/form';
import { NativeSelectOption } from '@/components/ui/native-select';
import { STAGES, outcomesFor } from '@/lib/stages';
import type { Draft } from './application-draft';

/** A new application's status in the "Add application" form: its stage and that stage's outcome. */
export const StatusFields = withForm({
  defaultValues: {} as Draft,
  render: function StatusFields({ form }) {
    return (
      <>
        <form.AppField
          name="stage"
          listeners={{
            // an offer has no "ghosted" or talent pool
            onChange: ({ value }) => {
              if (!outcomesFor(value).some((possible) => possible.id === form.getFieldValue('outcome')))
                form.setFieldValue('outcome', 'pending');
            },
          }}
        >
          {(field) => (
            <field.SelectField label="Stage" controlClassName="w-full">
              {STAGES.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </field.SelectField>
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.stage}>
          {(stage) => (
            <form.AppField name="outcome">
              {(field) => (
                <field.SelectField label="Outcome" controlClassName="w-full">
                  {outcomesFor(stage).map((option) => (
                    <NativeSelectOption key={option.id} value={option.id}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </field.SelectField>
              )}
            </form.AppField>
          )}
        </form.Subscribe>
      </>
    );
  },
});
