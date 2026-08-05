import { readFile, mkdir, appendFile } from "node:fs/promises";
import * as path from "path";
import fs from "fs";
import * as vscode from "vscode";

import { getStylesPathsFromVale } from "./cli";

/**
 * Finds the styles path that contains the vocabulary directory, or returns the first path
 */
async function findVocabStylesPath(
  stylesPaths: string,
  vocabularyName: string
): Promise<string> {
  // Check each path to see if the vocabulary directory already exists
  // for (const stylesPath of stylesPaths) {
    const vocabDir = path.join(
      stylesPaths,
      "config",
      "vocabularies",
      vocabularyName
    );
    try {
      // console.log(`Checking for vocabulary directory at ${vocabDir}`);
      await fs.promises.access(vocabDir);
      // Directory exists, use this path
      return stylesPaths;
    } catch {
      // Directory doesn't exist in this path, continue searching
    }
  // }

  // Vocabulary doesn't exist in any path, use the first one
  return stylesPaths[0];
}

/**
 * Adds a word to a vocabulary file (accept.txt or reject.txt)
 */
export async function addToVocabulary(
  word: string,
  vocabularyName: string,
  fileName: "accept.txt" | "reject.txt",
  workspaceRoot: string
): Promise<void> {
  // Get all styles paths from Vale using ls-config
  const stylesPaths = await getStylesPathsFromVale(workspaceRoot);

  if (!stylesPaths || stylesPaths.length === 0) {
    throw new Error(
      "Could not get styles paths from Vale. Make sure Vale is installed and a .vale.ini file exists."
    );
  }

  // Find which path contains the vocabulary directory (or use first if none exist)
  const stylesPath = await findVocabStylesPath(stylesPaths, vocabularyName);

  // Build the vocabulary folder path: <StylesPath>/config/vocabularies/<name>/
  const vocabDir = path.join(
    stylesPath,
    "config",
    "vocabularies",
    vocabularyName
  );

  // Create the directory structure if it doesn't exist
  await mkdir(vocabDir, { recursive: true });

  // Path to the vocabulary file
  const vocabFile = path.join(vocabDir, fileName);
  // Check if the file exists and if the word is already in it
  let fileContent = "";
  try {
    fileContent = await readFile(vocabFile, "utf-8");
  } catch (error) {
    // File doesn't exist yet, will be created
  }

  const lines = fileContent.split("\n").map((line) => line.trim());
  if (lines.includes(word)) {
    vscode.window.showInformationMessage(
      `"${word}" is already in ${fileName}`
    );
    return;
  }

  // Append the word to the file
  await appendFile(vocabFile, `${word}\n`);

  vscode.window.showInformationMessage(
    `Added "${word}" to ${fileName} in vocabulary "${vocabularyName}"`
  );
}
