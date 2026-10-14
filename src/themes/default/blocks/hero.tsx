'use client';

import Image from 'next/image';
import {
  PersonalBaselineCalculator,
  type PersonalBaselineCalculatorConfig,
} from '@/features/life-ledger/landing/personal-baseline-form';
import { ArrowRight } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { SmartIcon } from '@/shared/blocks/common';
import { Button } from '@/shared/components/ui/button';
import { Highlighter } from '@/shared/components/ui/highlighter';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

import { SocialAvatars } from './social-avatars';

function CalculatorHero({ section }: { section: Section }) {
  const highlightText = section.highlight_text ?? '';
  const texts = highlightText
    ? section.title?.split(highlightText, 2)
    : undefined;

  return (
    <section
      id={section.id}
      className={cn(
        'relative flex min-h-[100dvh] items-center overflow-hidden pt-24 pb-14 md:pt-24 md:pb-16',
        section.className
      )}
    >
      <div className="bg-primary/5 pointer-events-none absolute top-16 right-[-12rem] size-[34rem] rounded-full blur-3xl" />
      <div className="relative container grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
        <div className="max-w-2xl">
          {section.announcement?.title && (
            <p className="text-primary mb-5 text-sm font-semibold">
              {section.announcement.title}
            </p>
          )}
          {texts && texts.length > 0 ? (
            <h1 className="text-foreground text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl">
              {texts[0]}
              <span className="text-primary">{highlightText}</span>
              {texts[1]}
            </h1>
          ) : (
            <h1 className="text-foreground text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl">
              {section.title}
            </h1>
          )}
          <p
            className="text-muted-foreground mt-6 max-w-[58ch] text-base leading-relaxed sm:text-lg"
            dangerouslySetInnerHTML={{ __html: section.description ?? '' }}
          />
          {section.buttons && (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {section.buttons.map((button, index) => (
                <Button
                  asChild
                  size={button.size || 'lg'}
                  variant={button.variant || 'default'}
                  className="px-5 text-sm whitespace-nowrap active:translate-y-px"
                  key={index}
                >
                  <Link
                    href={button.url ?? ''}
                    target={button.target ?? '_self'}
                  >
                    {button.icon && <SmartIcon name={button.icon as string} />}
                    <span>{button.title}</span>
                  </Link>
                </Button>
              ))}
            </div>
          )}
        </div>

        <PersonalBaselineCalculator
          config={section.calculator as PersonalBaselineCalculatorConfig}
        />
      </div>
    </section>
  );
}

function DefaultHero({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  const highlightText = section.highlight_text ?? '';
  const texts = highlightText
    ? section.title?.split(highlightText, 2)
    : undefined;

  return (
    <section
      id={section.id}
      className={cn(
        'pt-24 pb-8 md:pt-36 md:pb-8',
        section.className,
        className
      )}
    >
      {section.announcement && (
        <Link
          href={section.announcement.url || ''}
          target={section.announcement.target || '_self'}
          className="hover:bg-background dark:hover:border-t-border bg-muted group mx-auto mb-8 flex w-fit items-center gap-4 rounded-full border p-1 pl-4 shadow-md shadow-zinc-950/5 transition-colors duration-300 dark:border-t-white/5 dark:shadow-zinc-950"
        >
          <span className="text-foreground text-sm">
            {section.announcement.title}
          </span>
          <span className="dark:border-background block h-4 w-0.5 border-l bg-white dark:bg-zinc-700" />
          <div className="bg-background group-hover:bg-muted size-6 overflow-hidden rounded-full duration-500">
            <div className="flex w-12 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0">
              <span className="flex size-6">
                <ArrowRight className="m-auto size-3" />
              </span>
              <span className="flex size-6">
                <ArrowRight className="m-auto size-3" />
              </span>
            </div>
          </div>
        </Link>
      )}

      <div className="relative mx-auto max-w-full px-4 text-center md:max-w-5xl">
        {texts && texts.length > 0 ? (
          <h1 className="text-foreground text-4xl font-semibold text-balance sm:mt-12 sm:text-6xl">
            {texts[0]}
            <Highlighter action="underline" color="#159A70">
              {highlightText}
            </Highlighter>
            {texts[1]}
          </h1>
        ) : (
          <h1 className="text-foreground text-4xl font-semibold text-balance sm:mt-12 sm:text-6xl">
            {section.title}
          </h1>
        )}
        <p
          className="text-muted-foreground mt-8 mb-8 text-lg text-balance"
          dangerouslySetInnerHTML={{ __html: section.description ?? '' }}
        />
        {section.buttons && (
          <div className="flex items-center justify-center gap-4">
            {section.buttons.map((button, index) => (
              <Button
                asChild
                size={button.size || 'default'}
                variant={button.variant || 'default'}
                className="px-4 text-sm"
                key={index}
              >
                <Link href={button.url ?? ''} target={button.target ?? '_self'}>
                  {button.icon && <SmartIcon name={button.icon as string} />}
                  <span>{button.title}</span>
                </Link>
              </Button>
            ))}
          </div>
        )}
        {section.tip && (
          <p
            className="text-muted-foreground mt-6 block text-center text-sm"
            dangerouslySetInnerHTML={{ __html: section.tip }}
          />
        )}
        {section.show_avatars && (
          <SocialAvatars tip={section.avatars_tip || ''} />
        )}
      </div>

      {(section.image?.src || section.image_invert?.src) && (
        <div className="border-foreground/10 relative mt-8 border-y sm:mt-16">
          <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
            <div className="border-x">
              {section.image_invert?.src && (
                <Image
                  className="border-border/25 relative z-2 hidden w-full border dark:block"
                  src={section.image_invert.src}
                  alt={section.image_invert.alt || section.image?.alt || ''}
                  width={
                    section.image_invert.width || section.image?.width || 1200
                  }
                  height={
                    section.image_invert.height || section.image?.height || 630
                  }
                  sizes="(max-width: 768px) 100vw, 1200px"
                  loading="lazy"
                  quality={75}
                  unoptimized={section.image_invert.src.startsWith('http')}
                />
              )}
              {section.image?.src && (
                <Image
                  className="border-border/25 relative z-2 block w-full border dark:hidden"
                  src={section.image.src}
                  alt={section.image.alt || section.image_invert?.alt || ''}
                  width={
                    section.image.width || section.image_invert?.width || 1200
                  }
                  height={
                    section.image.height || section.image_invert?.height || 630
                  }
                  sizes="(max-width: 768px) 100vw, 1200px"
                  loading="lazy"
                  quality={75}
                  unoptimized={section.image.src.startsWith('http')}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function Hero({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  if (section.calculator) {
    return <CalculatorHero section={section} />;
  }

  return <DefaultHero section={section} className={className} />;
}
