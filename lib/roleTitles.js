// Shared catalog of role titles + discipline codes, used to power the
// "type to search" autocomplete on the project Overview role form and the
// profile Skills field. Matching is substring-based (not just prefix) so
// typing "chief" surfaces CEO / CFO / CMO / CTO / COO / CPO — anything whose
// full title contains the word "Chief".

export const ROLE_TITLES = [
  { code: "BIZ", title: "Chief Executive Officer", abbr: "CEO" },
  { code: "BIZ", title: "Chief Operating Officer", abbr: "COO" },
  { code: "BIZ", title: "Chief Financial Officer", abbr: "CFO" },
  { code: "BIZ", title: "Chief Marketing Officer", abbr: "CMO" },
  { code: "SW", title: "Chief Technology Officer", abbr: "CTO" },
  { code: "SW", title: "Chief Product Officer", abbr: "CPO" },
  { code: "UX", title: "Chief Design Officer", abbr: "CDO" },
  { code: "AI", title: "Chief Data Officer", abbr: "CDO" },
  { code: "BIZ", title: "VP of Sales" },
  { code: "BIZ", title: "VP of Marketing" },
  { code: "BIZ", title: "VP of Operations" },
  { code: "SW", title: "VP of Engineering" },
  { code: "SW", title: "VP of Product" },
  { code: "SW", title: "Software Engineer" },
  { code: "SW", title: "Frontend Engineer" },
  { code: "SW", title: "Backend Engineer" },
  { code: "SW", title: "Full-Stack Engineer" },
  { code: "SW", title: "Mobile Engineer (iOS)" },
  { code: "SW", title: "Mobile Engineer (Android)" },
  { code: "SW", title: "DevOps Engineer" },
  { code: "SW", title: "Site Reliability Engineer" },
  { code: "SW", title: "Security Engineer" },
  { code: "SW", title: "QA Engineer" },
  { code: "AI", title: "Machine Learning Engineer" },
  { code: "AI", title: "AI Researcher" },
  { code: "AI", title: "Data Scientist" },
  { code: "AI", title: "Data Engineer" },
  { code: "AI", title: "Computer Vision Engineer" },
  { code: "HW", title: "Hardware Engineer" },
  { code: "HW", title: "Electrical Engineer" },
  { code: "HW", title: "Embedded Systems Engineer" },
  { code: "HW", title: "Firmware Engineer" },
  { code: "CAD", title: "Mechanical Engineer" },
  { code: "CAD", title: "CAD Designer" },
  { code: "CAD", title: "Industrial Designer" },
  { code: "UX", title: "Product Designer" },
  { code: "UX", title: "UX Designer" },
  { code: "UX", title: "UI Designer" },
  { code: "UX", title: "UX Researcher" },
  { code: "UX", title: "Brand Designer" },
  { code: "UX", title: "Graphic Designer" },
  { code: "SW", title: "Product Manager" },
  { code: "SW", title: "Project Manager" },
  { code: "SW", title: "Program Manager" },
  { code: "BIZ", title: "Business Development Lead" },
  { code: "BIZ", title: "Growth Marketer" },
  { code: "BIZ", title: "Marketing Manager" },
  { code: "BIZ", title: "Sales Lead" },
  { code: "BIZ", title: "Operations Manager" },
  { code: "BIZ", title: "Finance Lead" },
  { code: "BIZ", title: "General Counsel" },
  { code: "BIZ", title: "Community Manager" },
  { code: "BIZ", title: "Content Writer" },
  { code: "BIZ", title: "Founder" },
  { code: "BIZ", title: "Co-Founder" },
];

/**
 * Substring match against title and abbreviation, case-insensitive.
 * "chief" -> every *CO title; "cfo" -> Chief Financial Officer.
 */
export function searchRoleTitles(query, limit = 8) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return ROLE_TITLES.filter(
    (r) => r.title.toLowerCase().includes(q) || (r.abbr && r.abbr.toLowerCase().includes(q)) || r.code.toLowerCase().includes(q)
  ).slice(0, limit);
}
