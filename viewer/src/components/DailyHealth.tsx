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
    const [isModalOpen, setIsModalOpen] = React.useState(false);

    const closeModal = React.useCallback((): void => {
        setIsModalOpen(false);
    }, []);

    React.useEffect(() => {
        if (!isModalOpen) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                closeModal();
            }
        };

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKeyDown);

        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [closeModal, isModalOpen]);

    const renderResourceList = React.useCallback(
        (
            label: string,
            sources: Array<{
                source_id?: string;
                source_name: string;
                source_url?: string;
                feed_url?: string;
            }>,
            emptyLabel: string,
        ): JSX.Element => {
            if (!Array.isArray(sources) || sources.length === 0) {
                return (
                    <section className="resource-modal-section">
                        <h3>{label}</h3>
                        <p className="status-row muted">{emptyLabel}</p>
                    </section>
                );
            }

            return (
                <section className="resource-modal-section">
                    <h3>
                        {label} ({safeNumber(sources.length)})
                    </h3>
                    <ul className="resource-modal-list">
                        {sources.map((source, index) => {
                            const key = `${source.source_id ?? source.source_name}-${index}`;
                            return <li key={key}>{renderResourceRefs([source])}</li>;
                        })}
                    </ul>
                </section>
            );
        },
        [renderResourceRefs],
    );

    return (
        <>
            <section className="status-card daily-card">
                <div className="daily-card-head">
                    <h2>Per-day resources</h2>
                    <button
                        type="button"
                        className="daily-modal-button"
                        onClick={() => {
                            setIsModalOpen(true);
                        }}
                    >
                        Per-day resources
                    </button>
                </div>
                {dailyHealth.length > 0 ? (
                    <p className="status-row muted">
                        Open modal to view all daily checks and resource lists.
                    </p>
                ) : (
                    <p className="status-row muted">Daily health summary not found yet.</p>
                )}
            </section>

            {isModalOpen ? (
                <div
                    className="resource-modal-overlay"
                    role="presentation"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            closeModal();
                        }
                    }}
                >
                    <section className="resource-modal" role="dialog" aria-modal="true" aria-label="All per-day resources details">
                        <header className="resource-modal-head">
                            <div>
                                <h2>Per-day resources</h2>
                                <p className="status-row muted">
                                    Days: {safeNumber(dailyHealth.length)}
                                </p>
                            </div>
                            <button type="button" className="resource-modal-close" onClick={closeModal}>
                                Close
                            </button>
                        </header>

                        <div className="resource-modal-body">
                            {dailyHealth.length > 0 ? (
                                dailyHealth.map((day) => (
                                    <article key={`all-${day.date}`} className="resource-modal-day">
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
                                        {renderResourceList("Failed", day.failed_resources, "No failed resources.")}
                                        {renderResourceList("Flaky", day.flaky_resources, "No flaky resources.")}
                                        {renderResourceList("Good", day.good_resources, "No good resources.")}
                                    </article>
                                ))
                            ) : (
                                <p className="status-row muted">Daily health summary not found yet.</p>
                            )}
                        </div>
                    </section>
                </div>
            ) : null}
        </>
    );
}
