import mammoth from "mammoth";

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  if (!result.value || result.value.trim().length === 0) {
    throw new Error("DOCX document contains no extractable text");
  }
  return result.value;
}
