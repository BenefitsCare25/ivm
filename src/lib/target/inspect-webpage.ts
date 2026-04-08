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
