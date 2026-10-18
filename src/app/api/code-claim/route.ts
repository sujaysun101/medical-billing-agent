import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  DATE_OF_SERVICE_MAX,
  INSURANCE_TYPE_MAX,
  PATIENT_INFO_MAX,
  PROCEDURE_DESCRIPTION_MAX,
  PROVIDER_TYPE_MAX,
} from "@/lib/claim-limits";
import { capMaxTokens, formatZodError, guardDemoRequest, MAX_OUTPUT_TOKENS } from "@/lib/demo-guard";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const bodySchema = z
  .object({
    patientInfo: z.string().trim().max(PATIENT_INFO_MAX).optional().default(""),
    procedureDescription: z.string().trim().min(1).max(PROCEDURE_DESCRIPTION_MAX),
    dateOfService: z.string().trim().max(DATE_OF_SERVICE_MAX).optional().default(""),
    providerType: z.string().trim().max(PROVIDER_TYPE_MAX).optional().default(""),
    insuranceType: z.string().trim().max(INSURANCE_TYPE_MAX).optional().default(""),
  })
  .strict();

const MAX_BODY_CHARS =
  PATIENT_INFO_MAX +
  PROCEDURE_DESCRIPTION_MAX +
  DATE_OF_SERVICE_MAX +
  PROVIDER_TYPE_MAX +
  INSURANCE_TYPE_MAX +
  1_000;

export async function POST(req: NextRequest) {
  const blocked = await guardDemoRequest(req);
  if (blocked) return blocked;

  let json: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 400 });
    }
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const { patientInfo, procedureDescription, dateOfService, providerType, insuranceType } = parsed.data;

  let message;
  try {
    message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: capMaxTokens(MAX_OUTPUT_TOKENS),
      messages: [
        {
          role: "user",
          content: `You are a certified medical billing and coding specialist. Based on the clinical information, suggest billing codes and assess denial risk.

Patient Info: ${patientInfo}
Procedure/Visit Description: ${procedureDescription}
Date of Service: ${dateOfService}
Provider Type: ${providerType}
Insurance Type: ${insuranceType}

Return ONLY this JSON:
{
  "icdCodes": [
    { "code": "ICD-10 code", "description": "diagnosis description", "confidence": "high", "isPrimary": true }
  ],
  "cptCodes": [
    { "code": "CPT code", "description": "procedure description", "units": 1, "modifiers": ["list of applicable modifiers"] }
  ],
  "denialRisk": {
    "score": "low",
    "percentage": 15,
    "reasons": ["list of denial risk factors"],
    "recommendations": ["how to reduce denial risk"]
  },
  "claimNotes": "important billing notes and documentation requirements",
  "estimatedReimbursement": "estimated reimbursement range note"
}

confidence must be: high, medium, or low. score must be: low, medium, or high.`,
        },
      ],
    });
  } catch {
    // Do not log this error. Provider failures can echo request metadata.
    return NextResponse.json({ error: "The billing request could not be completed" }, { status: 502 });
  }

  const content = message.content[0];
  if (!content || content.type !== "text") {
    return NextResponse.json({ error: "Unexpected response" }, { status: 500 });
  }

  try {
    return NextResponse.json(JSON.parse(content.text));
  } catch {
    return NextResponse.json({ error: "Failed to parse" }, { status: 500 });
  }
}
