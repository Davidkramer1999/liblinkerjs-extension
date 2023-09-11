const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

// get dependencies from package.json
class DependencyCache {
  constructor() {
    this.dependenciesCache = null;
    this.isWatcherSet = false;
  }

  getDependenciesFromPackageJson() {
    if (this.dependenciesCache !== null) {
      return this.dependenciesCache;
    }

    let workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      let rootPath = workspaceFolders[0].uri.fsPath;
      let packageJsonPath = path.join(rootPath, "package.json");

      try {
        if (fs.existsSync(packageJsonPath)) {
          // Use fs.readFileSync and JSON.parse instead of require
          let packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
          this.dependenciesCache = packageJson.dependencies ? Object.keys(packageJson.dependencies) : [];
        }

        if (!this.isWatcherSet) {
          fs.watchFile(packageJsonPath, (curr, prev) => {
            // Read the updated package.json using fs.readFileSync
            const updatedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

            // Create a new dependencies array
            const newDependencies = updatedPackageJson.dependencies ? Object.keys(updatedPackageJson.dependencies) : [];

            // Compare the new dependencies with the cached ones
            if (JSON.stringify(newDependencies) !== JSON.stringify(this.dependenciesCache)) {
              this.dependenciesCache = newDependencies;
            }
          });
          this.isWatcherSet = true;
        }
      } catch (err) {
        console.error(`An error occurred while reading package.json`);
      }
    }
    return this.dependenciesCache;
  }
}

const dependencyCache = new DependencyCache();

function findAndHighlightImports(content, dependencies) {
  const importedItems = [];
  const ranges = [];

  const lines = content.split("\n");

  lines.forEach((line, i) => {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("import")) {
      const fromIndex = trimmedLine.indexOf("from");
      if (fromIndex === -1) return;

      const dep = trimmedLine
        .slice(fromIndex + 5)
        .replace(/['"`;]/g, "")
        .trim();

      if (dependencies.includes(dep)) {
        const openBraceIndex = trimmedLine.indexOf("{");
        const closeBraceIndex = trimmedLine.indexOf("}");

        if (openBraceIndex !== -1 && closeBraceIndex !== -1) {
          const items = trimmedLine.slice(openBraceIndex + 1, closeBraceIndex).split(",");

          items.forEach((item) => {
            const trimmedItem = item.trim();
            importedItems.push(trimmedItem);

            const itemStart = line.indexOf(trimmedItem);
            const itemEnd = itemStart + trimmedItem.length;

            const startPos = new vscode.Position(i, itemStart);
            const endPos = new vscode.Position(i, itemEnd);

            ranges.push(new vscode.Range(startPos, endPos));
          });
        }
      }
    }
  });

  return { ranges, importedItems };
}

function findAndHighlightReturn(content, dependencies) {
  const ranges = [];
  const returnKeyword = "return ";
  const returnStartIndex = content.indexOf(returnKeyword);

  if (returnStartIndex === -1) return ranges;

  let remainingContent = content.slice(returnStartIndex + returnKeyword.length);
  let lineIndex = content.substr(0, returnStartIndex).split("\n").length - 1;

  dependencies.forEach((item) => {
    const openingTag = `<${item}`;
    const selfClosingTag = `/>`;
    const closingTag = `</${item}>`;

    let start = 0;
    let offset = returnStartIndex + returnKeyword.length;

    while ((start = remainingContent.indexOf(openingTag, start)) !== -1) {
      const endOfOpeningTag = remainingContent.indexOf(">", start);
      if (endOfOpeningTag === -1) break;

      const isSelfClosing = remainingContent.substring(endOfOpeningTag - 1, endOfOpeningTag + 1) === selfClosingTag;

      lineIndex += remainingContent.substr(0, start).split("\n").length - 1;
      offset += start;

      let lineContent = content.split("\n")[lineIndex];
      let lineOffset = lineContent.indexOf(openingTag) + 1; // +1 to skip the '<'

      let startPos = new vscode.Position(lineIndex, lineOffset);
      let endPos = new vscode.Position(lineIndex, lineOffset + openingTag.length - 1); // -1 to also skip the '<'

      ranges.push(new vscode.Range(startPos, endPos));

      if (!isSelfClosing) {
        const closeStart = remainingContent.indexOf(closingTag, endOfOpeningTag);
        if (closeStart !== -1) {
          lineOffset = lineContent.indexOf(closingTag);
          startPos = new vscode.Position(lineIndex, lineOffset + 2);
          endPos = new vscode.Position(lineIndex, lineOffset + closingTag.length - 1);

          ranges.push(new vscode.Range(startPos, endPos));
        }
      }

      // Update remainingContent and reset start index
      remainingContent = remainingContent.slice(endOfOpeningTag);
      start = 0;
    }
  });

  return ranges;
}

function checkImportsInFiles(dependencies) {
  let activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }

  let document = activeEditor.document;
  let content = document.getText();

  let highlightDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(220,220,220,.35)",
    isWholeLine: false,
  });

  const { ranges, importedItems } = findAndHighlightImports(content, dependencies);

  const returnRanges = findAndHighlightReturn(content, importedItems);

  // Combine both ranges arrays
  const combinedRanges = [...ranges, ...returnRanges];

  if (combinedRanges.length > 0) {
    activeEditor.setDecorations(highlightDecorationType, combinedRanges);
  }
}

//when opening a new file
vscode.window.onDidChangeActiveTextEditor(() => {
  const dependencies = dependencyCache.getDependenciesFromPackageJson();
  checkImportsInFiles(dependencies);
});

function activate(context) {
  let dependencies = dependencyCache.getDependenciesFromPackageJson();
  checkImportsInFiles(dependencies);

  let disposable = vscode.commands.registerCommand("liblinkerjs.checkImports", () => {
    dependencies = dependencyCache.getDependenciesFromPackageJson();
    checkImportsInFiles(dependencies);
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
