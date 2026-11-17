import { AdminRequestError } from "./staffClient.ts";
import type {
  ContentImage,
  ContentIssue,
  ManagedContentBlock,
} from "../content/contract.ts";
export class ContentRequestError extends AdminRequestError {
  readonly issues: ContentIssue[];
  constructor(status: number, issues: unknown) {
    super(status);
    this.issues = Array.isArray(issues)
      ? issues
          .slice(0, 20)
          .filter(
            (i) =>
              i &&
              typeof i.field === "string" &&
              /^[a-zA-Z0-9_.]{0,100}$/.test(i.field) &&
              [
                "invalid",
                "required",
                "fallback_required",
                "image_unavailable",
              ].includes(i.code),
          )
          .map((i) => ({ field: i.field, code: i.code }))
      : [];
  }
}
export async function sendContentCommand(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
  fetcher: typeof fetch = fetch,
): Promise<ManagedContentBlock> {
  const response = await fetcher(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ContentRequestError(
      response.status,
      data?.error === "validation_failed" ? data.issues : [],
    );
  if (
    !data?.block ||
    typeof data.block.id !== "string" ||
    !Number.isSafeInteger(data.block.version) ||
    !data.block.draft
  )
    throw new ContentRequestError(503, []);
  return data.block;
}
export async function uploadCompanyImage(file: File): Promise<ContentImage> {
  if (!file.size || file.size > 3000000)
    throw new ContentRequestError(400, [{ field: "image", code: "invalid" }]);
  const response = await fetch("/api/admin/content/images", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": file.type },
    body: file,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ContentRequestError(response.status, data?.issues);
  if (
    !data?.image ||
    !/^\/api\/admin\/content\/images\/[0-9a-f-]+$/.test(data.image.url)
  )
    throw new ContentRequestError(503, []);
  return data.image;
}
export const contentEditorText = {
  en: {
    save: "Save draft",
    saved: "Draft saved.",
    published: "Content published.",
    unpublished: "Content unpublished.",
    unpublish: "Unpublish",
    create: "Add section",
    empty: "No sections yet. Add a section to start editing.",
    eyebrow: "Eyebrow",
    alt: "Image description (accessibility)",
    label: "Label",
    year: "Year (four digits)",
    kinds: {
      card: "Card",
      mission: "Mission / vision",
      history: "Timeline entry",
      service: "Service",
      stat: "Statistic",
    },
    kind: "Item type",
    items: "Section items",
    add: "Add item",
    remove: "Remove",
    up: "Move up",
    down: "Move down",
    image: "Image",
    dropzone: "Click or drag an image here to upload",
    defaultImage:
      "The standard website photograph (shown here) is used when no custom image is selected.",
    clear: "Remove image",
    upload: "JPEG, PNG or WebP, maximum 3 MB",
    fallback:
      "Show Chinese for English visitors when the English version is incomplete.",
    failed:
      "Unable to complete this request. Check the highlighted fields and reload after a conflict or interrupted response before retrying.",
    dirty:
      "Save your draft before publishing. Saved changes stay private until publication.",
    confirm:
      "Unpublish this section? It will be removed from the public site; the draft remains available.",
    location: "Job location filter",
    reload: "Reload saved sections",
    invalid: "Check this field.",
    required: "This field is required.",
    fallback_required: "Complete English content or confirm Chinese fallback.",
    image_unavailable: "Choose an available image.",
  },
  zh: {
    save: "保存草稿",
    saved: "草稿已保存。",
    published: "内容已发布。",
    unpublished: "内容已取消发布。",
    unpublish: "取消发布",
    create: "添加区块",
    empty: "暂无区块，请添加区块以开始编辑。",
    eyebrow: "引导标题",
    alt: "图片描述（无障碍）",
    label: "标签",
    year: "年份（四位数字）",
    kinds: {
      card: "卡片",
      mission: "使命／愿景",
      history: "历程节点",
      service: "业务服务",
      stat: "数据",
    },
    kind: "项目类型",
    items: "区块项目",
    add: "添加项目",
    remove: "删除",
    up: "上移",
    down: "下移",
    image: "图片",
    dropzone: "点击或拖拽图片到此处上传",
    defaultImage: "未选择自定义图片时，将显示网站标准照片（如图所示）。",
    clear: "移除图片",
    upload: "支持 JPEG、PNG 或 WebP，最大 3 MB",
    fallback: "英文内容不完整时，为英文访客显示中文内容。",
    failed:
      "无法完成此请求。请检查标记的字段；若发生冲突或响应中断，请重新加载确认后再重试。",
    dirty: "发布前请先保存草稿，保存的修改在发布前仅内部可见。",
    confirm: "确定取消发布此区块吗？官网将不再显示，但草稿会保留。",
    location: "职位地点筛选值",
    reload: "重新加载已保存区块",
    invalid: "请检查此字段。",
    required: "此项为必填。",
    fallback_required: "请完善英文内容或确认使用中文。",
    image_unavailable: "请选择可用的图片。",
  },
} as const;
