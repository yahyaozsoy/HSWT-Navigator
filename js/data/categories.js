// How places are grouped everywhere in the app (Campus tab, quick chips, search labels, panels).
// Grouped by what people come for, not by who runs the place: both libraries sit together
// even though one belongs to HSWT and one to TUM.

export const CATEGORIES = [
  { id: 'study', icon: 'local_library', name: { de: 'Bibliotheken & Lernen', en: 'Libraries & study' } },
  { id: 'advice', icon: 'support_agent', name: { de: 'Studium & Beratung', en: 'Studies & advice' } },
  { id: 'food', icon: 'restaurant', name: { de: 'Essen & Trinken', en: 'Food & drink' } },
  { id: 'international', icon: 'public', name: { de: 'International & Karriere', en: 'International & careers' } },
  { id: 'faculty', icon: 'school', name: { de: 'Fakultäten & Dekanate', en: "Faculties & dean's offices" } },
  { id: 'research', icon: 'science', name: { de: 'Institute & Forschung', en: 'Institutes & research' } },
  { id: 'living', icon: 'home', name: { de: 'Wohnen & Campusleben', en: 'Housing & campus life' } },
  { id: 'transit', icon: 'directions_bus', name: { de: 'Bus, Bahn & Rad', en: 'Bus, train & bike' } },
];

export const categoryById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
