// Stands in for the `cloudflare:workers` module when unit tests run in Node.
export class DurableObject<Env = unknown> {
  constructor(
    public ctx: unknown,
    public env: Env,
  ) {}
}
