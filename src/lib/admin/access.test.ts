import { exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { isAdminRequest, readAccessConfig, type AccessConfig } from "./access";

const config: AccessConfig = {
  teamDomain: "team.cloudflareaccess.com",
  aud: "aud-123",
  adminEmail: "admin@p-hook.com",
};

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  otherPrivateKey = (await generateKeyPair("RS256")).privateKey as CryptoKey;
  const jwk = await exportJWK(pair.publicKey);
  getKey = (async () => {
    const { importJWK } = await import("jose");
    return importJWK(jwk, "RS256");
  }) as JWTVerifyGetKey;
});

function sign(
  claims: { email?: string; aud?: string; iss?: string },
  key: CryptoKey = privateKey,
  expiresIn = "10m",
) {
  return new SignJWT(claims.email ? { email: claims.email } : {})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(claims.iss ?? `https://${config.teamDomain}`)
    .setAudience(claims.aud ?? config.aud)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

const withToken = (token?: string) =>
  new Headers(token ? { "cf-access-jwt-assertion": token } : undefined);

describe("readAccessConfig", () => {
  it("is null until both team domain and AUD are set", () => {
    expect(readAccessConfig({})).toBeNull();
    expect(readAccessConfig({ CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com" })).toBeNull();
    expect(readAccessConfig({ CF_ACCESS_AUD: "x" })).toBeNull();
  });

  it("cleans the team domain and defaults the admin email", () => {
    expect(
      readAccessConfig({
        CF_ACCESS_TEAM_DOMAIN: "https://t.cloudflareaccess.com/",
        CF_ACCESS_AUD: "x",
      }),
    ).toEqual({ teamDomain: "t.cloudflareaccess.com", aud: "x", adminEmail: "admin@p-hook.com" });
    expect(
      readAccessConfig({
        CF_ACCESS_TEAM_DOMAIN: "t",
        CF_ACCESS_AUD: "x",
        ADMIN_EMAIL: "Boss@Example.com",
      })?.adminEmail,
    ).toBe("boss@example.com");
  });
});

describe("isAdminRequest", () => {
  it("lets the admin in with a valid token", async () => {
    const token = await sign({ email: "Admin@p-hook.com" });
    expect(await isAdminRequest(withToken(token), config, getKey)).toBe(true);
  });

  it("refuses when Access is not configured, even with a token", async () => {
    const token = await sign({ email: "admin@p-hook.com" });
    expect(await isAdminRequest(withToken(token), null, getKey)).toBe(false);
  });

  it("refuses a request with no token", async () => {
    expect(await isAdminRequest(withToken(), config, getKey)).toBe(false);
  });

  it("refuses another email", async () => {
    const token = await sign({ email: "someone@else.com" });
    expect(await isAdminRequest(withToken(token), config, getKey)).toBe(false);
  });

  it("refuses a token with no email", async () => {
    expect(await isAdminRequest(withToken(await sign({})), config, getKey)).toBe(false);
  });

  it("refuses the wrong audience or issuer", async () => {
    expect(
      await isAdminRequest(
        withToken(await sign({ email: "admin@p-hook.com", aud: "other" })),
        config,
        getKey,
      ),
    ).toBe(false);
    expect(
      await isAdminRequest(
        withToken(await sign({ email: "admin@p-hook.com", iss: "https://evil.example" })),
        config,
        getKey,
      ),
    ).toBe(false);
  });

  it("refuses a token signed with another key", async () => {
    const token = await sign({ email: "admin@p-hook.com" }, otherPrivateKey);
    expect(await isAdminRequest(withToken(token), config, getKey)).toBe(false);
  });

  it("refuses an expired token and garbage", async () => {
    const expired = await sign({ email: "admin@p-hook.com" }, privateKey, "-1m");
    expect(await isAdminRequest(withToken(expired), config, getKey)).toBe(false);
    expect(await isAdminRequest(withToken("not.a.jwt"), config, getKey)).toBe(false);
  });
});
