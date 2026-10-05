// Errors whose message is safe to show to players.
export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
