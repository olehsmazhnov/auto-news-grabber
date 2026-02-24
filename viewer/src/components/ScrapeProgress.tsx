import type { ScrapeStatusSnapshot } from "../types";
import { clampPercent, stageLabel } from "../utils/scrape-status";

type ScrapeProgressProps = {
    status: ScrapeStatusSnapshot;
};

export function ScrapeProgress({ status }: ScrapeProgressProps): JSX.Element {
    const progressPercent = clampPercent(status.progress_percent);
    const progressStage = stageLabel(status.stage ?? "initializing");
    const progressMessage = status.message || "Scrape is running...";
    const progressError = status.error || "";

    return (
        <div className="scrape-loader" role="status" aria-live="polite" aria-atomic="true">
            <div className="scrape-loader-head">
                <span className="scrape-loader-spinner" aria-hidden="true" />
                <span className="scrape-loader-message">{progressMessage}</span>
                <strong className="scrape-loader-percent">{progressPercent}%</strong>
            </div>
            <div className="scrape-loader-track" aria-hidden="true">
                <span className="scrape-loader-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="scrape-loader-stage">
                Stage: {progressStage}
                {progressError ? ` | ${progressError}` : ""}
            </p>
        </div>
    );
}
