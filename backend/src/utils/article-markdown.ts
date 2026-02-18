import type { NewsItem } from "../types.js";

function renderPhotos(item: NewsItem): string {
  if (!item.photos.length) {
    return "No photos.\n";
  }

  return item.photos
    .map((photo, index) => {
      return [
        `### Photo ${index + 1}`,
        `- provider: ${photo.provider}`,
        `- source_url: ${photo.source_url}`,
        `- local_path: ${photo.local_path}`,
        `- license: ${photo.license}`,
        `- credit: ${photo.credit}`,
        `- attribution_url: ${photo.attribution_url}`,
        "",
      ].join("\n");
    })
    .join("\n");
}

export function renderArticleMarkdown(item: NewsItem): string {
  return [
    `# ${item.title}`,
    "",
    `- source: ${item.source}`,
    `- url: ${item.url}`,
    `- published_date: ${item.published_date}`,
    `- published_time: ${item.published_time}`,
    `- published_at: ${item.published_at || ""}`,
    `- scraped_at: ${item.scraped_at}`,
    `- rights_flag: ${item.rights_flag}`,
    `- license_text: ${item.license_text}`,
    "",
    "## Content",
    "",
    item.content,
    "",
    "## Photos",
    "",
    renderPhotos(item),
  ].join("\n");
}
