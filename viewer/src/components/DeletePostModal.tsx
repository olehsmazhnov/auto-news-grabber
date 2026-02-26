import React from "react";
import type { NewsItem } from "../types";
import { formatDateTime } from "../utils/date";

type DeletePostModalProps = {
    item: NewsItem | null;
    isSaving: boolean;
    errorMessage: string;
    onCancel: () => void;
    onConfirm: (item: NewsItem) => void;
};

function stopOverlayBubbling(event: React.MouseEvent<HTMLElement>): void {
    event.stopPropagation();
}

export function DeletePostModal({
    item,
    isSaving,
    errorMessage,
    onCancel,
    onConfirm,
}: DeletePostModalProps): JSX.Element | null {
    React.useEffect(() => {
        if (!item) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape" && !isSaving) {
                onCancel();
            }
        };

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKeyDown);

        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [item, isSaving, onCancel]);

    if (!item) {
        return null;
    }

    return (
        <div
            className="delete-modal-overlay"
            role="presentation"
            onClick={() => {
                if (!isSaving) {
                    onCancel();
                }
            }}
        >
            <section
                className="delete-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Delete post"
                onClick={stopOverlayBubbling}
            >
                <header className="delete-modal-head">
                    <h2>Delete post from sync?</h2>
                    <button
                        type="button"
                        className="delete-modal-close"
                        onClick={onCancel}
                        disabled={isSaving}
                    >
                        Close
                    </button>
                </header>

                <div className="delete-modal-body">
                    <p className="status-row">
                        This post will be hidden in the viewer and excluded from future Supabase sync.
                    </p>
                    <p className="status-row">
                        <strong>{item.title}</strong>
                    </p>
                    <p className="status-row muted">
                        {item.source} · {formatDateTime(item.published_date, item.published_time, item.published_at)}
                    </p>
                    {errorMessage ? <p className="status-row delete-modal-error">{errorMessage}</p> : null}
                </div>

                <footer className="delete-modal-actions">
                    <button
                        type="button"
                        className="delete-modal-cancel"
                        onClick={onCancel}
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="delete-modal-confirm"
                        onClick={() => onConfirm(item)}
                        disabled={isSaving}
                    >
                        {isSaving ? "Deleting..." : "Delete"}
                    </button>
                </footer>
            </section>
        </div>
    );
}
