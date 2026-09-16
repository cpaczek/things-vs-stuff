// Free game analytics: tiny enum-validated event beacon → Analytics Engine.
// Query later with the AE SQL API (dataset: things_vs_stuff).

import { NextRequest, NextResponse } from "next/server";
import { checkLimit, metric, clientIp } from "@/lib/cf";

export const runtime = "nodejs";

const EVENTS = new Set([
  "run_start",
  "run_win",
  "run_loss",
  "invent_ok",
  "invent_overruled",
  "fusion",
]);

export async function POST(req: NextRequest) {
  if (!(await checkLimit("RL_LOOSE", clientIp(req)))) {
    return new NextResponse(null, { status: 429 });
  }
  let e: unknown;
  try {
    e = (await req.json())?.e;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof e !== "string" || !EVENTS.has(e)) {
    return new NextResponse(null, { status: 400 });
  }
  await metric(["event", e]);
  return new NextResponse(null, { status: 204 });
}
