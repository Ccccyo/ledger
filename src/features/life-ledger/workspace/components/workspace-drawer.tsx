'use client';

import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export function WorkspaceDrawer({
  title,
  description,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  description: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const previous = useRef(
    typeof document === 'undefined'
      ? null
      : (document.activeElement as HTMLElement | null)
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <Dialog.Content
          data-life-ledger
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previous.current?.focus();
          }}
          className="bg-background fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto overscroll-contain p-5 outline-none sm:p-7"
        >
          <header className="mb-6 pr-12">
            <Dialog.Title className="text-xl font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Description className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {description}
            </Dialog.Description>
          </header>
          <Dialog.Close
            aria-label={closeLabel}
            className="hover:bg-muted focus-visible:ring-primary/30 absolute top-3 right-3 flex size-11 items-center justify-center rounded-lg focus-visible:ring-4 focus-visible:outline-none"
          >
            <X aria-hidden="true" className="size-5" />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
