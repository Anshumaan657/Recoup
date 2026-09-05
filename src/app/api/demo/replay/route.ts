import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_DEMO_SEED } from "@/lib/demo/dataset";
import {
  DemoReplayInProgressError,
  replayDemoEvaluation,
} from "@/lib/demo/replay";
import { getServerEnv } from "@/lib/validation/env";
import { demoReplayRequestSchema } from "@/lib/validation/demo";
import { hostedDemoReplayResponse } from "@/lib/demo/hosted-preview";

export async function POST(request: NextRequest) {
  if (!getServerEnv().DEMO_MODE) {
    return NextResponse.json(
      { status: "forbidden", message: "Demo replay is disabled" },
      { status: 403 }
    );
  }

  let input: unknown = {};
  try {
    const text = await request.text();
    input = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { status: "invalid_request", message: "Request body must be valid JSON" },
      { status: 400 }
    );
  }
  const parsed = demoReplayRequestSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "invalid_request", message: "Use only an integer seed and boolean reset" },
      { status: 400 }
    );
  }

  if (getServerEnv().HOSTED_DEMO_MODE) {
    return NextResponse.json(hostedDemoReplayResponse(), { status: 200 });
  }

  try {
    const result = await replayDemoEvaluation(
      parsed.data.seed ?? DEFAULT_DEMO_SEED,
      parsed.data.reset ?? false
    );
    return NextResponse.json({ status: "completed", ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof DemoReplayInProgressError) {
      return NextResponse.json(
        { status: "conflict", message: "A replay for this seed is already running" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { status: "error", message: "Demo replay failed" },
      { status: 500 }
    );
  }
}
