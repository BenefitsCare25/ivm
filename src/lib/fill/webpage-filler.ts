import type { FillContext, FillFieldResult, FillerResult } from "./types";

export async function fillWebpage(ctx: FillContext): Promise<FillerResult> {
  const results: FillFieldResult[] = [];
  const scriptLines: string[] = [
    "// IVM Auto-Fill Script",
    `// Target: ${ctx.targetUrl ?? "unknown"}`,
    `// Generated: ${new Date().toISOString()}`,
    "// Paste this into your browser DevTools console on the target page.",
    "",
    "(function() {",
    "  const results = [];",
  ];

  for (const mapping of ctx.approvedMappings) {
    const value = mapping.userOverrideValue ?? mapping.transformedValue;
    const targetField = ctx.targetFields.find((f) => f.id === mapping.targetFieldId);
    const selector = targetField?.selector;
    const label = targetField?.label ?? mapping.targetLabel;
    const fieldType = targetField?.fieldType ?? "text";

    if (!selector) {
      results.push({
        targetFieldId: mapping.targetFieldId,
        targetLabel: label,
        intendedValue: value,
        appliedValue: null,
        verifiedValue: null,
        status: "FAILED",
        errorMessage: "No CSS selector available for this field",
      });
      continue;
    }

    const escapedValue = JSON.stringify(value);
    const escapedSelector = JSON.stringify(selector);
    const escapedLabel = JSON.stringify(label);

    if (fieldType === "checkbox") {
      const checked = ["true", "yes", "1", "checked", "on"].includes(value.toLowerCase());
      scriptLines.push(
        `  try {`,
        `    const el = document.querySelector(${escapedSelector});`,
        `    if (!el) throw new Error("Element not found");`,
        `    el.checked = ${checked};`,
        `    el.dispatchEvent(new Event("change", { bubbles: true }));`,
        `    results.push({ field: ${escapedLabel}, status: "OK" });`,
        `  } catch(e) { results.push({ field: ${escapedLabel}, status: "FAIL", error: e.message }); }`,
        ""
      );
    } else if (fieldType === "radio") {
      scriptLines.push(
        `  try {`,
        `    const radios = document.querySelectorAll(${escapedSelector});`,
        `    if (!radios.length) throw new Error("No radio elements found");`,
        `    let found = false;`,
        `    radios.forEach(function(el) {`,
        `      if (el.value === ${escapedValue} || (el.labels && el.labels[0] && el.labels[0].textContent.trim() === ${escapedValue})) {`,
        `        el.checked = true;`,
        `        el.dispatchEvent(new Event("change", { bubbles: true }));`,
        `        found = true;`,
        `      }`,
        `    });`,
        `    if (!found) throw new Error("No matching radio option for value: " + ${escapedValue});`,
        `    results.push({ field: ${escapedLabel}, status: "OK" });`,
        `  } catch(e) { results.push({ field: ${escapedLabel}, status: "FAIL", error: e.message }); }`,
        ""
      );
    } else if (fieldType === "select") {
      scriptLines.push(
        `  try {`,
        `    const el = document.querySelector(${escapedSelector});`,
        `    if (!el) throw new Error("Element not found");`,
        `    el.value = ${escapedValue};`,
        `    el.dispatchEvent(new Event("change", { bubbles: true }));`,
        `    results.push({ field: ${escapedLabel}, status: "OK" });`,
        `  } catch(e) { results.push({ field: ${escapedLabel}, status: "FAIL", error: e.message }); }`,
        ""
      );
    } else {
      scriptLines.push(
        `  try {`,
        `    const el = document.querySelector(${escapedSelector});`,
        `    if (!el) throw new Error("Element not found");`,
        `    const nativeSetter = Object.getOwnPropertyDescriptor(`,
        `      window.HTMLInputElement.prototype, "value"`,
        `    )?.set || Object.getOwnPropertyDescriptor(`,
        `      window.HTMLTextAreaElement.prototype, "value"`,
        `    )?.set;`,
        `    if (nativeSetter) nativeSetter.call(el, ${escapedValue});`,
        `    else el.value = ${escapedValue};`,
        `    el.dispatchEvent(new Event("input", { bubbles: true }));`,
        `    el.dispatchEvent(new Event("change", { bubbles: true }));`,
        `    results.push({ field: ${escapedLabel}, status: "OK" });`,
        `  } catch(e) { results.push({ field: ${escapedLabel}, status: "FAIL", error: e.message }); }`,
        ""
      );
    }

    results.push({
      targetFieldId: mapping.targetFieldId,
      targetLabel: label,
      intendedValue: value,
      appliedValue: value,
      verifiedValue: null,
      status: "APPLIED",
      errorMessage: null,
    });
  }

  scriptLines.push(
    `  console.table(results);`,
    `  const ok = results.filter(r => r.status === "OK").length;`,
    `  console.log("IVM Fill: " + ok + "/" + results.length + " fields filled.");`,
    "})();"
  );

  return {
    results,
    filledStoragePath: null,
    webpageFillScript: scriptLines.join("\n"),
  };
}
