/** Thrown when a record does not exist, or belongs to another organization. Rendered as a 404. */
export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thrown when the actor lacks the permission an action needs. */
export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Thrown when an action conflicts with existing data or a business rule. */
export class ConflictError extends Error {
  constructor(message = "That conflicts with existing data.") {
    super(message);
    this.name = "ConflictError";
  }
}
