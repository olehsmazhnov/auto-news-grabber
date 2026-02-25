import React from "react";
import type { DayFilterOption } from "../utils/day-filter";
import { safeNumber } from "../utils/scrape-status";

type DayFilterProps = {
    options: DayFilterOption[];
    selectedDayKey: string | null;
    onSelectDay: (dayKey: string) => void;
};

export function DayFilter({
    options,
    selectedDayKey,
    onSelectDay,
}: DayFilterProps): JSX.Element {
    return (
        <section className="status-card day-filter-card">
            <h2>Posts by day</h2>
            {options.length > 0 ? (
                <div className="day-filter-list">
                    {options.map((option) => {
                        const isActive = option.dayKey === selectedDayKey;
                        return (
                            <button
                                key={option.dayKey}
                                type="button"
                                className={`day-filter-button${isActive ? " is-active" : ""}`}
                                onClick={() => {
                                    onSelectDay(option.dayKey);
                                }}
                            >
                                <span>{option.label}</span>
                                <span>{safeNumber(option.count)}</span>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <p className="status-row muted">No dated posts yet.</p>
            )}
        </section>
    );
}
