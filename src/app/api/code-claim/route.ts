import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { patientInfo, procedureDescription, dateOfService, providerType, insuranceType } = await req.json();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
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

  const content = message.content[0];
  if (content.type !== "text") return NextResponse.json({ error: "Unexpected response" }, { status: 500 });

  try {
    return NextResponse.json(JSON.parse(content.text));
  } catch {
    return NextResponse.json({ error: "Failed to parse" }, { status: 500 });
  }
}
