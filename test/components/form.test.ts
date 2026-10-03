import { describe, expect, it } from 'vitest';
import { formSchema, lazySchema } from '@/components/form';
import { LOAD_FAILED } from '@/components/lazy-form';
import { scheduleSchema } from '@/lib/shared/schemas/settings';

describe('lazySchema', () => {
  const values = { everyMinutes: 15, fromHour: 25, toHour: 22 };

  it('checks with the schema once it is loaded, each problem at its field', async () => {
    const check = lazySchema(() => Promise.resolve(formSchema(scheduleSchema)));
    const result = await check({ value: values });
    expect(result).toMatchObject({ fields: { fromHour: [{ message: 'Hours are 0–24.' }] } });
  });

  it('says the form could not be loaded when the schema can’t be, instead of letting it save unchecked', async () => {
    const check = lazySchema<typeof values>(() => Promise.reject(new Error('ChunkLoadError')));
    expect(await check({ value: values })).toBe(LOAD_FAILED);
  });
});
