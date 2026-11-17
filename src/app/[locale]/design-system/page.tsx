import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { homeContent } from "@/lib/homeContent";
import { publicSiteClass, siteContainerClass } from "@/lib/publicSite";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { BrandIcon, type BrandIconName } from "@/components/ui/brand-icon";
import { RecruitmentCta } from "@/components/jobs/RecruitmentCta";
import {
  ArrowRight,
  Search,
  ExternalLink,
  Briefcase,
  Sparkles,
} from "lucide-react";

type Props = { params: Promise<{ locale: string }> };

async function getLocale(params: Props["params"]) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return locale as "en" | "zh";
}

export const metadata: Metadata = {
  title: "Design System | Avelthorne People Group",
  description: "Live component gallery, typography scale, and color tokens.",
  robots: { index: false, follow: false },
};

export default async function DesignSystemPage({ params }: Props) {
  const locale = await getLocale(params);
  setRequestLocale(locale);
  const t = homeContent[locale];

  const brandIcons: { name: BrandIconName; label: string }[] = [
    { name: "meaningful-work", label: "Meaningful Work" },
    { name: "learning-growth", label: "Learning & Growth" },
    { name: "collaborative-team", label: "Collaborative Teams" },
    { name: "work-life-balance", label: "Work-life Balance" },
    { name: "supportive-culture", label: "Supportive Culture" },
    { name: "business-enquiries", label: "Business Enquiries" },
    { name: "arrow-right", label: "Arrow Right" },
    { name: "chevron-down", label: "Chevron Down" },
    { name: "information", label: "Information" },
    { name: "search", label: "Search" },
  ];

  return (
    <div className={`${publicSiteClass} min-h-screen`} data-public-site>
      <SiteHeader locale={locale} content={t} activePage="none" />

      <main id="main-content" className={`${siteContainerClass} py-12 md:py-16`}>
        {/* Top Header */}
        <div className="mb-12 border-b border-border pb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <Badge variant="gold" className="rounded-full px-3">Design System</Badge>
            <span className="text-xs text-muted-foreground font-mono">v2.1 · Refined Weights & Radius</span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
            Avelthorne Design System
          </h1>
          <p className="mt-3 text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
            Live preview of customized UI components, balanced typography, rounded surfaces, and Lucide icons.
          </p>
        </div>

        {/* 1. Color Palette Tokens */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="FOUNDATION"
            title="Brand Color Palette"
            description="Core tokens established from the brand reference handoff."
          />
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="rounded-xl border border-border overflow-hidden bg-card p-4 shadow-xs">
              <div className="h-20 rounded-lg bg-brand-teal mb-3 flex items-end p-2.5">
                <span className="text-xs text-white font-mono">#17545b</span>
              </div>
              <strong className="block text-sm font-semibold">Teal (Primary)</strong>
              <span className="text-xs text-muted-foreground">Action, buttons, active</span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card p-4 shadow-xs">
              <div className="h-20 rounded-lg bg-brand-navy mb-3 flex items-end p-2.5">
                <span className="text-xs text-white font-mono">#061722</span>
              </div>
              <strong className="block text-sm font-semibold">Deep Navy</strong>
              <span className="text-xs text-muted-foreground">Headings, CTA, contrast</span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card p-4 shadow-xs">
              <div className="h-20 rounded-lg bg-brand-ivory border border-border/80 mb-3 flex items-end p-2.5">
                <span className="text-xs text-foreground font-mono">#faf9f6</span>
              </div>
              <strong className="block text-sm font-semibold">Ivory (Background)</strong>
              <span className="text-xs text-muted-foreground">Warm paper page surface</span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card p-4 shadow-xs">
              <div className="h-20 rounded-lg bg-brand-gold mb-3 flex items-end p-2.5">
                <span className="text-xs text-white font-mono">#b79761</span>
              </div>
              <strong className="block text-sm font-semibold">Gold (Accent)</strong>
              <span className="text-xs text-muted-foreground">Eyebrow rules, milestones</span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card p-4 shadow-xs">
              <div className="h-20 rounded-lg bg-secondary border border-border/60 mb-3 flex items-end p-2.5">
                <span className="text-xs text-foreground font-mono">#f3efe8</span>
              </div>
              <strong className="block text-sm font-semibold">Cream / Soft</strong>
              <span className="text-xs text-muted-foreground">Cards & muted surfaces</span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card p-4 shadow-xs">
              <div className="h-20 rounded-lg bg-[#5c6972] mb-3 flex items-end p-2.5">
                <span className="text-xs text-white font-mono">#5c6972</span>
              </div>
              <strong className="block text-sm font-semibold">Muted Slate</strong>
              <span className="text-xs text-muted-foreground">Body subtext (WCAG AA)</span>
            </div>
          </div>
        </section>

        {/* 2. Typography Scale */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="TYPOGRAPHY"
            title="Balanced Font Hierarchy"
            description="Refined Source Serif 4 headings with softened weights (font-semibold, 600) instead of heavy black."
          />
          <div className="mt-8 space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
            <div className="border-b border-border/60 pb-6">
              <span className="text-xs font-mono text-muted-foreground">Display / Source Serif 4 (Semibold 600 · 36px)</span>
              <p className="font-serif text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-foreground mt-1">
                People. Expertise. Opportunity.
              </p>
            </div>

            <div className="border-b border-border/60 pb-6">
              <span className="text-xs font-mono text-muted-foreground">Section Title / Source Serif 4 (Semibold 600 · 26px)</span>
              <p className="font-serif text-xl sm:text-2xl font-semibold text-foreground mt-1">
                Customer Operations & Risk Compliance
              </p>
            </div>

            <div className="border-b border-border/60 pb-6">
              <span className="text-xs font-mono text-muted-foreground">Body Copy / Host Grotesk (Regular & Medium)</span>
              <p className="font-sans text-base sm:text-lg text-foreground mt-1 leading-relaxed max-w-3xl">
                Avelthorne People Group brings together people, expertise and opportunity to support the work we do and the teams we build. Supporting exceptional customer experiences through effective operations.
              </p>
            </div>

            <div className="border-b border-border/60 pb-6">
              <span className="text-xs font-mono text-muted-foreground">Eyebrow Accent / Host Grotesk + Gold Rule</span>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs sm:text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
                  SERVICES
                </span>
                <span className="w-12 h-[1.5px] bg-brand-gold" />
              </div>
            </div>

            <div>
              <span className="text-xs font-mono text-muted-foreground">Metrics / Barlow Condensed (Bold, 700)</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-3">
                <div>
                  <strong className="block font-number text-4xl sm:text-5xl font-bold text-foreground">
                    2,016
                  </strong>
                  <span className="text-xs sm:text-sm text-muted-foreground">Founded</span>
                </div>
                <div>
                  <strong className="block font-number text-4xl sm:text-5xl font-bold text-foreground">
                    1,200+
                  </strong>
                  <span className="text-xs sm:text-sm text-muted-foreground">Employees</span>
                </div>
                <div>
                  <strong className="block font-number text-4xl sm:text-5xl font-bold text-foreground">
                    3
                  </strong>
                  <span className="text-xs sm:text-sm text-muted-foreground">Office Cities</span>
                </div>
                <div>
                  <strong className="block font-number text-4xl sm:text-5xl font-bold text-foreground">
                    30
                  </strong>
                  <span className="text-xs sm:text-sm text-muted-foreground">Countries Served</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Button Component Matrix */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="COMPONENTS"
            title="Buttons & Lucide Icon Integration"
            description="Polished with 8px–12px rounded corners, smooth hover transitions, and Lucide icons."
          />
          <div className="mt-8 space-y-8 rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
            <div>
              <span className="block text-xs font-mono text-muted-foreground mb-3">Variants with Icons</span>
              <div className="flex flex-wrap items-center gap-4">
                <Button variant="default">
                  View Jobs
                  <ArrowRight className="size-4" />
                </Button>
                <Button variant="navy">
                  About Us
                  <ExternalLink className="size-4" />
                </Button>
                <Button variant="outline">
                  <Search className="size-4 mr-1.5" />
                  Search Roles
                </Button>
                <Button variant="secondary">
                  <Briefcase className="size-4 mr-1.5" />
                  All Categories
                </Button>
                <Button variant="ghost">
                  <Sparkles className="size-4 mr-1.5 text-brand-gold" />
                  Culture Highlights
                </Button>
                <Button variant="link">
                  View All Jobs
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>

            <Separator />

            <div>
              <span className="block text-xs font-mono text-muted-foreground mb-3">Sizes (Rounded Aesthetic)</span>
              <div className="flex flex-wrap items-center gap-4">
                <Button size="sm">Small (32px)</Button>
                <Button size="default">Default (44px)</Button>
                <Button size="lg">Large (48px)</Button>
                <Button size="xl">Hero Extra Large (52px)</Button>
              </div>
            </div>

            <Separator />

            <div>
              <span className="block text-xs font-mono text-muted-foreground mb-3">States</span>
              <div className="flex flex-wrap items-center gap-4">
                <Button variant="default">Normal</Button>
                <Button variant="default" disabled>Disabled State</Button>
                <Button variant="outline" disabled>Disabled Outline</Button>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Card Components */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="SURFACES"
            title="Rounded Cards (rounded-xl)"
            description="Cards featuring 12px–16px rounded borders and balanced editorial typography."
          />
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card variant="default">
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-brand-teal/10 flex items-center justify-center text-brand-teal font-serif font-semibold text-lg mb-2">
                  01
                </div>
                <CardTitle>Customer Operations</CardTitle>
                <CardDescription>
                  Supporting exceptional customer experiences through effective operations, service and delivery.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button variant="link" className="p-0">
                  Explore Service
                  <ArrowRight className="size-4" />
                </Button>
              </CardFooter>
            </Card>

            <Card variant="ivory">
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-brand-gold/20 flex items-center justify-center text-brand-gold font-serif font-semibold text-lg mb-2">
                  02
                </div>
                <CardTitle>Risk & Compliance</CardTitle>
                <CardDescription>
                  Helping organisations manage risk, meet regulatory expectations and maintain high standards.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button variant="link" className="p-0">
                  Explore Service
                  <ArrowRight className="size-4" />
                </Button>
              </CardFooter>
            </Card>

            <Card variant="navy">
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-brand-gold font-serif font-semibold text-lg mb-2">
                  03
                </div>
                <CardTitle className="text-white">Technology Services</CardTitle>
                <CardDescription className="text-white/70">
                  Enabling business performance through modern technology, reliable data, and digital capability.
                </CardDescription>
              </CardHeader>
              <CardFooter className="border-white/10">
                <Button variant="link" className="p-0 text-brand-gold hover:text-white">
                  Explore Service
                  <ArrowRight className="size-4" />
                </Button>
              </CardFooter>
            </Card>
          </div>
        </section>

        {/* 5. Form Controls */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="INPUTS"
            title="Form Controls (rounded-lg)"
            description="Accessible, clean inputs with 8px radius and brand teal focus styling."
          />
          <div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8 max-w-2xl shadow-xs">
            <div className="space-y-5">
              <div>
                <Label htmlFor="demo-name">Full Name</Label>
                <Input id="demo-name" placeholder="e.g. Jane Doe" className="mt-1.5" />
              </div>

              <div>
                <Label htmlFor="demo-email">Work Email</Label>
                <Input id="demo-email" type="email" placeholder="jane@example.com" className="mt-1.5" />
              </div>

              <div>
                <Label htmlFor="demo-message">Message</Label>
                <Textarea
                  id="demo-message"
                  placeholder="How can we assist you?"
                  className="mt-1.5"
                />
              </div>

              <Button type="button" variant="default" size="lg" className="w-full sm:w-auto">
                Submit Inquiry
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
            </div>
          </div>
        </section>

        {/* 6. Brand Vector Icons */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="ASSETS"
            title="Official Vector Icons"
            description="The complete set of 10 clean SVG icons extracted from the handoff package."
          />
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {brandIcons.map((icon) => (
              <div
                key={icon.name}
                className="flex flex-col items-center justify-center p-6 rounded-xl border border-border bg-card text-center hover:border-brand-teal/40 transition-colors shadow-xs"
              >
                <div className="h-12 w-12 flex items-center justify-center mb-3">
                  <BrandIcon name={icon.name} size={36} alt={icon.label} />
                </div>
                <strong className="text-xs font-medium text-foreground">{icon.label}</strong>
                <span className="text-[10px] text-muted-foreground font-mono mt-1">{icon.name}.svg</span>
              </div>
            ))}
          </div>
        </section>

        {/* 7. Live CTA Banner Preview */}
        <section className="mb-16">
          <SectionHeader
            eyebrow="CALL TO ACTION"
            title="Recruitment Banner Component"
            description="Rounded full-width deep navy banner with Lucide ArrowRight icon."
          />
          <div className="mt-8">
            <RecruitmentCta
              locale={locale}
              content={t}
              heading="Find Your Next Opportunity"
              subheading="Build your career with Avelthorne People Group. Explore opportunities across our teams."
            />
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} content={t} includeCta={false} />
    </div>
  );
}
