export type PeerlyErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "PRINCIPAL_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "INVALID_OPERATION";

export class PeerlyError extends Error {
  readonly code: PeerlyErrorCode;
  readonly statusCode: number;

  constructor(code: PeerlyErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "PeerlyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
