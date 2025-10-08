import {
  type Context,
  Span,
  SpanStatusCode,
  Tracer,
  context as otContext,
  trace,
} from "@opentelemetry/api";
import { randomUUID } from "crypto";

export type TelemetryEvent = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  status: "start" | "end" | "error";
  timestamp: number;
  durationMs?: number;
  attributes?: Record<string, unknown>;
  errorMessage?: string;
};

export type TelemetryListener = (event: TelemetryEvent) => void;

const makeTraceId = () => randomUUID().replace(/-/g, "").slice(0, 32);
const makeSpanId = () => randomUUID().replace(/-/g, "").slice(0, 16);

class LocalSpan {
  private endTime: number | null = null;
  private status: { code: number; message?: string } | undefined;
  private attributes: Record<string, unknown> = {};
  private readonly startTime = Date.now();

  constructor(
    private readonly name: string,
    private readonly listener: TelemetryListener,
    traceId?: string,
    parentSpanId?: string,
    attributes?: Record<string, unknown>,
  ) {
    this.traceId = traceId ?? makeTraceId();
    this.parentSpanId = parentSpanId;
    this.spanId = makeSpanId();
    if (attributes) this.attributes = { ...attributes };
    if (parentSpanId) this.attributes.parentSpanId = parentSpanId;

    this.listener({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      status: "start",
      timestamp: this.startTime,
      attributes: this.attributes,
    });
  }

  private readonly traceId: string;
  private readonly spanId: string;
  private readonly parentSpanId?: string;

  spanContext() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      traceFlags: 1,
    } as const;
  }

  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Record<string, unknown>) {
    Object.assign(this.attributes, attributes);
    return this;
  }

  addEvent(_name: string, _attributes?: Record<string, unknown>) {
    void _name;
    void _attributes;
    return this;
  }

  setStatus(status: { code: number; message?: string }) {
    this.status = status;
    return this;
  }

  recordException(exception: unknown) {
    const message = exception instanceof Error ? exception.message : String(exception);
    this.listener({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      status: "error",
      timestamp: Date.now(),
      attributes: this.attributes,
      errorMessage: message,
    });
    return this;
  }

  updateName(_name: string) {
    void _name;
    return this;
  }

  isRecording() {
    return true;
  }

  end() {
    if (this.endTime !== null) return;
    this.endTime = Date.now();
    this.listener({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      status: "end",
      timestamp: this.endTime,
      durationMs: this.endTime - this.startTime,
      attributes: this.attributes,
      errorMessage: this.status?.code === SpanStatusCode.ERROR ? this.status?.message : undefined,
    });
  }

}

type AttributeSupplier = () => Record<string, unknown> | null;

class LocalTracer implements Tracer {
  constructor(
    private readonly listener: TelemetryListener,
    private readonly attributeSupplier?: AttributeSupplier,
  ) {}

  startSpan(name: string, options?: { attributes?: Record<string, unknown> }, contextArg?: Context): Span {
    const parentContext = contextArg ?? otContext.active();
    const parentSpan = trace.getSpan(parentContext);
    const parentSpanContext = parentSpan?.spanContext();
    const suppliedAttributes = this.attributeSupplier?.() ?? null;
    const initialAttributes = suppliedAttributes
      ? { ...suppliedAttributes, ...(options?.attributes ?? {}) }
      : options?.attributes;
    const localSpan = new LocalSpan(
      name,
      this.listener,
      parentSpanContext?.traceId,
      parentSpanContext?.spanId,
      initialAttributes,
    );
    return localSpan as unknown as Span;
  }

  startActiveSpan<T>(name: string, arg2?: unknown, arg3?: unknown, arg4?: unknown): T {
    let options: { attributes?: Record<string, unknown> } | undefined;
    let ctx: Context | undefined;
    let fn: ((span: Span) => T) | undefined;

    if (typeof arg2 === "function") {
      fn = arg2 as (span: Span) => T;
    } else if (typeof arg3 === "function") {
      options = arg2 as { attributes?: Record<string, unknown> } | undefined;
      fn = arg3 as (span: Span) => T;
    } else if (typeof arg4 === "function") {
      options = arg2 as { attributes?: Record<string, unknown> } | undefined;
      ctx = arg3 as Context | undefined;
      fn = arg4 as (span: Span) => T;
    }

    if (!fn) {
      throw new Error("startActiveSpan requires a callback function");
    }

    const parentContext = ctx ?? otContext.active();
    const suppliedAttributes = this.attributeSupplier?.() ?? null;
    const mergedOptions = suppliedAttributes
      ? { ...options, attributes: { ...suppliedAttributes, ...(options?.attributes ?? {}) } }
      : options;

    const localSpan = this.startSpan(name, mergedOptions, parentContext) as unknown as LocalSpan;
    const spanProxy = localSpan as unknown as Span;
    const contextWithSpan = trace.setSpan(parentContext, spanProxy);

    const invoke = () => {
      try {
        const result = fn!(spanProxy);
        const maybePromise = result as unknown as Promise<unknown> | undefined;
        if (maybePromise && typeof maybePromise.then === "function") {
          return (maybePromise
            .catch((error: unknown) => {
              localSpan.recordException(error);
              localSpan.setStatus?.({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
              throw error;
            })
            .finally(() => localSpan.end())) as T;
        }
        localSpan.end();
        return result;
      } catch (error) {
        localSpan.recordException(error);
        localSpan.setStatus?.({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
        localSpan.end();
        throw error;
      }
    };

    return otContext.with(contextWithSpan, invoke);
  }

  // Unused tracer APIs implemented as no-ops
  getCurrentSpan() {
    return undefined;
  }

  withSpan<T>(_span: Span, fn: () => T): T {
    return fn();
  }

  bind<T>(target: T, _context?: unknown): T {
    void _context;
    return target;
  }
}

export function createTelemetrySettings(
  listener: TelemetryListener,
  options?: { attributeSupplier?: AttributeSupplier },
) {
  return {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
    tracer: new LocalTracer(listener, options?.attributeSupplier),
  } as const;
}
