/**
 * Singapore hospital reference lists, used by the flex-claim "wrong claim type"
 * policy check: a Polyclinic flex claim whose supporting document is actually a
 * hospital bill is the wrong claim type (should be an Insurance Claim).
 *
 * Names are matched as normalized substrings against extracted document text, so
 * a document letterhead like "SINGAPORE GENERAL HOSPITAL" is recognised
 * regardless of surrounding formatting.
 */

export type HospitalKind = "govt" | "private";

export interface HospitalMatch {
  name: string;
  kind: HospitalKind;
}

// Restructured / public-sector hospitals + national specialty centres.
const GOVT_HOSPITALS = [
  "Alexandra Hospital",
  "Changi General Hospital",
  "KK Women's & Children's Hospital",
  "Khoo Teck Puat Hospital",
  "National University Hospital",
  "National Heart Centre Singapore",
  "National Cancer Centre Singapore",
  "Ng Teng Fong General Hospital",
  "Sengkang General Hospital",
  "Singapore General Hospital",
  "Singapore National Eye Centre",
  "Tan Tock Seng Hospital",
  "Woodlands Health",
  "Woodlands Hospital",
];

// Private hospitals & day-surgery centres.
const PRIVATE_HOSPITALS = [
  "Aptus Surgery Centre",
  "Farrer Park Hospital",
  "Gleneagles Hospital",
  "Mount Alvernia Hospital",
  "Mount Elizabeth Novena Hospital",
  "Mount Elizabeth Orchard Hospital",
  "Mount Elizabeth Hospital",
  "Novena Surgery Centre",
  "Novaaptus Surgery Centre",
  "Parkway East Hospital",
  "Raffles Hospital",
  "Thomson Medical",
  "HMI Medical Centre",
  "Cura Day Surgery Centre",
  "Solis & Luma",
];

/** Lowercase, expand "&", strip punctuation, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Precompute normalized keys, longest-first so the most specific name wins
// (e.g. "mount elizabeth novena hospital" before a shorter generic match).
const HOSPITAL_KEYS: { key: string; name: string; kind: HospitalKind }[] = [
  ...GOVT_HOSPITALS.map((name) => ({ name, kind: "govt" as const })),
  ...PRIVATE_HOSPITALS.map((name) => ({ name, kind: "private" as const })),
]
  .map((e) => ({ ...e, key: normalize(e.name) }))
  .sort((a, b) => b.key.length - a.key.length);

/**
 * Detect whether any known hospital name appears in the given text (e.g. the
 * concatenated fields of an extracted document). Returns the first (most
 * specific) match, or null.
 */
export function detectHospital(text: string): HospitalMatch | null {
  if (!text?.trim()) return null;
  const haystack = ` ${normalize(text)} `;
  for (const h of HOSPITAL_KEYS) {
    if (haystack.includes(` ${h.key} `) || haystack.includes(h.key)) {
      return { name: h.name, kind: h.kind };
    }
  }
  return null;
}
