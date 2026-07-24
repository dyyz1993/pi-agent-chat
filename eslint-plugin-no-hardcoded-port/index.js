"use strict";

/**
 * eslint-plugin-no-hardcoded-port - prevent hardcoded backend ports in source.
 */
const noHardcodedPort = require("./rules/no-hardcoded-port");

module.exports = {
  meta: {
    name: "eslint-plugin-no-hardcoded-port",
    version: "1.0.0",
  },
  rules: {
    "no-hardcoded-port": noHardcodedPort,
  },
  configs: {
    recommended: {
      plugins: ["no-hardcoded-port"],
      rules: {
        "no-hardcoded-port/no-hardcoded-port": "error",
      },
    },
  },
};
