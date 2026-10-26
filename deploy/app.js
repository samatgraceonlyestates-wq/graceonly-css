// THE STARTUP FILE cPanel runs ("Application startup file: app.js" in Setup Node.js App).
//
// It sits in the root of the ASSEMBLED standalone output (scripts/build-standalone.mjs copies
// it to .next/standalone/app.js, beside Next's own server.js), and does three things only:
//
//  1. PORT: cPanel's launcher (Phusion Passenger) gives the app its port through the
//     environment. Next's server.js reads process.env.PORT itself (3000 if unset); nothing here
//     hard-codes one. Under Passenger the port barely matters (it takes over listen()), but it
//     must still come from the environment, never from this file.
//  2. HOST: Next's server.js binds to process.env.HOSTNAME. On Linux, HOSTNAME is very often
//     already set to the MACHINE'S NAME by the shell, which would make Next listen on whatever
//     address that name resolves to. So the address comes from HOST (set it in cPanel if the
//     host requires one) and otherwise is 0.0.0.0, Next's own default.
//  3. NODE_ENV: production (server.js sets it too). It turns on the Secure session cookie.
//
// Everything else (DATABASE_URL, CSS_PORTAL_BASE_URL, CSS_PORTAL_SERVICE_KEY) is read by the app
// from the environment when needed. This file reads no secret and logs nothing.
//
// Plain CommonJS on purpose: it runs as-is under Node 22, with no build step of its own, and
// Passenger loads a startup file with require(); Next's server.js beside it is CommonJS too.
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS startup file, see above */
"use strict";

const path = require("node:path");

process.env.NODE_ENV = "production";
process.env.HOSTNAME = process.env.HOST || "0.0.0.0";

require(path.join(__dirname, "server.js"));
