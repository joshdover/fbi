export interface Logger {
  log(message: string): void;
}

export type StackClient = <TResponse = unknown, TBody = unknown>(
  method: string,
  path: string,
  body?: TBody
) => Promise<TResponse>;
