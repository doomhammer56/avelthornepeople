import { NextRequest } from "next/server";
import Groq from "groq-sdk";
import { buildSystemPrompt, type JobContext } from "@/lib/chatbot/knowledgeBase";
import { z } from "zod";

// Simple in-memory rate limit: max 20 messages per IP per 60-second window.
// Resets automatically as entries expire; no external store needed.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(2000),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  job: z
    .object({
      job_title: z.string().optional(),
      location: z.string().optional(),
      work_mode: z.string().optional(),
      salary_min: z.union([z.string(), z.number()]).optional(),
      salary_max: z.union([z.string(), z.number()]).optional(),
      currency: z.string().optional(),
      salary_type: z.string().optional(),
      benefits: z.string().optional(),
      language: z.string().optional(),
      age_range: z.string().optional(),
      shift: z.string().optional(),
      requirements: z.string().optional(),
      interview_process: z.string().optional(),
      required_docs: z.string().optional(),
      start_date: z.string().optional(),
      training: z.string().optional(),
      risk_notes: z.string().optional(),
    })
    .optional(),
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: NextRequest) {
  // Rate limit by forwarded IP or connection remote address
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return new Response("Too many requests", { status: 429 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return new Response("Invalid request", { status: 400 });
  }

  const job: JobContext | undefined = body.job;
  const systemPrompt = buildSystemPrompt(job);

  // Stream the response back so the widget shows tokens as they arrive
  const stream = await groq.chat.completions.create({
    model: "qwen/qwen3.8-27b",
    messages: [
      { role: "system", content: systemPrompt },
      ...body.messages,
    ],
    max_tokens: 400,
    temperature: 0.4,
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) controller.enqueue(encoder.encode(text));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-store",
    },
  });
}
