import * as client from "openid-client";
import type { Config } from "../config.js";

export interface LoginChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface Identity {
  sub: string;
  email: string;
}

/** Abstração do provedor OIDC; testes injetam uma implementação falsa. */
export interface IdentityProvider {
  start(redirectUri: string): Promise<{ url: string; checks: LoginChecks }>;
  finish(callbackUrl: URL, checks: LoginChecks): Promise<Identity>;
}

export function googleProvider(cfg: NonNullable<Config["google"]>): IdentityProvider {
  let discovered: Promise<client.Configuration> | undefined;
  const conf = () =>
    (discovered ??= client.discovery(new URL("https://accounts.google.com"), cfg.clientId, cfg.clientSecret));

  return {
    async start(redirectUri) {
      const config = await conf();
      const checks: LoginChecks = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: "openid email",
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(checks.codeVerifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return { url: url.href, checks };
    },
    async finish(callbackUrl, checks) {
      const config = await conf();
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error("ID token sem sub");
      return { sub: claims.sub, email: String(claims.email ?? "") };
    },
  };
}
