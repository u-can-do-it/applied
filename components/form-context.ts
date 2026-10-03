'use client';

import { createFormHookContexts } from '@tanstack/react-form';

// The contexts the form's field components (form-fields.tsx) read their field from (form.tsx puts them together).
export const { fieldContext, formContext, useFieldContext } = createFormHookContexts();
