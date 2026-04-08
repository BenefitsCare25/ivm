/**
 * Normalizes DOCX XML to merge split placeholder text across formatting runs.
 *
 * Word often splits `{{placeholder}}` across multiple <w:r> elements due to
 * spell-check, formatting, or editing history. For example:
 *   <w:r><w:t>{{</w:t></w:r><w:r><w:t>name</w:t></w:r><w:r><w:t>}}</w:t></w:r>
 *
 * This function detects split placeholders and merges them into single runs.
 */
export function normalizeDocxRuns(xml: string): string {
  let result = xml;
  let changed = true;

  // Iterate until no more merges are needed (handles chained splits)
  while (changed) {
    changed = false;

    // Extract all <w:r>...</w:r> positions with their text content
    const runs: Array<{ match: string; text: string; start: number; end: number }> = [];
    const runPattern = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    let m: RegExpExecArray | null;

    while ((m = runPattern.exec(result)) !== null) {
      let text = "";
      const textPattern = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let tm: RegExpExecArray | null;
      while ((tm = textPattern.exec(m[0])) !== null) {
        text += tm[1];
      }
      runs.push({ match: m[0], text, start: m.index, end: m.index + m[0].length });
    }

    // Scan for adjacent runs whose combined text contains a complete {{placeholder}}
    for (let i = 0; i < runs.length; i++) {
      let combined = "";
      let j = i;

      while (j < runs.length && j - i < 10) {
        combined += runs[j].text;

        if (j > i && /\{\{[^}]+\}\}/.test(combined)) {
          // Runs i..j together form a split placeholder — merge into run i
          const firstRun = runs[i].match;

          // Replace the <w:t> content in the first run with the combined text
          const mergedRun = firstRun.replace(
            /<w:t[^>]*>[\s\S]*?<\/w:t>/,
            `<w:t xml:space="preserve">${combined}</w:t>`
          );

          // Rebuild: keep everything before run i, add merged run, skip runs i+1..j, keep rest
          result =
            result.substring(0, runs[i].start) +
            mergedRun +
            result.substring(runs[j].end);

          changed = true;
          break;
        }
        j++;
      }
      if (changed) break;
    }
  }

  return result;
}
