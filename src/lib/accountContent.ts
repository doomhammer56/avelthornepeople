// Keep candidate-account labels bilingual and separate from authentication services.
// New accounts are an added product scope; no tracking or session behavior is implied by this UI.
export const accountContent = {
  en: {
    eyebrow: "Candidate Account",
    login: "Log In",
    signup: "Create Account",
    name: "Full Name",
    email: "Email",
    password: "Password",
    confirm: "Confirm Password",
    loginPrompt: "Already Have An Account?",
    signupPrompt: "New To Tricore Customer Care LLC?",
    unavailable:
      "Account access is not available yet. Sign-up and login will open once authentication is connected.",
    noScript: "Enable JavaScript to review the account form.",
    introduction: "Explore opportunities at Tricore Customer Care LLC.",
  },
  zh: {
    eyebrow: "求职者账户",
    login: "登录",
    signup: "创建账户",
    name: "姓名",
    email: "邮箱",
    password: "密码",
    confirm: "确认密码",
    loginPrompt: "已有账户？",
    signupPrompt: "首次访问 Tricore Customer Care LLC？",
    unavailable: "账户功能暂未开放。身份验证服务接入后，即可注册和登录。",
    noScript: "请启用 JavaScript 以查看账户表单。",
    introduction: "探索 Tricore Customer Care LLC 的职业机会。",
  },
};
// Pause candidate accounts until their product scope is approved.
// Keep both navigation and direct preview routes behind the same switch.
export const candidateAccountsEnabled = false;
