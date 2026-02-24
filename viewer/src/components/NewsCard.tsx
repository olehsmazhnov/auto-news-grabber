import React from "react";
import type { CardRenderData, NewsItem } from "../types";
import { formatDateTime } from "../utils/date";
import { buildCardRenderData } from "../utils/news";

type NewsCardProps = {
    item: NewsItem;
    expandedItemIds: Set<string>;
    onToggleExpanded: (itemId: string) => void;
};

export function NewsCard({ item, expandedItemIds, onToggleExpanded }: NewsCardProps): JSX.Element {
    const cardData = buildCardRenderData(item, expandedItemIds);

    return (
        <article className="card">
            {cardData.image ? (
                <img className="card-image" src={cardData.image} alt={item.title} loading="lazy" />
            ) : null}
            <div className="card-body">
                <div className="meta">
                    <span>{formatDateTime(item.published_date, item.published_time, item.published_at)}</span>
                    <span>{item.source}</span>
                    <span className="flag">{item.rights_flag}</span>
                    <span
                        className={`interest-pill ${cardData.interest === "interesting" ? "interest-good" : "interest-bad"}`}
                        title={cardData.interest === "interesting" ? "Article looks interesting" : "Article looks less interesting"}
                    >
                        {cardData.interest === "interesting" ? "Interesting" : "Not interesting"}
                    </span>
                </div>
                <h3>{item.title}</h3>
                <p className="excerpt">{cardData.contentToShow}</p>
                {cardData.hasMoreContent ? (
                    <button
                        type="button"
                        className="content-toggle"
                        onClick={() => onToggleExpanded(item.id)}
                        aria-expanded={cardData.isExpanded}
                    >
                        {cardData.isExpanded ? "Show less" : "Show more"}
                    </button>
                ) : null}
                <div className="links">
                    <a href={item.url} target="_blank" rel="noreferrer">
                        Source
                    </a>
                    <a href={cardData.articleLink} target="_blank" rel="noreferrer">
                        Local article
                    </a>
                </div>
            </div>
        </article>
    );
}
