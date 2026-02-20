import fs from "node:fs/promises";
import path from "node:path";
import type { NewsItem } from "../types.js";
import { renderArticleMarkdown } from "../utils/article-markdown.js";
import { shortHash, slugify } from "../utils/slug.js";

export function toRelativePath(targetPath: string): string {
  return path.relative(process.cwd(), targetPath).replace(/\\/g, "/");
}

export function createUniqueArticleFolderName(
  title: string,
  url: string,
  usedFolderNames: Set<string>,
): string {
  const id = shortHash(url);
  const baseFolderName = `${slugify(title, 56)}-${id}`;

  let folderName = baseFolderName;
  let suffix = 1;
  while (usedFolderNames.has(folderName)) {
    folderName = `${baseFolderName}-${suffix}`;
    suffix += 1;
  }

  usedFolderNames.add(folderName);
  return folderName;
}

export async function saveArticleFileSet(item: NewsItem, articleDir: string): Promise<void> {
  await fs.writeFile(
    path.join(articleDir, "article.json"),
    `${JSON.stringify(item, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(articleDir, "article.md"),
    renderArticleMarkdown(item),
    "utf8",
  );
}
