import React from "react";
import type { ResourceReport, ResourceTotals, RunSummary } from "../types";
import { formatRunTimestamp } from "../utils/date";
import { runTotals } from "../utils/news";
import { safeNumber } from "../utils/scrape-status";

type StatusGridProps = {
    latestRun: RunSummary | null;
    latestTotals: ResourceTotals;
    failedResources: ResourceReport[];
    recentRuns: RunSummary[];
    renderResourceRefs: (
        sources: Array<{
            source_id?: string;
            source_name: string;
            source_url?: string;
            feed_url?: string;
        }>
    ) => React.ReactNode;
};

export function StatusGrid({
    latestRun,
    latestTotals,
    failedResources,
    recentRuns,
    renderResourceRefs,
}: StatusGridProps): JSX.Element {
    return (
        <section className="status-grid">
            <article className="status-card">
                <h2>Latest run</h2>
                {latestRun ? (
                    <div className="status-body">
                        <p className="status-row">
                            <strong>{formatRunTimestamp(latestRun.generated_at)}</strong>
                        </p>
                        <p className="status-row">Run ID: {latestRun.run_id}</p>
                        <p className="status-row">
                            Items saved: {safeNumber(latestRun.total_items)} / collected:{" "}
                            {safeNumber(latestRun.collected_items)} / skipped:{" "}
                            {safeNumber(latestRun.skipped_seen_items)}
                        </p>
                        <div className="pill-row">
                            <span className="pill pill-ok">ok {latestTotals.ok_resources}</span>
                            <span className="pill pill-empty">empty {latestTotals.empty_resources}</span>
                            <span className="pill pill-fail">failed {latestTotals.failed_resources}</span>
                        </div>
                        <p className="status-row">
                            Failed resources:{" "}
                            {renderResourceRefs(failedResources)}
                        </p>
                        <p className="status-row">
                            <a href={`/${latestRun.run_path}/run_summary.json`} target="_blank" rel="noreferrer">
                                Open run summary JSON
                            </a>
                        </p>
                    </div>
                ) : (
                    <p className="status-row muted">No run summary yet.</p>
                )}
            </article>

            <article className="status-card">
                <h2>Recent runs</h2>
                {recentRuns.length > 0 ? (
                    <ul className="run-list">
                        {recentRuns.map((run) => {
                            const totals = runTotals(run);
                            return (
                                <li key={run.run_id} className="run-item">
                                    <a href={`/${run.run_path}/run_summary.json`} target="_blank" rel="noreferrer">
                                        {formatRunTimestamp(run.generated_at)}
                                    </a>
                                    <span>{safeNumber(run.total_items)} saved</span>
                                    <span className={totals.failed_resources > 0 ? "pill pill-fail" : "pill pill-ok"}>
                                        {totals.failed_resources > 0
                                            ? `${totals.failed_resources} failed`
                                            : "all good"}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="status-row muted">Run history not found yet.</p>
                )}
            </article>
        </section>
    );
}
