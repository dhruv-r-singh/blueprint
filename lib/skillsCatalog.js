// Common skills/tools shown as autocomplete suggestions on the profile
// Skills field. Freeform entries are still allowed — this just makes
// picking a common one fast.

export const SKILLS_CATALOG = [
  "JavaScript", "TypeScript", "Python", "Go", "Rust", "C++", "C", "Java", "Swift", "Kotlin",
  "React", "React Native", "Next.js", "Vue", "Svelte", "Node.js", "GraphQL",
  "PyTorch", "TensorFlow", "Computer Vision", "NLP", "Mobile ML", "LLM fine-tuning",
  "SQL", "PostgreSQL", "MongoDB", "Firebase", "AWS", "GCP", "Azure", "Docker", "Kubernetes",
  "Figma", "Sketch", "Adobe XD", "Illustrator", "Photoshop", "After Effects",
  "SolidWorks", "Fusion 360", "AutoCAD", "3D printing", "Injection molding", "PCB design",
  "KiCad", "Embedded C", "FPGA", "Arduino", "Raspberry Pi",
  "Partnerships", "Grant writing", "Fundraising", "Go-to-market", "Sales", "Cold outreach",
  "SEO", "Content strategy", "Copywriting", "Growth marketing", "Paid acquisition",
  "Product strategy", "Roadmapping", "User research", "A/B testing", "Analytics",
  "Financial modeling", "Accounting", "Legal / contracts", "Operations", "Recruiting",
];

/** Case-insensitive substring match. */
export function searchSkills(query, exclude = [], limit = 8) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const excludeSet = new Set(exclude.map((s) => s.toLowerCase()));
  return SKILLS_CATALOG.filter((s) => s.toLowerCase().includes(q) && !excludeSet.has(s.toLowerCase())).slice(0, limit);
}
