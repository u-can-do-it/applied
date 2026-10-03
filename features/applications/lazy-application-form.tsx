'use client';

import { lazy } from 'react';
import { LazyForm } from '@/components/lazy-form';
import type { FormProps } from './application-form';
import { ApplicationFormHeader } from './application-form-header';

// The add/edit form loads when it's first wanted: it brings the form library and the action's schema
// (zod), which the Applied page doesn't need until then. Pointing at "Add application", or opening an
// application (its "Edit"), starts the download, so it's usually in by the time the form opens.
export const loadApplicationForm = () => import('./application-form');
const ApplicationForm = lazy(() => loadApplicationForm().then((module) => ({ default: module.ApplicationForm })));

export function LazyApplicationForm(props: FormProps) {
  return (
    <LazyForm
      header={<ApplicationFormHeader editing={props.app !== undefined} />}
      // link, title, board and day, status (adding), details, ad text
      fields={props.app ? ['h-8', 'h-8', 'h-8', 'h-8', 'h-44'] : ['h-8', 'h-8', 'h-8', 'h-8', 'h-8', 'h-44']}
    >
      <ApplicationForm {...props} />
    </LazyForm>
  );
}
