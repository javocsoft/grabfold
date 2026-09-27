import type { PageRef, View } from "../../src/index.ts";

export interface Colour {
  name: string;
  hex: string;
  line: string;
}

export const COLOURS: Colour[];
export const SHEETS: number;
export function pageNumber(page: PageRef): number | null;
export function describe(view: View): string;
export function pageHTML(page: PageRef): string;
