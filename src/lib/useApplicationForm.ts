"use client";

import { useForm, useController } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createApplicationSchema,
  type ApplicationValues,
} from "./applicationForm.ts";
import type { ApplicationContent } from "./applicationContent.ts";

export function useApplicationForm(messages: ApplicationContent["validation"]) {
  const form = useForm<ApplicationValues>({
    resolver: zodResolver(createApplicationSchema(messages)),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      phoneCountry: "",
      resume: null,
      consent: false,
      coverLetter: "",
    },
  });
  // Keep a single File in form state. A native register/ref reads FileList on
  // blur/ref updates, which would replace the selected File and fail validation.
  const { field: resumeField } = useController({
    control: form.control,
    name: "resume",
  });
  return { ...form, resumeField };
}
