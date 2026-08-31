export const REFERENCE_CATEGORIES: Array<[string, string]> = [
  ["official_asset", "Ativo oficial da marca"],
  ["real_product", "Foto real do produto"],
  ["visual_inspiration", "Inspiração visual"],
];

export const REFERENCE_WEIGHTS: Array<[string, string]> = [
  ["low", "Baixo"],
  ["medium", "Médio"],
  ["high", "Alto"],
];

export function roleForCategory(category: string): string {
  if (category === "official_asset") return "brand_asset";
  if (category === "real_product") return "product_photo";
  return "visual_reference";
}

const AUTOMATIC_RULES: Record<string, string> = {
  official_asset: "Preservar exatamente o ativo enviado. Não redesenhar, reinterpretar, alterar textos, cores ou proporções importantes.",
  real_product: "Preservar a aparência real. É permitido recortar, ajustar iluminação e integrar à composição, mas não substituir por outro produto.",
  visual_inspiration: "Utilizar apenas como inspiração visual. Não copiar logos, nomes, textos, preços, produtos ou elementos exclusivos da referência.",
};

export function automaticRuleForCategory(category: string): string {
  return AUTOMATIC_RULES[category] || AUTOMATIC_RULES.visual_inspiration;
}

export function buildReferenceStoragePath(slug: string, id: string, filename: string): string {
  return `${slug}/references/${id}-${filename}`;
}
