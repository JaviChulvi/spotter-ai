// Streaming OpenAI strength-coach endpoint. Reads only OPENAI_API_KEY from env.
import type { NextRequest } from "next/server";
import OpenAI from "openai";
import { OPENAI_MODEL } from "@/lib/config";
import {
  COACH_FEEDBACK_JSON_SCHEMA,
  type SquatSetSummary,
} from "@/lib/coach/schema";
import { SQUAT_COACH_SYSTEM_PROMPT, buildUserPrompt } from "@/lib/coach/prompt";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return json(
      { error: "OPENAI_API_KEY is not set. Add it to .env.local and restart." },
      500,
    );
  }

  let summary: SquatSetSummary;
  try {
    summary = (await req.json()) as SquatSetSummary;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const client = new OpenAI();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const completion = await client.chat.completions.create({
          model: OPENAI_MODEL,
          stream: true,
          response_format: {
            type: "json_schema",
            json_schema: COACH_FEEDBACK_JSON_SCHEMA,
          },
          messages: [
            { role: "system", content: SQUAT_COACH_SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(summary) },
          ],
        });
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
