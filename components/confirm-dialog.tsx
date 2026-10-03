'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ConfirmOptions } from './confirm';

/** The question of useConfirm(), loaded with the first one asked (confirm.tsx). */
export default function ConfirmDialog({
  open,
  asked,
  reply,
  onCloseAutoFocus,
}: {
  open: boolean;
  asked: ConfirmOptions;
  reply: (yes: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && reply(false)}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{asked.title}</AlertDialogTitle>
          <AlertDialogDescription>{asked.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={asked.destructive ? 'destructive' : 'default'}
            onClick={() => {
              reply(true);
            }}
          >
            {asked.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
