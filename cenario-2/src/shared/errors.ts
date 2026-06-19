export abstract class AppError extends Error {
	public readonly code: string;
	public readonly details?: Record<string, unknown>;

	protected constructor(code: string, message: string, details?: Record<string, unknown>) {
		super(message);
		this.code = code;
		this.details = details;
	}
}

export class ValidationError extends AppError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("VALIDATION_ERROR", message, details);
	}
}

export class SearchError extends AppError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("SEARCH_ERROR", message, details);
	}
}

export class CompletionError extends AppError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("COMPLETION_ERROR", message, details);
	}
}

