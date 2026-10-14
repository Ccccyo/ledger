import { ReactNode } from 'react';

export default async function LifeLedgerAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="bg-muted/30 min-h-screen">{children}</div>;
}
