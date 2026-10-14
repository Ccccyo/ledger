'use client';

import { SmartIcon } from '@/shared/blocks/common/smart-icon';
import { ScrollAnimation } from '@/shared/components/ui/scroll-animation';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

export function Features({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  const isLedgerLayout = section.layout === 'ledger';

  return (
    <section
      id={section.id}
      className={cn('py-16 md:py-24', section.className, className)}
    >
      <div className={`container space-y-8 md:space-y-16`}>
        <ScrollAnimation>
          <div className="mx-auto max-w-4xl text-center text-balance">
            <h2 className="text-foreground mb-4 text-3xl font-semibold tracking-tight md:text-4xl">
              {section.title}
            </h2>
            <p className="text-muted-foreground mb-6 md:mb-12 lg:mb-16">
              {section.description}
            </p>
          </div>
        </ScrollAnimation>

        <ScrollAnimation delay={0.2}>
          <div
            className={cn(
              'relative mx-auto grid overflow-hidden rounded-2xl border',
              isLedgerLayout
                ? 'bg-border gap-px lg:grid-cols-6'
                : 'divide-x divide-y *:p-12 sm:grid-cols-2 lg:grid-cols-3'
            )}
          >
            {section.items?.map((item, idx) => (
              <div
                className={cn(
                  'space-y-3',
                  isLedgerLayout && 'bg-card p-7 sm:p-9 lg:min-h-56 lg:p-10',
                  isLedgerLayout && idx === 0 && 'lg:col-span-4',
                  isLedgerLayout && idx === 1 && 'lg:col-span-2',
                  isLedgerLayout && idx > 1 && 'lg:col-span-2',
                  isLedgerLayout && idx === 0 && 'bg-primary/[0.045]'
                )}
                key={idx}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      isLedgerLayout &&
                        'bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full'
                    )}
                  >
                    <SmartIcon name={item.icon as string} size={22} />
                  </span>
                  <h3
                    className={cn(
                      'font-medium',
                      isLedgerLayout ? 'text-base' : 'text-sm'
                    )}
                  >
                    {item.title}
                  </h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </ScrollAnimation>
      </div>
    </section>
  );
}
