import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { randomUUID } from "crypto";
import type { TargetField } from "@/types/target";
import { formatFieldLabel } from "@/lib/utils";

export interface InspectResult {
  fields: TargetField[];
  isSupported: boolean;
  unsupportedReason?: string;
}

const FETCH_TIMEOUT = 15_000;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

const INPUT_TYPE_MAP: Record<string, TargetField["fieldType"]> = {
  text: "text",
  email: "email",
  number: "number",
  date: "date",
  checkbox: "checkbox",
  radio: "radio",
  tel: "text",
  url: "text",
  password: "text",
  search: "text",
};

const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file"]);
const SKIP_NAMES = new Set([
  "_token", "csrf", "csrfmiddlewaretoken", "_csrf", "authenticity_token",
]);

export async function inspectWebpage(url: string): Promise<InspectResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: "follow",
      headers: { "User-Agent": "IVM-TargetInspector/1.0" },
    });
  } catch {
    return {
      fields: [],
      isSupported: false,
      unsupportedReason: "Could not reach URL (timeout or network error)",
    };
  }

  if (!res.ok) {
    return {
      fields: [],
      isSupported: false,
      unsupportedReason: `HTTP ${res.status}: ${res.statusText}`,
    };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return {
      fields: [],
      isSupported: false,
      unsupportedReason: `Not an HTML page (Content-Type: ${contentType})`,
    };
  }

  const html = await res.text();
  if (html.length > MAX_BODY_SIZE) {
    return {
      fields: [],
      isSupported: false,
      unsupportedReason: "Page too large (over 2 MB)",
    };
  }

  // Google Forms: fields are JS-rendered, parse embedded JSON instead
  if (url.includes("docs.google.com/forms")) {
    return inspectGoogleForm(html);
  }

  const $ = cheerio.load(html);
  const fields: TargetField[] = [];

  $("input").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "text").toLowerCase();
    if (SKIP_TYPES.has(type)) return;
    const name = $el.attr("name") ?? $el.attr("id") ?? "";
    if (!name || SKIP_NAMES.has(name)) return;

    fields.push({
      id: randomUUID(),
      name,
      label: findLabel($, $el, name),
      fieldType: INPUT_TYPE_MAP[type] ?? "other",
      required: $el.attr("required") !== undefined,
      currentValue: $el.attr("value") ?? undefined,
      selector: buildSelector($el),
    });
  });

  $("select").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name") ?? $el.attr("id") ?? "";
    if (!name || SKIP_NAMES.has(name)) return;

    const options = $el
      .find("option")
      .map((_, opt) => $(opt).attr("value") ?? $(opt).text().trim())
      .get()
      .filter(Boolean);

    fields.push({
      id: randomUUID(),
      name,
      label: findLabel($, $el, name),
      fieldType: "select",
      required: $el.attr("required") !== undefined,
      options,
      selector: buildSelector($el),
    });
  });

  $("textarea").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name") ?? $el.attr("id") ?? "";
    if (!name || SKIP_NAMES.has(name)) return;

    fields.push({
      id: randomUUID(),
      name,
      label: findLabel($, $el, name),
      fieldType: "textarea",
      required: $el.attr("required") !== undefined,
      currentValue: $el.text().trim() || undefined,
      selector: buildSelector($el),
    });
  });

  return { fields, isSupported: true };
}

function findLabel(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  fallbackName: string
): string {
  const id = $el.attr("id");
  if (id) {
    const labelText = $(`label[for="${id}"]`).first().text().trim();
    if (labelText) return labelText;
  }
  const parentLabel = $el.closest("label").text().trim();
  if (parentLabel) return parentLabel;
  const ariaLabel = $el.attr("aria-label");
  if (ariaLabel) return ariaLabel;
  const placeholder = $el.attr("placeholder");
  if (placeholder) return placeholder;
  return formatFieldLabel(fallbackName);
}

function buildSelector($el: cheerio.Cheerio<AnyNode>): string {
  const id = $el.attr("id");
  if (id) return `#${id}`;
  const name = $el.attr("name");
  if (name) return `[name="${name}"]`;
  return "";
}

// Google Forms field type codes in FB_PUBLIC_LOAD_DATA_
const GF_FIELD_TYPE: Record<number, TargetField["fieldType"]> = {
  0: "text",      // Short answer
  1: "textarea",  // Paragraph
  2: "radio",     // Multiple choice
  3: "select",    // Dropdown
  4: "checkbox",  // Checkboxes
  5: "other",     // Linear scale
  9: "date",      // Date
  10: "other",    // Time
};

function inspectGoogleForm(html: string): InspectResult {
  // FB_PUBLIC_LOAD_DATA_ is assigned as a JS variable in a <script> tag
  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!match) {
    return {
      fields: [],
      isSupported: true,
      unsupportedReason: "Could not parse Google Form structure (form may require sign-in)",
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { fields: [], isSupported: false, unsupportedReason: "Failed to parse Google Form data" };
  }

  // Structure: data[1][1] is the array of form items
  const items = (data as unknown[][])?.[1]?.[1];
  if (!Array.isArray(items)) {
    return { fields: [], isSupported: true };
  }

  const fields: TargetField[] = [];

  for (const item of items) {
    if (!Array.isArray(item)) continue;

    const label = (item[1] as string) ?? "";
    const typeCode = item[3] as number;
    const fieldType = GF_FIELD_TYPE[typeCode] ?? "other";

    // item[4] contains the question data including entry IDs and options
    const questionData = item[4];
    if (!Array.isArray(questionData) || questionData.length === 0) continue;

    const entryId = questionData[0]?.[0];
    if (!entryId) continue;

    const entryName = `entry.${entryId}`;

    // Extract options for radio/select/checkbox types
    let options: string[] | undefined;
    if (typeCode === 2 || typeCode === 3 || typeCode === 4) {
      const rawOptions = questionData[0]?.[1];
      if (Array.isArray(rawOptions)) {
        options = rawOptions
          .map((o: unknown[]) => o?.[0] as string)
          .filter((o): o is string => typeof o === "string" && o.length > 0);
      }
    }

    fields.push({
      id: randomUUID(),
      name: entryName,
      label: label || formatFieldLabel(entryName),
      fieldType,
      required: item[4]?.[0]?.[2] === 1,
      options,
      selector: `[name="${entryName}"]`,
    });
  }

  return { fields, isSupported: true };
}
