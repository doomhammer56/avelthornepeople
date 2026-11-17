"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { requestCvDownload, requestCvPreview } from "@/lib/admin/cvDownload";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import type { AdminLang } from "@/lib/admin/nav";

export function useCvDownload(lang: AdminLang) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  async function openCv(applicationId: string, mode: "download" | "preview") {
    if (inFlight.current) return;
    inFlight.current = true;
    // Open during the click gesture, before any network request. The PDF stays
    // on the separate Storage origin, without an opener or a staff-page referrer.
    const tab =
      mode === "preview" ? window.open("about:blank", "_blank") : null;
    if (mode === "preview" && !tab) {
      inFlight.current = false;
      toast.error(
        lang === "zh"
          ? "请允许弹出窗口以预览简历。"
          : "Allow pop-ups to preview the CV.",
      );
      return;
    }
    if (tab) {
      tab.opener = null;
      const referrer = tab.document.createElement("meta");
      referrer.name = "referrer";
      referrer.content = "no-referrer";
      tab.document.head.appendChild(referrer);
      tab.document.body.textContent =
        lang === "zh" ? "正在加载简历…" : "Loading CV…";
    }
    setPending(true);
    try {
      const url = await (mode === "preview"
        ? requestCvPreview(applicationId)
        : requestCvDownload(applicationId));
      if (tab) {
        if (!tab.closed) tab.location.replace(url);
        return;
      }
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noreferrer";
      link.referrerPolicy = "no-referrer";
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      tab?.close();
      if (error instanceof AdminRequestError && error.status === 401) {
        signInAgain(lang);
        return;
      }
      if (error instanceof AdminRequestError && error.status === 415) {
        toast.error(
          lang === "zh"
            ? "仅支持预览 PDF。请下载 Word 文件。"
            : "Preview is available for PDFs. Download Word files to open them.",
        );
        return;
      }
      toast.error(
        lang === "zh"
          ? "简历暂不可用，或您无权下载。"
          : "The CV is unavailable or you do not have permission to download it.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    download: (id: string) => openCv(id, "download"),
    preview: (id: string) => openCv(id, "preview"),
  };
}
