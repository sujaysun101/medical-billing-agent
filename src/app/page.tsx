"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface IcdCode { code: string; description: string; confidence: string; isPrimary: boolean; }
interface CptCode { code: string; description: string; units: number; modifiers: string[]; }
interface DenialRisk { score: string; percentage: number; reasons: string[]; recommendations: string[]; }
interface ClaimResult { icdCodes: IcdCode[]; cptCodes: CptCode[]; denialRisk: DenialRisk; claimNotes: string; estimatedReimbursement: string; }

const riskColor: Record<string, string> = { low: "bg-green-100 text-green-800", medium: "bg-yellow-100 text-yellow-800", high: "bg-red-100 text-red-800" };
const confColor: Record<string, string> = { high: "text-green-600", medium: "text-yellow-600", low: "text-red-600" };

export default function Home() {
  const [form, setForm] = useState({ patientInfo: "", procedureDescription: "", dateOfService: "", providerType: "", insuranceType: "" });
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function submit() {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/code-claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResult(data);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-blue-50">
      <header className="bg-white border-b px-6 py-4 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-700 rounded-lg flex items-center justify-center text-white text-sm font-bold">M</div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Medical Billing Agent</h1>
            <p className="text-xs text-slate-500">AI-powered ICD-10 and CPT coding with denial risk assessment</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Enter Claim Details</CardTitle>
            <CardDescription>Provide visit information to generate billing codes and assess denial risk.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Patient Info</Label>
                <Input placeholder="Age, sex, relevant history" value={form.patientInfo} onChange={e => set("patientInfo", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Date of Service</Label>
                <Input type="date" value={form.dateOfService} onChange={e => set("dateOfService", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Provider Type</Label>
                <Input placeholder="e.g. Family Medicine, Cardiology" value={form.providerType} onChange={e => set("providerType", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Insurance Type</Label>
                <Input placeholder="e.g. Medicare, Blue Cross PPO" value={form.insuranceType} onChange={e => set("insuranceType", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Procedure / Visit Description *</Label>
              <Textarea
                placeholder="Describe the clinical encounter, diagnoses, and procedures performed..."
                className="min-h-32"
                value={form.procedureDescription}
                onChange={e => set("procedureDescription", e.target.value)}
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <Button onClick={submit} disabled={loading || !form.procedureDescription.trim()} className="w-full bg-blue-700 hover:bg-blue-800">
              {loading ? "Coding Claim..." : "Generate Billing Codes"}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle>ICD-10 Diagnosis Codes</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {result.icdCodes.map((code, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-blue-700">{code.code}</span>
                          {code.isPrimary && <Badge className="bg-blue-100 text-blue-700 text-xs">Primary</Badge>}
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{code.description}</p>
                        <p className={`text-xs mt-1 ${confColor[code.confidence]}`}>Confidence: {code.confidence}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>CPT Procedure Codes</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {result.cptCodes.map((code, i) => (
                    <div key={i} className="p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-green-700">{code.code}</span>
                        <span className="text-xs text-slate-500">x{code.units}</span>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{code.description}</p>
                      {code.modifiers.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {code.modifiers.map((m, j) => <Badge key={j} variant="outline" className="text-xs">{m}</Badge>)}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card className={result.denialRisk.score === "high" ? "border-red-300" : result.denialRisk.score === "medium" ? "border-yellow-300" : "border-green-300"}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Denial Risk Assessment</CardTitle>
                  <Badge className={riskColor[result.denialRisk.score]}>
                    {result.denialRisk.score.toUpperCase()} RISK
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Risk Factors:</p>
                  <ul className="space-y-1">
                    {result.denialRisk.reasons.map((r, i) => <li key={i} className="text-sm text-red-600 flex gap-1"><span>*</span>{r}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Recommendations:</p>
                  <ul className="space-y-1">
                    {result.denialRisk.recommendations.map((r, i) => <li key={i} className="text-sm text-green-700 flex gap-1"><span>+</span>{r}</li>)}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle>Billing Notes</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-slate-700">{result.claimNotes}</p></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Estimated Reimbursement</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-slate-700">{result.estimatedReimbursement}</p></CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
