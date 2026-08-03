/** @type {import('next').NextConfig} */
const nextConfig = {
  // firebase-admin pulls in jwks-rsa -> jose, and jose's newer versions
  // ship an ESM-only build. When Next's webpack bundler tries to bundle
  // firebase-admin into a serverless function, it produces a CommonJS
  // require() of that ESM file, which crashes at runtime with
  // ERR_REQUIRE_ESM — only on routes that happen to exercise the code path
  // inside firebase-admin that touches jwks-rsa (createCustomToken /
  // updateUser), which is why /api/oauth/google/refresh was fine but the
  // new LinkedIn callback route wasn't. Marking firebase-admin as an
  // external package tells Next to leave it as a plain Node require()
  // resolved at runtime instead of bundling it, sidestepping the ESM/CJS
  // interop problem entirely.
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};
module.exports = nextConfig;
