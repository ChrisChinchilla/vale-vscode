import * as vscode from "vscode";
import nspell from "nspell";
import en from "dictionary-en";

export const getSpellingSuggestions = async (
  range: vscode.Range,
  file: vscode.TextDocument
): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const word = file.getText(range);
    // TODO: Handle reject?
    const spell = nspell(en as any);
    resolve(spell.suggest(word));
  });
