"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

export type BoardStage = { id: string; name: string };
export type BoardCard = {
  id: string;
  candidateId: string;
  name: string;
  stageId: string | null;
  daysInStage: number;
  feedback: string | null;
};

/**
 * Kanban view of a job's active applications. Drag a card to another column, or use
 * the arrow buttons (keyboard and touch friendly). Moves show instantly and roll back
 * if the server refuses them.
 */
export function Board({
  stages,
  cards,
  canMove,
  moveAction,
}: {
  stages: BoardStage[];
  cards: BoardCard[];
  canMove: boolean;
  moveAction: (applicationId: string, stageId: string) => Promise<{ ok: boolean }>;
}) {
  const [optimisticCards, applyMove] = useOptimistic(
    cards,
    (state, move: { id: string; stageId: string }) =>
      state.map((c) => (c.id === move.id ? { ...c, stageId: move.stageId, daysInStage: 0 } : c)),
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // After an arrow-button move the card re-renders in another column and focus would be lost.
  const [refocus, setRefocus] = useState<{ id: string; direction: "back" | "forward" } | null>(null);

  useEffect(() => {
    if (!refocus) return;
    const card = boardRef.current?.querySelector<HTMLElement>(`[data-card-id="${refocus.id}"]`);
    if (!card) return;
    // Prefer the same-direction button so pressing Enter again keeps moving the card.
    const button = card.querySelector<HTMLElement>(`[data-direction="${refocus.direction}"]`);
    (button ?? card).focus();
  }, [refocus, optimisticCards]);

  function move(card: BoardCard, stageId: string, direction?: "back" | "forward") {
    if (card.stageId === stageId) return;
    setError(null);
    setRefocus(direction ? { id: card.id, direction } : null);
    startTransition(async () => {
      applyMove({ id: card.id, stageId });
      const result = await moveAction(card.id, stageId);
      if (!result.ok) setError(`Couldn't move ${card.name}. Refresh and try again.`);
    });
  }

  // Applications without a stage (a job with no stages) get their own column, so nobody is hidden.
  const columns: (BoardStage & { droppable: boolean })[] = [
    ...(optimisticCards.some((c) => c.stageId === null) ? [{ id: "", name: "No stage", droppable: false }] : []),
    ...stages.map((s) => ({ ...s, droppable: true })),
  ];

  return (
    <>
      {error && (
        <p role="alert" className="error mb-3 text-sm">
          {error}
        </p>
      )}
      <div ref={boardRef} className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((column) => {
          const inColumn = optimisticCards.filter((c) => (c.stageId ?? "") === column.id);
          const index = stages.findIndex((s) => s.id === column.id);
          return (
            <section
              key={column.id || "none"}
              aria-label={column.name}
              className="card w-60 shrink-0 p-2"
              style={dropTarget === column.id ? { outline: "2px solid var(--accent)" } : undefined}
              onDragOver={(e) => {
                if (!canMove || !column.droppable) return;
                e.preventDefault();
                setDropTarget(column.id);
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                const card = optimisticCards.find((c) => c.id === e.dataTransfer.getData("text/plain"));
                if (card && column.droppable) move(card, column.id);
              }}
            >
              <h3 className="mb-2 flex items-baseline justify-between px-1 text-sm font-medium">
                {column.name}
                <span className="muted text-xs">{inColumn.length}</span>
              </h3>
              <ul className="min-h-16 space-y-2">
                {inColumn.map((card) => {
                  const prev = index > 0 ? stages[index - 1] : null;
                  const next = index >= 0 && index < stages.length - 1 ? stages[index + 1] : null;
                  return (
                    <li
                      key={card.id}
                      data-card-id={card.id}
                      tabIndex={-1}
                      aria-label={card.name}
                      draggable={canMove}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", card.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="rounded-md border p-2 text-sm"
                      style={{ borderColor: "var(--border)", background: "var(--bg)", cursor: canMove ? "grab" : undefined }}
                    >
                      <Link href={`/candidates/${card.candidateId}`} className="font-medium hover:underline">
                        {card.name}
                      </Link>
                      <div className="muted mt-0.5 text-xs">
                        {card.daysInStage === 0 ? "Today" : `${card.daysInStage}d in stage`}
                        {card.feedback && ` · ${card.feedback}`}
                      </div>
                      {canMove && (prev || next) && (
                        <div className="mt-2 flex justify-between">
                          {prev ? (
                            <button
                              type="button"
                              className="link text-xs"
                              data-direction="back"
                              onClick={() => move(card, prev.id, "back")}
                              aria-label={`Move ${card.name} back to ${prev.name}`}
                            >
                              ← {prev.name}
                            </button>
                          ) : (
                            <span />
                          )}
                          {next && (
                            <button
                              type="button"
                              className="link text-xs"
                              data-direction="forward"
                              onClick={() => move(card, next.id, "forward")}
                              aria-label={`Move ${card.name} forward to ${next.name}`}
                            >
                              {next.name} →
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
