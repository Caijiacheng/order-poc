import type { ProductEntity } from "@/lib/memory/types";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\-_./，。！？、【】（）()]/g, "")
    .trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function collectProductTerms(product: ProductEntity) {
  const terms = [
    product.sku_id,
    product.sku_name,
    product.brand,
    product.category,
    product.spec,
    ...product.tags,
    ...(product.alias_names ?? []),
    ...(product.search_terms ?? []),
  ];
  return unique(terms.map(normalizeText).filter(Boolean));
}

function scoreTermMatch(keyword: string, term: string) {
  if (keyword === term) return 120;
  if (term.startsWith(keyword) || keyword.startsWith(term)) return 80;
  if (term.includes(keyword)) return 60;
  return 0;
}

function scoreProductByKeyword(product: ProductEntity, keyword: string) {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) return 0;
  const terms = collectProductTerms(product);
  return terms.reduce((best, term) => Math.max(best, scoreTermMatch(normalizedKeyword, term)), 0);
}

export function matchProductsByKeywords(input: {
  products: ProductEntity[];
  keywords: string[];
  mode?: "any" | "all";
  onlyActive?: boolean;
  limit?: number;
}) {
  const keywords = input.keywords.map(normalizeText).filter(Boolean);
  const mode = input.mode ?? "any";
  if (keywords.length === 0) {
    return input.products.filter((item) => (input.onlyActive ? item.status === "active" : true));
  }

  const scored = input.products
    .filter((item) => (input.onlyActive ? item.status === "active" : true))
    .map((product) => {
      const scores = keywords.map((keyword) => scoreProductByKeyword(product, keyword));
      const matchedCount = scores.filter((score) => score > 0).length;
      if (mode === "all" && matchedCount !== keywords.length) {
        return null;
      }
      if (mode === "any" && matchedCount === 0) {
        return null;
      }
      const totalScore = scores.reduce((sum, score) => sum + score, 0) + matchedCount * 10;
      return { product, score: totalScore };
    })
    .filter((item): item is { product: ProductEntity; score: number } => Boolean(item))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.product.display_order - right.product.display_order;
    });

  const products = scored.map((item) => item.product);
  return input.limit ? products.slice(0, input.limit) : products;
}

export function excludeProductsByKeywords(input: {
  products: ProductEntity[];
  excludeKeywords: string[];
}) {
  const excludeKeywords = input.excludeKeywords.map(normalizeText).filter(Boolean);
  if (excludeKeywords.length === 0) {
    return input.products;
  }

  return input.products.filter((product) => {
    const terms = collectProductTerms(product);
    return !excludeKeywords.some((keyword) => terms.some((term) => term.includes(keyword)));
  });
}
