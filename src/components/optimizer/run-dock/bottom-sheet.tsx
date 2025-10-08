"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

export type SheetState = "peek" | "short" | "full";

const SHEET_STATES: SheetState[] = ["peek", "short", "full"];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function computeHeights(viewportHeight: number): Record<SheetState, number> {
  const peek = 72;
  const shortBase = viewportHeight < 960 ? 440 : viewportHeight * 0.46;
  const short = clamp(shortBase, 360, viewportHeight * 0.72);
  const full = clamp(viewportHeight * 0.92, short + 40, viewportHeight - 24);
  return {
    peek,
    short,
    full,
  } satisfies Record<SheetState, number>;
}

type BottomSheetProps = {
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  header: ReactNode;
  children: ReactNode;
  className?: string;
};

const FALLBACK_VIEWPORT_HEIGHT = 900;

export function BottomSheet({
  state,
  onStateChange,
  header,
  children,
  className,
}: BottomSheetProps) {
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  useEffect(() => {
    const handler = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", handler);
    handler();
    return () => window.removeEventListener("resize", handler);
  }, []);

  const heights = useMemo(
    () => computeHeights(viewportHeight),
    [viewportHeight]
  );

  const targetHeight = heights[state];
  const dragData = useRef<{
    pointerId: number | null;
    startY: number;
    startHeight: number;
  }>({ pointerId: null, startY: 0, startHeight: targetHeight });
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragHeightRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const isDragging = dragHeight !== null;

  const displayHeight = dragHeight ?? targetHeight;

  useEffect(() => {
    dragHeightRef.current = dragHeight;
  }, [dragHeight]);

  useEffect(() => {
    if (!isDragging) {
      dragData.current = {
        pointerId: null,
        startY: 0,
        startHeight: targetHeight,
      };
    } else {
      dragData.current.startHeight = targetHeight;
    }
  }, [isDragging, targetHeight]);

  const finishDrag = useCallback(
    (height: number) => {
      const clamped = clamp(height, heights.peek, heights.full);
      let nextState: SheetState = state;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const candidate of SHEET_STATES) {
        const diff = Math.abs(clamped - heights[candidate]);
        if (diff < bestDiff) {
          bestDiff = diff;
          nextState = candidate;
        }
      }
      setDragHeight(null);
      if (nextState !== state) {
        onStateChange(nextState);
      }
    },
    [heights, onStateChange, state]
  );

  useEffect(() => () => {
    cleanupRef.current?.();
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary) return;
      event.preventDefault();

      const pointerId = event.pointerId;
      dragData.current = {
        pointerId,
        startY: event.clientY,
        startHeight: displayHeight,
      };
      setDragHeight(displayHeight);

      cleanupRef.current?.();

      const handlePointerMoveWindow = (moveEvent: PointerEvent) => {
        if (dragData.current.pointerId !== pointerId) return;
        const delta = dragData.current.startY - moveEvent.clientY;
        const overshoot = Math.max(56, viewportHeight * 0.08);
        const nextHeight = clamp(
          dragData.current.startHeight + delta,
          heights.peek - overshoot,
          heights.full + overshoot
        );
        setDragHeight(nextHeight);
      };

      const finishAndCleanup = () => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        dragData.current.pointerId = null;
      };

      const handlePointerUpWindow = () => {
        if (dragData.current.pointerId !== pointerId) return;
        finishAndCleanup();
        finishDrag(dragHeightRef.current ?? targetHeight);
      };

      const handlePointerCancelWindow = () => {
        if (dragData.current.pointerId !== pointerId) return;
        finishAndCleanup();
        setDragHeight(null);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMoveWindow);
        window.removeEventListener("pointerup", handlePointerUpWindow);
        window.removeEventListener("pointercancel", handlePointerCancelWindow);
      };

      cleanupRef.current = cleanup;

      window.addEventListener("pointermove", handlePointerMoveWindow);
      window.addEventListener("pointerup", handlePointerUpWindow, { once: false });
      window.addEventListener("pointercancel", handlePointerCancelWindow, { once: false });
    },
    [displayHeight, finishDrag, heights.full, heights.peek, targetHeight, viewportHeight]
  );

  const shadowClass = state === "peek"
    ? "shadow-[0_-8px_24px_rgba(15,23,42,0.12)]"
    : state === "short"
      ? "shadow-[0_-18px_50px_rgba(15,23,42,0.18)]"
      : "shadow-[0_-28px_70px_rgba(15,23,42,0.24)]";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
      <div className="pointer-events-auto w-full">
        <div
          className={cn(
            "relative overflow-hidden rounded-t-3xl border border-neutral-200 border-b-0 bg-white/95 backdrop-blur",
            shadowClass,
            isDragging ? "cursor-grabbing" : "cursor-default",
            className
          )}
          style={{
            height: displayHeight,
            transition: isDragging
              ? "none"
              : "height 260ms cubic-bezier(0.32,0.72,0,1), box-shadow 200ms ease",
          }}
        >
          <div
            className="absolute left-1/2 top-2 z-20 flex h-10 w-28 -translate-x-1/2 items-center justify-center cursor-grab active:cursor-grabbing"
            onPointerDown={handlePointerDown}
          >
            <span className="pointer-events-none h-1.5 w-12 rounded-full bg-neutral-300" />
          </div>
          <div className="relative flex h-full flex-col pt-6">
            <div className="px-4 pb-3 sm:px-6 sm:pb-4">
              {header}
            </div>
            {state === "peek" ? null : (
              <div className="flex-1 min-h-0 px-4 pb-4 sm:px-6">
                {children}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
