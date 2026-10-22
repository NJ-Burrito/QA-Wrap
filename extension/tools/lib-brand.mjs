/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** brand/brand.json for tools that cannot import the extension's modules. */
import { readFileSync } from 'node:fs';

export const BRAND = JSON.parse(readFileSync(new URL('../brand/brand.json', import.meta.url), 'utf8'));
/** The film end card's two fine lines: the site (no scheme; empty when there is none) and "Made by <owner>". */
export const END_CARD_BRAND = {
  url: String(BRAND.urls.homepage || '').replace(/^https?:\/\//, ''),
  publisher: BRAND.madeBy.en.replace('{maker}', BRAND.publisher.en),
};
