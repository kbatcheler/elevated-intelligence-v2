import { createHmac } from "node:crypto";

// The agent resolves credentials and tokenizes identifiers entirely inside the
// client boundary. Secrets are read from the agent's own local environment by
// reference (the authRef the framework hands out is a pointer, never a value),
// and tokenization is a keyed, non-reversible HMAC whose salt never leaves the
// client network. The mapping from identifier to token therefore stays local,
// which is what lets the agent derive and discard without exporting anything
// that could be reversed into raw client data.

export interface LocalSecrets {
  resolveSecret(ref: string): Promise<string>;
  tokenize(value: string): string;
}

export function createLocalSecrets(opts: {
  tokenizeSalt: string;
  env?: Record<string, string | undefined>;
}): LocalSecrets {
  const env = opts.env ?? process.env;
  if (!opts.tokenizeSalt) {
    throw new Error("Edge agent tokenize salt must be a non-empty local secret");
  }
  return {
    async resolveSecret(ref: string): Promise<string> {
      const value = env[ref];
      if (value === undefined || value === "") {
        throw new Error("Edge agent secret " + ref + " is not set in the local environment");
      }
      return value;
    },
    tokenize(value: string): string {
      return createHmac("sha256", opts.tokenizeSalt).update(value).digest("base64url");
    },
  };
}
