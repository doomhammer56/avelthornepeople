"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ManagedContentBlock, ContentType } from "@/lib/content/contract";
import type { PublicJobSummary } from "@/lib/publicJobs";
import type { AdminLang } from "@/lib/admin/nav";
import {
  draftCompanyContent,
  contentPreviewText,
  type ContentPreviewPage,
  type ContentSelection,
} from "@/lib/admin/contentPreview";
import { pageSections } from "@/lib/admin/contentLayout";
import { homeContent } from "@/lib/homeContent";
import { aboutContent } from "@/lib/aboutContent";
import { servicesContent } from "@/lib/servicesContent";
import { contactContent } from "@/lib/contactContent";
import {
  companyHome,
  companyAbout,
  companyServices,
} from "@/lib/content/public";
import dynamic from "next/dynamic";

const HomePage = dynamic(() =>
  import("../home/HomePage").then((module) => module.HomePage),
);
const AboutPage = dynamic(() =>
  import("../AboutPage").then((module) => module.AboutPage),
);
const ServicesPage = dynamic(() =>
  import("../ServicesPage").then((module) => module.ServicesPage),
);
const ContactPage = dynamic(() =>
  import("../contact/ContactPage").then((module) => module.ContactPage),
);

type Props = {
  blocks: ManagedContentBlock[];
  locale: AdminLang;
  lang: AdminLang;
  page: ContentPreviewPage;
  mobile: boolean;
  selectedSection?: string;
  disabled: boolean;
  jobs: readonly PublicJobSummary[];
  jobsTotal?: number;
  jobsFailed: boolean;
  onSelect: (selection: ContentSelection) => void;
};

// Render React into a separate document while retaining the editor's in-memory drafts.
// Native iframe media queries reproduce mobile layouts without a second design implementation.
export const ContentPagePreview = memo(function ContentPagePreview({
  blocks,
  locale,
  lang,
  page,
  mobile,
  selectedSection,
  disabled,
  jobs,
  jobsTotal,
  jobsFailed,
  onSelect,
}: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const t = contentPreviewText[lang];
  const company = draftCompanyContent(blocks, locale);
  const site = companyHome(homeContent[locale], company);

  // Attach to an already-loaded iframe as well as subsequent native load events.
  // Server-rendered srcdoc can finish loading before React hydrates its event handlers.
  const connectFrame = useCallback((node: HTMLIFrameElement | null) => {
    if (!node) return;
    const ready = () => {
      const current = node.contentDocument;
      if (current?.getElementById("content-preview-root"))
        setPreviewDocument(current);
    };
    node.addEventListener("load", ready);
    ready();
    return () => node.removeEventListener("load", ready);
  }, []);

  // Fit a true desktop or mobile viewport inside the available admin workspace.
  // Scaling the iframe preserves its own media queries instead of clipping the page horizontally.
  useEffect(() => {
    if (!canvas.current) return;
    const container = canvas.current;
    const resize = () => {
      const padding = getComputedStyle(container);
      const width =
        container.clientWidth -
        parseFloat(padding.paddingLeft) -
        parseFloat(padding.paddingRight);
      container.style.setProperty(
        "--content-preview-scale",
        String(Math.min(1, width / (mobile ? 390 : 1200))),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [mobile]);

  // Copy stylesheet nodes and font classes, without copying scripts or admin theme state.
  // Watching head changes also keeps the isolated preview current during local CSS edits.
  useEffect(() => {
    if (!previewDocument) return;
    const styles = previewDocument.createElement("div");
    styles.hidden = true;
    previewDocument.head.append(styles);
    previewDocument.documentElement.setAttribute(
      "class",
      document.documentElement.className,
    );
    const sync = () =>
      styles.replaceChildren(
        ...Array.from(
          document.head.querySelectorAll('style, link[rel="stylesheet"]'),
        ).map((node) => node.cloneNode(true)),
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const controls = previewDocument.createElement("style");
    controls.textContent = `
      html { color-scheme: light; scroll-behavior: auto; }
      [data-preview-block] { cursor: pointer; }
      [data-preview-block]:hover, [data-preview-block]:focus-visible {
        outline: 2px dashed #55687a; outline-offset: -3px;
      }
      [data-preview-selected="true"] { outline: 2px solid #55687a; outline-offset: -3px; }
      [data-preview-block]:focus-visible { outline-width: 4px; }
      [data-public-site] [data-reveal] { opacity: 1 !important; transform: none !important; }
      [data-public-site] *, [data-public-site] *::before, [data-public-site] *::after {
        animation: none !important; transition: none !important;
      }
    `;
    previewDocument.head.append(controls);
    return () => {
      observer.disconnect();
      styles.remove();
      controls.remove();
    };
  }, [previewDocument]);

  // Connect visible sections and repeated items to their stable content identities.
  // Selection remains accurate when staff reorder cards or switch between shared pages.
  useEffect(() => {
    if (!previewDocument) return;
    previewDocument.documentElement.setAttribute(
      "lang",
      locale === "zh" ? "zh-CN" : "en",
    );
    previewDocument
      .querySelectorAll<HTMLElement>("[data-preview-block]")
      .forEach((node) => {
        delete node.dataset.previewBlock;
        delete node.dataset.previewSection;
        delete node.dataset.previewSelected;
        node.removeAttribute("tabindex");
      });
    // Outline every public section of the page, editable or fixed, so the
    // preview mirrors the section list in the inspector one-to-one.
    for (const section of pageSections[page]) {
      previewDocument
        .querySelectorAll<HTMLElement>(section.selector)
        .forEach((node) => {
          node.dataset.previewBlock = section.type ?? "FIXED";
          node.dataset.previewSection = section.key;
          node.dataset.previewSelected = String(
            section.key === selectedSection,
          );
          node.tabIndex = 0;
          node.setAttribute("aria-label", `${t.edit}: ${section.label[lang]}`);
        });
    }
    const groups: [string, ContentType, string[]?][] = [
      [
        ".home-services-grid > article, .service-grid > article, #services section[aria-labelledby^='service-']",
        "PROFILE",
        ["service"],
      ],
      ["#mission article", "PROFILE", ["mission", "card"]],
      ["#history li", "PROFILE", ["history"]],
      [".home-culture-values > article, .values-grid > article", "CULTURE"],
      [".benefits-grid > article", "BENEFIT"],
    ];
    for (const [selector, type, kinds] of groups) {
      const items =
        company.blocks[type]?.items.filter(
          (item) =>
            (!kinds || kinds.includes(item.kind)) &&
            // Same visibility rule as the public mapping, so indexes line up.
            (item.kind === "history" ? item.text.label : item.text.title),
        ) ?? [];
      previewDocument
        .querySelectorAll<HTMLElement>(selector)
        .forEach((node, index) => {
          if (items[index]) node.dataset.previewItem = items[index].id;
        });
    }
    previewDocument
      .querySelectorAll<HTMLElement>("a, button, input, textarea, select")
      .forEach((node) => {
        node.tabIndex = -1;
        if (node.matches("input, textarea, select"))
          node.setAttribute("disabled", "");
      });
  });

  // Reveal a selected section only when none of its instances is already visible.
  // Clicking a shared image in the hero must not jump to another instance farther down the page.
  useEffect(() => {
    if (!previewDocument || !selectedSection) return;
    const viewport = previewDocument.defaultView;
    if (!viewport) return;
    const sections = Array.from(
      previewDocument.querySelectorAll<HTMLElement>(
        `[data-preview-section="${selectedSection}"]`,
      ),
    );
    const visible = sections.some((node) => {
      const box = node.getBoundingClientRect();
      return box.top < viewport.innerHeight && box.bottom > 0;
    });
    if (!visible && sections[0])
      viewport.scrollTo({
        top: viewport.scrollY + sections[0].getBoundingClientRect().top,
        behavior: "instant",
      });
  }, [previewDocument, selectedSection, page]);

  // Intercept preview interactions before public links and form handlers receive them.
  // Only a section selection leaves the iframe, and it never writes to an API.
  function select(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    if (!element?.closest || disabled) return;
    const section = element.closest<HTMLElement>("[data-preview-block]");
    if (!section) return;
    // Clicking the picture itself opens the image picker, not the alt text below it.
    // Alt text stays reachable from its own field once the section is open.
    const field = element.closest("img")
      ? "image"
      : element.closest(".eyebrow, .page-header-eyebrow")
        ? "eyebrow"
        : element.closest("h1, h2, h3")
          ? "title"
          : element.closest("time")
            ? "label"
            : element.closest("p")
              ? "body"
              : undefined;
    onSelect({
      section: section.dataset.previewSection,
      type:
        section.dataset.previewBlock === "FIXED"
          ? undefined
          : (section.dataset.previewBlock as ContentType),
      itemId: element.closest<HTMLElement>("[data-preview-item]")?.dataset
        .previewItem,
      field,
    });
  }

  let content;
  if (page === "about")
    content = (
      <AboutPage
        locale={locale}
        content={companyAbout(aboutContent[locale], company)}
        siteContent={site}
        company={company}
        preview
      />
    );
  else if (page === "services")
    content = (
      <ServicesPage
        locale={locale}
        content={companyServices(servicesContent[locale], company)}
        siteContent={site}
        company={company}
        preview
      />
    );
  else if (page === "contact")
    content = (
      <ContactPage
        locale={locale}
        content={contactContent[locale]}
        siteContent={site}
        company={company}
        endpoint={null}
        preview
      />
    );
  else
    content = (
      <HomePage
        locale={locale}
        content={site}
        company={company}
        jobs={jobs}
        jobsTotal={jobsTotal}
        jobsFailed={jobsFailed}
        preview
      />
    );

  return (
    <div ref={canvas} className="admin-visual-canvas" data-mobile={mobile}>
      <iframe
        ref={connectFrame}
        title={t.preview}
        className="admin-visual-frame"
        /* The document is a fixed shell; draft text is rendered through React escaping.
           A normal same-origin frame lets React's selection handlers run inside the preview. */
        srcDoc={
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="content-preview-root"></div></body></html>'
        }
      />
      {!previewDocument && <p role="status">{t.loading}</p>}
      {previewDocument?.getElementById("content-preview-root") &&
        createPortal(
          <div
            onClickCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
              select(event.target);
            }}
            onSubmitCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDownCapture={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                select(event.target);
              }
            }}
          >
            {content}
          </div>,
          previewDocument.getElementById("content-preview-root")!,
        )}
    </div>
  );
});
