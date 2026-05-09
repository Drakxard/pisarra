"use client";

import dynamic from "next/dynamic";
import { Component, forwardRef, type ErrorInfo, type ReactNode } from "react";
import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
  },
);

type ExcalidrawMapCanvasProps = ExcalidrawProps & {
  errorKey?: string;
  onRenderError?: (error: Error) => void;
  fallback?: ReactNode;
};

type CanvasBoundaryProps = {
  children: ReactNode;
  errorKey?: string;
  fallback?: ReactNode;
  onRenderError?: (error: Error) => void;
};

type CanvasBoundaryState = {
  error: Error | null;
};

class CanvasErrorBoundary extends Component<CanvasBoundaryProps, CanvasBoundaryState> {
  state: CanvasBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return {
      error,
    };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    this.props.onRenderError?.(error);
  }

  componentDidUpdate(previousProps: CanvasBoundaryProps) {
    if (previousProps.errorKey !== this.props.errorKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}

export const ExcalidrawMapCanvas = forwardRef<HTMLDivElement, ExcalidrawMapCanvasProps>(function ExcalidrawMapCanvas(
  { errorKey, onRenderError, fallback, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className="excalidraw-host"
    >
      <CanvasErrorBoundary errorKey={errorKey} onRenderError={onRenderError} fallback={fallback}>
        <Excalidraw langCode="es-ES" {...props} />
      </CanvasErrorBoundary>
    </div>
  );
});
