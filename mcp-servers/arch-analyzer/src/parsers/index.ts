/**
 * Parser registry. Picks the right parser for a file by extension.
 */

import { typescriptParser } from "./typescript.js";
import { pythonParser } from "./python.js";
import { goParser } from "./go.js";
import { javaParser } from "./java.js";
import type { Language, Parser } from "../types.js";

const PARSERS: Parser[] = [
  typescriptParser,
  pythonParser,
  goParser,
  javaParser,
];

export function pickParser(filePath: string): { parser: Parser; language: Language } | null {
  const lower = filePath.toLowerCase();
  for (const parser of PARSERS) {
    if (parser.extensions.some((ext) => lower.endsWith(ext))) {
      // Pick the first matching language as the canonical one. ts/js files
      // share the same parser but report different language ids.
      const language = inferLanguage(lower, parser);
      return { parser, language };
    }
  }
  return null;
}

function inferLanguage(filePath: string, parser: Parser): Language {
  if (parser === typescriptParser) {
    return /\.[cm]?js$|\.jsx$/.test(filePath) ? "javascript" : "typescript";
  }
  if (parser === pythonParser) return "python";
  if (parser === goParser) return "go";
  if (parser === javaParser) return "java";
  return parser.languages[0]!;
}
