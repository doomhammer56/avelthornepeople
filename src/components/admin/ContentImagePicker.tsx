"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import type { ContentImage } from "@/lib/content/contract";
import type { AdminLang } from "@/lib/admin/nav";
import {
  contentEditorText,
  uploadCompanyImage,
} from "@/lib/admin/contentClient";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CompanyImage } from "../CompanyContentMedia";
export function ContentImagePicker({
  image,
  alt,
  defaultImage,
  lang,
  disabled,
  onChange,
  onPending,
  onError,
}: {
  image?: ContentImage;
  alt: string;
  /** Site photograph shown while no custom image is chosen. */
  defaultImage?: string;
  lang: AdminLang;
  disabled: boolean;
  onChange: (image: ContentImage | null) => void;
  onPending: (delta: number) => void;
  onError: (error: unknown) => void;
}) {
  const t = contentEditorText[lang];
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Share one upload path between the file dialog and drag-and-drop.
  // Both entry points must respect the same pending/error handling.
  async function upload(file: File | undefined) {
    if (!file) return;
    onPending(1);
    try {
      onChange(await uploadCompanyImage(file));
    } catch (error) {
      onError(error);
    } finally {
      onPending(-1);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-foreground/80">
        {t.image}
      </span>
      {/* One clickable, droppable zone replaces the bare file input so staff can
          see, click or drag onto the exact spot that changes the picture. */}
      <div
        className={cn(
          "relative flex cursor-pointer flex-col gap-2.5 rounded-lg border border-dashed border-input bg-card p-3 outline-none transition-colors hover:border-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50",
          dragging && "border-primary bg-background",
          disabled && "cursor-not-allowed opacity-60",
        )}
        data-editor-field="image"
        data-dragging={dragging}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={t.dropzone}
        onClick={() => !disabled && input.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) upload(e.dataTransfer.files?.[0]);
        }}
      >
        {image || !defaultImage ? (
          <CompanyImage
            image={image}
            alt={alt}
            locale={lang}
            className="min-h-[140px]! rounded-md"
          />
        ) : (
          <div className="relative min-h-40 overflow-hidden rounded-md">
            <Image
              src={defaultImage}
              alt=""
              fill
              unoptimized
              sizes="320px"
              style={{ objectFit: "cover" }}
            />
          </div>
        )}
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <ImageUp className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex flex-col gap-0.5">
            <strong className="font-medium text-foreground/80">
              {t.dropzone}
            </strong>
            <small className="text-xs">{t.upload}</small>
          </span>
        </div>
        <input
          ref={input}
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 opacity-0"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            await upload(file);
          }}
        />
      </div>
      {defaultImage && !image ? (
        <small className="text-xs text-muted-foreground">{t.defaultImage}</small>
      ) : null}
      {image ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <Trash2 aria-hidden="true" />
          {t.clear}
        </Button>
      ) : null}
    </div>
  );
}
