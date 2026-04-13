import { db } from "@/lib/db";
import { createChildLogger } from "@/lib/logger";
import type { AIProvider } from "@/lib/ai/types";

const log = createChildLogger({ module: "intelligence-forensics" });

// ─── PDF Metadata Analysis ────────────────────────────────────────────────────

const SUSPICIOUS_CREATORS = [
  "photoshop", "gimp", "paint.net", "pixelmator", "affinity photo",
  "canva", "snapseed", "lightroom", "corel draw", "inkscape",
];

const SUSPICIOUS_PRODUCERS = [
  "ilovepdf", "smallpdf", "pdf2go", "pdfcrowd", "sejda",
  "pdfescape", "pdf24", "foxit phantompdf", "nitro",
];

/**
 * Examines PDF document metadata for signs of post-creation editing:
 * - Creator is a raster/graphics editor (Photoshop, GIMP)
 * - Producer is an online PDF manipulation tool
 * - Modification date is suspiciously newer than creation date
 *
 * Creates a DOCUMENT_METADATA ValidationResult (WARNING or FAIL).
 * Always non-fatal — never throws.
 */
export async function checkPdfMetadata(
  trackedItemId: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<void> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
    } catch {
      // Malformed or encrypted PDF — skip metadata check
      return;
    }

    const creator = pdfDoc.getCreator()?.toLowerCase() ?? "";
    const producer = pdfDoc.getProducer()?.toLowerCase() ?? "";
    const creationDate = pdfDoc.getCreationDate();
    const modDate = pdfDoc.getModificationDate();

    const findings: string[] = [];
    let severity: "WARNING" | "FAIL" = "WARNING";

    // Check for image/graphics editor as document creator
    const suspiciousCreator = SUSPICIOUS_CREATORS.find((s) => creator.includes(s));
    if (suspiciousCreator) {
      findings.push(
        `Document was created with "${pdfDoc.getCreator()}" — a graphics editor, not a document authoring tool`
      );
      severity = "FAIL";
    }

    // Check for suspicious online PDF editor as producer
    const suspiciousProducer = SUSPICIOUS_PRODUCERS.find((s) => producer.includes(s));
    if (suspiciousProducer) {
      findings.push(
        `Document was produced by "${pdfDoc.getProducer()}" — an online PDF editor commonly used to modify documents`
      );
      severity = "FAIL";
    }

    // Check for suspicious modification gap (> 30 days after creation)
    if (creationDate && modDate) {
      const gapDays = Math.round(
        (modDate.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (gapDays > 30) {
        findings.push(
          `Document was modified ${gapDays} days after creation ` +
          `(created: ${creationDate.toLocaleDateString()}, modified: ${modDate.toLocaleDateString()})`
        );
      }
    }

    if (findings.length === 0) return;

    await db.validationResult.create({
      data: {
        trackedItemId,
        ruleType: "DOCUMENT_METADATA",
        status: severity,
        message: findings.join("; "),
        metadata: JSON.parse(
          JSON.stringify({
            fileName,
            creator: pdfDoc.getCreator() ?? null,
            producer: pdfDoc.getProducer() ?? null,
            creationDate: creationDate?.toISOString() ?? null,
            modificationDate: modDate?.toISOString() ?? null,
            findings,
          })
        ),
      },
    });

    log.warn({ trackedItemId, fileName, findings }, "[forensics] Suspicious PDF metadata");
  } catch (err) {
    log.warn({ err, trackedItemId, fileName }, "[forensics] PDF metadata check failed (non-fatal)");
  }
}

// ─── AI Visual Forensics ──────────────────────────────────────────────────────

const FORENSICS_SYSTEM_PROMPT = `You are a document forensics expert. Analyze the provided document for visual signs of alteration or forgery. Look for:
1. Font inconsistencies — characters in a different font, weight, or baseline than surrounding text
2. Pixel artifacts — blurry halos, jagged edges, or compression artifacts around specific numbers or names
3. Background anomalies — pattern breaks, color discontinuities, or "white patches" suggesting erased content
4. Alignment issues — text appearing slightly off-baseline compared to surrounding content
5. Resolution inconsistencies — areas with noticeably different image quality suggesting pasted-in content
6. Suspicious whitespace or blank areas that may be covering original content

Respond ONLY with valid JSON (no markdown, no preamble):
{"suspicious":boolean,"confidence":"low"|"medium"|"high","findings":string[],"summary":string}

Set "suspicious" to true only if you observe concrete visual evidence of alteration.
Set "confidence" to "high" only if evidence is unambiguous. Use "medium" if probable. Use "low" if speculative.
"findings" must list specific observations (e.g. "Blurry halo around dollar amount on line 3").
"summary" is one sentence.`;

interface ForensicsResult {
  suspicious: boolean;
  confidence: "low" | "medium" | "high";
  findings: string[];
  summary: string;
}

async function callForensicsAI(
  fileBuffer: Buffer,
  mimeType: string,
  provider: AIProvider,
  apiKey: string,
  model?: string
): Promise<ForensicsResult | null> {
  const base64 = fileBuffer.toString("base64");
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  if (!isPdf && !isImage) return null;

  if (provider === "anthropic") {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });

    const content: Parameters<typeof client.messages.create>[0]["messages"][0]["content"] = [];

    if (isPdf) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      } as never);
    } else {
      content.push({
        type: "image",
        source: { type: "base64", media_type: mimeType as "image/png" | "image/jpeg" | "image/webp", data: base64 },
      });
    }
    content.push({ type: "text", text: "Analyze this document for signs of forgery or alteration." });

    const response = await client.messages.create(
      {
        model: model ?? "claude-opus-4-6",
        max_tokens: 1024,
        system: FORENSICS_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      },
      { signal: AbortSignal.timeout(30_000) }
    );

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    return parseForensicsResponse(text);

  } else if (provider === "openai") {
    if (isPdf) return null; // OpenAI vision doesn't support PDF natively

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create(
      {
        model: model ?? "gpt-4o",
        max_tokens: 1024,
        messages: [
          { role: "system", content: FORENSICS_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" },
              },
              { type: "text", text: "Analyze this document for signs of forgery or alteration." },
            ],
          },
        ],
      },
      { signal: AbortSignal.timeout(30_000) }
    );

    const text = response.choices[0]?.message?.content ?? "";
    return parseForensicsResponse(text);

  } else if (provider === "gemini") {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genai = new GoogleGenerativeAI(apiKey);
    const geminiModel = genai.getGenerativeModel({ model: model ?? "gemini-2.0-flash" });

    const result = await geminiModel.generateContent({
      systemInstruction: FORENSICS_SYSTEM_PROMPT,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: "Analyze this document for signs of forgery or alteration." },
          ],
        },
      ],
    });

    const text = result.response.text();
    return parseForensicsResponse(text);
  }

  return null;
}

function parseForensicsResponse(raw: string): ForensicsResult | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<ForensicsResult>;
    if (typeof parsed.suspicious !== "boolean") return null;
    return {
      suspicious: parsed.suspicious,
      confidence: (["low", "medium", "high"] as const).includes(parsed.confidence as never)
        ? (parsed.confidence as "low" | "medium" | "high")
        : "low",
      findings: Array.isArray(parsed.findings) ? parsed.findings.filter((f) => typeof f === "string") : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  } catch {
    return null;
  }
}

/**
 * Uses AI vision to detect pixel-level forgery artifacts in documents:
 * font inconsistencies, background breaks, resolution anomalies, etc.
 *
 * Creates a VISUAL_FORENSICS ValidationResult (FAIL for high confidence, WARNING for medium).
 * Only runs for PDF and image files. Skipped for OpenAI + PDF combination.
 * Always non-fatal — never throws.
 */
export async function checkVisualForensics(
  trackedItemId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  provider: AIProvider,
  apiKey: string,
  model?: string
): Promise<void> {
  try {
    const result = await callForensicsAI(fileBuffer, mimeType, provider, apiKey, model);

    if (!result || !result.suspicious || result.confidence === "low") return;

    const severity = result.confidence === "high" ? "FAIL" : "WARNING";

    await db.validationResult.create({
      data: {
        trackedItemId,
        ruleType: "VISUAL_FORENSICS",
        status: severity,
        message: result.summary || result.findings.join("; ") || "AI detected visual signs of document alteration",
        metadata: JSON.parse(
          JSON.stringify({
            fileName,
            confidence: result.confidence,
            findings: result.findings,
            provider,
          })
        ),
      },
    });

    log.warn(
      { trackedItemId, fileName, confidence: result.confidence, findings: result.findings },
      "[forensics] Visual forensics flagged suspicious document"
    );
  } catch (err) {
    log.warn({ err, trackedItemId, fileName }, "[forensics] Visual forensics check failed (non-fatal)");
  }
}

// ─── Cross-Field Arithmetic Validation ───────────────────────────────────────

const TOTAL_HINTS = ["total", "grand total", "amount due", "net amount", "total amount", "total billed", "total charged"];
const LINE_AMOUNT_HINTS = ["amount", "charge", "cost", "fee", "billed amount", "allowed amount"];
const SERVICE_DATE_HINTS = ["date of service", "service date", "dos", "treatment date"];
const SUBMISSION_DATE_HINTS = ["submission date", "received date", "claim date", "date submitted", "date received"];

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) || n < 0 ? null : n;
}

function parseDate(value: string): Date | null {
  try {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function matchesHints(key: string, hints: string[]): boolean {
  const lower = key.toLowerCase().trim();
  return hints.some((h) => lower.includes(h));
}

/**
 * Validates arithmetic consistency of extracted document fields:
 * - Sum of line amounts should match any identified total field (within 2% rounding tolerance)
 * - Service date should not be after submission/claim date
 *
 * Creates an ARITHMETIC_INCONSISTENCY ValidationResult (FAIL).
 * Always non-fatal — never throws.
 */
export async function checkArithmeticConsistency(
  trackedItemId: string,
  fields: Record<string, string>,
  fileName?: string
): Promise<void> {
  try {
    const findings: string[] = [];

    // ── Total vs line items check ────────────────────────────────
    let totalValue: number | null = null;
    let totalKey: string | null = null;
    const lineAmounts: { key: string; value: number }[] = [];

    for (const [key, raw] of Object.entries(fields)) {
      const amount = parseAmount(raw);
      if (amount === null) continue;

      if (matchesHints(key, TOTAL_HINTS)) {
        // Use the largest-valued "total" field as the authoritative total
        if (totalValue === null || amount > totalValue) {
          totalValue = amount;
          totalKey = key;
        }
      } else if (matchesHints(key, LINE_AMOUNT_HINTS)) {
        lineAmounts.push({ key, value: amount });
      }
    }

    if (totalValue !== null && lineAmounts.length >= 2) {
      const sum = lineAmounts.reduce((acc, { value }) => acc + value, 0);
      const discrepancy = Math.abs(sum - totalValue);
      const tolerance = totalValue * 0.02; // 2% rounding tolerance

      if (discrepancy > tolerance && discrepancy > 0.5) {
        findings.push(
          `"${totalKey}" (${totalValue.toFixed(2)}) does not match sum of line items ` +
          `(${sum.toFixed(2)}; difference: ${discrepancy.toFixed(2)})`
        );
      }
    }

    // ── Date logic check ─────────────────────────────────────────
    let serviceDate: Date | null = null;
    let serviceDateKey: string | null = null;
    let submissionDate: Date | null = null;
    let submissionDateKey: string | null = null;

    for (const [key, raw] of Object.entries(fields)) {
      if (matchesHints(key, SERVICE_DATE_HINTS) && !serviceDate) {
        const d = parseDate(raw);
        if (d) { serviceDate = d; serviceDateKey = key; }
      } else if (matchesHints(key, SUBMISSION_DATE_HINTS) && !submissionDate) {
        const d = parseDate(raw);
        if (d) { submissionDate = d; submissionDateKey = key; }
      }
    }

    if (serviceDate && submissionDate && serviceDate > submissionDate) {
      findings.push(
        `"${serviceDateKey}" (${serviceDate.toLocaleDateString()}) is AFTER ` +
        `"${submissionDateKey}" (${submissionDate.toLocaleDateString()}) — impossible date sequence`
      );
    }

    if (findings.length === 0) return;

    await db.validationResult.create({
      data: {
        trackedItemId,
        ruleType: "ARITHMETIC_INCONSISTENCY",
        status: "FAIL",
        message: findings.join("; "),
        metadata: JSON.parse(
          JSON.stringify({
            fileName: fileName ?? null,
            findings,
            totalField: totalKey,
            totalValue,
            lineAmountCount: lineAmounts.length,
          })
        ),
      },
    });

    log.warn({ trackedItemId, fileName, findings }, "[forensics] Arithmetic inconsistency detected");
  } catch (err) {
    log.warn({ err, trackedItemId }, "[forensics] Arithmetic check failed (non-fatal)");
  }
}
