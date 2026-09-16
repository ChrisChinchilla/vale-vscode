import { readFile, mkdir, appendFile } from "node:fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { getStylesPathsFromVale } from "./cli";
import type { ValeExecutionOptions } from "./utils";
import { sanitizeVocabularyWord } from "./utils";

/**
 * Adds a word to a vocabulary file (accept.txt or reject.txt)
 */
export async function addToVocabulary(
  word: string,
  vocabularyName: string,
  fileName: "accept.txt" | "reject.txt",
  workspaceRoot: string,
  execution: ValeExecutionOptions,
  configPath = ""
): Promise<void> {
  if (/[\\/]/.test(vocabularyName) || vocabularyName.trim() !== vocabularyName) {
    throw new Error(
      `Invalid vocabulary name "${vocabularyName}": it can't contain path separators or leading/trailing whitespace.`
    );
  }

  const sanitizedWord = sanitizeVocabularyWord(word);
  if (!sanitizedWord) {
    throw new Error(`"${word}" isn't a valid vocabulary entry.`);
  }

  // Get the styles path from Vale using ls-config
  const stylesPath = await getStylesPathsFromVale(
    workspaceRoot,
    execution,
    configPath
  );

  if (!stylesPath) {
    throw new Error(
      "Could not get styles paths from Vale. Make sure Vale is installed and a .vale.ini file exists."
    );
  }

  // Build the vocabulary folder path: <StylesPath>/config/vocabularies/<name>/
  const vocabDir = path.join(
    stylesPath,
    "config",
    "vocabularies",
    vocabularyName
  );

  // Reject a vocabulary name that escapes the vocabularies directory (e.g. "../../etc")
  const vocabulariesRoot = path.join(stylesPath, "config", "vocabularies");
  const relative = path.relative(vocabulariesRoot, vocabDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Invalid vocabulary name "${vocabularyName}": it must resolve inside the vocabularies directory.`
    );
  }

  // Create the directory structure if it doesn't exist
  await mkdir(vocabDir, { recursive: true });

  // Path to the vocabulary file
  const vocabFile = path.join(vocabDir, fileName);
  // Check if the file exists and if the word is already in it
  let fileContent = "";
  try {
    fileContent = await readFile(vocabFile, "utf-8");
  } catch {
    // File doesn't exist yet, will be created
  }

  const lines = fileContent.split("\n").map((line) => line.trim());
  if (lines.includes(sanitizedWord)) {
    vscode.window.showInformationMessage(
      `"${sanitizedWord}" is already in ${fileName}`
    );
    return;
  }

  // Append the word to the file
  await appendFile(vocabFile, `${sanitizedWord}\n`);

  vscode.window.showInformationMessage(
    `Added "${sanitizedWord}" to ${fileName} in vocabulary "${vocabularyName}"`
  );
}
