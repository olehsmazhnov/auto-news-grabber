import React from "react";
import type { ScrapeStatusSnapshot } from "../types";
import { ScrapeProgress } from "./ScrapeProgress";

type HeaderProps = {
    scrapeIsRunning: boolean;
    scrapeProgressPercent: number;
    scrapeRunState: "idle" | "running" | "success" | "error";
    scrapeRunMessage: string;
    scrapeProgress: ScrapeStatusSnapshot | null;
    supabaseSyncState: "idle" | "saving" | "success" | "error";
    supabaseSyncMessage: string;
    onRunScrape: () => void;
    onSyncToSupabase: () => void;
};

export function Header({
    scrapeIsRunning,
    scrapeProgressPercent,
    scrapeRunState,
    scrapeRunMessage,
    scrapeProgress,
    supabaseSyncState,
    supabaseSyncMessage,
    onRunScrape,
    onSyncToSupabase,
}: HeaderProps): JSX.Element {
    return (
        <header className="header">
            <h1>Auto News Viewer</h1>
            <p>Latest snapshot with run diagnostics and daily resource health.</p>
            <div className="header-actions">
                <button
                    type="button"
                    className="scrape-run-button"
                    disabled={scrapeIsRunning || supabaseSyncState === "saving"}
                    onClick={onRunScrape}
                >
                    {scrapeIsRunning
                        ? `Scraping ${scrapeProgressPercent}%`
                        : "Run new unique scrape"}
                </button>
                <button
                    type="button"
                    className="supabase-sync-button"
                    disabled={supabaseSyncState === "saving" || scrapeIsRunning}
                    onClick={onSyncToSupabase}
                >
                    {supabaseSyncState === "saving" ? "Saving..." : "Save latest run to Supabase"}
                </button>
                {scrapeRunMessage ? (
                    <p
                        className={`scrape-run-status ${scrapeRunState === "error"
                                ? "scrape-run-status-error"
                                : scrapeRunState === "success"
                                    ? "scrape-run-status-success"
                                    : ""
                            }`}
                    >
                        {scrapeRunMessage}
                    </p>
                ) : null}
                {scrapeIsRunning && scrapeProgress ? (
                    <ScrapeProgress status={scrapeProgress} />
                ) : null}
                {supabaseSyncMessage ? (
                    <p
                        className={`supabase-sync-status ${supabaseSyncState === "error"
                                ? "supabase-sync-status-error"
                                : supabaseSyncState === "success"
                                    ? "supabase-sync-status-success"
                                    : ""
                            }`}
                    >
                        {supabaseSyncMessage}
                    </p>
                ) : null}
            </div>
        </header>
    );
}
