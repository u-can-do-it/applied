'use client';

import { STAGES, outcomesFor, type StageId, type OutcomeId } from '@/lib/stages';
import { Field } from '@/components/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

/** A new application's status in the "Add application" form: its stage and that stage's outcome. */
export function StatusFields({
  stage,
  outcome,
  onChange,
}: {
  stage: StageId;
  outcome: OutcomeId;
  onChange: (patch: { stage?: StageId; outcome?: OutcomeId }) => void;
}) {
  return (
    <>
      <Field label="Stage">
        <NativeSelect
          className="w-full"
          value={stage}
          onChange={(event) => {
            const next = event.target.value as StageId;
            // an offer has no "ghosted" or talent pool
            onChange(
              outcomesFor(next).some((possible) => possible.id === outcome)
                ? { stage: next }
                : { stage: next, outcome: 'pending' },
            );
          }}
        >
          {STAGES.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Outcome">
        <NativeSelect
          className="w-full"
          value={outcome}
          onChange={(event) => onChange({ outcome: event.target.value as OutcomeId })}
        >
          {outcomesFor(stage).map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}
