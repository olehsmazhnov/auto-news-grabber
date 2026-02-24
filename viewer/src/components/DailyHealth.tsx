import React from "react";
import type { DailyHealthReport } from "../types";
import { safeNumber } from "../utils/scrape-status";

type DailyHealthProps = {
    dailyHealth: DailyHealthReport[];
    renderResourceRefs: (
        sources: Array<{
            source_id?: string;
            source_name: string;
            source_url?: string;
            feed_url?: string;
        }>
    ) => React.ReactNode;
};

export function DailyHealth({ dailyHealth, renderResourceRefs }: DailyHealthProps): JSX.Element {
    return (
        <section className="status-card daily-card">
            <h2>Per-day resources</h2>
            {dailyHealth.length > 0 ? (
                <div className="daily-list">
                    {dailyHealth.map((day) => (
                        <article key={day.date} className="daily-item">
                            <div className="daily-head">
                                <strong>{day.date}</strong>
                                <span>
                                    runs: {safeNumber(day.run_count)} / items: {safeNumber(day.items_saved)}
                                </span>
                                <span>
                                    checks: ok {safeNumber(day.resource_checks?.ok_resources)} / empty{" "}
                                    {safeNumber(day.resource_checks?.empty_resources)} / failed{" "}
                                    {safeNumber(day.resource_checks?.failed_resources)}
                                </span>
                            </div>
                            <p className="status-row">Failed: {renderResourceRefs(day.failed_resources)}</p>
                            <p className="status-row">Flaky: {renderResourceRefs(day.flaky_resources)}</p>
                            <p className="status-row">Good: {renderResourceRefs(day.good_resources)}</p>
                        </article>
                    ))}
                </div>
            ) : (
                <p className="status-row muted">Daily health summary not found yet.</p>
            )}
        </section>
    );
}
