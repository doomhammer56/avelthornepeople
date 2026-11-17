// Keep the legal consent copy exact and all application feedback bilingual.
// Form behaviour and the backend adapter can change without altering approved wording.
export const applicationContent = {
  en: {
    title: "Apply Now",
    close: "Close",
    name: "Full Name",
    email: "Email",
    phone: "Phone",
    phoneCountry: "Country / calling code",
    chooseCountry: "Select country",
    phonePlaceholder: "Local or international number",
    coverLetter: "Cover Letter (Optional)",
    resume: "CV",
    resumeHint: "Click or drop to upload · PDF / DOC, max 10MB",
    remove: "Remove File",
    consent:
      "I agree Avelthorne People Group may use my personal data for recruitment, retained for 24 months. I may request deletion at any time.",
    submitConfirmTitle: "Submit application?",
    submitConfirmDescription:
      "Please confirm you want to send this application for this role. You can still edit your details after canceling.",
    submitConfirm: "Yes, submit",
    submitCancel: "Go back",
    captcha: "Complete the security check before submitting.",
    captchaFailed:
      "The security check could not load. Close and reopen the form, then try again.",
    submit: "Submit",
    sending: "Submitting…",
    retryAfter:
      "Please wait {seconds} seconds before trying again. Your details are still here.",
    unavailable:
      "Online submission is not available yet. You can review the form, but your details will not be sent.",
    noScript: "Enable JavaScript to open the application form.",
    successTitle: "Application Received",
    successDescription:
      "A confirmation email is on its way. Our recruitment team will review your application.",
    acceptedDescription:
      "Your application has been received. Our recruitment team will review it and follow up if there is a next step.",
    duplicate: "Your application has already been received for this role.",
    failed:
      "Your application could not be confirmed. Please try again. Your details are still in this form.",
    closed:
      "This role is no longer accepting applications. Please return to the job list.",
    errors: {
      validation:
        "Please correct the highlighted fields and submit again. Your details are still here.",
      upload:
        "Your CV could not be uploaded. Check your connection and try again. Your details are still here.",
      rateLimited:
        "Too many attempts. Please wait a few minutes before trying again. Your details are still here.",
      forbidden:
        "This submission was blocked. Open this job on our website and try again. Your details are still here until you leave this form.",
      conflict:
        "This attempt conflicts with an earlier submission. Close and reopen the form to start a new attempt, or contact us if you are unsure whether it was received.",
      unavailable:
        "The application service is temporarily unavailable. Please try again shortly. Your details are still here.",
      network:
        "We lost the connection and could not confirm receipt. Check your connection, then retry with the same details.",
      timeout:
        "The request timed out and receipt could not be confirmed. Please retry with the same details. Your information is still here.",
      unconfirmed:
        "We could not confirm receipt. Please retry with the same details so we can check your previous attempt.",
      invalidRequest:
        "This submission could not be processed. Check the form and retry. If this continues, reopen the job page and submit again.",
      captcha:
        "The security check did not pass. Complete it and try again. Your details are still here.",
    },
    validation: {
      required: "Please complete this field.",
      nameRequired: "Enter your full name.",
      emailRequired: "Enter your email address.",
      phoneRequired: "Enter your phone number.",
      email: "Enter a valid email address.",
      phone:
        "Enter a valid phone number for the selected country, or use a full international number such as +60 12 345 6789.",
      nameLength: "Use 120 characters or fewer.",
      coverLetterLength: "Use 5,000 characters or fewer.",
      resumeRequired: "Choose your CV.",
      resumeType: "Choose a PDF or DOC file.",
      resumeSize: "Choose a file no larger than 10MB.",
      resumeEmpty: "Choose a file that is not empty.",
      resumeInvalid:
        "This file could not be read as a complete PDF or DOC. Export your CV again, then select the new file.",
      resumeName:
        "Your CV filename is too long. Rename it using 255 characters or fewer, then select it again.",
      uploadExpired:
        "Your CV upload has expired or is no longer available. Please select the file again and submit.",
      multiple: "Choose one CV only.",
      consent: "Your consent is required to submit an application.",
    },
  },
  zh: {
    title: "投递简历",
    close: "关闭",
    name: "姓名",
    email: "邮箱",
    phone: "手机",
    phoneCountry: "国家／区号",
    chooseCountry: "请选择国家",
    phonePlaceholder: "本地号码或国际号码",
    coverLetter: "求职信（选填）",
    resume: "简历",
    resumeHint: "点击或拖拽上传 · PDF / DOC，不超过 10MB",
    remove: "移除文件",
    consent:
      "我同意 Avelthorne People Group 将我的个人信息用于招聘评估，保存期限 24 个月，可随时申请删除。",
    submitConfirmTitle: "确认提交申请？",
    submitConfirmDescription:
      "请确认要将此申请发送给该职位。选择返回仍可继续修改信息。",
    submitConfirm: "确认提交",
    submitCancel: "返回修改",
    captcha: "提交前请完成安全验证。",
    captchaFailed:
      "安全验证加载失败。请关闭并重新打开表单后再试。",
    submit: "提交",
    sending: "正在提交…",
    retryAfter: "请等待 {seconds} 秒后重试，你填写的信息仍保留在此表单中。",
    unavailable: "在线提交暂未开放。你可以查看表单，但你的信息不会被发送。",
    noScript: "请启用 JavaScript 以打开申请表单。",
    successTitle: "投递成功",
    successDescription: "确认邮件已发送至你的邮箱。招聘团队将审核你的申请。",
    acceptedDescription:
      "已收到你的申请。招聘团队将进行审核，如有后续步骤会与你联系。",
    duplicate: "我们已收到你对此职位的申请。",
    failed:
      "暂时无法确认申请是否已收到，请重试。你填写的信息仍保留在此表单中。",
    closed: "该职位已停止接受申请，请返回职位列表。",
    errors: {
      validation: "请修改标出的字段后重新提交。你填写的信息仍保留在此表单中。",
      upload:
        "简历上传失败。请检查网络连接后重试，你填写的信息仍保留在此表单中。",
      rateLimited:
        "尝试次数过多。请等待几分钟后重试，你填写的信息仍保留在此表单中。",
      forbidden:
        "此次提交被阻止。请从我们的网站打开此职位后重试。离开表单前，你填写的信息仍会保留。",
      conflict:
        "此次提交与先前的申请冲突。请关闭并重新打开表单以重新申请；若不确定是否已收到，请联系我们。",
      unavailable:
        "申请服务暂时不可用，请稍后重试。你填写的信息仍保留在此表单中。",
      network:
        "网络连接中断，暂时无法确认是否已收到申请。请检查网络后使用相同的信息重试。",
      timeout:
        "请求超时，暂时无法确认是否已收到申请。请使用相同的信息重试，你填写的信息仍保留在此表单中。",
      unconfirmed:
        "暂时无法确认是否已收到申请。请使用相同的信息重试，以便核对上次提交。",
      invalidRequest:
        "无法处理此次提交。请检查表单后重试；若仍失败，请重新打开职位页面后提交。",
      captcha:
        "安全验证未通过。请完成验证后重试，你填写的信息仍保留在此表单中。",
    },
    validation: {
      required: "请填写此项。",
      nameRequired: "请输入你的姓名。",
      emailRequired: "请输入你的邮箱地址。",
      phoneRequired: "请输入你的电话号码。",
      email: "请输入有效的邮箱地址。",
      phone:
        "请输入所选国家的有效电话号码，或以 + 开头的完整国际号码，例如 +86 138 0013 8000。",
      nameLength: "请输入不超过 120 个字符。",
      coverLetterLength: "请输入不超过 5,000 个字符。",
      resumeRequired: "请选择简历。",
      resumeType: "请选择 PDF 或 DOC 文件。",
      resumeSize: "请选择不超过 10MB 的文件。",
      resumeEmpty: "请选择非空文件。",
      resumeInvalid:
        "无法将此文件识别为完整的 PDF 或 DOC。请重新导出简历后选择新文件。",
      resumeName: "简历文件名过长。请将文件名缩短至 255 个字符以内后重新选择。",
      uploadExpired: "简历上传已过期或不可用，请重新选择文件后提交。",
      multiple: "请只选择一份简历。",
      consent: "提交申请前须同意个人信息使用声明。",
    },
  },
};
export type ApplicationContent =
  (typeof applicationContent)[keyof typeof applicationContent];
