import type { Locale } from "./homeContent";

export type TeamProfile = {
  id: string;
  name: string;
  role: string;
  biography?: string;
};

// Approved team band copy. Named profiles stay empty until HR supplies them.
export const teamContent: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    description: string;
    imageAlt: string;
    preview: string;
    profile: string;
    profiles: readonly TeamProfile[];
  }
> = {
  en: {
    eyebrow: "Our Team",
    title: "Our Team",
    description:
      "A collaborative and supportive team, bringing together diverse experience, ideas and perspectives to deliver great outcomes.",
    imageAlt:
      "Four colleagues collaborating around a table in a bright office.",
    preview: "Design preview — team profiles and photography await approval.",
    profile: "Team Profile",
    profiles: [],
  },
  zh: {
    eyebrow: "我们的团队",
    title: "我们的团队",
    description:
      "一支协作且彼此支持的团队，汇聚多元经验、想法与视角，共同交付出色成果。",
    imageAlt: "四位同事在明亮的办公室内围坐协作讨论。",
    preview: "设计预览 — 团队介绍与照片待审核确认。",
    profile: "团队成员",
    profiles: [],
  },
};
