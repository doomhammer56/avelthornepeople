import type { AdminLang } from "./nav";

// Bilingual labels for "My account", where any staff member changes their own
// display name and password. Team-wide role and access changes stay in
// Accounts & Roles, which only Admins can open.
export const accountContent: Record<
  AdminLang,
  {
    title: string;
    subtitle: string;
    profileTitle: string;
    profileHelp: string;
    name: string;
    nameHelp: string;
    email: string;
    emailHelp: string;
    role: string;
    saveName: string;
    saving: string;
    nameSaved: string;
    nameInvalid: string;
    nameFailed: string;
    passwordTitle: string;
    passwordHelp: string;
    current: string;
    next: string;
    repeat: string;
    show: string;
    hide: string;
    captcha: string;
    captchaFailed: string;
    changePassword: string;
    changing: string;
    passwordSaved: string;
    mismatch: string;
    wrongCurrent: string;
    weak: string;
    reused: string;
    locked: string;
    inProgress: string;
    limited: string;
    unavailable: string;
    resetRequired: string;
    failed: string;
  }
> = {
  en: {
    title: "My account",
    subtitle: "Update your own name and password.",
    profileTitle: "Profile",
    profileHelp:
      "Your name appears in the sidebar and in the audit log. Your email and role are managed by an administrator.",
    name: "Display name",
    nameHelp: "Up to 100 characters.",
    email: "Email",
    emailHelp: "Used to sign in. Ask an administrator to change it.",
    role: "Role",
    saveName: "Save name",
    saving: "Saving…",
    nameSaved: "Your name was updated.",
    nameInvalid: "Enter a name between 1 and 100 characters.",
    nameFailed: "We could not update your name. Please try again.",
    passwordTitle: "Change password",
    passwordHelp:
      "Enter your current password and choose a new one with at least 12 characters. For security you will be signed out everywhere and asked to sign in again.",
    current: "Current password",
    next: "New password (at least 12 characters)",
    repeat: "Confirm new password",
    show: "Show password",
    hide: "Hide password",
    captcha: "Complete the security check to continue.",
    captchaFailed:
      "The security check could not load. Reload this page to try again.",
    changePassword: "Change password",
    changing: "Changing…",
    passwordSaved: "Password changed. Please sign in again.",
    mismatch: "The new passwords must match.",
    wrongCurrent: "Your current password is incorrect.",
    weak: "This password does not meet the security requirements. Choose a stronger password.",
    reused: "Choose a new password that is different from your current one.",
    locked:
      "Sign-in checks are temporarily locked after too many attempts. Try again later.",
    inProgress: "Another check is in progress. Please wait and retry.",
    limited: "Too many requests. Please try again shortly.",
    unavailable:
      "Authentication is temporarily unavailable. Please try again shortly.",
    resetRequired:
      "We could not finish changing your password. Sign in again, or use “Forgot your password?” on the sign-in page.",
    failed: "We could not change your password. Check your details and retry.",
  },
  zh: {
    title: "我的账号",
    subtitle: "修改您自己的姓名和密码。",
    profileTitle: "个人资料",
    profileHelp:
      "您的姓名会显示在侧边栏和操作日志中。邮箱和角色由管理员管理。",
    name: "显示名称",
    nameHelp: "最多 100 个字符。",
    email: "邮箱",
    emailHelp: "用于登录。如需修改请联系管理员。",
    role: "角色",
    saveName: "保存姓名",
    saving: "保存中…",
    nameSaved: "姓名已更新。",
    nameInvalid: "请输入 1 至 100 个字符的姓名。",
    nameFailed: "无法更新姓名，请重试。",
    passwordTitle: "修改密码",
    passwordHelp:
      "请输入当前密码，并设置至少 12 个字符的新密码。出于安全考虑，修改后所有设备都会退出登录，需要重新登录。",
    current: "当前密码",
    next: "新密码（至少 12 个字符）",
    repeat: "确认新密码",
    show: "显示密码",
    hide: "隐藏密码",
    captcha: "请完成安全验证。",
    captchaFailed: "安全验证加载失败，请刷新页面重试。",
    changePassword: "修改密码",
    changing: "修改中…",
    passwordSaved: "密码已修改，请重新登录。",
    mismatch: "两次输入的新密码必须一致。",
    wrongCurrent: "当前密码不正确。",
    weak: "此密码不符合安全要求，请选择更强的密码。",
    reused: "新密码不能与当前密码相同。",
    locked: "尝试次数过多，验证已暂时锁定，请稍后重试。",
    inProgress: "另一项验证正在处理中，请稍后重试。",
    limited: "请求过多，请稍后重试。",
    unavailable: "身份验证暂时不可用，请稍后重试。",
    resetRequired:
      "无法完成密码修改。请重新登录，或在登录页使用“忘记密码”。",
    failed: "无法修改密码，请检查信息后重试。",
  },
};
